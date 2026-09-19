BEGIN;

CREATE TABLE job_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES service_jobs(id) ON DELETE CASCADE,
  level smallint NOT NULL CHECK (level BETWEEN 1 AND 3),
  minutes_late integer NOT NULL CHECK (minutes_late >= 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  resolution_reason text,
  UNIQUE (job_id, level)
);

CREATE INDEX job_escalations_status_idx ON job_escalations (status, level DESC, detected_at ASC);

COMMIT;
