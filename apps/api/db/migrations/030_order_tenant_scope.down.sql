BEGIN;
DROP INDEX IF EXISTS customer_external_identities_org_source_identity_uq;
ALTER TABLE customer_external_identities DROP COLUMN IF EXISTS organization_id;
ALTER TABLE customer_external_identities ADD CONSTRAINT customer_external_identities_source_identity_key_key UNIQUE(source,identity_key);
DROP INDEX IF EXISTS orders_org_paid_idx;
DROP INDEX IF EXISTS orders_org_external_uq;
ALTER TABLE orders DROP COLUMN IF EXISTS organization_id;
ALTER TABLE orders ADD CONSTRAINT orders_external_source_external_order_id_key UNIQUE(external_source,external_order_id);
COMMIT;
