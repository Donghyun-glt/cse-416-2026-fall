-- User content is now encrypted by the application before it is stored
-- (src/lib/data-vault.ts), so the database only holds ciphertext for it.
-- The old checks on the About-you columns compared plain text (allowed roles,
-- 100-character limit); they cannot apply to ciphertext. The same rules are
-- still enforced by the application before encryption (src/lib/user-about.ts).

ALTER TABLE user_about DROP CONSTRAINT IF EXISTS user_about_role_check;
ALTER TABLE user_about DROP CONSTRAINT IF EXISTS user_about_organization_check;
ALTER TABLE user_about DROP CONSTRAINT IF EXISTS user_about_department_check;
ALTER TABLE user_about DROP CONSTRAINT IF EXISTS user_about_interests_check;
ALTER TABLE user_about DROP CONSTRAINT IF EXISTS user_about_notes_check;

INSERT INTO schema_migrations (name)
VALUES ('007_encrypted_user_data.sql')
ON CONFLICT (name) DO NOTHING;
