import { can } from '../auth/rbac.mjs';
import { technicianJobView, transitionJob } from '../jobs/state-machine.mjs';
import { assignJob } from '../dispatch/assignment.mjs';
import { completeServiceJob } from '../jobs/completion.mjs';
import { approveSettlement, walletEntryFromSettlement, walletBalance } from '../finance/wallet.mjs';
import { createServiceRating } from '../crm/ratings.mjs';

export function routeRequest({ method, url, role, body = {}, context = {} }) {
  if (method === 'GET' && url === '/health') return response(200, { service: 'subil-api', status: 'ok' });

  if (method === 'GET' && url === '/api/v1/technicians/me/jobs') {
    if (!can(role, 'jobs:assigned:read')) return response(403, { error: 'forbidden' });
    const jobs = (context.jobs || []).filter(j => j.technicianId === context.userId).map(technicianJobView);
    return response(200, { jobs });
  }

  if (method === 'GET' && url === '/api/v1/technicians/me/wallet') {
    if (role !== 'technician' && !can(role, 'settlements:read')) return response(403, { error: 'forbidden' });
    const technicianId = role === 'technician' ? context.userId : body.technicianId;
    const entries = (context.walletEntries || []).filter(e => e.technicianId === technicianId);
    return response(200, { technicianId, balance: walletBalance(entries, technicianId), entries });
  }

  const assignMatch = url.match(/^\/api\/v1\/jobs\/([^/]+)\/assign$/);
  if (method === 'POST' && assignMatch) {
    if (!can(role, 'jobs:assign')) return response(403, { error: 'forbidden' });
    const job = findById(context.jobs, assignMatch[1]);
    const technician = findById(context.technicians, body.technicianId);
    if (!job) return response(404, { error: 'job_not_found' });
    if (!technician) return response(404, { error: 'technician_not_found' });
    try { return response(200, { job: assignJob(job, technician, body.scheduledAt) }); }
    catch (error) { return response(422, { error: 'assignment_invalid', message: error.message }); }
  }

  const statusMatch = url.match(/^\/api\/v1\/jobs\/([^/]+)\/status$/);
  if (method === 'PATCH' && statusMatch) {
    if (!can(role, 'jobs:assigned:update') && !can(role, 'jobs:schedule')) return response(403, { error: 'forbidden' });
    const job = findById(context.jobs, statusMatch[1]);
    if (!job) return response(404, { error: 'job_not_found' });
    if (role === 'technician' && job.technicianId !== context.userId) return response(403, { error: 'forbidden' });
    try { return response(200, { job: transitionJob(job, body.status) }); }
    catch (error) { return response(409, { error: 'invalid_transition', message: error.message }); }
  }

  const completeMatch = url.match(/^\/api\/v1\/jobs\/([^/]+)\/complete$/);
  if (method === 'POST' && completeMatch) {
    if (!can(role, 'jobs:assigned:update')) return response(403, { error: 'forbidden' });
    const job = findById(context.jobs, completeMatch[1]);
    if (!job) return response(404, { error: 'job_not_found' });
    if (role === 'technician' && job.technicianId !== context.userId) return response(403, { error: 'forbidden' });
    try {
      return response(200, completeServiceJob({ job, evidence: body.evidence, settlementInput: { ...body.settlementInput, technicianId: job.technicianId } }));
    } catch (error) { return response(422, { error: 'completion_invalid', message: error.message }); }
  }

  const approveMatch = url.match(/^\/api\/v1\/settlements\/([^/]+)\/approve$/);
  if (method === 'POST' && approveMatch) {
    if (!can(role, 'settlements:approve')) return response(403, { error: 'forbidden' });
    const settlement = findById(context.settlements, approveMatch[1]);
    if (!settlement) return response(404, { error: 'settlement_not_found' });
    try {
      const approved = approveSettlement(settlement, context.userId);
      return response(200, { settlement: approved, walletEntry: walletEntryFromSettlement(approved) });
    } catch (error) { return response(422, { error: 'settlement_invalid', message: error.message }); }
  }

  const ratingMatch = url.match(/^\/api\/v1\/jobs\/([^/]+)\/rating$/);
  if (method === 'POST' && ratingMatch) {
    if (role !== 'customer') return response(403, { error: 'forbidden' });
    const job = findById(context.jobs, ratingMatch[1]);
    if (!job || job.status !== 'completed') return response(409, { error: 'service_not_completed' });
    if (job.customerId !== context.userId) return response(403, { error: 'forbidden' });
    if ((context.ratings || []).some(r => r.jobId === job.id)) return response(409, { error: 'rating_already_exists' });
    try {
      return response(201, { rating: createServiceRating({ jobId: job.id, customerId: context.userId, technicianId: job.technicianId, score: body.score, comment: body.comment }) });
    } catch (error) { return response(422, { error: 'rating_invalid', message: error.message }); }
  }

  return response(404, { error: 'not_found' });
}

function findById(items = [], id) { return items.find(item => String(item.id) === String(id)); }
function response(status, data) { return { status, data }; }
