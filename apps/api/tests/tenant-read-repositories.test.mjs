import test from 'node:test';
import assert from 'node:assert/strict';
import { createTenantReadRepositories } from '../src/persistence/tenant-read-repositories.mjs';

const TENANT = '11111111-1111-4111-8111-111111111111';

function dbFor(handler) {
  const calls = [];
  return {
    calls,
    db: {
      async query(sql, params = []) {
        calls.push({ sql, params });
        return handler(sql, params);
      }
    }
  };
}

test('tenant read repositories require tenant id', () => {
  assert.throws(() => createTenantReadRepositories({ query() {} }, null), /Tenant id is required/);
});

test('inventory stats are tenant constrained', async () => {
  const { db, calls } = dbFor(async () => ({ rows: [{ total_skus: 2, low_stock: 1 }] }));
  const result = await createTenantReadRepositories(db, TENANT).inventory.stats();
  assert.equal(result.total_skus, 2);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /i\.organization_id=\$1/);
  assert.match(calls[0].sql, /inventory_balances WHERE organization_id=\$1/);
  assert.deepEqual(calls[0].params, [TENANT]);
});

test('inventory list scopes nested balances and technician custody', async () => {
  const { db, calls } = dbFor(async () => ({ rows: [] }));
  await createTenantReadRepositories(db, TENANT).inventory.list({ query: 'MEM', status: 'low', limit: 10, offset: 20 });
  assert.match(calls[0].sql, /b\.organization_id=\$1/);
  assert.match(calls[0].sql, /technician_inventory WHERE organization_id=\$1/);
  assert.deepEqual(calls[0].params, [TENANT, 'MEM', 'low', 10, 20]);
});

test('inventory movements cannot cross tenant boundaries', async () => {
  const { db, calls } = dbFor(async () => ({ rows: [] }));
  await createTenantReadRepositories(db, TENANT).inventory.movements({ limit: 25, offset: 0 });
  assert.match(calls[0].sql, /m\.organization_id=\$1/);
  assert.match(calls[0].sql, /i\.organization_id=\$1/);
  assert.deepEqual(calls[0].params, [TENANT, 25, 0]);
});

test('technician stock verifies technician user belongs to tenant', async () => {
  const { db, calls } = dbFor(async () => ({ rows: [] }));
  await createTenantReadRepositories(db, TENANT).inventory.technicianStock('tech-1');
  assert.match(calls[0].sql, /u\.organization_id=\$1/);
  assert.match(calls[0].sql, /ti\.organization_id=\$1/);
  assert.deepEqual(calls[0].params, [TENANT, 'tech-1']);
});

test('purchasing stats and suppliers are tenant constrained', async () => {
  const { db, calls } = dbFor(async sql => /FROM purchase_orders WHERE/.test(sql)
    ? { rows: [{ open_orders: 3 }] }
    : { rows: [] });
  const repos = createTenantReadRepositories(db, TENANT);
  const stats = await repos.purchasing.stats();
  await repos.purchasing.suppliers({ query: 'مورد', limit: 10, offset: 0 });
  assert.equal(stats.open_orders, 3);
  assert.match(calls[0].sql, /organization_id=\$1/);
  assert.match(calls[1].sql, /s\.organization_id=\$1/);
  assert.match(calls[1].sql, /po\.organization_id=\$1/);
  assert.deepEqual(calls[1].params, [TENANT, 'مورد', 10, 0]);
});

test('purchase order list constrains supplier warehouse lines and items to tenant', async () => {
  const { db, calls } = dbFor(async () => ({ rows: [] }));
  await createTenantReadRepositories(db, TENANT).purchasing.list({ query: 'PO-', status: 'overdue', limit: 20, offset: 0 });
  const sql = calls[0].sql;
  assert.match(sql, /po\.organization_id=\$1/);
  assert.match(sql, /s\.organization_id=\$1/);
  assert.match(sql, /w\.organization_id=\$1/);
  assert.match(sql, /poi\.organization_id=\$1/);
  assert.match(sql, /i\.organization_id=\$1/);
  assert.deepEqual(calls[0].params, [TENANT, 'PO-', 'overdue', 20, 0]);
});
