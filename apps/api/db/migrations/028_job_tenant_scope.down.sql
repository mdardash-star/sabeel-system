BEGIN;
DROP INDEX IF EXISTS service_jobs_organization_status_created_idx;
ALTER TABLE service_jobs DROP COLUMN IF EXISTS organization_id;
COMMIT;
