import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../src/http/router.mjs';

test('technician cannot approve own settlement', () => {
  const result = routeRequest({
    method: 'POST',
    url: '/api/v1/settlements/settlement-1/approve',
    role: 'technician',
    context: {
      userId: 'tech-1',
      settlements: [{ id: 'settlement-1', technicianId: 'tech-1', status: 'pending_approval', payoutAmount: 60 }]
    }
  });
  assert.equal(result.status, 403);
});

test('finance approval credits the technician recorded on settlement', () => {
  const result = routeRequest({
    method: 'POST',
    url: '/api/v1/settlements/settlement-1/approve',
    role: 'finance',
    context: {
      userId: 'finance-1',
      settlements: [{ id: 'settlement-1', technicianId: 'tech-1', status: 'pending_approval', payoutAmount: 60 }]
    }
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.settlement.status, 'approved');
  assert.equal(result.data.walletEntry.technicianId, 'tech-1');
  assert.equal(result.data.walletEntry.amount, 60);
});

test('technician cannot complete another technicians job', () => {
  const result = routeRequest({
    method: 'POST',
    url: '/api/v1/jobs/job-1/complete',
    role: 'technician',
    body: {
      evidence: [{ mediaType: 'image', storageKey: 'jobs/job-1/after.jpg' }],
      settlementInput: { saleExVat: 500, productCost: 250, otherCosts: 50, mode: 'percentage', commissionRate: 0.30 }
    },
    context: {
      userId: 'tech-2',
      jobs: [{ id: 'job-1', technicianId: 'tech-1', status: 'in_progress' }]
    }
  });
  assert.equal(result.status, 403);
});
