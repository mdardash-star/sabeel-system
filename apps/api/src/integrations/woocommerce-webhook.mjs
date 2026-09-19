import crypto from 'node:crypto';

export function verifyWooCommerceSignature(rawBody, signature, secret) {
  if (!secret) throw new Error('WooCommerce webhook secret is required');
  if (!signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function webhookDeliveryKey(headers = {}) {
  const id = headers['x-wc-webhook-delivery-id'] || headers['x-wc-webhook-id'];
  if (!id) throw new Error('WooCommerce webhook delivery id is required');
  return `woocommerce:webhook:${id}`;
}

export async function acceptWooCommerceWebhook(db, { rawBody, headers, secret, maxAgeSeconds = 300, now = Date.now() }) {
  const signature = headers['x-wc-webhook-signature'];
  if (!verifyWooCommerceSignature(rawBody, signature, secret)) throw new Error('Invalid WooCommerce webhook signature');

  const timestamp = Number(headers['x-subil-webhook-timestamp'] || 0);
  if (timestamp && Math.abs(now - timestamp * 1000) > maxAgeSeconds * 1000) throw new Error('Expired WooCommerce webhook');

  const deliveryKey = webhookDeliveryKey(headers);
  const result = await db.query(
    `INSERT INTO webhook_deliveries (provider, delivery_key, received_at)
     VALUES ('woocommerce', $1, now())
     ON CONFLICT (delivery_key) DO NOTHING RETURNING delivery_key`,
    [deliveryKey]
  );
  if (!result.rows[0]) return { accepted: false, duplicate: true, deliveryKey };
  return { accepted: true, duplicate: false, deliveryKey };
}
