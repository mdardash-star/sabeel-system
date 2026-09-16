BEGIN;
DROP TRIGGER IF EXISTS service_jobs_status_notification_trg ON service_jobs;
DROP FUNCTION IF EXISTS subil_emit_job_status_notification();
COMMIT;
