import { customerIdentityFromOrder, serviceJobFromPaidOrder, extractOrderAttribution } from './woocommerce-order.mjs';
import { withTransaction } from '../persistence/transactions.mjs';

const DEFAULT_ORG = '00000000-0000-4000-8000-000000000001';

export async function persistPaidServiceOrder(db, order, { cityId = 'riyadh', organizationId = DEFAULT_ORG } = {}) {
  if (!['processing','completed'].includes(order?.status)) throw new Error('Order must be paid before creating a service job');
  const mapped = serviceJobFromPaidOrder(order);
  const identity = customerIdentityFromOrder(order);
  const attribution = extractOrderAttribution(order);

  return withTransaction(db, async (client) => {
    const existingOrder = (await client.query(
      `SELECT * FROM orders WHERE organization_id=$1 AND external_source='woocommerce' AND external_order_id=$2 LIMIT 1`,
      [organizationId, String(order.id)]
    )).rows[0];
    if (existingOrder) {
      const existingJob=(await client.query('SELECT * FROM service_jobs WHERE order_id=$1 LIMIT 1',[existingOrder.id])).rows[0]||null;
      return { serviceRequired:Boolean(existingJob), duplicate:true, order:existingOrder, job:existingJob };
    }

    let customer = (await client.query(
      `SELECT c.* FROM customers c JOIN customer_external_identities i ON i.customer_id=c.id
       WHERE c.organization_id=$1 AND i.organization_id=$1 AND i.source='woocommerce' AND i.identity_key=$2 LIMIT 1`,
      [organizationId, identity.identityKey]
    )).rows[0];

    if (!customer) {
      customer = (await client.query(
        `INSERT INTO customers (name,organization_id) VALUES ($1,$2) RETURNING *`,
        [mapped.customer.name, organizationId]
      )).rows[0];
      await client.query(
        `INSERT INTO customer_external_identities (customer_id, source, identity_key, external_customer_id, organization_id)
         VALUES ($1, 'woocommerce', $2, $3, $4)`,
        [customer.id, identity.identityKey, identity.externalCustomerId, organizationId]
      );
    }

    const persistedOrder = (await client.query(
      `INSERT INTO orders (external_source, external_order_id, customer_id, paid_at, total_ex_vat, organization_id)
       VALUES ('woocommerce', $1, $2, now(), $3, $4)
       ON CONFLICT (organization_id, external_source, external_order_id) DO UPDATE SET customer_id=EXCLUDED.customer_id
       RETURNING *`,
      [String(order.id), customer.id, Number(order.total || 0) / 1.15, organizationId]
    )).rows[0];

    for (const item of order.line_items || []) {
      const subtotalExVat = Number(item.total ?? item.subtotal ?? 0);
      await client.query(
        `INSERT INTO order_items
           (order_id, external_line_item_id, product_id, sku, product_name, quantity, subtotal_ex_vat, unit_cost_snapshot)
         SELECT $1, $2, $3, $4, $5, $6, $7, COALESCE(i.unit_cost, 0)
         FROM (SELECT 1) seed LEFT JOIN inventory_items i ON i.organization_id=$8 AND i.sku = NULLIF($4, '')
         ON CONFLICT (order_id, external_line_item_id) DO UPDATE SET
           product_id = EXCLUDED.product_id, sku = EXCLUDED.sku, product_name = EXCLUDED.product_name,
           quantity = EXCLUDED.quantity, subtotal_ex_vat = EXCLUDED.subtotal_ex_vat,
           unit_cost_snapshot = EXCLUDED.unit_cost_snapshot`,
        [persistedOrder.id, String(item.id), item.product_id ? String(item.product_id) : null,
          String(item.sku || ''), String(item.name || 'منتج'), Number(item.quantity || 1), subtotalExVat, organizationId]
      );
    }

    const costRow = (await client.query(
      `SELECT COALESCE(SUM(quantity * unit_cost_snapshot), 0)::numeric(12,2) AS product_cost
       FROM order_items WHERE order_id=$1`,
      [persistedOrder.id]
    )).rows[0];
    const productCost = Number(costRow?.product_cost || 0);
    await client.query(
      `INSERT INTO order_costs (order_id, product_cost, other_costs, updated_at)
       VALUES ($1,$2,0,now())
       ON CONFLICT (order_id) DO UPDATE SET product_cost=EXCLUDED.product_cost, updated_at=now()`,
      [persistedOrder.id, productCost]
    );

    let job=null;
    if(mapped){
      const serviceLocation = (await client.query(
        `INSERT INTO service_locations (customer_id, city_id, address_text)
         VALUES ($1, $2, $3) RETURNING *`,
        [customer.id, cityId, [mapped.serviceLocation.address1, mapped.serviceLocation.address2, mapped.serviceLocation.city].filter(Boolean).join(', ')]
      )).rows[0];
      job = (await client.query(
        `INSERT INTO service_jobs
           (order_id, customer_id, service_location_id, city_id, status, organization_id, required_skill_code, service_duration_minutes)
         VALUES ($1, $2, $3, $4, 'pending_assignment', $5, $6, $7) RETURNING *`,
        [persistedOrder.id, customer.id, serviceLocation.id, cityId, organizationId, mapped.requiredSkillCode, mapped.serviceDurationMinutes]
      )).rows[0];
      await client.query(
        `INSERT INTO audit_log (action, entity_type, entity_id, data)
         VALUES ('woocommerce.service_job_created', 'service_job', $1, $2::jsonb)`,
        [job.id, JSON.stringify({
          externalOrderId: String(order.id), identityKey: identity.identityKey, organizationId,
          productCost, requiredSkillCode: mapped.requiredSkillCode, serviceDurationMinutes: mapped.serviceDurationMinutes
        })]
      );
    }

    if(attribution.meaningful){
      const touch=(await client.query(
        `INSERT INTO marketing_touches(visitor_id,customer_id,source,medium,campaign,content,term,landing_url,occurred_at)
         VALUES(NULL,$1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [customer.id,attribution.source,attribution.medium,attribution.campaign,attribution.content,attribution.term,attribution.landingUrl,attribution.occurredAt]
      )).rows[0];
      await client.query(
        `INSERT INTO order_attribution(order_id,first_touch_id,last_touch_id)
         VALUES($1,$2,$2)
         ON CONFLICT(order_id) DO UPDATE SET first_touch_id=EXCLUDED.first_touch_id,last_touch_id=EXCLUDED.last_touch_id,attributed_at=now()`,
        [persistedOrder.id,touch.id]
      );
    }

    await client.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, data)
       VALUES ('woocommerce.order_persisted', 'order', $1, $2::jsonb)`,
      [persistedOrder.id, JSON.stringify({externalOrderId:String(order.id),organizationId,serviceRequired:Boolean(job),attribution:attribution.meaningful?attribution:null})]
    );

    return { serviceRequired:Boolean(job), duplicate:false, customer, order:persistedOrder, job, productCost, attribution:attribution.meaningful?attribution:null };
  });
}
