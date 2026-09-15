import { customerIdentityFromOrder, serviceJobFromPaidOrder } from './woocommerce-order.mjs';
import { withTransaction } from '../persistence/transactions.mjs';

export async function persistPaidServiceOrder(db, order, { cityId = 'riyadh' } = {}) {
  const mapped = serviceJobFromPaidOrder(order);
  if (!mapped) return { serviceRequired: false, job: null };
  const identity = customerIdentityFromOrder(order);

  return withTransaction(db, async (client) => {
    const existing = await client.query(
      `SELECT j.* FROM service_jobs j JOIN orders o ON o.id = j.order_id
       WHERE o.external_source = 'woocommerce' AND o.external_order_id = $1 LIMIT 1`,
      [String(order.id)]
    );
    if (existing.rows[0]) return { serviceRequired: true, duplicate: true, job: existing.rows[0] };

    let customer = (await client.query(
      `SELECT c.* FROM customers c JOIN customer_external_identities i ON i.customer_id=c.id
       WHERE i.source='woocommerce' AND i.identity_key=$1 LIMIT 1`,
      [identity.identityKey]
    )).rows[0];

    if (!customer) {
      customer = (await client.query(
        `INSERT INTO customers (name) VALUES ($1) RETURNING *`,
        [mapped.customer.name]
      )).rows[0];
      await client.query(
        `INSERT INTO customer_external_identities (customer_id, source, identity_key, external_customer_id)
         VALUES ($1, 'woocommerce', $2, $3)`,
        [customer.id, identity.identityKey, identity.externalCustomerId]
      );
    }

    const serviceLocation = (await client.query(
      `INSERT INTO service_locations (customer_id, city_id, address_text)
       VALUES ($1, $2, $3) RETURNING *`,
      [customer.id, cityId, [mapped.serviceLocation.address1, mapped.serviceLocation.address2, mapped.serviceLocation.city].filter(Boolean).join(', ')]
    )).rows[0];

    const persistedOrder = (await client.query(
      `INSERT INTO orders (external_source, external_order_id, customer_id, paid_at, total_ex_vat)
       VALUES ('woocommerce', $1, $2, now(), $3)
       ON CONFLICT (external_source, external_order_id) DO UPDATE SET customer_id=EXCLUDED.customer_id
       RETURNING *`,
      [String(order.id), customer.id, Number(order.total || 0) / 1.15]
    )).rows[0];

    const job = (await client.query(
      `INSERT INTO service_jobs (order_id, customer_id, service_location_id, city_id, status)
       VALUES ($1, $2, $3, $4, 'pending_assignment') RETURNING *`,
      [persistedOrder.id, customer.id, serviceLocation.id, cityId]
    )).rows[0];

    await client.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, data)
       VALUES ('woocommerce.service_job_created', 'service_job', $1, $2::jsonb)`,
      [job.id, JSON.stringify({ externalOrderId: String(order.id), identityKey: identity.identityKey })]
    );

    return { serviceRequired: true, duplicate: false, customer, order: persistedOrder, job };
  });
}
