BEGIN;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE orders o SET organization_id = c.organization_id FROM customers c WHERE c.id=o.customer_id AND o.organization_id IS NULL;
ALTER TABLE orders ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE orders ALTER COLUMN organization_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_external_source_external_order_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS orders_org_external_uq ON orders(organization_id,external_source,external_order_id);
CREATE INDEX IF NOT EXISTS orders_org_paid_idx ON orders(organization_id,paid_at DESC);

ALTER TABLE customer_external_identities ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE customer_external_identities i SET organization_id=c.organization_id FROM customers c WHERE c.id=i.customer_id AND i.organization_id IS NULL;
ALTER TABLE customer_external_identities ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE customer_external_identities ALTER COLUMN organization_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid;
ALTER TABLE customer_external_identities DROP CONSTRAINT IF EXISTS customer_external_identities_source_identity_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS customer_external_identities_org_source_identity_uq ON customer_external_identities(organization_id,source,identity_key);

COMMIT;
