import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestTechnician, assignJob } from '../src/dispatch/assignment.mjs';
import { dailyJobsForTechnician } from '../src/technicians/daily-jobs.mjs';
import { notificationForJobStatus } from '../src/notifications/events.mjs';

test('suggests an active technician in the same city', () => {
  const job = { id: 'j1', cityId: 'riyadh' };
  const technicians = [
    { id: 'outside', cityId: 'jeddah', isActive: true, rating: 5, jobsToday: 0, distanceKm: 1 },
    { id: 'busy', cityId: 'riyadh', isActive: true, rating: 4.9, jobsToday: 7, distanceKm: 5 },
    { id: 'near', cityId: 'riyadh', isActive: true, rating: 4.8, jobsToday: 2, distanceKm: 2 }
  ];
  assert.equal(suggestTechnician(job, technicians).id, 'near');
});

test('assigns and schedules a technician', () => {
  const job = assignJob({ id: 'j2', cityId: 'riyadh' }, { id: 't1', cityId: 'riyadh', isActive: true }, '2026-09-15T09:30:00+03:00');
  assert.equal(job.status, 'scheduled');
  assert.equal(job.technicianId, 't1');
});

test('daily technician list is ordered and hides phones', () => {
  const jobs = [
    { id: 'late', technicianId: 't1', scheduledAt: '2026-09-15T12:00:00Z', customerPhone: 'hidden' },
    { id: 'early', technicianId: 't1', scheduledAt: '2026-09-15T08:00:00Z', customerMobile: 'hidden' }
  ];
  const result = dailyJobsForTechnician(jobs, 't1', '2026-09-15T00:00:00Z');
  assert.deepEqual(result.map(j => j.id), ['early', 'late']);
  assert.equal('customerPhone' in result[1], false);
  assert.equal('customerMobile' in result[0], false);
});

test('creates pending customer notification for tracked statuses', () => {
  const event = notificationForJobStatus({ id: 'j3', customerId: 'c1', scheduledAt: '2026-09-15T09:00:00Z' }, 'en_route');
  assert.equal(event.type, 'technician.en_route');
  assert.equal(event.deliveryStatus, 'pending');
});
