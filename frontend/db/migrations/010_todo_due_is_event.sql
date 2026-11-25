-- Summary tab: where an item's date came from.
-- due_is_event is true when the email states no deadline for the task and the date
-- shown is the day of an event the email mentions (the first calendar suggestion
-- still ahead). The list labels such a date "Event" so it is not read as a deadline.
-- Rows from before this column keep FALSE: their date is shown as before.

ALTER TABLE todo_items ADD COLUMN IF NOT EXISTS due_is_event BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO schema_migrations (name)
VALUES ('010_todo_due_is_event.sql')
ON CONFLICT (name) DO NOTHING;
