BEGIN;
CREATE TABLE ai_dispatch_recommendations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES service_jobs(id)ON DELETE CASCADE,
 window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
 recommended_technician_id uuid REFERENCES technicians(id)ON DELETE SET NULL,recommended_score numeric(5,2),
 explanation text NOT NULL,risk_level text NOT NULL CHECK(risk_level IN('low','medium','high')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','approved','rejected','expired')),
 selected_technician_id uuid REFERENCES technicians(id)ON DELETE SET NULL,created_by uuid REFERENCES users(id)ON DELETE SET NULL,
 reviewed_by uuid REFERENCES users(id)ON DELETE SET NULL,reviewed_at timestamptz,review_note text NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_dispatch_recommendations_idx ON ai_dispatch_recommendations(status,created_at DESC);
CREATE UNIQUE INDEX ai_dispatch_one_pending_idx ON ai_dispatch_recommendations(job_id)WHERE status='pending';
COMMIT;
