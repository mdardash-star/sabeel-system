import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createApiServer } from '../src/server.mjs';

const secret = 'route-test-secret';

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
      if (/INSERT INTO orders/.test(sql)) return { rows: [{ id: 'o1', external_order_id: '9200' }] };
      if (/INSERT INTO order_items/.test(sql)) return { rows: [] };
      if (/FROM order_items WHERE order_id/.test(sql)) return { rows: [{ product_cost: '0.00' }] };
      if (/INSERT INTO order_costs/.test(sql)) return { rows: [] };
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

function sign(body) {
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

async function startServer(db) {
  const server = createApiServer({ db, wooCommerceWebhookSecret: secret });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

test('signed paid order webhook reaches the live HTTP route and creates a job', async (t) => {
  const db = fakePool();
  const server = await startServer(db);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  const order = {
    id: 9200,
    status: 'processing',
    customer_id: 88,
    total: '575.00',
    billing: { first_name: 'SUBIL', last_name: 'Customer', email: 'customer@example.com', phone: '+966500000088', address_1: 'Riyadh', city: 'Riyadh' },
    line_items: [{ id: 1, name: 'Aqua Gold', quantity: 1, meta_data: [{ key: '_subil_requires_service', value: 'yes' }] }]
  };
  const body = JSON.stringify(order);

  const response = await fetch(`http://127.0.0.1:${port}/api/v1/integrations/woocommerce/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-wc-webhook-signature': sign(body),
      'x-wc-webhook-delivery-id': 'route-delivery-1'
    },
    body
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.accepted, true);
  assert.equal(payload.serviceRequired, true);
  assert.ok(db.calls.some(c => /INSERT INTO webhook_deliveries/.test(c.sql)));
  assert.ok(db.calls.some(c => /INSERT INTO service_jobs/.test(c.sql)));
});

test('invalid signature is rejected with 401 before any persistence', async (t) => {
  const db = fakePool();
  const server = await startServer(db);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  const body = JSON.stringify({ id: 9201, status: 'processing', line_items: [] });
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/integrations/woocommerce/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-wc-webhook-signature': 'not-a-real-signature',
      'x-wc-webhook-delivery-id': 'route-delivery-2'
    },
    body
  });
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.error, 'invalid_signature');
  assert.equal(db.calls.length, 0);
});

test('a pending (not yet paid) order webhook is acknowledged without creating a job', async (t) => {
  const db = fakePool();
  const server = await startServer(db);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  const order = { id: 9202, status: 'pending', line_items: [] };
  const body = JSON.stringify(order);

  const response = await fetch(`http://127.0.0.1:${port}/api/v1/integrations/woocommerce/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-wc-webhook-signature': sign(body),
      'x-wc-webhook-delivery-id': 'route-delivery-3'
    },
    body
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.accepted, true);
  assert.equal(payload.serviceRequired, false);
  assert.equal(payload.reason, 'order_not_paid_yet');
  assert.ok(db.calls.some(c => /INSERT INTO webhook_deliveries/.test(c.sql)));
  assert.ok(!db.calls.some(c => /INSERT INTO service_jobs/.test(c.sql)));
});

test('webhook route is rejected when the secret is not configured', async (t) => {
  const db = fakePool();
  const server = createApiServer({ db, wooCommerceWebhookSecret: '' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  const body = JSON.stringify({ id: 9203, status: 'processing', line_items: [] });
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/integrations/woocommerce/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-wc-webhook-signature': 'x', 'x-wc-webhook-delivery-id': 'route-delivery-4' },
    body
  });
  assert.equal(response.status, 500);
  assert.equal(db.calls.length, 0);
});
