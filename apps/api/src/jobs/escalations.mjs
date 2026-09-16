import { withTransaction } from '../persistence/transactions.mjs';

export function escalationLevel(minutesLate) {
  const minutes = Number(minutesLate);
  if (!Number.isFinite(minutes) || minutes < 1) return 0;
  if (minutes >= 240) return 3;
  if (minutes >= 120) return 2;
  return 1;
}

export async function detectJobEscalations(db, { actorUserId, limit = 100 }) {
  return withTransaction(db, async (client) => {
    const overdue = await client.query(
      `SELECT id, FLOOR(EXTRACT(EPOCH FROM (now() - scheduled_at)) / 60)::integer AS minutes_late
       FROM service_jobs
       WHERE status NOT IN ('pending_assignment','completed','cancelled') AND scheduled_at < now()
       ORDER BY scheduled_at ASC LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit]
    );
    const created = [];
    for (const job of overdue.rows) {
      const level = escalationLevel(job.minutes_late);
      const inserted = await client.query(
        `INSERT INTO job_escalations (job_id, level, minutes_late)
         VALUES ($1, $2, $3) ON CONFLICT (job_id, level) DO NOTHING
         RETURNING id, job_id, level, minutes_late, status, detected_at`,
        [job.id, level, job.minutes_late]
      );
      if (!inserted.rows[0]) continue;
      created.push(inserted.rows[0]);
      await client.query(
        `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
         VALUES ($1, 'job.sla_escalated', 'service_job', $2, $3::jsonb)`,
        [actorUserId, job.id, JSON.stringify({ level, minutesLate: job.minutes_late })]
      );
    }
    return { scanned: overdue.rows.length, created };
  });
}

export async function resolveJobEscalations(db, { jobId, reason, actorUserId }) {
  return withTransaction(db, async (client) => {
    const updated = await client.query(
      `UPDATE job_escalations SET status = 'resolved', resolved_at = now(), resolved_by = $2, resolution_reason = $3
       WHERE job_id = $1 AND status = 'open'
       RETURNING id, job_id, level, minutes_late, status, detected_at, resolved_at, resolution_reason`,
      [jobId, actorUserId, reason.trim()]
    );
    if (!updated.rows.length) return [];
    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'job.sla_resolved', 'service_job', $2, $3::jsonb)`,
      [actorUserId, jobId, JSON.stringify({ reason: reason.trim(), escalationIds: updated.rows.map(item => item.id) })]
    );
    return updated.rows;
  });
}
