BEGIN;
CREATE TABLE marketing_touches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),visitor_id text,customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
 source text NOT NULL,medium text NOT NULL DEFAULT '',campaign text NOT NULL DEFAULT '',content text NOT NULL DEFAULT '',term text NOT NULL DEFAULT '',
 landing_url text NOT NULL DEFAULT '',occurred_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(visitor_id IS NOT NULL OR customer_id IS NOT NULL)
);
CREATE INDEX marketing_touches_customer_idx ON marketing_touches(customer_id,occurred_at DESC);
CREATE INDEX marketing_touches_visitor_idx ON marketing_touches(visitor_id,occurred_at DESC);
CREATE TABLE order_attribution (
 order_id uuid PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,first_touch_id uuid REFERENCES marketing_touches(id) ON DELETE SET NULL,
 last_touch_id uuid REFERENCES marketing_touches(id) ON DELETE SET NULL,model text NOT NULL DEFAULT 'first_last' CHECK(model IN('first_last','first_touch','last_touch')),
 attributed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE marketing_spend (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),source text NOT NULL,campaign text NOT NULL DEFAULT '',amount numeric(14,2) NOT NULL CHECK(amount>=0),
 spent_on date NOT NULL,currency char(3) NOT NULL DEFAULT 'SAR',created_by uuid REFERENCES users(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_spend_period_idx ON marketing_spend(spent_on,source);
COMMIT;
