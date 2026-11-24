/* eslint-disable @typescript-eslint/no-require-imports -- The Node test runner loads TypeScript sources directly. */
// Session lookups are kept in memory for a minute so each API request does not need a
// database round trip just to find its session.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const vm = require("node:vm");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const SESSION = "opaque-session";
const DAY = 24 * 60 * 60 * 1000;

/**
 * gmail-session.ts with a fake database, a fake Google token endpoint and a clock the test
 * moves by hand. `tokenExpiresIn`: how long the stored access token still has (none: no expiry).
 */
function sessions({ userId = 3, expiresIn = 7 * DAY, tokenExpiresIn, refreshFails = false } = {}) {
  const clock = { now: Date.parse("2026-11-25T09:00:00Z") };
  class FakeDate extends Date { static now() { return clock.now; } }
  const db = { rows: true, userId, queries: [], hold: null };
  const google = { refreshes: 0, hold: null };
  const errors = [];
  const exports = {};
  const query = async (sql, params = []) => {
    db.queries.push(sql);
    if (db.hold) await db.hold;
    if (sql.includes("RETURNING token_ciphertext")) {
      return { rows: db.rows ? [{ token_ciphertext: db.sealed, user_id: db.userId, expires_at: new Date(clock.now + expiresIn) }] : [] };
    }
    if (sql.includes("SET token_ciphertext")) db.sealed = params[1];
    return { rows: [] };
  };
  const createGoogleOAuthClient = () => {
    let credentials = {};
    return {
      setCredentials(value) { credentials = value; },
      async refreshAccessToken() {
        google.refreshes++;
        if (google.hold) await google.hold;
        if (refreshFails) throw new Error("invalid_grant");
        assert.equal(credentials.refresh_token, "refresh");
        return { credentials: { access_token: `fresh-${google.refreshes}`, expiry_date: clock.now + 60 * 60_000, refresh_token: credentials.refresh_token } };
      },
    };
  };
  const source = readFileSync(resolve(__dirname, "../src/lib/gmail-session.ts"), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Buffer, JSON, Date: FakeDate, process: { env: { SESSION_SECRET: "test-secret" } },
    console: { error: (...args) => errors.push(args.join(" ")) },
    require: (name) => name === "./postgres" ? { query } : name === "./google" ? { createGoogleOAuthClient } : require(name),
  });
  db.sealed = exports.sealGmailTokens({ access_token: "access", refresh_token: "refresh", ...(tokenExpiresIn === undefined ? {} : { expiry_date: clock.now + tokenExpiresIn }) }, SESSION);
  const lookups = () => db.queries.filter((sql) => sql.includes("RETURNING token_ciphertext")).length;
  const stored = () => exports.openGmailTokens(db.sealed, SESSION);
  return { ...exports, clock, db, google, errors, lookups, stored };
}

test("a session read once is reused for a minute without asking the database", async () => {
  const s = sessions();
  const first = await s.getGmailSessionWithUser(SESSION);
  for (let i = 0; i < 20; i++) assert.equal((await s.getGmailSessionWithUser(SESSION)).tokens.refresh_token, "refresh");
  assert.equal(await s.getGmailSession(SESSION).then((tokens) => tokens.access_token), "access");
  assert.equal(first.userId, 3);
  assert.equal(s.lookups(), 1);

  s.clock.now += 59_000;
  await s.getGmailSession(SESSION);
  assert.equal(s.lookups(), 1);
  s.clock.now += 2_000; // past one minute: read again (and last_seen_at written again)
  await s.getGmailSession(SESSION);
  assert.equal(s.lookups(), 2);
});

test("each caller gets its own copy of the tokens", async () => {
  const s = sessions();
  const a = await s.getGmailSession(SESSION);
  a.access_token = "changed by one request";
  assert.equal((await s.getGmailSession(SESSION)).access_token, "access");
});

test("requests that arrive together share a single database query", async () => {
  const s = sessions();
  let release; s.db.hold = new Promise((r) => { release = r; });
  const together = Array.from({ length: 6 }, () => s.getGmailSessionWithUser(SESSION));
  release();
  const results = await Promise.all(together);
  assert.equal(s.lookups(), 1);
  assert.ok(results.every((result) => result.tokens.refresh_token === "refresh"));
});

test("a cached session is never used past its own expiry", async () => {
  const s = sessions({ expiresIn: 10_000 });
  await s.getGmailSession(SESSION);
  s.clock.now += 11_000;
  s.db.rows = false; // the database no longer returns the expired session
  assert.equal(await s.getGmailSession(SESSION), undefined);
  assert.equal(s.lookups(), 2);
});

