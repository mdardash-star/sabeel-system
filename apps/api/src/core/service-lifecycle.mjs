import { serviceJobFromPaidOrder } from '../integrations/woocommerce-order.mjs';
import { suggestTechnician, assignJob } from '../dispatch/assignment.mjs';
import { transitionJob } from '../jobs/state-machine.mjs';
import { notificationForJobStatus } from '../notifications/events.mjs';
import { completeServiceJob } from '../jobs/completion.mjs';
import { approveSettlement, walletEntryFromSettlement } from '../finance/wallet.mjs';
import { registerInstalledAsset } from '../crm/assets.mjs';

export function createScheduledService({ order, customerId, technicians, scheduledAt, jobId }) {
  if (!customerId) throw new Error('SUBIL customer id is required');
  const draft = serviceJobFromPaidOrder(order, { customerId });
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

export function closeService({ job, evidence, settlementInput, settlementId, now = new Date() }) {
  const result = completeServiceJob({ job, evidence, settlementInput, now });
  const pendingSettlement = {
    id: settlementId,
    ...result.settlement
  };

  return {
    job: result.job,
    evidence: result.evidence,
    settlement: pendingSettlement,
    audit: result.audit,
    notification: notificationForJobStatus(result.job, 'completed')
  };
}

export function approveServiceSettlement({ settlement, approverUserId, now = new Date() }) {
  const approvedSettlement = approveSettlement(settlement, approverUserId, now);
  return {
    settlement: approvedSettlement,
    walletEntry: walletEntryFromSettlement(approvedSettlement, now)
  };
}

export function assetFromCompletedService({ job, productId, serialNumber, installedAt, warrantyEndsAt, maintenanceIntervalMonths = 6, assetId }) {
  if (job.status !== 'completed') throw new Error('Job must be completed');
  if (!job.customerId) throw new Error('Completed job must be linked to a SUBIL customer');
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
