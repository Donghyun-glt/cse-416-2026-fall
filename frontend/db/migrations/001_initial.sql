CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oauth_sessions (
  session_hash CHAR(64) PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token_ciphertext TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oauth_sessions_expires_at_idx ON oauth_sessions (expires_at);
CREATE INDEX IF NOT EXISTS oauth_sessions_user_id_idx ON oauth_sessions (user_id);

CREATE TABLE IF NOT EXISTS message_priorities (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('urgent', 'fyi', 'low')),
  source TEXT NOT NULL CHECK (source IN ('automatic', 'manual')),
  reason TEXT NOT NULL,
  signals JSONB,
  classified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, gmail_message_id)
);

CREATE TABLE IF NOT EXISTS priority_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  previous_priority TEXT CHECK (previous_priority IN ('urgent', 'fyi', 'low')),
  new_priority TEXT NOT NULL CHECK (new_priority IN ('urgent', 'fyi', 'low')),
  source TEXT NOT NULL CHECK (source IN ('automatic', 'manual')),
  reason TEXT NOT NULL,
  signals JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS priority_events_message_idx
  ON priority_events (user_id, gmail_message_id, created_at DESC);

INSERT INTO schema_migrations (name)
VALUES ('001_initial.sql')
ON CONFLICT (name) DO NOTHING;
