BEGIN;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO organizations (id, slug, name)
VALUES ('00000000-0000-4000-8000-000000000001', 'sabeel', 'سبيل المتحدة')
ON CONFLICT (slug) DO NOTHING;

ALTER TABLE users ADD COLUMN organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT;
UPDATE users SET organization_id = '00000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE users
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN organization_id SET DEFAULT '00000000-0000-4000-8000-000000000001';

CREATE INDEX users_organization_role_idx ON users (organization_id, role, is_active);
COMMIT;
