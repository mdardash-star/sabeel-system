import test from 'node:test';
import assert from 'node:assert/strict';
import { withTransaction, approveSettlementAndCreditWallet, completeTechnicianJob, transitionTechnicianJob } from '../src/persistence/transactions.mjs';

function poolWithClient(client) {
  return { connect: async () => client };
}

test('transaction commits and releases on success', async () => {
  const calls = [];
  const client = { query: async (sql) => { calls.push(sql); return { rows: [] }; }, release: () => calls.push('RELEASE') };
  const value = await withTransaction(poolWithClient(client), async () => 7);
  assert.equal(value, 7);
  assert.deepEqual(calls, ['BEGIN', 'COMMIT', 'RELEASE']);
});

test('transaction rolls back and releases on failure', async () => {
  const calls = [];
  const client = { query: async (sql) => { calls.push(sql); return { rows: [] }; }, release: () => calls.push('RELEASE') };
  await assert.rejects(() => withTransaction(poolWithClient(client), async () => { throw new Error('boom'); }), /boom/);
  assert.deepEqual(calls, ['BEGIN', 'ROLLBACK', 'RELEASE']);
});

test('finance approval locks settlement and credits wallet idempotently', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (/FOR UPDATE/.test(sql)) return { rows: [{ id: 's1', technician_id: 't1', payout_amount: '60.00', status: 'pending_approval' }] };
      if (/UPDATE technician_settlements/.test(sql)) return { rows: [{ id: 's1', technician_id: 't1', payout_amount: '60.00', status: 'approved' }] };
      if (/INSERT INTO wallet_entries/.test(sql)) return { rows: [{ id: 'w1', technician_id: 't1', amount: '60.00' }] };
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [] };
      throw new Error('Unexpected query');
    },
    release() { calls.push({ sql: 'RELEASE' }); }
  };
  const result = await approveSettlementAndCreditWallet(poolWithClient(client), { settlementId: 's1', approverUserId: 'finance-1' });
  assert.equal(result.settlement.status, 'approved');
  assert.equal(result.walletEntry.technician_id, 't1');
  assert.ok(calls.some((c) => /FOR UPDATE/.test(c.sql)));
  assert.ok(calls.some((c) => /ON CONFLICT \(idempotency_key\)/.test(c.sql)));
  assert.ok(calls.some((c) => /settlement\.approved/.test(c.sql)));
});

test('retrying an approved settlement does not duplicate wallet credit or approval audit', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (/FOR UPDATE/.test(sql)) return { rows: [{ id: 's1', technician_id: 't1', payout_amount: '60.00', status: 'approved' }] };
      if (/INSERT INTO wallet_entries/.test(sql)) return { rows: [{ id: 'w1', technician_id: 't1', amount: '60.00' }] };
      throw new Error('Unexpected query');
    },
    release() { calls.push('RELEASE'); }
  };
  const result = await approveSettlementAndCreditWallet(poolWithClient(client), { settlementId: 's1', approverUserId: 'finance-1' });
  assert.equal(result.walletEntry.id, 'w1');
  assert.equal(calls.filter(sql => /INSERT INTO wallet_entries/.test(sql)).length, 1);
  assert.equal(calls.some(sql => /INSERT INTO audit_log/.test(sql)), false);
});

test('technician status transition locks ownership updates and writes audit atomically', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (/FROM service_jobs/.test(sql)) return { rows: [{ id: 'job-1', technician_id: 'tech-1', status: 'scheduled' }] };
      if (/UPDATE service_jobs/.test(sql)) return { rows: [{ id: 'job-1', technician_id: 'tech-1', status: 'en_route' }] };
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [] };
      throw new Error('Unexpected query');
    },
    release() { calls.push({ sql: 'RELEASE' }); }
  };
  const job = await transitionTechnicianJob(poolWithClient(client), {
    jobId: 'job-1', technicianId: 'tech-1', actorUserId: 'user-1', toStatus: 'en_route'
  });
  assert.equal(job.status, 'en_route');
  assert.ok(calls.some((call) => /FOR UPDATE/.test(call.sql) && call.params[1] === 'tech-1'));
  assert.ok(calls.some((call) => /job\.status_changed/.test(call.sql)));
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
});

test('technician cannot mark a job complete through status transition', async () => {
  await assert.rejects(
    () => transitionTechnicianJob(poolWithClient({}), { toStatus: 'completed' }),
    /Completion requires evidence endpoint/
  );
});

test('technician completion stores evidence settlement and audit in one transaction', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (/FROM service_jobs j/.test(sql)) return { rows: [{
        id: 'job-1', order_id: 'order-1', technician_id: 'tech-1', status: 'in_progress',
        total_ex_vat: '1000.00', product_cost: '500.00', other_costs: '100.00',
        mode: 'percentage', commission_rate: '0.3000', fixed_amount: null, policy_version: 'initial-1'
      }] };
      if (/INSERT INTO job_evidence/.test(sql)) return { rows: [{ id: 'e1', job_id: 'job-1', media_type: params[1], storage_key: params[2] }] };
      if (/UPDATE service_jobs/.test(sql)) return { rows: [{ id: 'job-1', technician_id: 'tech-1', status: 'completed' }] };
      if (/INSERT INTO technician_settlements/.test(sql)) return { rows: [{ id: 's1', job_id: 'job-1', technician_id: 'tech-1', payout_amount: '120.00', status: 'pending_approval' }] };
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [] };
      throw new Error('Unexpected query');
    },
    release() { calls.push({ sql: 'RELEASE' }); }
  };
  const result = await completeTechnicianJob(poolWithClient(client), {
    jobId: 'job-1', technicianId: 'tech-1', actorUserId: 'user-1',
    evidence: [{ mediaType: 'image', storageKey: 'jobs/job-1/after.jpg' }]
  });
  assert.equal(result.job.status, 'completed');
  assert.equal(result.settlement.payout_amount, '120.00');
  const settlementInsert = calls.find(call => /INSERT INTO technician_settlements/.test(call.sql));
  assert.equal(settlementInsert.params[5], 400);
  assert.equal(settlementInsert.params[9], 120);
  assert.ok(calls.some(call => call.sql === 'COMMIT'));
});

test('technician completion rejects evidence outside the job namespace', async () => {
  await assert.rejects(
    () => completeTechnicianJob(poolWithClient({}), {
      jobId: 'job-1', technicianId: 'tech-1', actorUserId: 'user-1',
      evidence: [{ mediaType: 'image', storageKey: 'jobs/job-2/after.jpg' }]
    }),
    /Invalid evidence/
  );
});
