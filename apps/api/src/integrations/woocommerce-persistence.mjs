import { customerIdentityFromOrder, serviceJobFromPaidOrder } from './woocommerce-order.mjs';
import { withTransaction } from '../persistence/transactions.mjs';

const DEFAULT_ORG = '00000000-0000-4000-8000-000000000001';

export async function persistPaidServiceOrder(db, order, { cityId = 'riyadh', organizationId = DEFAULT_ORG } = {}) {
  const mapped = serviceJobFromPaidOrder(order);
  if (!mapped) return { serviceRequired: false, job: null };
  const identity = customerIdentityFromOrder(order);

  return withTransaction(db, async (client) => {
    const existing = await client.query(
      `SELECT j.* FROM service_jobs j JOIN orders o ON o.id = j.order_id
       WHERE o.organization_id=$1 AND o.external_source = 'woocommerce' AND o.external_order_id = $2 LIMIT 1`,
      [organizationId, String(order.id)]
    );
    if (existing.rows[0]) return { serviceRequired: true, duplicate: true, job: existing.rows[0] };

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

    const serviceLocation = (await client.query(
      `INSERT INTO service_locations (customer_id, city_id, address_text)
       VALUES ($1, $2, $3) RETURNING *`,
      [customer.id, cityId, [mapped.serviceLocation.address1, mapped.serviceLocation.address2, mapped.serviceLocation.city].filter(Boolean).join(', ')]
    )).rows[0];

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
           quantity = EXCLUDED.quantity, subtotal_ex_vat = EXCLUDED.subtotal_ex_vat`,
        [persistedOrder.id, String(item.id), item.product_id ? String(item.product_id) : null,
          String(item.sku || ''), String(item.name || 'منتج'), Number(item.quantity || 1), subtotalExVat, organizationId]
      );
    }

    const job = (await client.query(
      `INSERT INTO service_jobs (order_id, customer_id, service_location_id, city_id, status, organization_id)
       VALUES ($1, $2, $3, $4, 'pending_assignment', $5) RETURNING *`,
      [persistedOrder.id, customer.id, serviceLocation.id, cityId, organizationId]
    )).rows[0];

    await client.query(
      `INSERT INTO audit_log (action, entity_type, entity_id, data)
       VALUES ('woocommerce.service_job_created', 'service_job', $1, $2::jsonb)`,
      [job.id, JSON.stringify({ externalOrderId: String(order.id), identityKey: identity.identityKey, organizationId })]
    );

    return { serviceRequired: true, duplicate: false, customer, order: persistedOrder, job };
  });
}
