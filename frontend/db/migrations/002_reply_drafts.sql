-- AI-generated reply drafts, cached per user + message + generation options so
-- reopening a message does not call the LLM again.

CREATE TABLE IF NOT EXISTS reply_drafts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  tone TEXT NOT NULL CHECK (tone IN ('professional', 'friendly', 'concise', 'formal')),
  length TEXT NOT NULL CHECK (length IN ('short', 'medium', 'long')),
  instructions TEXT NOT NULL DEFAULT '',
  draft TEXT NOT NULL,
  model TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, gmail_message_id, tone, length, instructions)
);

CREATE INDEX IF NOT EXISTS reply_drafts_message_idx
  ON reply_drafts (user_id, gmail_message_id, last_seen_at DESC);

INSERT INTO schema_migrations (name)
VALUES ('002_reply_drafts.sql')
ON CONFLICT (name) DO NOTHING;
