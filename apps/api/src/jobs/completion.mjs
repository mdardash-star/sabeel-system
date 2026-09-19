import { transitionJob } from './state-machine.mjs';
import { calculateSettlement } from '../finance/settlement.mjs';

export function completeServiceJob({ job, evidence, settlementInput, now = new Date() }) {
  if (job.status !== 'in_progress') throw new Error('Job must be in progress');
  if (!job.technicianId) throw new Error('Job must be assigned to a technician');
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new Error('Evidence is required before completion');
  }

  const validEvidence = evidence.filter(item => ['image', 'video'].includes(item.mediaType) && item.storageKey);
  if (validEvidence.length === 0) throw new Error('Valid image or video evidence is required');

  const completedJob = transitionJob(job, 'completed', now);
  const settlement = calculateSettlement({ ...settlementInput, jobId: job.id });

  return {
    job: completedJob,
    evidence: validEvidence,
    settlement: {
      ...settlement,
      jobId: job.id,
      technicianId: job.technicianId,
      status: 'pending_approval'
    },
    auditEvents: [
      { action: 'job.completed', entityType: 'serviceJob', entityId: job.id },
      { action: 'settlement.created', entityType: 'technicianSettlement', entityId: job.id }
    ]
  };
}
