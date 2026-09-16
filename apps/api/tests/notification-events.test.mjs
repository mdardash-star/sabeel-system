import test from 'node:test';
import assert from 'node:assert/strict';
import { notificationForJobStatus } from '../src/notifications/events.mjs';

const job = { id: 'job-1', customerId: 'customer-1', scheduledAt: '2026-09-17T10:00:00Z' };

test('scheduled service event includes push whatsapp and sms', () => {
  const event = notificationForJobStatus(job, 'scheduled');
  assert.equal(event.type, 'service.scheduled');
  assert.deepEqual(event.channels, ['push', 'whatsapp', 'sms']);
  assert.equal(event.data.ratingRequested, false);
});

test('completed service event requests rating', () => {
  const event = notificationForJobStatus(job, 'completed');
  assert.equal(event.type, 'service.completed');
  assert.equal(event.data.ratingRequested, true);
});

test('unsupported internal state does not emit customer event', () => {
  assert.equal(notificationForJobStatus(job, 'in_progress'), null);
});
