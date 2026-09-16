BEGIN;
ALTER TABLE customers ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE customers c SET organization_id=COALESCE(u.organization_id,'00000000-0000-4000-8000-000000000001'::uuid)
FROM users u WHERE u.id=c.user_id AND c.organization_id IS NULL;
UPDATE customers SET organization_id='00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE customers
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN organization_id SET DEFAULT '00000000-0000-4000-8000-000000000001';
CREATE INDEX customers_organization_created_idx ON customers(organization_id,created_at DESC);
COMMIT;
