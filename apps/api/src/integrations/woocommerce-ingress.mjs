import { acceptWooCommerceWebhook } from './woocommerce-webhook.mjs';
import { persistPaidServiceOrder } from './woocommerce-persistence.mjs';

export async function ingestWooCommerceOrderWebhook(db, { rawBody, headers, secret, cityId = 'riyadh' }) {
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

  const persisted = await persistPaidServiceOrder(db, order, { cityId });
  return { ...accepted, ...persisted };
}
