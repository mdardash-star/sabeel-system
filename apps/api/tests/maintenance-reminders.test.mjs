import test from 'node:test';
import assert from 'node:assert/strict';
import { maintenanceReminderEvents } from '../src/crm/maintenance-reminders.mjs';

test('creates pending reminder only for due active assets', () => {
  const assets = [
    { id: 'a1', customerId: 'c1', productId: 'p1', status: 'active', nextMaintenanceAt: '2026-09-15T00:00:00.000Z' },
    { id: 'a2', customerId: 'c2', productId: 'p2', status: 'active', nextMaintenanceAt: '2026-12-15T00:00:00.000Z' }
  ];
  const events = maintenanceReminderEvents(assets, new Date('2026-09-15T06:00:00.000Z'));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'maintenance.due');
  assert.equal(events[0].assetId, 'a1');
  assert.equal(events[0].status, 'pending');
  assert.deepEqual(events[0].channels, ['push', 'email', 'whatsapp']);
});
