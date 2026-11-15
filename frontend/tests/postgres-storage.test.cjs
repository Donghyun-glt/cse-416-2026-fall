/* eslint-disable @typescript-eslint/no-require-imports -- The Node test runner inspects the checked-in SQL and TypeScript sources. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function source(relativePath) {
  return readFileSync(resolve(__dirname, "..", relativePath), "utf8");
}

test("initial PostgreSQL migration creates persistent sessions and priority history", () => {
  const migration = source("db/migrations/001_initial.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS oauth_sessions/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS message_priorities/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS priority_events/i);
  assert.match(migration, /user_id INTEGER REFERENCES users\(id\) ON DELETE CASCADE/i);
  assert.match(migration, /token_ciphertext TEXT NOT NULL/i);
  assert.match(migration, /signals JSONB/i);
  assert.match(migration, /REFERENCES users\(id\) ON DELETE CASCADE/i);
});

test("priority storage no longer creates or applies Gmail classification labels", () => {
  const priority = source("src/lib/gmail-priority.ts");
  const listRoute = source("src/app/api/gmail/messages/route.ts");
  assert.doesNotMatch(priority, /users\.labels|users\.messages\.modify|addLabelIds|removeLabelIds/);
  assert.doesNotMatch(listRoute, /ensurePriorityLabels/);
  assert.match(priority, /getStoredPriority/);
  assert.match(priority, /recordPriority/);
});

test("OAuth cookie contains an opaque identifier while encrypted tokens stay in PostgreSQL", () => {
  const session = source("src/lib/gmail-session.ts");
  assert.match(session, /randomBytes\(32\)\.toString\("base64url"\)/);
  assert.match(session, /INSERT INTO oauth_sessions/);
  assert.match(session, /sessionHash\(sessionId\)/);
  assert.match(session, /createCipheriv\("aes-256-gcm"/);
});

test("the reply panel state is stored once per user and message and removed with the user", () => {
  const migration = source("db/migrations/003_reply_panel_states.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS reply_panel_states/i);
  assert.match(migration, /PRIMARY KEY \(user_id, gmail_message_id\)/i);
  assert.match(migration, /REFERENCES users\(id\) ON DELETE CASCADE/i);
  const storage = source("src/lib/mailflow-db.ts");
  assert.match(storage, /INSERT INTO reply_panel_states[\s\S]+ON CONFLICT \(user_id, gmail_message_id\) DO UPDATE/);
  assert.match(storage, /DELETE FROM reply_panel_states WHERE user_id = \$1 AND gmail_message_id = \$2/);
});

test("message insights are stored once and event states once per suggested event", () => {
  const migration = source("db/migrations/004_message_insights.sql");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS message_insights/i);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS calendar_event_states/i);
  assert.match(migration, /PRIMARY KEY \(user_id, gmail_message_id, candidate_key\)/i);
  assert.match(migration, /status IN \('pending', 'saved', 'dismissed'\)/i);
  const storage = source("src/lib/mailflow-db.ts");
  assert.match(storage, /INSERT INTO message_insights[\s\S]+ON CONFLICT \(user_id, gmail_message_id\) DO NOTHING/);
});
