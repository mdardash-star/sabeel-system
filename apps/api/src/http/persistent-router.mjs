import { can } from '../auth/rbac.mjs';
import { createRepositories } from '../persistence/repositories.mjs';
import { approveSettlementAndCreditWallet, completeAssetMaintenance, completeTechnicianJob, markSettlementPaid, rejectSettlement, setTechnicianActive, transitionTechnicianJob, updateAssetStatus } from '../persistence/transactions.mjs';
import { assignPersistentJob, listDispatchCandidates, reassignPersistentJob } from '../dispatch/persistent-dispatch.mjs';
import { detectJobEscalations, resolveJobEscalations } from '../jobs/escalations.mjs';
import { createInventoryItem, issueInventoryToTechnician, receiveInventory, transferInventory } from '../inventory/operations.mjs';
import { approvePurchaseOrder, createPurchaseOrder, createSupplier, receivePurchaseOrder } from '../purchasing/operations.mjs';

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

  if (method === 'GET' && url === '/api/v1/maintenance/stats') {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).assets.maintenanceStats();
    return response(200, { stats });
  }

  if (method === 'GET' && url === '/api/v1/maintenance/assets') {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const window = context.window || 'all';
    if (!['all', 'overdue', '7d', '30d'].includes(window)) return response(400, { error: 'invalid_maintenance_window' });
    const rows = await createRepositories(db).assets.listMaintenance({
      ...pagination, window, query: context.query || ''
    });
    return response(200, {
      assets: rows.map(({ total_count, ...asset }) => asset),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 },
      window
    });
  }

  if (method === 'GET' && url === '/api/v1/jobs/stats') {
    if (!can(role, 'jobs:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).jobs.operationsStats();
    return response(200, { stats });
  }

  if (method === 'GET' && url === '/api/v1/jobs') {
    if (!can(role, 'jobs:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const status = context.status || 'all';
    if (!['all','open','pending_assignment','scheduled','active','overdue','completed','cancelled'].includes(status)) {
      return response(400, { error: 'invalid_job_status_filter' });
    }
    const rows = await createRepositories(db).jobs.listForOperations({
      ...pagination, status, query: context.query || ''
    });
    return response(200, {
      jobs: rows.map(({ total_count, ...job }) => job),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 },
      status
    });
  }

  if (method === 'GET' && url === '/api/v1/jobs/escalations/stats') {
    if (!can(role, 'jobs:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).escalations.stats();
    return response(200, { stats });
  }

  if (method === 'GET' && url === '/api/v1/jobs/escalations') {
    if (!can(role, 'jobs:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const status = context.status || 'open';
    if (!['all', 'open', 'resolved'].includes(status)) return response(400, { error: 'invalid_escalation_status_filter' });
    const rows = await createRepositories(db).escalations.list({ ...pagination, status });
    return response(200, {
      escalations: rows.map(({ total_count, ...item }) => item),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }, status
    });
  }

  if (method === 'POST' && url === '/api/v1/jobs/escalations/run') {
    if (!can(role, 'jobs:assign')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const limit = Number(body.limit ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) return response(400, { error: 'invalid_escalation_limit' });
    const result = await detectJobEscalations(db, { actorUserId: context.userId, limit });
    return response(200, result);
  }

  const escalationResolveMatch = url.match(/^\/api\/v1\/jobs\/([^/]+)\/escalations\/resolve$/);
  if (method === 'POST' && escalationResolveMatch) {
    if (!can(role, 'jobs:assign')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const reason = cleanOptional(body.reason);
    if (reason.length < 3) return response(400, { error: 'resolution_reason_required' });
    const escalations = await resolveJobEscalations(db, { jobId: escalationResolveMatch[1], reason, actorUserId: context.userId });
    return escalations.length ? response(200, { escalations }) : response(404, { error: 'open_escalation_not_found' });
  }

  if (method === 'GET' && url === '/api/v1/technicians/stats') {
    if (!can(role, 'technicians:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).technicians.operationsStats();
    return response(200, { stats });
  }

  if (method === 'GET' && url === '/api/v1/technicians') {
    if (!can(role, 'technicians:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const status = context.status || 'all';
    if (!['all', 'active', 'inactive'].includes(status)) return response(400, { error: 'invalid_technician_status_filter' });
    const rows = await createRepositories(db).technicians.listForOperations({
      ...pagination, status, query: context.query || ''
    });
    return response(200, {
      technicians: rows.map(({ total_count, ...technician }) => technician),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }, status
    });
  }

  if (method === 'GET' && url === '/api/v1/settlements/stats') {
    if (!can(role, 'settlements:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).settlements.operationsStats();
    return response(200, { stats });
  }

  if (method === 'GET' && url === '/api/v1/settlements') {
    if (!can(role, 'settlements:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const status = context.status || 'all';
    if (!['all', 'pending_approval', 'approved', 'rejected', 'paid'].includes(status)) return response(400, { error: 'invalid_settlement_status_filter' });
    const rows = await createRepositories(db).settlements.listForOperations({
      ...pagination, status, query: context.query || ''
    });
    return response(200, {
      settlements: rows.map(({ total_count, ...settlement }) => settlement),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }, status
    });
  }

  if (method === 'GET' && url === '/api/v1/inventory/stats') {
    if (!can(role, 'inventory:read')) return response(403, { error: 'forbidden' });
    const stats = await createRepositories(db).inventory.stats();
    return response(200, { stats });
  }

  if (method === 'GET' && url === '/api/v1/purchasing/stats') {
    if (!can(role, 'purchasing:read')) return response(403, { error: 'forbidden' });
    return response(200, { stats: await createRepositories(db).purchasing.stats() });
  }

  if (method === 'GET' && url === '/api/v1/purchasing/suppliers') {
    if (!can(role, 'purchasing:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const rows = await createRepositories(db).purchasing.suppliers({ ...pagination, query: context.query || '' });
    return response(200, { suppliers: rows.map(({ total_count, ...supplier }) => supplier), pagination: { ...pagination, total: rows[0]?.total_count || 0 } });
  }

  if (method === 'GET' && url === '/api/v1/purchasing/orders') {
    if (!can(role, 'purchasing:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context), status = context.status || 'all';
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    if (!['all','draft','approved','partially_received','received','cancelled','overdue'].includes(status)) return response(400, { error: 'invalid_purchase_order_status' });
    const rows = await createRepositories(db).purchasing.list({ ...pagination, status, query: context.query || '' });
    return response(200, { orders: rows.map(({ total_count, ...order }) => order), pagination: { ...pagination, total: rows[0]?.total_count || 0 }, status });
  }

  if (method === 'POST' && url === '/api/v1/purchasing/suppliers') {
    if (!can(role, 'purchasing:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const name = cleanOptional(body.name), contactName = cleanOptional(body.contactName), mobile = cleanOptional(body.mobile), email = cleanOptional(body.email), vatNumber = cleanOptional(body.vatNumber);
    if (name.length < 2 || name.length > 200 || contactName.length > 200 || mobile.length > 30 || email.length > 200 || vatNumber.length > 30) return response(400, { error: 'invalid_supplier' });
    try { return response(201, { supplier: await createSupplier(db, { name, contactName, mobile, email, vatNumber, actorUserId: context.userId }) }); }
    catch (error) { if (error.code === '23505') return response(409, { error: 'supplier_exists' }); throw error; }
  }

  if (method === 'POST' && url === '/api/v1/purchasing/orders') {
    if (!can(role, 'purchasing:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const poNumber = cleanOptional(body.poNumber).toUpperCase(), supplierId = cleanOptional(body.supplierId), warehouseId = cleanOptional(body.warehouseId), notes = cleanOptional(body.notes);
    const expectedAt = body.expectedAt ? parseDate(body.expectedAt) : null, items = Array.isArray(body.items) ? body.items.map(item => ({ itemId: cleanOptional(item.itemId), quantity: Number(item.quantity), unitCost: Number(item.unitCost) })) : [];
    if (poNumber.length < 2 || poNumber.length > 80 || !supplierId || !warehouseId || (body.expectedAt && !expectedAt) || notes.length > 1000 || items.length < 1 || items.length > 100 || new Set(items.map(item=>item.itemId)).size !== items.length || items.some(item=>!item.itemId || !validInventoryNumber(item.quantity, false) || !validInventoryNumber(item.unitCost, true))) return response(400, { error: 'invalid_purchase_order' });
    try { return response(201, await createPurchaseOrder(db, { poNumber, supplierId, warehouseId, expectedAt, notes, items, actorUserId: context.userId })); }
    catch (error) { if (error.code === '23505') return response(409, { error: 'purchase_order_exists' }); if (error.message.includes('not found')) return response(404, { error: 'purchasing_target_not_found' }); throw error; }
  }

  const purchaseActionMatch = url.match(/^\/api\/v1\/purchasing\/orders\/([^/]+)\/(approve|receive)$/);
  if (method === 'POST' && purchaseActionMatch) {
    if (!can(role, 'purchasing:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    try {
      if (purchaseActionMatch[2] === 'approve') {
        const order = await approvePurchaseOrder(db, { purchaseOrderId: purchaseActionMatch[1], actorUserId: context.userId });
        return order ? response(200, { order }) : response(404, { error: 'purchase_order_not_found' });
      }
      const lines = Array.isArray(body.lines) ? body.lines.map(line => ({ purchaseOrderItemId: cleanOptional(line.purchaseOrderItemId), quantity: Number(line.quantity) })) : [];
      const notes = cleanOptional(body.notes);
      if (!lines.length || lines.length > 100 || notes.length > 500 || new Set(lines.map(line=>line.purchaseOrderItemId)).size !== lines.length || lines.some(line=>!line.purchaseOrderItemId || !validInventoryNumber(line.quantity, false))) return response(400, { error: 'invalid_purchase_receipt' });
      const order = await receivePurchaseOrder(db, { purchaseOrderId: purchaseActionMatch[1], lines, notes, actorUserId: context.userId });
      return order ? response(200, { order }) : response(404, { error: 'purchase_order_not_found' });
    } catch (error) {
      if (error.message.includes('not approvable') || error.message.includes('not receivable') || error.message.includes('over-receipt')) return response(409, { error: 'purchase_order_conflict', message: error.message });
      if (error.message.includes('Invalid purchase')) return response(400, { error: 'invalid_purchase_receipt' });
      throw error;
    }
  }

  if (method === 'GET' && url === '/api/v1/inventory') {
    if (!can(role, 'inventory:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const status = context.status || 'all';
    if (!['all', 'low', 'out'].includes(status)) return response(400, { error: 'invalid_inventory_status_filter' });
    const rows = await createRepositories(db).inventory.list({ ...pagination, status, query: context.query || '' });
    return response(200, {
      items: rows.map(({ total_count, ...item }) => item),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }, status
    });
  }

  if (method === 'GET' && url === '/api/v1/inventory/movements') {
    if (!can(role, 'inventory:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const rows = await createRepositories(db).inventory.movements(pagination);
    return response(200, {
      movements: rows.map(({ total_count, ...movement }) => movement),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }
    });
  }

  const technicianInventoryMatch = url.match(/^\/api\/v1\/technicians\/([^/]+)\/inventory$/);
  if (method === 'GET' && technicianInventoryMatch) {
    if (!can(role, 'inventory:read')) return response(403, { error: 'forbidden' });
    const stock = await createRepositories(db).inventory.technicianStock(technicianInventoryMatch[1]);
    return response(200, { technicianId: technicianInventoryMatch[1], stock });
  }

  if (method === 'POST' && url === '/api/v1/inventory/items') {
    if (!can(role, 'inventory:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const sku = cleanOptional(body.sku).toUpperCase(), name = cleanOptional(body.name), unit = cleanOptional(body.unit) || 'piece';
    const reorderLevel = Number(body.reorderLevel ?? 0), unitCost = Number(body.unitCost ?? 0);
    if (sku.length < 2 || sku.length > 80 || name.length < 2 || name.length > 200 || unit.length > 40 ||
        !validInventoryNumber(reorderLevel, true) || !validInventoryNumber(unitCost, true)) return response(400, { error: 'invalid_inventory_item' });
    try {
      const item = await createInventoryItem(db, { sku, name, unit, reorderLevel, unitCost, actorUserId: context.userId });
      return response(201, { item });
    } catch (error) {
      if (error.code === '23505') return response(409, { error: 'inventory_sku_exists' });
      throw error;
    }
  }

  if (method === 'POST' && ['/api/v1/inventory/receive','/api/v1/inventory/transfer','/api/v1/inventory/technician-issue'].includes(url)) {
    if (!can(role, 'inventory:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const itemId = cleanOptional(body.itemId), quantity = Number(body.quantity), reference = cleanOptional(body.reference), notes = cleanOptional(body.notes);
    if (!itemId || !validInventoryNumber(quantity, false) || reference.length > 200 || notes.length > 500) return response(400, { error: 'invalid_inventory_movement' });
    try {
      if (url.endsWith('/receive')) {
        const warehouseId = cleanOptional(body.warehouseId), unitCost = body.unitCost === undefined || body.unitCost === '' ? null : Number(body.unitCost);
        if (!warehouseId || (unitCost !== null && !validInventoryNumber(unitCost, true))) return response(400, { error: 'invalid_inventory_movement' });
        return response(201, await receiveInventory(db, { warehouseId, itemId, quantity, unitCost, reference, notes, actorUserId: context.userId }));
      }
      if (url.endsWith('/transfer')) {
        const fromWarehouseId = cleanOptional(body.fromWarehouseId), toWarehouseId = cleanOptional(body.toWarehouseId);
        if (!fromWarehouseId || !toWarehouseId) return response(400, { error: 'invalid_inventory_movement' });
        return response(201, await transferInventory(db, { fromWarehouseId, toWarehouseId, itemId, quantity, reference, notes, actorUserId: context.userId }));
      }
      const warehouseId = cleanOptional(body.warehouseId), technicianId = cleanOptional(body.technicianId);
      if (!warehouseId || !technicianId) return response(400, { error: 'invalid_inventory_movement' });
      return response(201, await issueInventoryToTechnician(db, { warehouseId, technicianId, itemId, quantity, reference, notes, actorUserId: context.userId }));
    } catch (error) {
      if (error.message.includes('not found')) return response(404, { error: 'inventory_target_not_found' });
      if (error.message.includes('Insufficient') || error.message.includes('different')) return response(409, { error: 'inventory_movement_conflict', message: error.message });
      throw error;
    }
  }

  const technicianPerformanceMatch = url.match(/^\/api\/v1\/technicians\/([^/]+)\/performance$/);
  if (method === 'GET' && technicianPerformanceMatch) {
    if (!can(role, 'technicians:read')) return response(403, { error: 'forbidden' });
    const range = parseDateRange(context.from, context.to);
    if (!range) return response(400, { error: 'invalid_date_range' });
    const repos = createRepositories(db);
    const technician = await repos.technicians.performance(technicianPerformanceMatch[1], range.from, range.to);
    if (!technician) return response(404, { error: 'technician_not_found' });
    const recentJobs = await repos.technicians.recentJobs(technicianPerformanceMatch[1], range.from, range.to, 10);
    return response(200, { technician, recentJobs, range });
  }

  const technicianStatusMatch = url.match(/^\/api\/v1\/technicians\/([^/]+)\/status$/);
  if (method === 'PATCH' && technicianStatusMatch) {
    if (!can(role, 'technicians:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    if (typeof body.isActive !== 'boolean') return response(400, { error: 'invalid_technician_status' });
    const reason = cleanOptional(body.reason);
    if (!body.isActive && reason.length < 3) return response(400, { error: 'deactivation_reason_required' });
    try {
      const technician = await setTechnicianActive(db, {
        technicianId: technicianStatusMatch[1], isActive: body.isActive, reason, actorUserId: context.userId
      });
      return technician ? response(200, { technician }) : response(404, { error: 'technician_not_found' });
    } catch (error) {
      if (error.message === 'Technician status is unchanged') return response(409, { error: 'technician_status_unchanged' });
      throw error;
    }
  }

  const candidatesMatch = url.match(/^\/api\/v1\/jobs\/([^/]+)\/candidates$/);
  if (method === 'GET' && candidatesMatch) {
    if (!can(role, 'jobs:assign')) return response(403, { error: 'forbidden' });
    const limit = context.limit === undefined ? 10 : Number(context.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return response(400, { error: 'invalid_pagination' });
    try {
      const result = await listDispatchCandidates(db, candidatesMatch[1], {
        windowStart: context.from, windowEnd: context.to, limit
      });
      return response(200, result);
    } catch (error) {
      if (error.message === 'Service job not found') return response(404, { error: 'job_not_found' });
      if (error.message === 'Service job is not dispatchable') return response(409, { error: 'job_not_dispatchable' });
      throw error;
    }
  }

  const dispatchMatch = url.match(/^\/api\/v1\/jobs\/([^/]+)\/(assign|reassign)$/);
  if (method === 'POST' && dispatchMatch) {
    if (!can(role, 'jobs:assign') || !can(role, 'jobs:schedule')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const technicianId = cleanOptional(body.technicianId);
    const scheduledAt = parseDate(body.scheduledAt);
    const serviceDurationMinutes = Number(body.serviceDurationMinutes ?? 60);
    const reason = cleanOptional(body.reason);
    if (!technicianId || !scheduledAt || !Number.isInteger(serviceDurationMinutes) || serviceDurationMinutes < 1 || serviceDurationMinutes > 1440 ||
        (dispatchMatch[2] === 'reassign' && reason.length < 3)) {
      return response(400, { error: 'invalid_assignment' });
    }
    try {
      const input = { jobId: dispatchMatch[1], technicianId, scheduledAt, serviceDurationMinutes, actorUserId: context.userId };
      const job = dispatchMatch[2] === 'assign'
        ? await assignPersistentJob(db, input)
        : await reassignPersistentJob(db, { ...input, reason });
      return response(200, { job });
    } catch (error) {
      if (error.message === 'Service job not found') return response(404, { error: 'job_not_found' });
      if (error.message.includes('already assigned') || error.message.includes('Only scheduled jobs')) return response(409, { error: 'job_not_assignable' });
      if (error.message.includes('scheduling conflict')) return response(409, { error: 'schedule_conflict' });
      if (error.message.includes('eligible') || error.message.includes('skill') || error.message.includes('unavailable') || error.message.includes('scheduled time')) {
        return response(422, { error: 'assignment_invalid', message: error.message });
      }
      throw error;
    }
  }

  const customerMatch = url.match(/^\/api\/v1\/customers\/([^/]+)$/);
  const timelineMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/timeline$/);
  if (method === 'GET' && timelineMatch) {
    if (!can(role, 'customers:read')) return response(403, { error: 'forbidden' });
    const pagination = parsePagination(context);
    if (!pagination) return response(400, { error: 'invalid_pagination' });
    const repos = createRepositories(db);
    const customer = await repos.customers.findDetails(timelineMatch[1]);
    if (!customer) return response(404, { error: 'customer_not_found' });
    const rows = await repos.customers.timeline(timelineMatch[1], pagination);
    return response(200, {
      customerId: timelineMatch[1],
      timeline: rows.map(({ total_count, ...item }) => item),
      pagination: { ...pagination, total: rows[0]?.total_count || 0 }
    });
  }
  const collectionMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/(addresses|assets|orders|jobs)$/);
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
      orders: repos.customers.listOrders,
      jobs: repos.customers.listServiceJobs
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
  const assetStatusMatch = url.match(/^\/api\/v1\/customers\/([^/]+)\/assets\/([^/]+)$/);
  if (method === 'PATCH' && assetStatusMatch) {
    if (!can(role, 'customers:update')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    if (!['active', 'inactive'].includes(body.status)) return response(400, { error: 'invalid_asset_status' });
    try {
      const asset = await updateAssetStatus(db, {
        customerId: assetStatusMatch[1], assetId: assetStatusMatch[2], actorUserId: context.userId, status: body.status
      });
      return asset ? response(200, { asset }) : response(404, { error: 'asset_not_found' });
    } catch (error) {
      if (error.message === 'Retired asset cannot change status') return response(409, { error: 'asset_retired' });
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

  const rejectMatch = url.match(/^\/api\/v1\/settlements\/([^/]+)\/reject$/);
  if (method === 'POST' && rejectMatch) {
    if (!can(role, 'settlements:approve')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const reason = cleanOptional(body.reason);
    if (reason.length < 3) return response(400, { error: 'rejection_reason_required' });
    try {
      const settlement = await rejectSettlement(db, { settlementId: rejectMatch[1], reason, actorUserId: context.userId });
      return settlement ? response(200, { settlement }) : response(404, { error: 'settlement_not_found' });
    } catch (error) {
      if (error.message === 'Settlement is not rejectable') return response(409, { error: 'settlement_not_rejectable' });
      throw error;
    }
  }

  const paidMatch = url.match(/^\/api\/v1\/settlements\/([^/]+)\/paid$/);
  if (method === 'POST' && paidMatch) {
    if (!can(role, 'settlements:approve')) return response(403, { error: 'forbidden' });
    if (!context.userId) return response(401, { error: 'user_identity_required' });
    const paymentReference = cleanOptional(body.paymentReference);
    if (paymentReference.length < 3) return response(400, { error: 'payment_reference_required' });
    try {
      const settlement = await markSettlementPaid(db, { settlementId: paidMatch[1], paymentReference, actorUserId: context.userId });
      return settlement ? response(200, { settlement }) : response(404, { error: 'settlement_not_found' });
    } catch (error) {
      if (error.message === 'Settlement is not payable') return response(409, { error: 'settlement_not_payable' });
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

function parseDateRange(fromValue, toValue) {
  const to = toValue ? parseDate(toValue) : new Date().toISOString();
  const from = fromValue ? parseDate(fromValue) : new Date(Date.now() - 30 * 86400000).toISOString();
  if (!from || !to || from >= to) return null;
  const maximumRange = 366 * 86400000;
  if (new Date(to).getTime() - new Date(from).getTime() > maximumRange) return null;
  return { from, to };
}

function validInventoryNumber(value, allowZero) {
  return Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) && value <= 1_000_000;
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
