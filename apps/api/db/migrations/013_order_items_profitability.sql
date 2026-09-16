BEGIN;

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  external_line_item_id text NOT NULL,
  product_id text,
  sku text,
  product_name text NOT NULL,
  quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
  subtotal_ex_vat numeric(14,2) NOT NULL CHECK (subtotal_ex_vat >= 0),
  unit_cost_snapshot numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost_snapshot >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, external_line_item_id)
);

CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_sku_idx ON order_items (sku);

COMMIT;
