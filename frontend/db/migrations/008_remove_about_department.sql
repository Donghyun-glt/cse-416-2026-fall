-- "Major or department" was removed from Settings > About you (role is now free
-- text, so a major can be written there). The app no longer reads or writes this
-- column; what was stored in it is erased so nothing the user can no longer see
-- or edit is kept. The column itself stays so older code keeps working.

UPDATE user_about SET department = '' WHERE department <> '';

INSERT INTO schema_migrations (name)
VALUES ('008_remove_about_department.sql')
ON CONFLICT (name) DO NOTHING;
