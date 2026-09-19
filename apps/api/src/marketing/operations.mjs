import { withTransaction } from '../persistence/transactions.mjs';

const DEFAULT_ORG = '00000000-0000-4000-8000-000000000001';

async function resolveOrganizationId(client, actorUserId) {
  if (!actorUserId) return DEFAULT_ORG;
  const { rows } = await client.query(
    'SELECT organization_id FROM users WHERE id=$1 AND is_active=true LIMIT 1',
    [actorUserId]
  );
  if (!rows[0]?.organization_id) throw new Error('Active user organization not found');
  return rows[0].organization_id;
}

export async function createSegment(db, input) {
  return withTransaction(db, async client => {
    const organizationId = await resolveOrganizationId(client, input.actorUserId);
    const segment = (await client.query(
      `INSERT INTO customer_segments (organization_id,name,segment_type,created_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [organizationId,input.name,input.segmentType,input.actorUserId]
    )).rows[0];
    await audit(client,input.actorUserId,'marketing.segment_created','customer_segment',segment.id,{organizationId,segmentType:input.segmentType});
    return segment;
  });
}

export async function createCampaign(db, input) {
  return withTransaction(db, async client => {
    const organizationId = await resolveOrganizationId(client, input.actorUserId);
    const segment = (await client.query(
      'SELECT id FROM customer_segments WHERE id=$1 AND organization_id=$2 AND is_active=true',
      [input.segmentId,organizationId]
    )).rows[0];
    if (!segment) throw new Error('Marketing segment not found');
    const campaign = (await client.query(
      `INSERT INTO marketing_campaigns (organization_id,name,segment_id,channel,message,status,scheduled_at,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [organizationId,input.name,input.segmentId,input.channel,input.message,input.scheduledAt?'scheduled':'draft',input.scheduledAt||null,input.actorUserId]
    )).rows[0];
    await audit(client,input.actorUserId,'marketing.campaign_created','marketing_campaign',campaign.id,{organizationId,channel:input.channel,scheduledAt:input.scheduledAt||null});
    return campaign;
  });
}

export async function launchCampaign(db, { campaignId, actorUserId }) {
  return withTransaction(db, async client => {
    const organizationId = await resolveOrganizationId(client, actorUserId);
    const campaign = (await client.query(
      `SELECT mc.*,cs.segment_type FROM marketing_campaigns mc
       JOIN customer_segments cs ON cs.id=mc.segment_id AND cs.organization_id=mc.organization_id
       WHERE mc.id=$1 AND mc.organization_id=$2 FOR UPDATE OF mc`,
      [campaignId,organizationId]
    )).rows[0];
    if (!campaign) return null;
    if (!['draft','scheduled'].includes(campaign.status)) throw new Error('Campaign is not launchable');
    const audience = await selectAudience(client,campaign.segment_type,null,organizationId);
    for (const customer of audience) {
      const event = (await client.query(
        `INSERT INTO notification_events (event_type,customer_id,channels,payload)
         VALUES ('marketing.campaign',$1,$2,$3::jsonb) RETURNING id`,
        [customer.id,[campaign.channel],JSON.stringify({campaignId:campaign.id,campaignName:campaign.name,message:campaign.message})]
      )).rows[0];
      await client.query(
        `INSERT INTO campaign_recipients (campaign_id,customer_id,notification_event_id)
         VALUES ($1,$2,$3) ON CONFLICT (campaign_id,customer_id) DO NOTHING`,
        [campaign.id,customer.id,event.id]
      );
    }
    const updated = (await client.query(
      `UPDATE marketing_campaigns SET status='queued',launched_at=now(),updated_at=now()
       WHERE id=$1 AND organization_id=$2 RETURNING *`,
      [campaign.id,organizationId]
    )).rows[0];
    await audit(client,actorUserId,'marketing.campaign_launched','marketing_campaign',campaign.id,{organizationId,audienceCount:audience.length,channel:campaign.channel});
    return { campaign:updated, audienceCount:audience.length };
  });
}

export async function previewAudience(db, segmentType, limit = 10, organizationId = DEFAULT_ORG) {
  const rows = await selectAudience(db,segmentType,limit,organizationId);
  return { count:Number(rows[0]?.audience_count||rows.length),customers:rows.map(({audience_count,...customer})=>customer) };
}

async function selectAudience(client, segmentType, limit = null, organizationId = DEFAULT_ORG) {
  const conditions = {
    all: 'true',
    repeat_customers: '(SELECT COUNT(*) FROM orders o WHERE o.customer_id=c.id AND o.paid_at IS NOT NULL) >= 2',
    dormant_90d: `EXISTS (SELECT 1 FROM orders o WHERE o.customer_id=c.id AND o.paid_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id=c.id AND o.paid_at >= now()-interval '90 days')`,
    maintenance_due_30d: `EXISTS (SELECT 1 FROM installed_assets a WHERE a.customer_id=c.id AND a.status='active' AND a.next_maintenance_at < now()+interval '30 days')`,
    high_value: 'COALESCE((SELECT SUM(o.total_ex_vat) FROM orders o WHERE o.customer_id=c.id AND o.paid_at IS NOT NULL),0) >= 2000'
  };
  const condition = conditions[segmentType];
  if (!condition) throw new Error('Invalid marketing segment type');
  const params = [organizationId];
  if (limit) params.push(limit);
  const sql = `SELECT c.id,c.name,u.mobile,COUNT(*) OVER()::integer AS audience_count
    FROM customers c
    LEFT JOIN users u ON u.id=c.user_id
    LEFT JOIN notification_preferences np ON np.user_id=u.id
    WHERE c.organization_id=$1
      AND u.is_active IS DISTINCT FROM false
      AND COALESCE(np.marketing,false)=true
      AND ${condition}
    ORDER BY c.created_at DESC${limit ? ' LIMIT $2' : ''}`;
  return (await client.query(sql,params)).rows;
}

async function audit(client,actorUserId,action,entityType,entityId,data){await client.query(
  `INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,data) VALUES ($1,$2,$3,$4,$5::jsonb)`,
  [actorUserId,action,entityType,entityId,JSON.stringify(data)]
);}
