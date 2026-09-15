import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../src/http/router.mjs';

const technician = { id: 't1', isActive: true, cityId: 'riyadh', rating: 5 };

test('dispatcher assigns a service job', () => {
  const result = routeRequest({ method: 'POST', url: '/api/v1/jobs/j1/assign', role: 'dispatcher', body: { technicianId: 't1', scheduledAt: '2026-09-15T09:00:00+03:00' }, context: { userId: 'd1', jobs: [{ id: 'j1', status: 'pending_assignment', cityId: 'riyadh' }], technicians: [technician] } });
  assert.equal(result.status, 200);
  assert.equal(result.data.job.technicianId, 't1');
  assert.equal(result.data.job.status, 'scheduled');
});

test('technician completion requires evidence', () => {
  const result = routeRequest({ method: 'POST', url: '/api/v1/jobs/j1/complete', role: 'technician', body: { evidence: [], settlementInput: { saleExVat: 500, productCost: 300, payoutMode: 'percentage', payoutRate: 0.3 } }, context: { userId: 't1', jobs: [{ id: 'j1', technicianId: 't1', status: 'in_progress' }] } });
  assert.equal(result.status, 422);
});

test('finance approval creates technician wallet credit', () => {
  const result = routeRequest({ method: 'POST', url: '/api/v1/settlements/s1/approve', role: 'finance', context: { userId: 'f1', settlements: [{ id: 's1', technicianId: 't1', status: 'pending_approval', payoutAmount: 60 }] } });
  assert.equal(result.status, 200);
  assert.equal(result.data.settlement.status, 'approved');
  assert.equal(result.data.walletEntry.amount, 60);
});

test('customer can rate own completed service only once', () => {
  const context = { userId: 'c1', jobs: [{ id: 'j1', customerId: 'c1', technicianId: 't1', status: 'completed' }], ratings: [] };
  const result = routeRequest({ method: 'POST', url: '/api/v1/jobs/j1/rating', role: 'customer', body: { score: 5, comment: 'Excellent' }, context });
  assert.equal(result.status, 201);
  assert.equal(result.data.rating.score, 5);

  const duplicate = routeRequest({ method: 'POST', url: '/api/v1/jobs/j1/rating', role: 'customer', body: { score: 4 }, context: { ...context, ratings: [result.data.rating] } });
  assert.equal(duplicate.status, 409);
});

test('technician wallet is scoped to signed-in technician', () => {
  const result = routeRequest({ method: 'GET', url: '/api/v1/technicians/me/wallet', role: 'technician', context: { userId: 't1', walletEntries: [{ technicianId: 't1', type: 'credit', amount: 60, status: 'available' }, { technicianId: 't2', type: 'credit', amount: 999, status: 'available' }] } });
  assert.equal(result.status, 200);
  assert.equal(result.data.balance, 60);
  assert.equal(result.data.entries.length, 1);
});
