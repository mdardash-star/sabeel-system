BEGIN;

CREATE TABLE customer_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp','email','instagram','x','sms','webchat')),
  external_thread_id text NOT NULL,
  contact_handle text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','pending_agent','waiting_customer','closed')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, external_thread_id)
);

CREATE TABLE conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES customer_conversations(id) ON DELETE CASCADE,
  external_message_id text,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  sender_type text NOT NULL CHECK (sender_type IN ('customer','agent','system')),
  body text NOT NULL,
  delivery_status text NOT NULL DEFAULT 'received' CHECK (delivery_status IN ('received','queued','sent','delivered','failed')),
  sent_by uuid REFERENCES users(id) ON DELETE SET NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX conversation_messages_external_idx ON conversation_messages (external_message_id) WHERE external_message_id IS NOT NULL;
CREATE INDEX customer_conversations_worklist_idx ON customer_conversations (status, priority, last_message_at DESC);
CREATE INDEX conversation_messages_thread_idx ON conversation_messages (conversation_id, sent_at ASC);
COMMIT;
