import test from 'node:test';
import assert from 'node:assert/strict';
import { approveSettlement, walletEntryFromSettlement, walletBalance } from '../src/finance/wallet.mjs';
import { registerInstalledAsset, completeMaintenance, maintenanceDue } from '../src/crm/assets.mjs';
import { createServiceRating, technicianRating } from '../src/crm/ratings.mjs';

test('approved settlement becomes an available wallet credit', () => {
  const settlement = approveSettlement({ id: 's1', technicianId: 't1', payoutAmount: 120, status: 'pending_approval' }, 'finance-1', new Date('2026-09-14T12:00:00Z'));
  const entry = walletEntryFromSettlement(settlement, new Date('2026-09-14T12:01:00Z'));
  assert.equal(settlement.status, 'approved');
  assert.equal(entry.amount, 120);
  assert.equal(walletBalance([entry], 't1'), 120);
});

test('asset schedules maintenance and advances after service', () => {
  const asset = registerInstalledAsset({ id: 'a1', customerId: 'c1', productId: 'p1', installedAt: '2026-01-01T00:00:00Z', maintenanceIntervalMonths: 6 });
  assert.equal(maintenanceDue(asset, new Date('2026-07-02T00:00:00Z')), true);
  const serviced = completeMaintenance(asset, new Date('2026-07-02T00:00:00Z'));
  assert.equal(maintenanceDue(serviced, new Date('2026-07-03T00:00:00Z')), false);
});

test('verified ratings calculate technician average', () => {
  const r1 = createServiceRating({ jobId: 'j1', customerId: 'c1', technicianId: 't1', score: 5 });
  const r2 = createServiceRating({ jobId: 'j2', customerId: 'c2', technicianId: 't1', score: 4 });
  assert.deepEqual(technicianRating([r1, r2], 't1'), { average: 4.5, count: 2 });
});
