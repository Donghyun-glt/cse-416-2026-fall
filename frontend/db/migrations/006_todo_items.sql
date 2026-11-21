-- Summary tab: one row per message that still needs something from the user.
-- This is decided separately from the Urgent / FYI / Low priority label and is
-- never derived from it. `reasons` says why the message is listed (task, reply,
-- event, manual); a reason is removed as it is dealt with, and the item is done
-- when none is left or when the user marks it done.

CREATE TABLE IF NOT EXISTS todo_items (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  task TEXT NOT NULL DEFAULT '',
  due_date DATE,
  reasons TEXT[] NOT NULL DEFAULT '{}',
  confirm_audience BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'not_relevant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, gmail_message_id)
);

CREATE INDEX IF NOT EXISTS todo_items_open_idx ON todo_items (user_id, status, updated_at DESC);

INSERT INTO schema_migrations (name)
VALUES ('006_todo_items.sql')
ON CONFLICT (name) DO NOTHING;
