BEGIN;
DROP INDEX IF EXISTS customers_organization_created_idx;
ALTER TABLE customers DROP COLUMN IF EXISTS organization_id;
COMMIT;
