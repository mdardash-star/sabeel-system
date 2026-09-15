BEGIN;

CREATE TABLE compensation_policies (
  id text PRIMARY KEY,
  policy_version text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('fixed','percentage')),
  commission_rate numeric(5,4) CHECK (commission_rate IS NULL OR (commission_rate >= 0 AND commission_rate <= 0.5)),
  fixed_amount numeric(12,2) CHECK (fixed_amount IS NULL OR fixed_amount >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (mode = 'percentage' AND commission_rate IS NOT NULL AND fixed_amount IS NULL) OR
    (mode = 'fixed' AND fixed_amount IS NOT NULL AND commission_rate IS NULL)
  )
);

INSERT INTO compensation_policies (id, policy_version, mode, commission_rate)
VALUES ('initial-margin-30', 'initial-1', 'percentage', 0.3000);

CREATE TABLE order_costs (
  order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE RESTRICT,
  product_cost numeric(12,2) NOT NULL CHECK (product_cost >= 0),
  other_costs numeric(12,2) NOT NULL DEFAULT 0 CHECK (other_costs >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
