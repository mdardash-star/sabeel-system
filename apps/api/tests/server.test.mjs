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
