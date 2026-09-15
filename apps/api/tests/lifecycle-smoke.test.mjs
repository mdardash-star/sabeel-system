import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduledService, progressService, closeService, approveServiceSettlement, assetFromCompletedService } from '../src/core/service-lifecycle.mjs';

const order = {
  id: 9001,
  customer_id: 77,
  status: 'processing',
  billing: { first_name: 'Customer', email: 'customer@example.com', phone: '+966500000000', city: 'riyadh' },
  shipping: { address_1: 'Riyadh', city: 'riyadh' },
  line_items: [{ id: 1, name: 'Service item', quantity: 1, meta_data: [{ key: '_subil_requires_service', value: 'yes' }] }]
};

const technicians = [{ id: 'tech-1', cityId: 'riyadh', isActive: true, rating: 4.9, jobsToday: 2, distanceKm: 5 }];

test('paid order stays linked to SUBIL customer through installation and finance', () => {
  const scheduled = createScheduledService({ order, customerId: 'customer-77', technicians, scheduledAt: '2026-09-15T09:00:00Z', jobId: 'job-9001' });
  assert.equal(scheduled.job.status, 'scheduled');
  assert.equal(scheduled.job.customerId, 'customer-77');
  assert.equal(scheduled.job.customerIdentityKey, 'woocommerce:customer:77');
  assert.equal(scheduled.job.technicianId, 'tech-1');

  const enRoute = progressService(scheduled.job, 'en_route', new Date('2026-09-15T08:30:00Z'));
  const arrived = progressService(enRoute.job, 'arrived', new Date('2026-09-15T08:55:00Z'));
  const inProgress = progressService(arrived.job, 'in_progress', new Date('2026-09-15T09:00:00Z'));

  const closed = closeService({
    job: inProgress.job,
    evidence: [{ mediaType: 'image', storageKey: 'jobs/job-9001/after.jpg' }],
    settlementId: 'settlement-9001',
    settlementInput: { saleExVat: 500, productCost: 250, otherCosts: 50, mode: 'percentage', commissionRate: 0.30, policyVersion: '2026-09' },
    now: new Date('2026-09-15T10:00:00Z')
  });
  assert.equal(closed.job.status, 'completed');
  assert.equal(closed.job.customerId, 'customer-77');
  assert.equal(closed.settlement.status, 'pending_approval');
  assert.equal(closed.settlement.margin, 200);
  assert.equal(closed.settlement.payoutAmount, 60);
  assert.equal(closed.notification.type, 'service.completed');

  const finance = approveServiceSettlement({ settlement: closed.settlement, approverUserId: 'finance-1', now: new Date('2026-09-15T10:05:00Z') });
  assert.equal(finance.settlement.status, 'approved');
  assert.equal(finance.walletEntry.technicianId, 'tech-1');
  assert.equal(finance.walletEntry.amount, 60);

  const asset = assetFromCompletedService({
    job: closed.job,
    assetId: 'asset-9001',
    productId: 'product-aqua-gold',
    serialNumber: 'AG-9001',
    installedAt: '2026-09-15T10:00:00Z'
  });
  assert.equal(asset.customerId, 'customer-77');
  assert.equal(asset.status, 'active');
  assert.ok(asset.nextMaintenanceAt);
});

test('scheduling requires resolved SUBIL customer id', () => {
  assert.throws(() => createScheduledService({ order, technicians, scheduledAt: '2026-09-15T09:00:00Z', jobId: 'job-no-customer' }), /customer id/i);
});
