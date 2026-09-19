BEGIN;
CREATE TABLE ai_sales_opportunities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),customer_id uuid NOT NULL REFERENCES customers(id)ON DELETE CASCADE,
 opportunity_type text NOT NULL CHECK(opportunity_type IN('maintenance_due','cart_recovery','cross_sell','win_back','conversation_followup')),
 score smallint NOT NULL CHECK(score BETWEEN 0 AND 100),estimated_value numeric(14,2) NOT NULL DEFAULT 0 CHECK(estimated_value>=0),
 reason text NOT NULL,recommended_action text NOT NULL,signals jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'new' CHECK(status IN('new','approved','contacted','converted','dismissed','lost')),
 assigned_to uuid REFERENCES users(id)ON DELETE SET NULL,created_by uuid REFERENCES users(id)ON DELETE SET NULL,
 reviewed_by uuid REFERENCES users(id)ON DELETE SET NULL,reviewed_at timestamptz,outcome_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_sales_active_opportunity_idx ON ai_sales_opportunities(customer_id,opportunity_type)WHERE status IN('new','approved','contacted');
CREATE INDEX ai_sales_worklist_idx ON ai_sales_opportunities(status,score DESC,created_at DESC);
COMMIT;
