import{withTransaction}from'../persistence/transactions.mjs';

export async function upsertAbandonedCart(db,input){return withTransaction(db,async client=>{const cart=(await client.query(
 `INSERT INTO abandoned_carts (external_source,external_cart_id,customer_id,customer_name,mobile,email,cart_value,currency,checkout_url,items,abandoned_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
  ON CONFLICT (external_source,external_cart_id) DO UPDATE SET customer_id=COALESCE(EXCLUDED.customer_id,abandoned_carts.customer_id),
   customer_name=EXCLUDED.customer_name,mobile=EXCLUDED.mobile,email=EXCLUDED.email,cart_value=EXCLUDED.cart_value,
   currency=EXCLUDED.currency,checkout_url=EXCLUDED.checkout_url,items=EXCLUDED.items,abandoned_at=EXCLUDED.abandoned_at,updated_at=now()
  WHERE abandoned_carts.status IN ('open','notified') RETURNING *`,
 [input.externalSource||'woocommerce',input.externalCartId,input.customerId||null,input.customerName||'',input.mobile||null,input.email||null,input.cartValue,input.currency||'SAR',input.checkoutUrl||'',JSON.stringify(input.items||[]),input.abandonedAt])).rows[0];
 if(!cart)throw new Error('Abandoned cart is closed');await audit(client,input.actorUserId,'marketing.abandoned_cart_upserted','abandoned_cart',cart.id,{externalCartId:input.externalCartId});return cart})}

export async function runAbandonedCartRecovery(db,{actorUserId,limit=100}){return withTransaction(db,async client=>{const carts=(await client.query(
 `SELECT * FROM abandoned_carts WHERE status IN ('open','notified') AND abandoned_at<=now()-interval '60 minutes'
  AND reminder_count<2 AND (last_reminded_at IS NULL OR last_reminded_at<=now()-interval '24 hours')
  AND (mobile IS NOT NULL OR email IS NOT NULL) ORDER BY abandoned_at ASC FOR UPDATE SKIP LOCKED LIMIT $1`,[limit])).rows;let queued=0;
 for(const cart of carts){const channels=cart.mobile?['whatsapp','sms']:['email'];await client.query(
  `INSERT INTO notification_events(event_type,customer_id,channels,payload)VALUES('marketing.abandoned_cart',$1,$2,$3::jsonb)`,
  [cart.customer_id,channels,JSON.stringify({cartId:cart.id,customerName:cart.customer_name,cartValue:cart.cart_value,currency:cart.currency,checkoutUrl:cart.checkout_url,items:cart.items,reminderNumber:Number(cart.reminder_count)+1,contact:{mobile:cart.mobile,email:cart.email}})]);
 await client.query(`UPDATE abandoned_carts SET status='notified',reminder_count=reminder_count+1,last_reminded_at=now(),updated_at=now() WHERE id=$1`,[cart.id]);queued++}
 await audit(client,actorUserId,'marketing.abandoned_cart_recovery_run','abandoned_cart_recovery','batch',{scanned:carts.length,queued});return{scanned:carts.length,queued}})}

export async function markCartRecovered(db,{cartId,orderId,actorUserId}){return withTransaction(db,async client=>{const cart=(await client.query(
 `UPDATE abandoned_carts SET status='recovered',recovered_at=now(),recovered_order_id=$2,updated_at=now()
  WHERE id=$1 AND status IN ('open','notified') RETURNING *`,[cartId,orderId||null])).rows[0];if(!cart)return null;await audit(client,actorUserId,'marketing.abandoned_cart_recovered','abandoned_cart',cart.id,{orderId:orderId||null,cartValue:cart.cart_value});return cart})}
async function audit(c,u,a,t,id,d){await c.query(`INSERT INTO audit_log(actor_user_id,action,entity_type,entity_id,data)VALUES($1,$2,$3,$4,$5::jsonb)`,[u,a,t,id,JSON.stringify(d)])}
