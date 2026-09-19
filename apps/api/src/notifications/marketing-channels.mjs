import{withTransaction}from'../persistence/transactions.mjs';

export async function claimMarketingEvents(db,{limit=50}={}){return withTransaction(db,async c=>{const{rows}=await c.query(`SELECT ne.id,ne.event_type,ne.customer_id,ne.channels,ne.payload,ne.created_at,c.name,u.mobile,u.email,np.marketing
FROM notification_events ne
LEFT JOIN customers c ON c.id=ne.customer_id
LEFT JOIN users u ON u.id=c.user_id
LEFT JOIN notification_preferences np ON np.user_id=u.id
WHERE ne.status IN('pending','failed')
AND ne.event_type LIKE 'marketing.%'
AND (('whatsapp'=ANY(ne.channels)) OR ('email'=ANY(ne.channels)))
AND COALESCE(np.marketing,false)=true
ORDER BY ne.created_at
LIMIT $1 FOR UPDATE OF ne SKIP LOCKED`,[limit]);if(rows.length)await c.query(`UPDATE notification_events SET status='processing',updated_at=now() WHERE id=ANY($1::uuid[])`,[rows.map(x=>x.id)]);return rows})}

export async function settleMarketingEvent(db,{event,status,providerMessageIds={},error=null}){await db.query(`UPDATE notification_events SET status=$2,sent_at=CASE WHEN $2='sent'THEN COALESCE(sent_at,now())ELSE sent_at END,payload=jsonb_set(COALESCE(payload,'{}'::jsonb),'{delivery}',COALESCE(payload->'delivery','{}'::jsonb)||$3::jsonb,true),updated_at=now() WHERE id=$1`,[event.id,status,JSON.stringify({providerMessageIds,error:error?String(error).slice(0,500):null})]);}

export async function processMarketingBatch(db,{sender,limit=50}={}){const events=await claimMarketingEvents(db,{limit});const result={claimed:events.length,sent:0,failed:0,skipped:0};for(const event of events){const payload=event.payload&&typeof event.payload==='object'?event.payload:{};const ids={};let attempted=0,success=0;try{
 if(event.channels?.includes('whatsapp')&&event.mobile){attempted++;const r=await sender.sendWhatsApp({to:event.mobile,message:payload.message||payload.body||'لديك تحديث من سبيل',metadata:{eventId:event.id,eventType:event.event_type}});ids.whatsapp=r?.messageId||null;success++;}
 if(event.channels?.includes('email')&&event.email){attempted++;const r=await sender.sendEmail({to:event.email,subject:payload.subject||payload.campaignName||'تحديث من سبيل',message:payload.message||payload.body||'لديك تحديث من سبيل',metadata:{eventId:event.id,eventType:event.event_type}});ids.email=r?.messageId||null;success++;}
 if(!attempted){await settleMarketingEvent(db,{event,status:'failed',error:'no_contact_channel'});result.skipped++;continue;}
 await settleMarketingEvent(db,{event,status:success===attempted?'sent':'failed',providerMessageIds:ids,error:success===attempted?null:'partial_failure'});success===attempted?result.sent++:result.failed++;
 }catch(error){await settleMarketingEvent(db,{event,status:'failed',providerMessageIds:ids,error:error.message||'marketing_delivery_failed'});result.failed++;}}
 return result;}
