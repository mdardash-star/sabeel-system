BEGIN;
DROP INDEX IF EXISTS service_jobs_technician_schedule_idx;
ALTER TABLE service_jobs DROP COLUMN IF EXISTS service_duration_minutes;
COMMIT;
