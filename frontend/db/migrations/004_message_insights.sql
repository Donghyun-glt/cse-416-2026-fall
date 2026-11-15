-- The AI reading of a message, decided once when MailFlow first analyses it
-- (normally as it arrives in the Daily Briefing) and never regenerated: the
-- summary, the suggested calendar events and the review notes. Keeping it is
-- what makes a message's category and suggested events stay fixed.
-- `analysis` holds short quotes from the email that support each event.

CREATE TABLE IF NOT EXISTS message_insights (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  version TEXT NOT NULL,
  analysis JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, gmail_message_id)
);

-- What the user last did with each suggested event: still deciding (with the
-- details as they last edited them), added to Google Calendar, or dismissed.

CREATE TABLE IF NOT EXISTS calendar_event_states (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_message_id TEXT NOT NULL,
  candidate_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'saved', 'dismissed')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, gmail_message_id, candidate_key)
);

INSERT INTO schema_migrations (name)
VALUES ('004_message_insights.sql')
ON CONFLICT (name) DO NOTHING;