test("unknown sessions are not remembered", async () => {
  const s = sessions();
  s.db.rows = false;
  assert.equal(await s.getGmailSession(SESSION), undefined);
  s.db.rows = true; // a session created right after must work at once
  assert.equal((await s.getGmailSession(SESSION)).refresh_token, "refresh");
  assert.equal(s.lookups(), 2);
});

test("logging out removes the cached session immediately", async () => {
  const s = sessions();
  await s.getGmailSession(SESSION);
  await s.deleteGmailSession(SESSION);
  s.db.rows = false;
  assert.equal(await s.getGmailSession(SESSION), undefined);
  assert.equal(s.lookups(), 2);
});

test("a lookup still running during logout does not put the session back", async () => {
  const s = sessions();
  let release; s.db.hold = new Promise((r) => { release = r; });
  const running = s.getGmailSession(SESSION);
  const logout = s.deleteGmailSession(SESSION);
  release();
  await Promise.all([running, logout]);
  s.db.hold = null; s.db.rows = false;
  assert.equal(await s.getGmailSession(SESSION), undefined, "the next request asks the database again");
});

test("linking the session to a user updates the cached copy", async () => {
  const s = sessions({ userId: null });
  assert.equal((await s.getGmailSessionWithUser(SESSION)).userId, null);
  await s.attachGmailSessionToUser(SESSION, 42);
  assert.equal((await s.getGmailSessionWithUser(SESSION)).userId, 42);
  assert.equal(s.lookups(), 1);
});

test("idle database connections are kept for minutes and their errors cannot crash the server", () => {
  const source = readFileSync(resolve(__dirname, "../src/lib/postgres.ts"), "utf8");
  assert.match(source, /idleTimeoutMillis: 5 \* 60_000/);
  assert.match(source, /keepAlive: true/);
  assert.match(source, /pool\.on\("error"/);
});

// ----- Access token refresh -----
const MINUTE = 60_000;

test("an expired access token is refreshed once and saved, so later requests use it as-is", async () => {
  const s = sessions({ tokenExpiresIn: -MINUTE });
  const first = await s.getGmailSession(SESSION);
  assert.equal(first.access_token, "fresh-1");
  assert.equal(first.refresh_token, "refresh");
  assert.equal(s.google.refreshes, 1);
  assert.equal(s.stored().access_token, "fresh-1", "the new token is stored, encrypted, in the session row");
  assert.equal(s.stored().refresh_token, "refresh");

  for (let i = 0; i < 10; i++) await s.getGmailSession(SESSION);
  s.clock.now += 2 * MINUTE; // cache expired: read again from the database, which now holds the fresh token
  assert.equal((await s.getGmailSession(SESSION)).access_token, "fresh-1");
  assert.equal(s.google.refreshes, 1);
});

test("a token is refreshed 10 minutes ahead, so the Google client never refreshes it again by itself", async () => {
  const s = sessions({ tokenExpiresIn: 9 * MINUTE });
  assert.equal((await s.getGmailSession(SESSION)).access_token, "fresh-1");
  const later = sessions({ tokenExpiresIn: 11 * MINUTE });
  assert.equal((await later.getGmailSession(SESSION)).access_token, "access");
  assert.equal(later.google.refreshes, 0);
});

test("a cached token that gets close to expiry is refreshed instead of handed out", async () => {
  const s = sessions({ tokenExpiresIn: 10 * MINUTE + 30_000 });
  assert.equal((await s.getGmailSession(SESSION)).access_token, "access");
  s.clock.now += 40_000; // still inside the 1-minute cache, but now under 10 minutes left
  assert.equal((await s.getGmailSession(SESSION)).access_token, "fresh-1");
  assert.equal(s.google.refreshes, 1);
});

test("requests that arrive together trigger a single refresh", async () => {
  const s = sessions({ tokenExpiresIn: -MINUTE });
  let release; s.google.hold = new Promise((r) => { release = r; });
  const together = Array.from({ length: 6 }, () => s.getGmailSessionWithUser(SESSION));
  release();
  const results = await Promise.all(together);
  assert.equal(s.google.refreshes, 1);
  assert.ok(results.every((result) => result.tokens.access_token === "fresh-1"));
});

test("a failed refresh hands out the stored tokens, as before, and stores nothing", async () => {
  const s = sessions({ tokenExpiresIn: -MINUTE, refreshFails: true });
  const before = s.db.sealed;
  assert.equal((await s.getGmailSession(SESSION)).access_token, "access");
  assert.equal(s.db.sealed, before);
  assert.match(s.errors.join("\n"), /refresh failed/);
  assert.doesNotMatch(s.errors.join("\n"), /refresh"|access"/, "no token values in the log");
});

test("sessions without an expiry time or a refresh token are not refreshed", async () => {
  const s = sessions();
  await s.getGmailSession(SESSION);
  assert.equal(s.google.refreshes, 0);
});
