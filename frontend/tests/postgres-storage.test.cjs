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
