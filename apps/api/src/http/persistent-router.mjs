import { can } from '../auth/rbac.mjs';
import { createRepositories } from '../persistence/repositories.mjs';
import { approveSettlementAndCreditWallet, completeTechnicianJob, transitionTechnicianJob } from '../persistence/transactions.mjs';

export async function routePersistentRequest({ method, url, role, body = {}, context = {}, db }) {
  if (!db?.query) return response(503, { error: 'database_unavailable' });

  if (method === 'GET' && url === '/api/v1/customers') {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const repos = createRepositories(db);
    const rows = await repos.customers.list({ ...pagination, query: context.query || '' });
    return response(200, {
      customers: rows.map(({ total_count, ...customer }) => customer),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }
    });
  }

  if (method === 'POST' && url === '/api/v1/customers') {
    if (!can(role, 'customers:create')) return response(403, { error: 'forbidden' });
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const mobile = normalizeSaudiMobile(body.mobile);
    if (name.length < 2 || !mobile) return response(400, { error: 'invalid_customer' });
    try {
      const customer = await createRepositories(db).customers.create({
        name, mobile, cityId: cleanOptional(body.cityId), addressText: cleanOptional(body.addressText)
      });
      return response(201, { customer });
    } catch (error) {
      if (error.message === 'Customer mobile already exists') return response(409, { error: 'mobile_already_exists' });
      throw error;
    }
  }

  const customerMatch = url.match(/^\/api\/v1\/customers\/([^/]+)$/);
  if (method === 'PATCH' && customerMatch) {
    if (!can(role, 'customers:update')) return response(403, { error: 'forbidden' });
    const hasName = Object.hasOwn(body, 'name');
    const hasMobile = Object.hasOwn(body, 'mobile');
    const name = hasName && typeof body.name === 'string' ? body.name.trim() : null;
    const mobile = hasMobile ? normalizeSaudiMobile(body.mobile) : null;
    if ((!hasName && !hasMobile) || (hasName && (!name || name.length < 2)) || (hasMobile && !mobile)) {
      return response(400, { error: 'invalid_customer_update' });
    }
    try {
      const customer = await createRepositories(db).customers.update(customerMatch[1], { name, mobile });
      return customer ? response(200, { customer }) : response(404, { error: 'customer_not_found' });
    } catch (error) {
      if (error.message === 'Customer mobile already exists') return response(409, { error: 'mobile_already_exists' });
      throw error;
    }
  }
  if (method === 'GET' && customerMatch) {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const customer = await createRepositories(db).customers.findDetails(customerMatch[1]);
    return customer ? response(200, { customer }) : response(404, { error: 'customer_not_found' });
  }

  const approveMatch = url.match(/^\/api\/v1\/settlements\/([^/]+)\/approve$/);
  if (method === 'POST' && approveMatch) {
    if (!can(role, 'settlements:approve')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });

    try {
      const result = await approveSettlementAndCreditWallet(db, {
        settlementId: approveMatch[1],
        approverUserId: context.userId
      });
      return response(200, result);
    } catch (error) {
      if (error.message === 'Settlement not found') return response(404, { error: 'settlement_not_found' });
      if (error.message === 'Settlement is not approvable') return response(409, { error: 'settlement_not_approvable' });
      throw error;
    }
  }

  const completeMatch = url.match(/^\/api\/v1\/technicians\/me\/jobs\/([^/]+)\/complete$/);
  if (method === 'POST' && completeMatch) {
    const identity = await resolveTechnician({ role, context, db });
    if (identity.error) return identity.error;

    try {
      const result = await completeTechnicianJob(db, {
        jobId: completeMatch[1],
        technicianId: identity.technician.id,
        actorUserId: context.userId,
        evidence: body.evidence
      });
      if (!result) return response(404, { error: 'job_not_found' });
      return response(200, result);
    } catch (error) {
      const completionErrors = {
        'Evidence is required before completion': 'evidence_required',
        'Too many evidence items': 'too_many_evidence_items',
        'Invalid evidence': 'invalid_evidence',
        'Duplicate evidence': 'duplicate_evidence',
        'Job must be in progress': 'job_not_in_progress',
        'Completion finance configuration missing': 'finance_configuration_missing'
      };
      const code = completionErrors[error.message];
      if (code) return response(422, { error: code });
      throw error;
    }
  }

  const statusMatch = url.match(/^\/api\/v1\/technicians\/me\/jobs\/([^/]+)\/status$/);
  if (method === 'PATCH' && statusMatch) {
    const identity = await resolveTechnician({ role, context, db });
    if (identity.error) return identity.error;
    if (typeof body.status !== 'string') return response(400, { error: 'status_required' });

    try {
      const job = await transitionTechnicianJob(db, {
        jobId: statusMatch[1],
        technicianId: identity.technician.id,
        actorUserId: context.userId,
        toStatus: body.status
      });
      if (!job) return response(404, { error: 'job_not_found' });
      return response(200, { job });
    } catch (error) {
      if (error.message === 'Completion requires evidence endpoint') {
        return response(409, { error: 'completion_endpoint_required' });
      }
      if (error.message.startsWith('Invalid transition:')) {
        return response(409, { error: 'invalid_transition', message: error.message });
      }
      throw error;
    }
  }

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

function normalizeSaudiMobile(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  if (/^05\d{8}$/.test(digits)) return `+966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `+966${digits}`;
  if (/^9665\d{8}$/.test(digits)) return `+${digits}`;
  return null;
}

function cleanOptional(value) { return typeof value === 'string' ? value.trim().slice(0, 500) : ''; }

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
