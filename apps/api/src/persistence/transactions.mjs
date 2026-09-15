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
