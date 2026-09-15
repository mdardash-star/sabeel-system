import { withTransaction } from '../persistence/transactions.mjs';

export async function listDispatchCandidates(db, jobId, { windowStart, windowEnd, limit = 10 } = {}) {
  const jobResult = await db.query(`SELECT id, city_id, scheduled_at, status FROM service_jobs WHERE id=$1 LIMIT 1`, [jobId]);
  const job = jobResult.rows[0];
  if (!job) throw new Error('Service job not found');
  if (job.status !== 'pending_assignment' && job.status !== 'scheduled') throw new Error('Service job is not dispatchable');

  const start = windowStart || job.scheduled_at || new Date().toISOString();
  const end = windowEnd || new Date(new Date(start).getTime() + 4 * 60 * 60 * 1000).toISOString();

  const { rows } = await db.query(
    `SELECT t.id AS technician_id, t.city_id, t.branch_id,
            COUNT(j.id)::int AS jobs_in_window
     FROM technicians t
     LEFT JOIN service_jobs j ON j.technician_id=t.id
       AND j.status NOT IN ('completed','cancelled')
       AND j.scheduled_at >= $2 AND j.scheduled_at < $3
     WHERE t.is_active=true AND t.city_id=$1
     GROUP BY t.id, t.city_id, t.branch_id
     ORDER BY jobs_in_window ASC, t.id ASC
     LIMIT $4`,
    [job.city_id, start, end, limit]
  );
  return { job, windowStart: start, windowEnd: end, candidates: rows };
}

export async function assignPersistentJob(db, { jobId, technicianId, scheduledAt, actorUserId }) {
  return withTransaction(db, async (client) => {
    const job = (await client.query(`SELECT * FROM service_jobs WHERE id=$1 FOR UPDATE`, [jobId])).rows[0];
    if (!job) throw new Error('Service job not found');
    if (job.status !== 'pending_assignment' && job.status !== 'scheduled') throw new Error('Service job is not assignable');

    const technician = (await client.query(
      `SELECT * FROM technicians WHERE id=$1 AND is_active=true AND city_id=$2 LIMIT 1`,
      [technicianId, job.city_id]
    )).rows[0];
    if (!technician) throw new Error('Technician is not eligible for this city');

    const updated = (await client.query(
      `UPDATE service_jobs SET technician_id=$2, scheduled_at=$3, status='scheduled', updated_at=now()
       WHERE id=$1 RETURNING *`,
      [jobId, technicianId, scheduledAt]
    )).rows[0];

    await client.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data)
       VALUES ($1, 'job.assigned', 'service_job', $2, $3::jsonb)`,
      [actorUserId, jobId, JSON.stringify({ technicianId, scheduledAt })]
    );

    return updated;
  });
}
