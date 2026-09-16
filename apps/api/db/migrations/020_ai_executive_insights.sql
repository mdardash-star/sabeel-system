BEGIN;
CREATE TABLE ai_insights (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),fingerprint text NOT NULL,detected_on date NOT NULL DEFAULT CURRENT_DATE,
 domain text NOT NULL CHECK(domain IN('operations','finance','inventory','marketing','customer_care')),
 severity text NOT NULL CHECK(severity IN('info','medium','high','critical')),title text NOT NULL,summary text NOT NULL,
 recommended_action text NOT NULL,metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'open' CHECK(status IN('open','acknowledged','resolved','dismissed')),
 acknowledged_by uuid REFERENCES users(id)ON DELETE SET NULL,resolved_by uuid REFERENCES users(id)ON DELETE SET NULL,
 resolved_at timestamptz,resolution_note text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(fingerprint,detected_on)
);
CREATE TABLE ai_executive_briefs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),brief_date date NOT NULL UNIQUE,summary text NOT NULL,metrics jsonb NOT NULL,
 priorities jsonb NOT NULL DEFAULT '[]'::jsonb,generated_by uuid REFERENCES users(id)ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_insights_worklist_idx ON ai_insights(status,severity,created_at DESC);
COMMIT;
