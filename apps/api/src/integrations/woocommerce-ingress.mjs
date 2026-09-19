import { acceptWooCommerceWebhook } from './woocommerce-webhook.mjs';
import { persistPaidServiceOrder } from './woocommerce-persistence.mjs';

const DEFAULT_ORG = '00000000-0000-4000-8000-000000000001';

export async function ingestWooCommerceOrderWebhook(db, { rawBody, headers, secret, cityId = 'riyadh', organizationId = DEFAULT_ORG }) {
  const accepted = await acceptWooCommerceWebhook(db, { rawBody, headers, secret });
  if (!accepted.accepted) {
    return { accepted: false, duplicate: true, deliveryKey: accepted.deliveryKey, serviceRequired: false, job: null };
  }

  let order;
  try {
    order = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  } catch {
    throw new Error('Invalid WooCommerce webhook JSON');
  }

  const persisted = await persistPaidServiceOrder(db, order, { cityId, organizationId });
  return { ...accepted, ...persisted };
}
