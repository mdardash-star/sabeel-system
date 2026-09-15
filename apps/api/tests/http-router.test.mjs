import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../src/http/router.mjs';

const jobs = [{ id: 'j1', technicianId: 't1', status: 'scheduled', customerName: 'A', customerPhone: '0500000000', mobile: '0500000000' }];

test('technician sees only assigned jobs without customer phone', () => {
  const result = routeRequest({ method: 'GET', url: '/api/v1/technicians/me/jobs', role: 'technician', context: { userId: 't1', jobs } });
  assert.equal(result.status, 200);
  assert.equal(result.data.jobs.length, 1);
  assert.equal(result.data.jobs[0].customerPhone, undefined);
  assert.equal(result.data.jobs[0].mobile, undefined);
});

test('customer cannot access technician jobs', () => {
  const result = routeRequest({ method: 'GET', url: '/api/v1/technicians/me/jobs', role: 'customer', context: { userId: 'c1', jobs } });
  assert.equal(result.status, 403);
});

test('technician cannot update another technician job', () => {
  const result = routeRequest({ method: 'PATCH', url: '/api/v1/jobs/j1/status', role: 'technician', body: { status: 'en_route' }, context: { userId: 't2', jobs } });
  assert.equal(result.status, 403);
});
