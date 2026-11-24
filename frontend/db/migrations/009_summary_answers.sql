-- Summary tab, "Is this for you?".
-- todo_items.triage: for an item the app was unsure about, how the email itself
-- describes its audience and kind (encrypted JSON, '' when not needed).
-- summary_answers: what the user answered, kept so the same audience or kind of
-- mail is not asked about again. `text` is encrypted; `text_token` is a keyed
-- hash used only to find an existing row for the same text. This table is
-- separate from user_about on purpose: nothing here changes what the user typed
-- in Settings, and the user can remove any row there.

ALTER TABLE todo_items ADD COLUMN IF NOT EXISTS triage TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS summary_answers (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer TEXT NOT NULL CHECK (answer IN ('yes', 'no')),
  about TEXT NOT NULL CHECK (about IN ('audience', 'kind')),
  text TEXT NOT NULL,
  text_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, about, text_token)
);

INSERT INTO schema_migrations (name)
VALUES ('009_summary_answers.sql')
ON CONFLICT (name) DO NOTHING;
