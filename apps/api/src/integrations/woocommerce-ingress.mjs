import { acceptWooCommerceWebhook, verifyWooCommerceSignature } from './woocommerce-webhook.mjs';
import { persistPaidServiceOrder } from './woocommerce-persistence.mjs';
import { withTransaction } from '../persistence/transactions.mjs';

const DEFAULT_ORG = '00000000-0000-4000-8000-000000000001';

export async function ingestWooCommerceOrderWebhook(db, { rawBody, headers, secret, cityId = 'riyadh', organizationId = DEFAULT_ORG }) {
  // Reject unauthenticated or malformed deliveries before opening a transaction.
  if (!verifyWooCommerceSignature(rawBody, headers['x-wc-webhook-signature'], secret)) {
    throw new Error('Invalid WooCommerce webhook signature');
  }

  let order;
  try {
    order = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  } catch {
    throw new Error('Invalid WooCommerce webhook JSON');
  }

  return withTransaction(db, async (client) => {
    const accepted = await acceptWooCommerceWebhook(client, { rawBody, headers, secret });
    if (!accepted.accepted) {
      return { accepted: false, duplicate: true, deliveryKey: accepted.deliveryKey, serviceRequired: false, job: null };
    }

    // The delivery marker and the order must commit or roll back together.
    const persisted = await persistPaidServiceOrder(db, order, { cityId, organizationId, client });
    return { ...accepted, ...persisted };
  });
}
