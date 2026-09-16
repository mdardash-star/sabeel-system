BEGIN;

CREATE TABLE inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'piece',
  reorder_level numeric(12,2) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  unit_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE warehouses (
  id text PRIMARY KEY,
  name text NOT NULL,
  city_id text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO warehouses (id, name, city_id) VALUES ('main-riyadh', 'المستودع الرئيسي', 'riyadh');

CREATE TABLE inventory_balances (
  warehouse_id text NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity numeric(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, item_id)
);

CREATE TABLE technician_inventory (
  technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity numeric(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (technician_id, item_id)
);

CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type text NOT NULL CHECK (movement_type IN ('receipt','issue','transfer','technician_issue','technician_return','adjustment')),
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  quantity numeric(12,2) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(12,2) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  from_warehouse_id text REFERENCES warehouses(id) ON DELETE RESTRICT,
  to_warehouse_id text REFERENCES warehouses(id) ON DELETE RESTRICT,
  technician_id uuid REFERENCES technicians(id) ON DELETE RESTRICT,
  reference text,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_movements_created_idx ON inventory_movements (created_at DESC);
CREATE INDEX inventory_movements_item_idx ON inventory_movements (item_id, created_at DESC);
CREATE INDEX technician_inventory_technician_idx ON technician_inventory (technician_id, updated_at DESC);

COMMIT;
