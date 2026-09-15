import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ingestWooCommerceOrderWebhook } from '../src/integrations/woocommerce-ingress.mjs';

const secret = 'integration-test-secret';
const order = {
  id: 9100,
  status: 'processing',
  customer_id: 88,
  total: '575.00',
  billing: { first_name: 'SUBIL', last_name: 'Customer', email: 'customer@example.com', phone: '+966500000088', address_1: 'Riyadh', city: 'Riyadh' },
  line_items: [{ id: 1, name: 'Aqua Gold', quantity: 1, meta_data: [{ key: '_subil_requires_service', value: 'yes' }] }]
};

function signed(body, deliveryId = 'delivery-e2e-1') {
  return {
    rawBody: body,
    secret,
    headers: {
      'x-wc-webhook-signature': crypto.createHmac('sha256', secret).update(body).digest('base64'),
      'x-wc-webhook-delivery-id': deliveryId
    }
  };
}

function fakePool() {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (/SELECT j\.\*/.test(sql)) return { rows: [] };
      if (/SELECT c\.\*/.test(sql)) return { rows: [] };
      if (/INSERT INTO customers/.test(sql)) return { rows: [{ id: 'c1', name: 'SUBIL Customer' }] };
      if (/customer_external_identities/.test(sql)) return { rows: [] };
      if (/INSERT INTO service_locations/.test(sql)) return { rows: [{ id: 'l1' }] };
      if (/INSERT INTO orders/.test(sql)) return { rows: [{ id: 'o1', external_order_id: '9100' }] };
      if (/INSERT INTO service_jobs/.test(sql)) return { rows: [{ id: 'j1', status: 'pending_assignment', city_id: 'riyadh' }] };
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected transactional query: ${sql}`);
    },
    release() {}
  };
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (/INSERT INTO webhook_deliveries/.test(sql)) return { rows: [{ delivery_key: params[0] }] };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async connect() { return client; }
  };
}

test('signed paid service webhook becomes one pending assignment job', async () => {
  const db = fakePool();
  const body = Buffer.from(JSON.stringify(order));
  const result = await ingestWooCommerceOrderWebhook(db, { ...signed(body), cityId: 'riyadh' });
  assert.equal(result.accepted, true);
  assert.equal(result.serviceRequired, true);
  assert.equal(result.job.status, 'pending_assignment');
  assert.equal(result.job.city_id, 'riyadh');
  assert.ok(db.calls.some(c => /INSERT INTO webhook_deliveries/.test(c.sql)));
  assert.ok(db.calls.some(c => /INSERT INTO service_jobs/.test(c.sql)));
});

test('bad signature cannot enter persistence pipeline', async () => {
  const db = fakePool();
  const body = Buffer.from(JSON.stringify(order));
  await assert.rejects(() => ingestWooCommerceOrderWebhook(db, {
    rawBody: body,
    secret,
    headers: { 'x-wc-webhook-signature': 'bad', 'x-wc-webhook-delivery-id': 'bad-1' }
  }), /Invalid WooCommerce webhook signature/);
  assert.equal(db.calls.length, 0);
});
