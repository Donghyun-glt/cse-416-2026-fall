-- The reply panel as the user last left it for a message: the draft text
-- (including manual edits) plus the tone, length and free-form request that
-- produced it. One row per user + message; reopening the message restores it
-- on any device instead of regenerating. Removed once the reply is sent.

CREATE TABLE IF NOT EXISTS reply_panel_states (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  draft TEXT NOT NULL,
  tone TEXT NOT NULL CHECK (tone IN ('professional', 'friendly', 'concise', 'formal')),
  length TEXT NOT NULL CHECK (length IN ('short', 'medium', 'long')),
  instructions TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, gmail_message_id)
);

INSERT INTO schema_migrations (name)
VALUES ('003_reply_panel_states.sql')
ON CONFLICT (name) DO NOTHING;
