BEGIN;

CREATE TABLE asset_maintenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES installed_assets(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL,
  notes text NOT NULL DEFAULT '',
  performed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX asset_maintenance_events_asset_idx
  ON asset_maintenance_events (asset_id, completed_at DESC);

COMMIT;
