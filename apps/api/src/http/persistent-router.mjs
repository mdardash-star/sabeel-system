import { can } from '../auth/rbac.mjs';
import { createRepositories } from '../persistence/repositories.mjs';
import { approveSettlementAndCreditWallet, completeAssetMaintenance, completeTechnicianJob, transitionTechnicianJob } from '../persistence/transactions.mjs';

export async function routePersistentRequest({ method, url, role, body = {}, context = {}, db }) {
  if (!db?.query) return response(503, { error: 'database_unavailable' });

  if (method === 'GET' && url === '/api/v1/customers/stats') {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).customers.stats();
    return response(200, { stats });
  }

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
  const timelineMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/timeline$/);
  if (method === 'GET' && timelineMatch) {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const limit = context.limit === undefined ? 50 : Number(context.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return response(400, { error: 'invalid_pagination' });
    const repos = createRepositories(db);
    const customer = await repos.customers.findDetails(timelineMatch[1]);
    if (!customer) return response(404, { error: 'customer_not_found' });
    const timeline = await repos.customers.timeline(timelineMatch[1], limit);
    return response(200, { customerId: timelineMatch[1], timeline });
  }
  const collectionMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/(addresses|assets|orders)$/);
  if (method === 'GET' && collectionMatch) {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const repos = createRepositories(db);
    const customer = await repos.customers.findDetails(collectionMatch[1]);
    if (!customer) return response(404, { error: 'customer_not_found' });
    const key = collectionMatch[2];
    const loaders = {
      addresses: repos.customers.listAddresses,
      assets: repos.customers.listAssets,
      orders: repos.customers.listOrders
    };
    const rows = await loaders[key](collectionMatch[1], pagination);
    return response(200, {
      customerId: collectionMatch[1],
      [key]: rows.map(({ total_count, ...item }) => item),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }
    });
  }
  const assetHistoryMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/assets\/([^/]+)\/history$/);
  if (method === 'GET' && assetHistoryMatch) {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const repos = createRepositories(db);
    const asset = await repos.customers.findAsset(assetHistoryMatch[1], assetHistoryMatch[2]);
    if (!asset) return response(404, { error: 'asset_not_found' });
    const rows = await repos.customers.listAssetHistory(assetHistoryMatch[1], assetHistoryMatch[2], pagination);
    return response(200, {
      customerId: assetHistoryMatch[1], assetId: assetHistoryMatch[2],
      maintenance: rows.map(({ total_count, ...item }) => item),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }
    });
  }
  const addressMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/addresses$/);
  if (method === 'POST' && addressMatch) {
    if (!can(role, 'customers:update')) return response(403, { error: 'forbidden' });
    const cityId = cleanOptional(body.cityId);
    const addressText = cleanOptional(body.addressText);
    if (!cityId || cityId.length > 100 || addressText.length < 3) return response(400, { error: 'invalid_address' });
    const address = await createRepositories(db).customers.addAddress(addressMatch[1], { cityId, addressText });
    return address ? response(201, { address }) : response(404, { error: 'customer_not_found' });
  }
  const assetMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/assets$/);
  if (method === 'POST' && assetMatch) {
    if (!can(role, 'customers:update')) return response(403, { error: 'forbidden' });
    const productId = cleanOptional(body.productId);
    const serialNumber = cleanOptional(body.serialNumber) || null;
    const installedAt = parseDate(body.installedAt);
    const warrantyEndsAt = body.warrantyEndsAt ? parseDate(body.warrantyEndsAt) : null;
    const maintenanceIntervalMonths = Number(body.maintenanceIntervalMonths ?? 6);
    if (productId.length < 2 || productId.length > 200 || (serialNumber && serialNumber.length > 100) ||
        !installedAt || (body.warrantyEndsAt && !warrantyEndsAt) ||
        !Number.isInteger(maintenanceIntervalMonths) || maintenanceIntervalMonths < 1 || maintenanceIntervalMonths > 120 ||
        (warrantyEndsAt && warrantyEndsAt < installedAt)) {
      return response(400, { error: 'invalid_asset' });
    }
    const asset = await createRepositories(db).customers.addAsset(assetMatch[1], {
      productId, serialNumber, installedAt, warrantyEndsAt, maintenanceIntervalMonths,
      nextMaintenanceAt: addUtcMonths(installedAt, maintenanceIntervalMonths)
    });
    return asset ? response(201, { asset }) : response(404, { error: 'customer_not_found' });
  }
  const maintenanceMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/assets\/([^/]+)\/maintenance$/);
  if (method === 'POST' && maintenanceMatch) {
    if (!can(role, 'customers:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const completedAt = parseDate(body.completedAt);
    const notes = cleanOptional(body.notes);
    if (!completedAt || notes.length > 500) return response(400, { error: 'invalid_maintenance' });
    try {
      const result = await completeAssetMaintenance(db, {
        customerId: maintenanceMatch[1], assetId: maintenanceMatch[2],
        actorUserId: context.userId, completedAt, notes
      });
      return result ? response(200, result) : response(404, { error: 'asset_not_found' });
    } catch (error) {
      if (error.message === 'Asset is not active') return response(409, { error: 'asset_not_active' });
      throw error;
    }
  }
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

function parseDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addUtcMonths(iso, months) {
  const date = new Date(iso);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
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
