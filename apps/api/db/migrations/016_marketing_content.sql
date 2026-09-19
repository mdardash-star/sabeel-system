BEGIN;
CREATE TABLE marketing_content (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text NOT NULL,slug text NOT NULL UNIQUE,
 content_type text NOT NULL CHECK(content_type IN('social','blog','email','landing_page')),
 channel text NOT NULL CHECK(channel IN('website','instagram','x','snapchat','tiktok','email')),
 body text NOT NULL DEFAULT '',primary_keyword text NOT NULL DEFAULT '',meta_description text NOT NULL DEFAULT '',
 seo_score smallint NOT NULL DEFAULT 0 CHECK(seo_score BETWEEN 0 AND 100),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('idea','draft','review','approved','scheduled','published','cancelled')),
 scheduled_at timestamptz,published_at timestamptz,created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 approved_by uuid REFERENCES users(id) ON DELETE SET NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_content_calendar_idx ON marketing_content(status,scheduled_at);
COMMIT;
