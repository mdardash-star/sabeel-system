BEGIN;
ALTER TABLE service_jobs ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE service_jobs j SET organization_id=c.organization_id FROM customers c WHERE c.id=j.customer_id;
UPDATE service_jobs SET organization_id='00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE service_jobs
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN organization_id SET DEFAULT '00000000-0000-4000-8000-000000000001';
CREATE INDEX service_jobs_organization_status_created_idx ON service_jobs(organization_id,status,created_at DESC);
COMMIT;
