BEGIN;
CREATE TABLE technician_skills (
  technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  skill_code text NOT NULL,
  PRIMARY KEY (technician_id, skill_code)
);
CREATE TABLE technician_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  available_from timestamptz NOT NULL,
  available_to timestamptz NOT NULL,
  CHECK (available_to > available_from)
);
CREATE INDEX technician_availability_window_idx ON technician_availability (technician_id, available_from, available_to);
ALTER TABLE service_jobs ADD COLUMN required_skill_code text;
COMMIT;
