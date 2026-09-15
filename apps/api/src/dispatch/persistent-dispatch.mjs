import { withTransaction } from '../persistence/transactions.mjs';

export async function listDispatchCandidates(db, jobId, { windowStart, windowEnd, limit = 10 } = {}) {
  const jobResult = await db.query(`SELECT id, city_id, scheduled_at, status, required_skill_code FROM service_jobs WHERE id=$1 LIMIT 1`, [jobId]);
  const job = jobResult.rows[0];
  if (!job) throw new Error('Service job not found');
  if (job.status !== 'pending_assignment' && job.status !== 'scheduled') throw new Error('Service job is not dispatchable');
  const start = windowStart || job.scheduled_at || new Date().toISOString();
  const end = windowEnd || new Date(new Date(start).getTime() + 4 * 60 * 60 * 1000).toISOString();
  const { rows } = await db.query(
    `SELECT t.id AS technician_id, t.city_id, t.branch_id,
            COALESCE(r.avg_rating,0)::numeric(3,2) AS avg_rating,
            COALESCE(w.jobs_in_window,0)::int AS jobs_in_window
     FROM technicians t
     JOIN technician_availability a ON a.technician_id=t.id AND a.available_from <= $2 AND a.available_to >= $3
     LEFT JOIN technician_skills s ON s.technician_id=t.id AND s.skill_code=$4
     LEFT JOIN LATERAL (SELECT COUNT(*) AS jobs_in_window FROM service_jobs j WHERE j.technician_id=t.id AND j.status NOT IN ('completed','cancelled') AND j.scheduled_at >= $2 AND j.scheduled_at < $3) w ON true
     LEFT JOIN LATERAL (SELECT AVG(sr.score) AS avg_rating FROM service_ratings sr WHERE sr.technician_id=t.id) r ON true
     WHERE t.is_active=true AND t.city_id=$1 AND ($4::text IS NULL OR s.skill_code IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM service_jobs conflict WHERE conflict.technician_id=t.id AND conflict.id<>$5 AND conflict.status NOT IN ('completed','cancelled') AND conflict.scheduled_at >= $2 AND conflict.scheduled_at < $3)
     ORDER BY jobs_in_window ASC, avg_rating DESC, t.id ASC LIMIT $6`,
    [job.city_id, start, end, job.required_skill_code || null, job.id, limit]
  );
  return { job, windowStart: start, windowEnd: end, candidates: rows };
}

export async function assignPersistentJob(db, { jobId, technicianId, scheduledAt, windowMinutes = 120, actorUserId }) {
  return withTransaction(db, async (client) => {
    const job = (await client.query(`SELECT * FROM service_jobs WHERE id=$1 FOR UPDATE`, [jobId])).rows[0];
    if (!job) throw new Error('Service job not found');
    if (job.status !== 'pending_assignment' && job.status !== 'scheduled') throw new Error('Service job is not assignable');
    const start = new Date(scheduledAt);
    if (Number.isNaN(start.getTime())) throw new Error('Invalid scheduled time');
    const end = new Date(start.getTime() + windowMinutes * 60000).toISOString();
    const startIso = start.toISOString();

    const technician = (await client.query(`SELECT * FROM technicians WHERE id=$1 AND is_active=true AND city_id=$2 LIMIT 1`, [technicianId, job.city_id])).rows[0];
    if (!technician) throw new Error('Technician is not eligible for this city');

    if (job.required_skill_code) {
      const skill = (await client.query(`SELECT 1 FROM technician_skills WHERE technician_id=$1 AND skill_code=$2 LIMIT 1`, [technicianId, job.required_skill_code])).rows[0];
      if (!skill) throw new Error('Technician lacks required skill');
    }

    const availability = (await client.query(`SELECT 1 FROM technician_availability WHERE technician_id=$1 AND available_from <= $2 AND available_to >= $3 LIMIT 1`, [technicianId, startIso, end])).rows[0];
    if (!availability) throw new Error('Technician is unavailable for requested window');

    const conflict = (await client.query(`SELECT id FROM service_jobs WHERE technician_id=$1 AND id<>$2 AND status NOT IN ('completed','cancelled') AND scheduled_at >= $3 AND scheduled_at < $4 LIMIT 1 FOR UPDATE`, [technicianId, jobId, startIso, end])).rows[0];
    if (conflict) throw new Error('Technician has a scheduling conflict');

    const updated = (await client.query(`UPDATE service_jobs SET technician_id=$2, scheduled_at=$3, status='scheduled', updated_at=now() WHERE id=$1 RETURNING *`, [jobId, technicianId, startIso])).rows[0];
    await client.query(`INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, data) VALUES ($1, 'job.assigned', 'service_job', $2, $3::jsonb)`, [actorUserId, jobId, JSON.stringify({ technicianId, scheduledAt: startIso, windowMinutes })]);
    return updated;
  });
}
