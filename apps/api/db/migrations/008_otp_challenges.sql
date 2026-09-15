BEGIN;

CREATE TABLE otp_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mobile text NOT NULL,
  purpose text NOT NULL DEFAULT 'login' CHECK (purpose IN ('login')),
  code_hash char(64) NOT NULL,
  attempts smallint NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (mobile ~ '^\+9665[0-9]{8}$'),
  CHECK (length(code_hash) = 64)
);

CREATE INDEX otp_challenges_mobile_active_idx
  ON otp_challenges (mobile, created_at DESC)
  WHERE consumed_at IS NULL;

COMMIT;
