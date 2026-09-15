import test from 'node:test';
import assert from 'node:assert/strict';
import { routePersistentRequest } from '../src/http/persistent-router.mjs';

function dbReturning(rows, inspect = () => {}) {
  return { query: async (sql, params) => { inspect(sql, params); return { rows }; } };
}

test('technician endpoint reads only own jobs from safe repository projection', async () => {
  const db = dbReturning([
    { id: 'job-1', technician_id: 'tech-1', address_text: 'Riyadh', latitude: '24.7', longitude: '46.6', external_order_id: '1001' }
  ], (sql, params) => {
    assert.match(sql, /j\.technician_id = \$1/);
    assert.equal(params[0], 'tech-1');
    assert.doesNotMatch(sql, /JOIN customers/i);
    assert.doesNotMatch(sql, /\bphone\b|\bmobile\b|whatsapp/i);
  });
  const result = await routePersistentRequest({ method: 'GET', url: '/api/v1/technicians/me/jobs', role: 'technician', context: { technicianId: 'tech-1', from: '2026-09-15T00:00:00Z', to: '2026-09-16T00:00:00Z' }, db });
  assert.equal(result.status, 200);
  assert.equal(result.data.jobs[0].address_text, 'Riyadh');
  assert.equal('phone' in result.data.jobs[0], false);
  assert.equal('mobile' in result.data.jobs[0], false);
  assert.equal('whatsapp' in result.data.jobs[0], false);
});

test('technician endpoint rejects missing technician identity', async () => {
  const result = await routePersistentRequest({ method: 'GET', url: '/api/v1/technicians/me/jobs', role: 'technician', context: {}, db: dbReturning([]) });
  assert.equal(result.status, 401);
});

test('non-technician cannot use technician jobs endpoint', async () => {
  const result = await routePersistentRequest({ method: 'GET', url: '/api/v1/technicians/me/jobs', role: 'customer', context: { technicianId: 'tech-1' }, db: dbReturning([]) });
  assert.equal(result.status, 403);
});
