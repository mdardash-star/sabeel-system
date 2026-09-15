import { can } from '../auth/rbac.mjs';
import { createRepositories } from '../persistence/repositories.mjs';

export async function routePersistentRequest({ method, url, role, context = {}, db }) {
  if (!db?.query) return response(503, { error: 'database_unavailable' });

  const jobDetailsMatch = url.match(/^\/api\/v1\/technicians\/me\/jobs\/([^/]+)$/);
  if (method === 'GET' && jobDetailsMatch) {
    const identity = await resolveTechnician({ role, context, db });
    if (identity.error) return identity.error;

    const job = await identity.repos.jobs.findForTechnician(jobDetailsMatch[1], identity.technician.id);
    if (!job) return response(404, { error: 'job_not_found' });
    return response(200, { technicianId: identity.technician.id, job });
  }

  if (method === 'GET' && url === '/api/v1/technicians/me/jobs') {
    const identity = await resolveTechnician({ role, context, db });
    if (identity.error) return identity.error;

    const from = context.from || startOfUtcDay(new Date());
    const to = context.to || addUtcDays(from, 1);
    const jobs = await identity.repos.jobs.listForTechnician(identity.technician.id, from, to);
    return response(200, { technicianId: identity.technician.id, from, to, jobs });
  }

  if (method === 'GET' && url === '/api/v1/technicians/me/wallet') {
    const identity = await resolveTechnician({ role, context, db });
    if (identity.error) return identity.error;

    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const [balance, entries] = await Promise.all([
      identity.repos.wallet.balance(identity.technician.id),
      identity.repos.wallet.listForTechnician(identity.technician.id, pagination)
    ]);
    return response(200, {
      technicianId: identity.technician.id,
      balance,
      currency: entries[0]?.currency || 'SAR',
      entries: entries.map(({ total_count, ...entry }) => entry),
      pagination: { ...pagination, total: entries[0]?.total_count || 0 }
    });
  }

  return response(404, { error: 'not_found' });
}

function parsePagination(context) {
  const limit = context.limit === undefined ? 20 : Number(context.limit);
  const offset = context.offset === undefined ? 0 : Number(context.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return null;
  if (!Number.isInteger(offset) || offset < 0) return null;
  return { limit, offset };
}

async function resolveTechnician({ role, context, db }) {
  if (!can(role, 'jobs:assigned:read') || role !== 'technician') {
    return { error: response(403, { error: 'forbidden' }) };
  }
  if (!context.userId) return { error: response(401, { error: 'user_identity_required' }) };

  const repos = createRepositories(db);
  const technician = await repos.technicians.findActiveByUserId(context.userId);
  if (!technician) return { error: response(403, { error: 'active_technician_required' }) };
  return { repos, technician };
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
