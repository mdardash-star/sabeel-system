BEGIN;
ALTER TABLE service_jobs DROP COLUMN IF EXISTS required_skill_code;
DROP TABLE IF EXISTS technician_availability;
DROP TABLE IF EXISTS technician_skills;
COMMIT;
