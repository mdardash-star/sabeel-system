BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('customer','technician','dispatcher','support','finance','branch_manager','admin','super_admin')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  source text NOT NULL,
  identity_key text NOT NULL,
  external_customer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, identity_key)
);

CREATE TABLE service_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  city_id text NOT NULL,
  address_text text NOT NULL DEFAULT '',
  latitude numeric(9,6),
  longitude numeric(9,6),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE technicians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE RESTRICT,
  city_id text NOT NULL,
  branch_id text,
  compensation_policy_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_source text NOT NULL,
  external_order_id text NOT NULL,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  paid_at timestamptz,
  total_ex_vat numeric(12,2) CHECK (total_ex_vat IS NULL OR total_ex_vat >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_source, external_order_id)
);

CREATE TABLE service_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  service_location_id uuid REFERENCES service_locations(id) ON DELETE SET NULL,
  city_id text NOT NULL,
  technician_id uuid REFERENCES technicians(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending_assignment','scheduled','en_route','arrived','in_progress','completed','cancelled')),
  scheduled_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX service_jobs_technician_schedule_idx ON service_jobs (technician_id, scheduled_at);
CREATE INDEX service_jobs_customer_idx ON service_jobs (customer_id, created_at DESC);

CREATE TABLE job_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES service_jobs(id) ON DELETE CASCADE,
  media_type text NOT NULL CHECK (media_type IN ('image','video')),
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, storage_key)
);

CREATE TABLE technician_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES service_jobs(id) ON DELETE RESTRICT,
  technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
  sale_ex_vat numeric(12,2) NOT NULL CHECK (sale_ex_vat >= 0),
  product_cost numeric(12,2) NOT NULL CHECK (product_cost >= 0),
  other_costs numeric(12,2) NOT NULL DEFAULT 0 CHECK (other_costs >= 0),
  margin numeric(12,2) NOT NULL CHECK (margin >= 0),
  policy_version text NOT NULL,
  commission_rate numeric(5,4) CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 0.5)),
  fixed_amount numeric(12,2) CHECK (fixed_amount IS NULL OR fixed_amount >= 0),
  payout_amount numeric(12,2) NOT NULL CHECK (payout_amount >= 0),
  status text NOT NULL CHECK (status IN ('pending_approval','approved','rejected','paid')),
  approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wallet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
  settlement_id uuid REFERENCES technician_settlements(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN ('credit','debit')),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency char(3) NOT NULL DEFAULT 'SAR',
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('pending','available','paid','void')),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wallet_entries_technician_idx ON wallet_entries (technician_id, created_at DESC);

CREATE TABLE installed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_id text NOT NULL,
  serial_number text,
  installed_at timestamptz NOT NULL,
  warranty_ends_at timestamptz,
  maintenance_interval_months integer NOT NULL DEFAULT 6 CHECK (maintenance_interval_months > 0),
  last_maintenance_at timestamptz,
  next_maintenance_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','retired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX installed_assets_maintenance_idx ON installed_assets (status, next_maintenance_at);

CREATE TABLE service_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES service_jobs(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
  score smallint NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '',
  verified_service boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE,
  job_id uuid REFERENCES service_jobs(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES installed_assets(id) ON DELETE CASCADE,
  channels text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed','cancelled')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE INDEX notification_events_pending_idx ON notification_events (status, created_at);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);

COMMIT;
