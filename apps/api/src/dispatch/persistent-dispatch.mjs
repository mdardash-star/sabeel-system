import { withTransaction } from '../persistence/transactions.mjs';

export async function listDispatchCandidates(db, jobId, { windowStart, windowEnd, limit = 10, tenantId = null } = {}) {
  const jobResult = await db.query(`SELECT j.id, j.organization_id, j.city_id, j.scheduled_at, j.status, j.required_skill_code, j.service_duration_minutes, l.latitude, l.longitude FROM service_jobs j LEFT JOIN service_locations l ON l.id=j.service_location_id WHERE j.id=$1 AND ($2::uuid IS NULL OR j.organization_id=$2) LIMIT 1`, [jobId,tenantId]);
  const job = jobResult.rows[0];
  if (!job) throw new Error('Service job not found');
  if (job.status !== 'pending_assignment' && job.status !== 'scheduled') throw new Error('Service job is not dispatchable');
  const start = windowStart || job.scheduled_at || new Date().toISOString();
  const durationMinutes = Number(job.service_duration_minutes || 60);
  const end = windowEnd || new Date(new Date(start).getTime() + durationMinutes * 60000).toISOString();
  const { rows } = await db.query(
    `SELECT t.id AS technician_id, t.city_id, t.branch_id,
            COALESCE(r.avg_rating,0)::numeric(3,2) AS avg_rating,
            COALESCE(w.jobs_in_window,0)::int AS jobs_in_window,
            CASE WHEN $7::numeric IS NULL OR $8::numeric IS NULL OR tl.latitude IS NULL OR tl.longitude IS NULL THEN NULL
              ELSE ROUND((6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS((tl.latitude - $7::numeric) / 2)),2) + COS(RADIANS($7::numeric))*COS(RADIANS(tl.latitude))*POWER(SIN(RADIANS((tl.longitude - $8::numeric) / 2)),2))))::numeric,2) END AS distance_km
     FROM technicians t
     JOIN users tu ON tu.id=t.user_id
     JOIN technician_availability a ON a.technician_id=t.id AND a.available_from <= $2 AND a.available_to >= $3
     LEFT JOIN technician_skills s ON s.technician_id=t.id AND s.skill_code=$4
     LEFT JOIN technician_locations tl ON tl.technician_id=t.id
     LEFT JOIN LATERAL (SELECT COUNT(*) AS jobs_in_window FROM service_jobs j WHERE j.technician_id=t.id AND j.status NOT IN ('completed','cancelled') AND j.scheduled_at < $3 AND (j.scheduled_at + j.service_duration_minutes * interval '1 minute') > $2) w ON true
     LEFT JOIN LATERAL (SELECT AVG(sr.score) AS avg_rating FROM service_ratings sr WHERE sr.technician_id=t.id) r ON true
     WHERE t.is_active=true AND t.city_id=$1 AND ($4::text IS NULL OR s.skill_code IS NOT NULL)
       AND ($9::uuid IS NULL OR tu.organization_id=$9)
       AND NOT EXISTS (SELECT 1 FROM service_jobs conflict WHERE conflict.technician_id=t.id AND conflict.id<>$5 AND conflict.status NOT IN ('completed','cancelled') AND conflict.scheduled_at < $3 AND (conflict.scheduled_at + conflict.service_duration_minutes * interval '1 minute') > $2)
     ORDER BY distance_km ASC NULLS LAST, jobs_in_window ASC, avg_rating DESC, t.id ASC LIMIT $6`,
    [job.city_id,start,end,job.required_skill_code||null,job.id,limit,job.latitude??null,job.longitude??null,tenantId]);
  return {job,windowStart:start,windowEnd:end,candidates:rows};
}

