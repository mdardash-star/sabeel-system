import test from 'node:test';
import assert from 'node:assert/strict';
import { routePersistentRequest } from '../src/http/persistent-router.mjs';

function dbReturning(rows, inspect = () => {}) {
  return { query: async (sql, params) => { inspect(sql, params); return { rows }; } };
}

function technicianDb(jobRows, inspectJobs = () => {}) {
  return {
    query: async (sql, params) => {
      if (/FROM technicians t/.test(sql)) {
        assert.equal(params[0], 'user-1');
        return { rows: [{ id: 'tech-1', user_id: 'user-1', city_id: 'riyadh' }] };
      }
      inspectJobs(sql, params);
      return { rows: jobRows };
    }
  };
}

test('technician endpoint reads only own jobs from safe repository projection', async () => {
  const db = technicianDb([
    { id: 'job-1', technician_id: 'tech-1', address_text: 'Riyadh', latitude: '24.7', longitude: '46.6', external_order_id: '1001' }
  ], (sql, params) => {
    assert.match(sql, /j\.technician_id = \$1/);
    assert.equal(params[0], 'tech-1');
    assert.doesNotMatch(sql, /JOIN customers/i);
    assert.doesNotMatch(sql, /\bphone\b|\bmobile\b|whatsapp/i);
  });
  const result = await routePersistentRequest({ method: 'GET', url: '/api/v1/technicians/me/jobs', role: 'technician', context: { userId: 'user-1', from: '2026-09-15T00:00:00Z', to: '2026-09-16T00:00:00Z' }, db });
  assert.equal(result.status, 200);
  assert.equal(result.data.jobs[0].address_text, 'Riyadh');
  assert.equal('phone' in result.data.jobs[0], false);
  assert.equal('mobile' in result.data.jobs[0], false);
  assert.equal('whatsapp' in result.data.jobs[0], false);
});

test('technician endpoint rejects missing signed-in user identity', async () => {
  const result = await routePersistentRequest({ method: 'GET', url: '/api/v1/technicians/me/jobs', role: 'technician', context: {}, db: dbReturning([]) });
  assert.equal(result.status, 401);
});

test('technician endpoint rejects inactive or unknown technician profile', async () => {
  const result = await routePersistentRequest({ method: 'GET', url: '/api/v1/technicians/me/jobs', role: 'technician', context: { userId: 'user-1' }, db: dbReturning([]) });
  assert.equal(result.status, 403);
  assert.equal(result.data.error, 'active_technician_required');
});

test('non-technician cannot use technician jobs endpoint', async () => {
  const result = await routePersistentRequest({ method: 'GET', url: '/api/v1/technicians/me/jobs', role: 'customer', context: { userId: 'user-1' }, db: dbReturning([]) });
  assert.equal(result.status, 403);
});
