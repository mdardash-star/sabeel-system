BEGIN;
CREATE TABLE webhook_deliveries (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  delivery_key text NOT NULL UNIQUE,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX webhook_deliveries_received_idx ON webhook_deliveries (received_at DESC);
COMMIT;
