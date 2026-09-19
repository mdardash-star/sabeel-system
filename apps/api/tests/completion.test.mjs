import test from 'node:test';
import assert from 'node:assert/strict';
import { completeServiceJob } from '../src/jobs/completion.mjs';

const job = { id: 'job-100', status: 'in_progress', technicianId: 'tech-1' };
const settlementInput = {
  saleExVat: 1000,
  productCost: 500,
  otherCosts: 100,
  mode: 'percentage',
  commissionRate: 0.30,
  policyVersion: 'initial-1'
};

test('blocks completion without evidence', () => {
  assert.throws(() => completeServiceJob({ job, evidence: [], settlementInput }));
});

test('completes job and creates pending settlement with valid evidence', () => {
  const result = completeServiceJob({
    job,
    evidence: [{ mediaType: 'image', storageKey: 'jobs/job-100/after.jpg' }],
    settlementInput,
    now: new Date('2026-09-14T15:00:00Z')
  });
  assert.equal(result.job.status, 'completed');
  assert.equal(result.settlement.margin, 400);
  assert.equal(result.settlement.payoutAmount, 120);
  assert.equal(result.settlement.status, 'pending_approval');
  assert.equal(result.auditEvents.length, 2);
});
