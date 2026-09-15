import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepositories } from '../src/persistence/repositories.mjs';

function fakeDb(handler) {
  return { query: async (sql, params) => handler(sql, params) };
}

test('customer repository resolves external identity with parameters', async () => {
  const calls = [];
  const repos = createRepositories(fakeDb((sql, params) => {
    calls.push({ sql, params });
    return { rows: [{ id: 'customer-1' }] };
  }));
  const customer = await repos.customers.findByIdentity('woocommerce', 'woocommerce:customer:77');
  assert.equal(customer.id, 'customer-1');
  assert.deepEqual(calls[0].params, ['woocommerce', 'woocommerce:customer:77']);
  assert.match(calls[0].sql, /customer_external_identities/);
});

test('technician jobs are scoped and ordered by schedule', async () => {
  const repos = createRepositories(fakeDb((sql, params) => {
    assert.match(sql, /technician_id = \$1/);
    assert.match(sql, /ORDER BY scheduled_at ASC/);
    assert.equal(params[0], 'tech-1');
    return { rows: [{ id: 'job-1' }] };
  }));
  const jobs = await repos.jobs.listForTechnician('tech-1', '2026-09-15', '2026-09-16');
  assert.equal(jobs.length, 1);
});

test('settlement approval only changes pending settlement', async () => {
  const repos = createRepositories(fakeDb((sql, params) => {
    assert.match(sql, /status = 'pending_approval'/);
    assert.deepEqual(params, ['settlement-1', 'finance-1']);
    return { rows: [{ id: 'settlement-1', status: 'approved' }] };
  }));
  const settlement = await repos.settlements.approve('settlement-1', 'finance-1');
  assert.equal(settlement.status, 'approved');
});

test('wallet credit is idempotent by settlement key', async () => {
  const repos = createRepositories(fakeDb((sql, params) => {
    assert.match(sql, /ON CONFLICT \(idempotency_key\)/);
    assert.equal(params[3], 'settlement:settlement-1');
    return { rows: [{ amount: '60.00' }] };
  }));
  const entry = await repos.wallet.addSettlementCredit({ technicianId: 'tech-1', settlementId: 'settlement-1', amount: 60 });
  assert.equal(entry.amount, '60.00');
});

test('maintenance query returns active assets due before timestamp', async () => {
  const repos = createRepositories(fakeDb((sql, params) => {
    assert.match(sql, /status = 'active'/);
    assert.match(sql, /next_maintenance_at <= \$1/);
    assert.equal(params[0], '2027-03-15T00:00:00Z');
    return { rows: [{ id: 'asset-1' }] };
  }));
  const assets = await repos.assets.dueBefore('2027-03-15T00:00:00Z');
  assert.equal(assets[0].id, 'asset-1');
});
