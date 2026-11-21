-- What the user chose to tell MailFlow about themselves, entered by hand in
-- Settings. Every field is optional ('' = not given). Only the user's own save
-- or clear writes this table: no analysis or other AI step may fill in, guess
-- or change a value.

CREATE TABLE IF NOT EXISTS user_about (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT '' CHECK (role IN ('', 'undergraduate', 'graduate', 'faculty', 'staff', 'other')),
  organization TEXT NOT NULL DEFAULT '' CHECK (char_length(organization) <= 100),
  department TEXT NOT NULL DEFAULT '' CHECK (char_length(department) <= 100),
  interests TEXT NOT NULL DEFAULT '' CHECK (char_length(interests) <= 100),
  notes TEXT NOT NULL DEFAULT '' CHECK (char_length(notes) <= 100),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (name)
VALUES ('005_user_about.sql')
ON CONFLICT (name) DO NOTHING;
