import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyWooCommerceSignature, acceptWooCommerceWebhook } from '../src/integrations/woocommerce-webhook.mjs';

const secret = 'unit-test-secret';
const rawBody = Buffer.from('{"id":9001}');
const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');

test('valid WooCommerce HMAC signature is accepted', () => {
  assert.equal(verifyWooCommerceSignature(rawBody, signature, secret), true);
  assert.equal(verifyWooCommerceSignature(rawBody, 'invalid', secret), false);
});

test('first webhook delivery is accepted and persisted', async () => {
  const db = { query: async (sql, params) => {
    assert.match(sql, /ON CONFLICT \(delivery_key\) DO NOTHING/);
    assert.equal(params[0], 'woocommerce:webhook:delivery-1');
    return { rows: [{ delivery_key: params[0] }] };
  }};
  const result = await acceptWooCommerceWebhook(db, {
    rawBody,
    secret,
    headers: { 'x-wc-webhook-signature': signature, 'x-wc-webhook-delivery-id': 'delivery-1' }
  });
  assert.equal(result.accepted, true);
});

test('replayed webhook delivery is ignored', async () => {
  const db = { query: async () => ({ rows: [] }) };
  const result = await acceptWooCommerceWebhook(db, {
    rawBody,
    secret,
    headers: { 'x-wc-webhook-signature': signature, 'x-wc-webhook-delivery-id': 'delivery-1' }
  });
  assert.equal(result.accepted, false);
  assert.equal(result.duplicate, true);
});

test('invalid signature is rejected before database write', async () => {
  let touched = false;
  const db = { query: async () => { touched = true; return { rows: [] }; } };
  await assert.rejects(() => acceptWooCommerceWebhook(db, {
    rawBody,
    secret,
    headers: { 'x-wc-webhook-signature': 'bad', 'x-wc-webhook-delivery-id': 'delivery-2' }
  }), /Invalid WooCommerce webhook signature/);
  assert.equal(touched, false);
});
