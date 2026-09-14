import { can } from '../auth/rbac.mjs';
import { technicianJobView, transitionJob } from '../jobs/state-machine.mjs';

export function routeRequest({ method, url, role, body = {}, context = {} }) {
  if (method === 'GET' && url === '/health') {
    return response(200, { service: 'subil-api', status: 'ok' });
  }

  if (method === 'GET' && url === '/api/v1/technicians/me/jobs') {
    if (!can(role, 'jobs:assigned:read')) return response(403, { error: 'forbidden' });
    const technicianId = context.userId;
    const jobs = (context.jobs || [])
      .filter(job => job.technicianId === technicianId)
      .map(technicianJobView);
    return response(200, { jobs });
  }

  const statusMatch = url.match(/^\/api\/v1\/jobs\/([^/]+)\/status$/);
  if (method === 'PATCH' && statusMatch) {
    if (!can(role, 'jobs:assigned:update') && !can(role, 'jobs:schedule')) {
      return response(403, { error: 'forbidden' });
    }
    const job = (context.jobs || []).find(item => String(item.id) === statusMatch[1]);
    if (!job) return response(404, { error: 'job_not_found' });
    if (role === 'technician' && job.technicianId !== context.userId) {
      return response(403, { error: 'forbidden' });
    }
    try {
      return response(200, { job: transitionJob(job, body.status) });
    } catch (error) {
      return response(409, { error: 'invalid_transition', message: error.message });
    }
  }

  return response(404, { error: 'not_found' });
}

function response(status, data) {
  return { status, data };
}
