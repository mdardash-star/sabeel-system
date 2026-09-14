import { serviceJobFromPaidOrder } from '../integrations/woocommerce-order.mjs';
import { suggestTechnician, assignJob } from '../dispatch/assignment.mjs';
import { transitionJob } from '../jobs/state-machine.mjs';
import { notificationForJobStatus } from '../notifications/events.mjs';
import { calculateSettlement } from '../finance/settlement.mjs';
import { approveSettlement, walletEntryFromSettlement } from '../finance/wallet.mjs';
import { registerInstalledAsset } from '../crm/assets.mjs';

export function createScheduledService({ order, technicians, scheduledAt, jobId }) {
  const draft = serviceJobFromPaidOrder(order);
  if (!draft) return null;
  const job = { ...draft, id: jobId, cityId: draft.serviceLocation.city };
  const technician = suggestTechnician(job, technicians);
  if (!technician) throw new Error('No eligible technician');
  const scheduledJob = assignJob(job, technician, scheduledAt);
  return {
    job: scheduledJob,
    technician,
    notification: notificationForJobStatus(scheduledJob, 'scheduled')
  };
}

export function progressService(job, to, now = new Date()) {
  const next = transitionJob(job, to, now);
  return { job: next, notification: notificationForJobStatus(next, to) };
}

export function closeServiceWithFinance({ job, evidence, settlementInput, settlementId, approverUserId, now = new Date() }) {
  if (job.status !== 'in_progress') throw new Error('Job must be in progress');
  if (!Array.isArray(evidence) || !evidence.some(e => ['image', 'video'].includes(e.mediaType))) {
    throw new Error('Photo or video evidence is required');
  }

  const completedJob = transitionJob(job, 'completed', now);
  const calculated = calculateSettlement(settlementInput);
  const pendingSettlement = {
    id: settlementId,
    jobId: completedJob.id,
    technicianId: completedJob.technicianId,
    ...calculated,
    status: 'pending_approval'
  };
  const approvedSettlement = approveSettlement(pendingSettlement, approverUserId, now);
  const walletEntry = walletEntryFromSettlement(approvedSettlement, now);

  return {
    job: completedJob,
    settlement: approvedSettlement,
    walletEntry,
    notification: notificationForJobStatus(completedJob, 'completed')
  };
}

export function assetFromCompletedService({ job, productId, serialNumber, installedAt, warrantyEndsAt, maintenanceIntervalMonths = 6, assetId }) {
  if (job.status !== 'completed') throw new Error('Job must be completed');
  return registerInstalledAsset({
    id: assetId,
    customerId: job.customerId,
    productId,
    serialNumber,
    installedAt,
    warrantyEndsAt,
    maintenanceIntervalMonths
  });
}
