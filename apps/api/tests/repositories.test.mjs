import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepositories } from '../src/persistence/repositories.mjs';

function fakeDb(handler) {
  return { query: async (sql, params) => handler(sql, params) };
}

test('technician repository resolves only active profiles from active users', async () => {
  const repos = createRepositories(fakeDb((sql, params) => {
    assert.match(sql, /FROM technicians t/);
    assert.match(sql, /JOIN users u/);
    assert.match(sql, /t\.is_active = true/);
    assert.match(sql, /u\.is_active = true/);
    assert.deepEqual(params, ['user-1']);
    return { rows: [{ id: 'tech-1', user_id: 'user-1' }] };
  }));
  const technician = await repos.technicians.findActiveByUserId('user-1');
  assert.equal(technician.id, 'tech-1');
});

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

test('technician jobs expose operational location but never query customer contact data', async () => {
  const repos = createRepositories(fakeDb((sql, params) => {
    assert.match(sql, /j\.technician_id = \$1/);
    assert.match(sql, /ORDER BY j\.scheduled_at ASC/);
    assert.match(sql, /l\.address_text/);
    assert.match(sql, /l\.latitude/);
    assert.match(sql, /l\.longitude/);
    assert.match(sql, /o\.external_order_id/);
    assert.doesNotMatch(sql, /JOIN customers/i);
    assert.doesNotMatch(sql, /\bmobile\b/i);
    assert.doesNotMatch(sql, /\bphone\b/i);
    assert.doesNotMatch(sql, /whatsapp/i);
    assert.equal(params[0], 'tech-1');
    return { rows: [{ id: 'job-1', address_text: 'Riyadh', latitude: '24.7', longitude: '46.6' }] };
  }));
  const jobs = await repos.jobs.listForTechnician('tech-1', '2026-09-15', '2026-09-16');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].address_text, 'Riyadh');
  assert.equal('customer_id' in jobs[0], false);
  assert.equal('phone' in jobs[0], false);
  assert.equal('mobile' in jobs[0], false);
  assert.equal('whatsapp' in jobs[0], false);
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
