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

test('technician can read assigned job details', async () => {
  const db = technicianDb([{ id: 'job-1', technician_id: 'tech-1', address_text: 'Riyadh' }], (sql, params) => {
    assert.match(sql, /j\.id = \$1 AND j\.technician_id = \$2/);
    assert.deepEqual(params, ['job-1', 'tech-1']);
  });
  const result = await routePersistentRequest({
    method: 'GET',
    url: '/api/v1/technicians/me/jobs/job-1',
    role: 'technician',
    context: { userId: 'user-1' },
    db
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.job.id, 'job-1');
});

test('another technicians job is indistinguishable from a missing job', async () => {
  const result = await routePersistentRequest({
    method: 'GET',
    url: '/api/v1/technicians/me/jobs/job-2',
    role: 'technician',
    context: { userId: 'user-1' },
    db: technicianDb([])
  });
  assert.equal(result.status, 404);
  assert.equal(result.data.error, 'job_not_found');
});

test('technician wallet returns PostgreSQL balance and paginated entries', async () => {
  const db = {
    query: async (sql, params) => {
      if (/FROM technicians t/.test(sql)) return { rows: [{ id: 'tech-1', user_id: 'user-1' }] };
      if (/COALESCE\(SUM/.test(sql)) return { rows: [{ balance: '125.50' }] };
      assert.deepEqual(params, ['tech-1', 10, 20]);
      return { rows: [{ id: 'w1', amount: '125.50', currency: 'SAR', total_count: 21 }] };
    }
  };
  const result = await routePersistentRequest({
    method: 'GET',
    url: '/api/v1/technicians/me/wallet',
    role: 'technician',
    context: { userId: 'user-1', limit: '10', offset: '20' },
    db
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.balance, 125.5);
  assert.equal(result.data.entries[0].id, 'w1');
  assert.equal('total_count' in result.data.entries[0], false);
  assert.deepEqual(result.data.pagination, { limit: 10, offset: 20, total: 21 });
});

test('technician wallet rejects invalid pagination', async () => {
  const result = await routePersistentRequest({
    method: 'GET',
    url: '/api/v1/technicians/me/wallet',
    role: 'technician',
    context: { userId: 'user-1', limit: '101' },
    db: technicianDb([])
  });
  assert.equal(result.status, 400);
  assert.equal(result.data.error, 'invalid_pagination');
});
