import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, transitionJob, technicianJobView } from '../src/jobs/state-machine.mjs';

test('allows normal technician workflow', () => {
  assert.equal(canTransition('scheduled', 'en_route'), true);
  assert.equal(canTransition('en_route', 'arrived'), true);
  assert.equal(canTransition('arrived', 'in_progress'), true);
  assert.equal(canTransition('in_progress', 'completed'), true);
});

test('blocks skipping required workflow steps', () => {
  assert.equal(canTransition('scheduled', 'completed'), false);
  assert.throws(() => transitionJob({ id: 'job-1', status: 'scheduled' }, 'completed'));
});

test('records completion time', () => {
  const now = new Date('2026-09-14T12:00:00Z');
  const job = transitionJob({ id: 'job-2', status: 'in_progress' }, 'completed', now);
  assert.equal(job.completedAt, now.toISOString());
});

test('technician view removes customer phone fields', () => {
  const view = technicianJobView({
    id: 'job-3',
    status: 'scheduled',
    customerPhone: 'hidden',
    customerMobile: 'hidden',
    billingPhone: 'hidden',
    shippingPhone: 'hidden',
    addressText: 'service location'
  });
  assert.equal('customerPhone' in view, false);
  assert.equal('customerMobile' in view, false);
  assert.equal('billingPhone' in view, false);
  assert.equal('shippingPhone' in view, false);
  assert.equal(view.addressText, 'service location');
});
