import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledService, progressService } from '../src/core/service-lifecycle.mjs';

const order = {
  id: 9001,
  status: 'processing',
  billing: { first_name: 'Customer', city: 'riyadh' },
  shipping: { address_1: 'Riyadh', city: 'riyadh' },
  line_items: [{ id: 1, name: 'Service item', quantity: 1, meta_data: [{ key: '_subil_requires_service', value: 'yes' }] }]
};

const technicians = [{ id: 'tech-1', cityId: 'riyadh', isActive: true, rating: 4.9, jobsToday: 2, distanceKm: 5 }];

test('paid service order can be scheduled and progressed', () => {
  const scheduled = createScheduledService({ order, technicians, scheduledAt: '2026-09-15T09:00:00Z', jobId: 'job-9001' });
  assert.equal(scheduled.job.status, 'scheduled');
  assert.equal(scheduled.job.technicianId, 'tech-1');
  assert.equal(scheduled.notification.type, 'service.scheduled');
  const enRoute = progressService(scheduled.job, 'en_route');
  assert.equal(enRoute.job.status, 'en_route');
  assert.equal(enRoute.notification.type, 'technician.en_route');
});
