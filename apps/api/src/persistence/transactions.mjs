import { canTransition } from '../jobs/state-machine.mjs';
import { calculateSettlement } from '../finance/settlement.mjs';

export async function withTransaction(db, work) {
  if (!db?.connect) throw new Error('Database pool with connect() is required');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function setTechnicianActive(db, { technicianId, isActive, reason = '', actorUserId }) {
  return withTransaction(db, async (client) => {
    const locked = await client.query(
      `SELECT t.id, t.user_id, t.is_active, u.is_active AS user_is_active
       FROM technicians t JOIN users u ON u.id = t.user_id
       WHERE t.id = $1 FOR UPDATE OF t`,
      [technicianId]
    );
    const current = locked.rows[0];
    if (!current) return null;
    if (current.is_active === isActive) throw new Error('Technician status is unchanged');

    const updated = await client.query(
      `UPDATE technicians SET is_active = $2 WHERE id = $1
       RETURNING id, user_id, city_id, branch_id, compensation_policy_id, is_active, created_at`,
      [technicianId, isActive]
    );
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'technician.status_changed', 'technician', $2, $3::jsonb)`,
      [actorUserId, technicianId, JSON.stringify({ from: current.is_active, to: isActive, reason: reason.trim() })]
    );
    return updated.rows[0];
  });
}

export async function transitionTechnicianJob(db, { jobId, technicianId, actorUserId, toStatus }) {
  if (toStatus === 'completed') throw new Error('Completion requires evidence endpoint');

  return withTransaction(db, async (client) => {
    const locked = await client.query(
      `SELECT id, technician_id, status
       FROM service_jobs
       WHERE id = $1 AND technician_id = $2
       FOR UPDATE`,
      [jobId, technicianId]
    );
    const current = locked.rows[0];
    if (!current) return null;
    if (!canTransition(current.status, toStatus)) {
      throw new Error(`Invalid transition: ${current.status} -> ${toStatus}`);
    }

    const updated = await client.query(
      `UPDATE service_jobs
       SET status = $3, updated_at = now()
       WHERE id = $1 AND technician_id = $2
       RETURNING id, technician_id, status, scheduled_at, completed_at, updated_at`,
      [jobId, technicianId, toStatus]
    );
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'job.status_changed', 'service_job', $2, $3::jsonb)`,
      [actorUserId, jobId, JSON.stringify({ from: current.status, to: toStatus, technicianId })]
    );
    return updated.rows[0];
  });
}

