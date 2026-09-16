BEGIN;
CREATE TABLE ai_knowledge_articles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text NOT NULL,category text NOT NULL DEFAULT 'general',content text NOT NULL,
 keywords text[] NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'approved' CHECK(status IN('draft','approved','archived')),
 created_by uuid REFERENCES users(id)ON DELETE SET NULL,approved_by uuid REFERENCES users(id)ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_suggestions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),conversation_id uuid NOT NULL REFERENCES customer_conversations(id)ON DELETE CASCADE,
 suggestion_type text NOT NULL DEFAULT 'reply',prompt_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,generated_text text NOT NULL,
 confidence numeric(4,3) NOT NULL CHECK(confidence BETWEEN 0 AND 1),risk_level text NOT NULL CHECK(risk_level IN('low','medium','high')),
 sources jsonb NOT NULL DEFAULT '[]'::jsonb,status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','rejected','used')),
 created_by uuid REFERENCES users(id)ON DELETE SET NULL,reviewed_by uuid REFERENCES users(id)ON DELETE SET NULL,reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_knowledge_status_idx ON ai_knowledge_articles(status,category);
CREATE INDEX ai_suggestions_worklist_idx ON ai_suggestions(status,risk_level,created_at DESC);
COMMIT;
