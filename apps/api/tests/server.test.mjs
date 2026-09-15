import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/server.mjs';

test('live HTTP technician endpoint uses PostgreSQL repositories and date query', async (t) => {
  const queries = [];
  const db = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/FROM technicians t/.test(sql)) return { rows: [{ id: 'tech-1', user_id: 'user-1' }] };
      return { rows: [{ id: 'job-1', technician_id: 'tech-1', address_text: 'Riyadh' }] };
    }
  };
  const server = createApiServer({ db });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/technicians/me/jobs?from=2026-09-15T00%3A00%3A00Z&to=2026-09-16T00%3A00%3A00Z`, {
    headers: { 'x-subil-role': 'technician', 'x-subil-user-id': 'user-1' }
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.technicianId, 'tech-1');
  assert.equal(payload.jobs[0].address_text, 'Riyadh');
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[1].params, ['tech-1', '2026-09-15T00:00:00Z', '2026-09-16T00:00:00Z']);
  assert.doesNotMatch(queries[1].sql, /JOIN customers|\bphone\b|\bmobile\b|whatsapp/i);
});

test('live HTTP technician endpoint fails closed without database', async (t) => {
  const server = createApiServer({ db: null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/technicians/me/jobs`, {
    headers: { 'x-subil-role': 'technician', 'x-subil-user-id': 'user-1' }
  });
  assert.equal(response.status, 503);
});

test('live HTTP technician job details route is connected to PostgreSQL', async (t) => {
  const db = {
    query: async (sql, params) => {
      if (/FROM technicians t/.test(sql)) return { rows: [{ id: 'tech-1', user_id: 'user-1' }] };
      assert.match(sql, /j\.id = \$1 AND j\.technician_id = \$2/);
      assert.deepEqual(params, ['job-1', 'tech-1']);
      return { rows: [{ id: 'job-1', technician_id: 'tech-1', address_text: 'Riyadh' }] };
    }
  };
  const server = createApiServer({ db });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/technicians/me/jobs/job-1`, {
    headers: { 'x-subil-role': 'technician', 'x-subil-user-id': 'user-1' }
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.job.id, 'job-1');
});

test('live HTTP technician wallet route uses pagination query parameters', async (t) => {
  const db = {
    query: async (sql, params) => {
      if (/FROM technicians t/.test(sql)) return { rows: [{ id: 'tech-1', user_id: 'user-1' }] };
      if (/COALESCE\(SUM/.test(sql)) return { rows: [{ balance: '80.00' }] };
      assert.deepEqual(params, ['tech-1', 5, 10]);
      return { rows: [{ id: 'w1', amount: '80.00', currency: 'SAR', total_count: 11 }] };
    }
  };
  const server = createApiServer({ db });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/technicians/me/wallet?limit=5&offset=10`, {
    headers: { 'x-subil-role': 'technician', 'x-subil-user-id': 'user-1' }
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.balance, 80);
  assert.deepEqual(payload.pagination, { limit: 5, offset: 10, total: 11 });
});

test('live HTTP technician status route persists transition and audit', async (t) => {
  const client = {
    query: async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (/FROM service_jobs/.test(sql)) return { rows: [{ id: 'job-1', technician_id: 'tech-1', status: 'scheduled' }] };
      if (/UPDATE service_jobs/.test(sql)) return { rows: [{ id: 'job-1', technician_id: 'tech-1', status: 'en_route' }] };
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [] };
      throw new Error('Unexpected query');
    },
    release() {}
  };
  const db = {
    query: async () => ({ rows: [{ id: 'tech-1', user_id: 'user-1' }] }),
    connect: async () => client
  };
  const server = createApiServer({ db });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/technicians/me/jobs/job-1/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-subil-role': 'technician', 'x-subil-user-id': 'user-1' },
    body: JSON.stringify({ status: 'en_route' })
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.job.status, 'en_route');
});

test('live HTTP technician completion route persists evidence and settlement', async (t) => {
  const client = {
    query: async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] };
      if (/FROM service_jobs j/.test(sql)) return { rows: [{
        id: 'job-1', technician_id: 'tech-1', status: 'in_progress', total_ex_vat: '1000.00',
        product_cost: '500.00', other_costs: '100.00', mode: 'percentage', commission_rate: '0.3000', policy_version: 'initial-1'
      }] };
      if (/INSERT INTO job_evidence/.test(sql)) return { rows: [{ id: 'e1', storage_key: params[2] }] };
      if (/UPDATE service_jobs/.test(sql)) return { rows: [{ id: 'job-1', status: 'completed' }] };
      if (/INSERT INTO technician_settlements/.test(sql)) return { rows: [{ id: 's1', payout_amount: '120.00', status: 'pending_approval' }] };
      if (/INSERT INTO audit_log/.test(sql)) return { rows: [] };
      throw new Error('Unexpected query');
    },
    release() {}
  };
  const db = { query: async () => ({ rows: [{ id: 'tech-1', user_id: 'user-1' }] }), connect: async () => client };
  const server = createApiServer({ db });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/technicians/me/jobs/job-1/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-subil-role': 'technician', 'x-subil-user-id': 'user-1' },
    body: JSON.stringify({ evidence: [{ mediaType: 'image', storageKey: 'jobs/job-1/after.jpg' }] })
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.job.status, 'completed');
  assert.equal(payload.settlement.status, 'pending_approval');
});
