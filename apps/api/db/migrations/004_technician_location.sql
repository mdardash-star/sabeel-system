BEGIN;
CREATE TABLE technician_locations (
  technician_id uuid PRIMARY KEY REFERENCES technicians(id) ON DELETE CASCADE,
  latitude numeric(9,6) NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude numeric(9,6) NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters numeric(10,2) CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  captured_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX technician_locations_captured_idx ON technician_locations (captured_at DESC);
COMMIT;
