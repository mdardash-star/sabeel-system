BEGIN;
CREATE TABLE ai_marketing_recommendations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),fingerprint text NOT NULL,recommendation_type text NOT NULL CHECK(recommendation_type IN('recovery_campaign','budget_shift','content_plan','attribution_fix','delivery_fix')),
 priority text NOT NULL CHECK(priority IN('low','medium','high')),title text NOT NULL,rationale text NOT NULL,recommended_action text NOT NULL,
 projected_impact text NOT NULL DEFAULT '',evidence jsonb NOT NULL DEFAULT '{}'::jsonb,status text NOT NULL DEFAULT 'new' CHECK(status IN('new','approved','scheduled','completed','dismissed')),
 created_by uuid REFERENCES users(id)ON DELETE SET NULL,reviewed_by uuid REFERENCES users(id)ON DELETE SET NULL,reviewed_at timestamptz,
 outcome_note text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ai_marketing_active_idx ON ai_marketing_recommendations(fingerprint)WHERE status IN('new','approved','scheduled');
CREATE INDEX ai_marketing_worklist_idx ON ai_marketing_recommendations(status,priority,created_at DESC);
COMMIT;
