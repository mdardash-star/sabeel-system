BEGIN;
CREATE TABLE ai_finance_anomalies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),fingerprint text NOT NULL,anomaly_type text NOT NULL CHECK(anomaly_type IN('negative_margin','revenue_drop','settlement_backlog','overdue_purchase')),
 severity text NOT NULL CHECK(severity IN('medium','high','critical')),title text NOT NULL,description text NOT NULL,recommended_action text NOT NULL,
 entity_type text,entity_id text,financial_impact numeric(14,2) NOT NULL DEFAULT 0,evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','reviewed','resolved','dismissed')),reviewed_by uuid REFERENCES users(id)ON DELETE SET NULL,
 reviewed_at timestamptz,resolved_at timestamptz,resolution_note text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_finance_active_idx ON ai_finance_anomalies(fingerprint)WHERE status IN('open','reviewed');
CREATE INDEX ai_finance_worklist_idx ON ai_finance_anomalies(status,severity,created_at DESC);
COMMIT;
