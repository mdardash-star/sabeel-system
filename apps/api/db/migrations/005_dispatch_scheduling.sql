BEGIN;
ALTER TABLE service_jobs
  ADD COLUMN service_duration_minutes integer NOT NULL DEFAULT 60
  CHECK (service_duration_minutes > 0 AND service_duration_minutes <= 1440);
CREATE INDEX service_jobs_technician_schedule_idx
  ON service_jobs (technician_id, scheduled_at)
  WHERE technician_id IS NOT NULL AND scheduled_at IS NOT NULL AND status NOT IN ('completed','cancelled');
COMMIT;
