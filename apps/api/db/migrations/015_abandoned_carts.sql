BEGIN;
CREATE TABLE abandoned_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_source text NOT NULL DEFAULT 'woocommerce',
  external_cart_id text NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL DEFAULT '',
  mobile text,
  email text,
  cart_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (cart_value >= 0),
  currency char(3) NOT NULL DEFAULT 'SAR',
  checkout_url text NOT NULL DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','notified','recovered','expired','cancelled')),
  reminder_count integer NOT NULL DEFAULT 0 CHECK (reminder_count BETWEEN 0 AND 3),
  abandoned_at timestamptz NOT NULL,
  last_reminded_at timestamptz,
  recovered_at timestamptz,
  recovered_order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_source,external_cart_id)
);
CREATE INDEX abandoned_carts_recovery_idx ON abandoned_carts (status,abandoned_at) WHERE status IN ('open','notified');
COMMIT;
