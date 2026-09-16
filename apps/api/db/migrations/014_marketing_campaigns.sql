BEGIN;

CREATE TABLE customer_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  segment_type text NOT NULL CHECK (segment_type IN ('all','repeat_customers','dormant_90d','maintenance_due_30d','high_value')),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  segment_id uuid NOT NULL REFERENCES customer_segments(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  message text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','queued','completed','cancelled')),
  scheduled_at timestamptz,
  launched_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign_recipients (
  campaign_id uuid NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  notification_event_id uuid REFERENCES notification_events(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, customer_id)
);

CREATE INDEX marketing_campaigns_status_idx ON marketing_campaigns (status, created_at DESC);
COMMIT;