async function validateAssignment(client, job, technicianId, scheduledAt, durationMinutes, tenantId) {
  const start=new Date(scheduledAt);
  if(Number.isNaN(start.getTime())) throw new Error('Invalid scheduled time');
  if(!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 1440) throw new Error('Invalid service duration');
  const startIso=start.toISOString();
  const end=new Date(start.getTime()+durationMinutes*60000).toISOString();
  const technician=(await client.query(`SELECT t.* FROM technicians t JOIN users u ON u.id=t.user_id WHERE t.id=$1 AND t.is_active=true AND t.city_id=$2 AND ($3::uuid IS NULL OR u.organization_id=$3) LIMIT 1`,[technicianId,job.city_id,tenantId])).rows[0];
  if(!technician) throw new Error('Technician is not eligible for this city');
  if(job.required_skill_code){const skill=(await client.query(`SELECT 1 FROM technician_skills WHERE technician_id=$1 AND skill_code=$2 LIMIT 1`,[technicianId,job.required_skill_code])).rows[0];if(!skill) throw new Error('Technician lacks required skill');}
  const availability=(await client.query(`SELECT 1 FROM technician_availability WHERE technician_id=$1 AND available_from <= $2 AND available_to >= $3 LIMIT 1`,[technicianId,startIso,end])).rows[0];
  if(!availability) throw new Error('Technician is unavailable for requested window');
  const conflict=(await client.query(`SELECT id FROM service_jobs WHERE technician_id=$1 AND id<>$2 AND status NOT IN ('completed','cancelled') AND scheduled_at < $4 AND (scheduled_at + service_duration_minutes * interval '1 minute') > $3 LIMIT 1 FOR UPDATE`,[technicianId,job.id,startIso,end])).rows[0];
  if(conflict) throw new Error('Technician has a scheduling conflict');
  return {startIso,end};
}

export async function assignPersistentJob(db,{jobId,technicianId,scheduledAt,serviceDurationMinutes,windowMinutes,actorUserId,tenantId=null}){
  return withTransaction(db,async client=>{
    const job=(await client.query(`SELECT * FROM service_jobs WHERE id=$1 AND ($2::uuid IS NULL OR organization_id=$2) FOR UPDATE`,[jobId,tenantId])).rows[0];
    if(!job) throw new Error('Service job not found');
    if(job.status!=='pending_assignment') throw new Error('Service job is already assigned; use explicit reassignment');
    const durationMinutes=Number(serviceDurationMinutes ?? windowMinutes ?? job.service_duration_minutes ?? 60);
    const {startIso}=await validateAssignment(client,job,technicianId,scheduledAt,durationMinutes,tenantId);
    const updated=(await client.query(`UPDATE service_jobs SET technician_id=$2, scheduled_at=$3, service_duration_minutes=$4, status='scheduled', updated_at=now() WHERE id=$1 RETURNING *`,[jobId,technicianId,startIso,durationMinutes])).rows[0];
    await client.query(`INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,data) VALUES ($1,'job.assigned','service_job',$2,$3::jsonb)`,[actorUserId,jobId,JSON.stringify({technicianId,scheduledAt:startIso,serviceDurationMinutes:durationMinutes})]);
    return updated;
  });
}

export async function reassignPersistentJob(db,{jobId,technicianId,scheduledAt,serviceDurationMinutes,windowMinutes,actorUserId,reason,tenantId=null}){
  if(!reason?.trim()) throw new Error('Reassignment reason is required');
  return withTransaction(db,async client=>{
    const job=(await client.query(`SELECT * FROM service_jobs WHERE id=$1 AND ($2::uuid IS NULL OR organization_id=$2) FOR UPDATE`,[jobId,tenantId])).rows[0];
    if(!job) throw new Error('Service job not found');
    if(job.status!=='scheduled') throw new Error('Only scheduled jobs can be reassigned');
    const previous={technicianId:job.technician_id,scheduledAt:job.scheduled_at,serviceDurationMinutes:job.service_duration_minutes};
    const durationMinutes=Number(serviceDurationMinutes ?? windowMinutes ?? job.service_duration_minutes ?? 60);
    const {startIso}=await validateAssignment(client,job,technicianId,scheduledAt,durationMinutes,tenantId);
    const updated=(await client.query(`UPDATE service_jobs SET technician_id=$2, scheduled_at=$3, service_duration_minutes=$4, updated_at=now() WHERE id=$1 RETURNING *`,[jobId,technicianId,startIso,durationMinutes])).rows[0];
    await client.query(`INSERT INTO audit_log (actor_user_id,action,entity_type,entity_id,data) VALUES ($1,'job.reassigned','service_job',$2,$3::jsonb)`,[actorUserId,jobId,JSON.stringify({previous,technicianId,scheduledAt:startIso,serviceDurationMinutes:durationMinutes,reason:reason.trim()})]);
    return updated;
  });
}
