BEGIN;
DROP INDEX IF EXISTS users_organization_role_idx;
ALTER TABLE users DROP COLUMN IF EXISTS organization_id;
DROP TABLE IF EXISTS organizations;
COMMIT;