export async function completeTechnicianJob(db, { jobId, technicianId, actorUserId, evidence }) {
  const validEvidence = validateEvidence(jobId, evidence);

  return withTransaction(db, async (client) => {
    const locked = await client.query(
      `SELECT j.id, j.order_id, j.technician_id, j.status,
              o.total_ex_vat, oc.product_cost, oc.other_costs,
              p.mode, p.commission_rate, p.fixed_amount, p.policy_version
       FROM service_jobs j
       JOIN orders o ON o.id = j.order_id
       JOIN technicians t ON t.id = j.technician_id
       LEFT JOIN order_costs oc ON oc.order_id = j.order_id
       LEFT JOIN compensation_policies p
         ON p.id = COALESCE(t.compensation_policy_id, 'initial-margin-30')
        AND p.is_active = true
       WHERE j.id = $1 AND j.technician_id = $2
       FOR UPDATE OF j`,
      [jobId, technicianId]
    );
    const current = locked.rows[0];
    if (!current) return null;
    if (current.status !== 'in_progress') throw new Error('Job must be in progress');
    if (![current.total_ex_vat, current.product_cost, current.other_costs].every(value => Number.isFinite(Number(value))) || !current.policy_version) {
      throw new Error('Completion finance configuration missing');
    }

    const settlementValues = calculateSettlement({
      saleExVat: current.total_ex_vat,
      productCost: current.product_cost,
      otherCosts: current.other_costs,
      mode: current.mode,
      commissionRate: current.commission_rate,
      fixedAmount: current.fixed_amount,
      policyVersion: current.policy_version
    });

    const savedEvidence = [];
    for (const item of validEvidence) {
      const saved = await client.query(
        `INSERT INTO job_evidence (job_id, media_type, storage_key)
         VALUES ($1, $2, $3)
         RETURNING id, job_id, media_type, storage_key, created_at`,
        [jobId, item.mediaType, item.storageKey]
      );
      savedEvidence.push(saved.rows[0]);
    }

    const completed = await client.query(
      `UPDATE service_jobs
       SET status = 'completed', completed_at = now(), updated_at = now()
       WHERE id = $1 AND technician_id = $2
       RETURNING id, technician_id, status, scheduled_at, completed_at, updated_at`,
      [jobId, technicianId]
    );
    const settlement = await client.query(
      `INSERT INTO technician_settlements
         (job_id, technician_id, sale_ex_vat, product_cost, other_costs, margin,
          policy_version, commission_rate, fixed_amount, payout_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending_approval')
       RETURNING *`,
      [
        jobId, technicianId, settlementValues.saleExVat, settlementValues.productCost,
        settlementValues.otherCosts, settlementValues.margin, settlementValues.policyVersion,
        current.mode === 'percentage' ? current.commission_rate : null,
        current.mode === 'fixed' ? current.fixed_amount : null,
        settlementValues.payoutAmount
      ]
    );
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
       VALUES
         ($1, 'job.completed', 'service_job', $2, $3::jsonb),
         ($1, 'settlement.created', 'technician_settlement', $4, $5::jsonb)`,
      [
        actorUserId,
        jobId,
        JSON.stringify({ technicianId, evidenceCount: savedEvidence.length }),
        settlement.rows[0].id,
        JSON.stringify({ technicianId, jobId, payoutAmount: settlementValues.payoutAmount, policyVersion: settlementValues.policyVersion })
      ]
    );

    return { job: completed.rows[0], evidence: savedEvidence, settlement: settlement.rows[0] };
  });
}

export async function completeAssetMaintenance(db, { customerId, assetId, actorUserId, completedAt, notes = '' }) {
  return withTransaction(db, async (client) => {
    const locked = await client.query(
      `SELECT id, customer_id, status, maintenance_interval_months
       FROM installed_assets
       WHERE id = $1 AND customer_id = $2
       FOR UPDATE`,
      [assetId, customerId]
    );
    const current = locked.rows[0];
    if (!current) return null;
    if (current.status !== 'active') throw new Error('Asset is not active');

    const nextMaintenanceAt = addUtcMonths(completedAt, Number(current.maintenance_interval_months || 6));
    const updated = await client.query(
      `UPDATE installed_assets
       SET last_maintenance_at = $3, next_maintenance_at = $4
       WHERE id = $1 AND customer_id = $2
       RETURNING id, customer_id, product_id, serial_number, installed_at, warranty_ends_at,
                 maintenance_interval_months, last_maintenance_at, next_maintenance_at, status`,
      [assetId, customerId, completedAt, nextMaintenanceAt]
    );
    const event = await client.query(
      `INSERT INTO asset_maintenance_events (asset_id, completed_at, notes, performed_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, asset_id, completed_at, notes, performed_by, created_at`,
      [assetId, completedAt, notes, actorUserId]
    );
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'asset.maintenance_completed', 'installed_asset', $2, $3::jsonb)`,
      [actorUserId, assetId, JSON.stringify({ customerId, completedAt, nextMaintenanceAt })]
    );
    return { asset: updated.rows[0], maintenance: event.rows[0] };
  });
}

