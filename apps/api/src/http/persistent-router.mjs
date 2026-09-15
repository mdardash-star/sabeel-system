import { can } from '../auth/rbac.mjs';
import { createRepositories } from '../persistence/repositories.mjs';

export async function routePersistentRequest({ method, url, role, context = {}, db }) {
  if (!db?.query) return response(503, { error: 'database_unavailable' });

  if (method === 'GET' && url === '/api/v1/technicians/me/jobs') {
    if (!can(role, 'jobs:assigned:read')) return response(403, { error: 'forbidden' });
    if (role !== 'technician') return response(403, { error: 'forbidden' });
    if (!context.technicianId) return response(401, { error: 'technician_identity_required' });

    const from = context.from || startOfUtcDay(new Date());
    const to = context.to || addUtcDays(from, 1);
    const repos = createRepositories(db);
    const jobs = await repos.jobs.listForTechnician(context.technicianId, from, to);
    return response(200, { technicianId: context.technicianId, from, to, jobs });
  }

  return response(404, { error: 'not_found' });
}

function startOfUtcDay(date) {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  return value.toISOString();
}

function addUtcDays(iso, days) {
  const value = new Date(iso);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString();
}

function response(status, data) { return { status, data }; }
