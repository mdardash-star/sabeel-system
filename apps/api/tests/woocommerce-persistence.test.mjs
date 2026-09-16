import test from 'node:test';
import assert from 'node:assert/strict';
import { persistPaidServiceOrder } from '../src/integrations/woocommerce-persistence.mjs';

const paidOrder = {
  id: 9001, status: 'processing', customer_id: 77, total: '575.00',
  billing: { first_name: 'Test', last_name: 'Customer', email: 'test@example.com', phone: '+966500000001', address_1: 'Riyadh', city: 'Riyadh' },
  line_items: [{ id: 1, name: 'Aqua Gold', sku: 'RO-7-STAGE', quantity: 1, total: '500.00', meta_data: [{ key: '_subil_requires_service', value: 'yes' }] }]
};

function fakePool({ duplicate = false } = {}) {
  let customerCreated = false;
  const calls = [];
  const client = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (/SELECT j\.\*/.test(sql)) return { rows: duplicate ? [{ id: 'job-existing' }] : [] };
      if (/SELECT c\.\*/.test(sql)) return { rows: [] };
      if (/INSERT INTO customers/.test(sql)) { customerCreated = true; return { rows: [{ id: 'c1', name: 'Test Customer' }] }; }
      if (/customer_external_identities/.test(sql)) return { rows: [] };
      if (/INSERT INTO service_locations/.test(sql)) return { rows: [{ id: 'l1' }] };
      if (/INSERT INTO orders/.test(sql)) return { rows: [{ id: 'o1', external_order_id: '9001' }] };
      if (/INSERT INTO order_items/.test(sql)) return { rows: [] };
      if (/INSERT INTO service_jobs/.test(sql)) return { rows: [{ id: 'j1', status: 'pending_assignment' }] };
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
    release() {}
  };
  return { pool: { connect: async () => client }, calls, customerCreated: () => customerCreated };
}

test('paid WooCommerce service order creates customer order and pending job atomically', async () => {
  const f = fakePool();
  const result = await persistPaidServiceOrder(f.pool, paidOrder, { cityId: 'riyadh' });
  assert.equal(result.job.status, 'pending_assignment');
  assert.equal(result.duplicate, false);
  assert.equal(f.customerCreated(), true);
  assert.ok(f.calls.some(c => /woocommerce\.service_job_created/.test(c.sql)));
  assert.ok(f.calls.some(c => /INSERT INTO order_items/.test(c.sql) && c.params[1] === '1'));
  assert.ok(f.calls.some(c => /INSERT INTO order_items/.test(c.sql) && c.params[3] === 'RO-7-STAGE' && c.params[6] === 500));
  assert.ok(f.calls.some(c => c.sql === 'COMMIT'));
});

test('replayed WooCommerce order does not create a second service job', async () => {
  const f = fakePool({ duplicate: true });
  const result = await persistPaidServiceOrder(f.pool, paidOrder);
  assert.equal(result.duplicate, true);
  assert.equal(result.job.id, 'job-existing');
  assert.equal(f.customerCreated(), false);
});

test('order without service item creates no service job', async () => {
  const f = fakePool();
  const order = { ...paidOrder, line_items: [{ id: 2, name: 'Filter', quantity: 1, meta_data: [] }] };
  const result = await persistPaidServiceOrder(f.pool, order);
  assert.equal(result.serviceRequired, false);
  assert.equal(f.calls.length, 0);
});
