import { randomUUID } from 'node:crypto';
import { withTransaction } from '../persistence/transactions.mjs';

export async function createCustomerServiceOrder(db,{customerId,organizationId,actorUserId,serviceType,addressText,cityId='riyadh',scheduledAt=null,notes=''}){
  if(!customerId||!organizationId) throw new Error('Customer identity unavailable');
  const service=String(serviceType||'').trim();
  const address=String(addressText||'').trim();
  if(service.length<2) throw new Error('Service type required');
  if(address.length<5) throw new Error('Address required');
  const externalOrderId=`APP-${Date.now()}-${randomUUID().slice(0,8)}`;
  return withTransaction(db,async client=>{
    const {rows:[location]}=await client.query(
      `INSERT INTO service_locations(customer_id,city_id,address_text) VALUES($1,$2,$3) RETURNING id,customer_id,city_id,address_text,created_at`,
      [customerId,cityId,address]
    );
    const {rows:[order]}=await client.query(
      `INSERT INTO orders(external_source,external_order_id,customer_id,total_ex_vat,organization_id)
       VALUES('subil_app',$1,$2,0,$3)
       RETURNING id,external_source,external_order_id,customer_id,paid_at,total_ex_vat,created_at`,
      [externalOrderId,customerId,organizationId]
    );
    const {rows:[job]}=await client.query(
      `INSERT INTO service_jobs(order_id,customer_id,service_location_id,city_id,status,scheduled_at,organization_id)
       VALUES($1,$2,$3,$4,'pending_assignment',$5,$6)
       RETURNING id,order_id,customer_id,service_location_id,city_id,status,scheduled_at,created_at`,
      [order.id,customerId,location.id,cityId,scheduledAt||null,organizationId]
    );
    await client.query(
      `INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data)
       VALUES($1,'customer.service_order_created','service_job',$2,$3::jsonb)`,
      [actorUserId,job.id,JSON.stringify({externalOrderId,serviceType:service,addressText:address,cityId,scheduledAt:scheduledAt||null,notes:String(notes||'').trim()})]
    );
    return {order,job,location,serviceType:service,notes:String(notes||'').trim()};
  });
}