export async function updateAssetStatus(db, { customerId, assetId, actorUserId, status }) {
  return withTransaction(db, async (client) => {
    const locked = await client.query(
      `SELECT id, customer_id, product_id, serial_number, installed_at, warranty_ends_at,
              maintenance_interval_months, last_maintenance_at, next_maintenance_at, status
       FROM installed_assets WHERE id = $1 AND customer_id = $2 FOR UPDATE`,
      [assetId, customerId]
    );
    const current = locked.rows[0];
    if (!current) return null;
    if (current.status === 'retired') throw new Error('Retired asset cannot change status');
    if (current.status === status) return current;

    const updated = await client.query(
      `UPDATE installed_assets SET status = $3
       WHERE id = $1 AND customer_id = $2
       RETURNING id, customer_id, product_id, serial_number, installed_at, warranty_ends_at,
                 maintenance_interval_months, last_maintenance_at, next_maintenance_at, status`,
      [assetId, customerId, status]
    );
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'asset.status_changed', 'installed_asset', $2, $3::jsonb)`,
      [actorUserId, assetId, JSON.stringify({ customerId, from: current.status, to: status })]
    );
    return updated.rows[0];
  });
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

function validateEvidence(jobId, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) throw new Error('Evidence is required before completion');
  if (evidence.length > 10) throw new Error('Too many evidence items');

  const prefix = `jobs/${jobId}/`;
  const valid = evidence.every(item =>
    item &&
    (item.mediaType === 'image' || item.mediaType === 'video') &&
    typeof item.storageKey === 'string' &&
    item.storageKey.startsWith(prefix) &&
    item.storageKey.length <= 500 &&
    !item.storageKey.includes('..')
  );
  if (!valid) throw new Error('Invalid evidence');

  const keys = evidence.map(item => item.storageKey);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate evidence');
  return evidence;
}

export async function approveSettlementAndCreditWallet(db, { settlementId, approverUserId }) {
  return withTransaction(db, async (client) => {
    const locked = await client.query(
      `SELECT * FROM technician_settlements WHERE id = $1 FOR UPDATE`,
      [settlementId]
    );
    const settlement = locked.rows[0];
    if (!settlement) throw new Error('Settlement not found');
    if (settlement.status !== 'pending_approval' && settlement.status !== 'approved') {
      throw new Error('Settlement is not approvable');
    }

    let approved = settlement;
    let approvedNow = false;
    if (settlement.status === 'pending_approval') {
      const result = await client.query(
        `UPDATE technician_settlements
         SET status = 'approved', approved_by = $2, approved_at = now()
         WHERE id = $1 RETURNING *`,
        [settlementId, approverUserId]
      );
      approved = result.rows[0];
      approvedNow = true;
    }

    const wallet = await client.query(
      `INSERT INTO wallet_entries (technician_id, settlement_id, entry_type, amount, idempotency_key)
       VALUES ($1, $2, 'credit', $3, $4)
       ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING *`,
      [approved.technician_id, approved.id, approved.payout_amount, `settlement:${approved.id}`]
    );

    if (approvedNow) {
      await client.query(
        `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
         VALUES ($1, 'settlement.approved', 'technician_settlement', $2, $3::jsonb)`,
        [approverUserId, approved.id, JSON.stringify({ technicianId: approved.technician_id, payoutAmount: approved.payout_amount })]
      );
    }

    return { settlement: approved, walletEntry: wallet.rows[0] };
  });
}

export async function rejectSettlement(db, { settlementId, reason, actorUserId }) {
  return withTransaction(db, async (client) => {
    const locked = await client.query(
      `SELECT id, technician_id, payout_amount, status FROM technician_settlements WHERE id = $1 FOR UPDATE`,
      [settlementId]
    );
    const settlement = locked.rows[0];
    if (!settlement) return null;
    if (settlement.status !== 'pending_approval') throw new Error('Settlement is not rejectable');
    const updated = await client.query(
      `UPDATE technician_settlements SET status = 'rejected' WHERE id = $1 RETURNING *`,
      [settlementId]
    );
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'settlement.rejected', 'technician_settlement', $2, $3::jsonb)`,
      [actorUserId, settlementId, JSON.stringify({ technicianId: settlement.technician_id, payoutAmount: settlement.payout_amount, reason: reason.trim() })]
    );
    return updated.rows[0];
  });
}

export async function markSettlementPaid(db, { settlementId, actorUserId, paymentReference }) {
  return withTransaction(db, async (client) => {
    const locked = await client.query(
      `SELECT id, technician_id, payout_amount, status FROM technician_settlements WHERE id = $1 FOR UPDATE`,
      [settlementId]
    );
    const settlement = locked.rows[0];
    if (!settlement) return null;
    if (settlement.status !== 'approved') throw new Error('Settlement is not payable');
    const updated = await client.query(
      `UPDATE technician_settlements SET status = 'paid' WHERE id = $1 RETURNING *`,
      [settlementId]
    );
    await client.query(
      `UPDATE wallet_entries SET status = 'paid'
       WHERE settlement_id = $1 AND entry_type = 'credit' AND status = 'available'`,
      [settlementId]
    );
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'settlement.paid', 'technician_settlement', $2, $3::jsonb)`,
      [actorUserId, settlementId, JSON.stringify({ technicianId: settlement.technician_id, payoutAmount: settlement.payout_amount, paymentReference: paymentReference.trim() })]
    );
    return updated.rows[0];
  });
}
