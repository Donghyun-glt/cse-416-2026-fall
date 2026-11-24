/* eslint-disable @typescript-eslint/no-require-imports -- The Node test runner loads TypeScript sources directly. */
// Auto-sync asks Gmail whether anything changed (one small call) instead of reloading the
// whole list every 15 seconds, and stops while the browser tab is hidden.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const nextServer = require("next/server");

function load(file, imports) {
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../src", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: exported, console: { error() {} },
    require: (name) => {
      if (name === "next/server") return { NextResponse: nextServer.NextResponse };
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
  });
  return exported;
}

// ----- GET /api/gmail/messages/changes -----
function changesRoute({ session = { tokens: {}, userId: 1 }, history } = {}) {
  const calls = [];
  const route = load("app/api/gmail/messages/changes/route.ts", {
    googleapis: { google: { gmail: () => ({ users: { history: { list: async (params) => { calls.push({ ...params }); return history(params); } } } }) } },
    "@/lib/google": { createGoogleOAuthClient: () => ({ setCredentials() {} }) },
    "@/lib/gmail-session": { getGmailSessionWithUser: async () => session },
  });
  const get = (since) => route.GET(new nextServer.NextRequest(`https://mailflow.test/api/gmail/messages/changes${since === undefined ? "" : `?since=${since}`}`, { headers: { cookie: "gmail_session=s" } }));
  return { get, calls };
}

test("nothing changed: one Gmail history call, and the newer position for the next check", async () => {
  const { get, calls } = changesRoute({ history: async () => ({ data: { historyId: "1200" } }) });
  const response = await get("1100");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { changed: false, historyId: "1200" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].startHistoryId, "1100");
  assert.equal(calls[0].maxResults, 1);
});

test("something changed: the browser is told to reload", async () => {
  const { get } = changesRoute({ history: async () => ({ data: { history: [{ id: "1150" }], historyId: "1200" } }) });
  assert.deepEqual(await (await get("1100")).json(), { changed: true, historyId: "1200" });
});

test("a position Gmail no longer keeps counts as changed; other Gmail failures are a 502", async () => {
  const expired = changesRoute({ history: async () => { throw Object.assign(new Error("Requested entity was not found."), { code: 404 }); } });
  assert.deepEqual(await (await expired.get("5")).json(), { changed: true });
  const failing = changesRoute({ history: async () => { throw Object.assign(new Error("backend error"), { code: 500 }); } });
  assert.equal((await failing.get("5")).status, 502);
});

test("signed out or a malformed position: no Gmail call", async () => {
  const signedOut = changesRoute({ session: null, history: async () => ({ data: {} }) });
  assert.equal((await signedOut.get("1")).status, 401);
  const bad = changesRoute({ history: async () => ({ data: {} }) });
  for (const since of [undefined, "", "abc", "1;DROP", "123456789012345678901"]) assert.equal((await bad.get(since)).status, 400);
  assert.equal(signedOut.calls.length + bad.calls.length, 0);
});

// ----- the list response carries the position -----
function listRoute(getProfile) {
  const route = load("app/api/gmail/messages/route.ts", {
    googleapis: { google: { gmail: () => ({ users: {
      ...(getProfile ? { getProfile } : {}),
      messages: { list: async () => ({ data: { messages: [{ id: "m1" }] } }), get: async ({ id }) => ({ data: { id, threadId: "t1", labelIds: ["INBOX"] } }) },
      drafts: { list: async () => ({ data: { drafts: [] } }) },
    } }) } },
    "@/lib/google": { createGoogleOAuthClient: () => ({ setCredentials() {} }) },
    "@/lib/gmail-session": { getGmailSessionWithUser: async () => ({ tokens: {}, userId: 1 }), attachGmailSessionToUser: async () => {} },
    "@/lib/gmail-message": { parseGmailMessage: (message) => ({ id: message.id, draft: false }) },
    "@/lib/gmail-priority": { getOrAssignPriorities: async () => new Map([["m1", "fyi"]]) },
    "@/lib/mailflow-db": { upsertUser: async () => 1 },
    "@/lib/mail-priority": { comparePriority: () => 0 },
  });
  return () => route.GET(new nextServer.NextRequest("https://mailflow.test/api/gmail/messages?mode=inbox", { headers: { cookie: "gmail_session=s" } }));
}

test("a mailbox list returns Gmail's history position with it", async () => {
  const body = await (await listRoute(async () => ({ data: { historyId: "777" } }))()).json();
  assert.equal(body.historyId, "777");
  assert.deepEqual(body.messages.map((message) => message.id), ["m1"]);
});

test("the list still loads when the position cannot be read (the next sync then reloads)", async () => {
  const failing = await listRoute(async () => { throw new Error("quota"); })();
  assert.equal(failing.status, 200);
  assert.equal((await failing.json()).historyId, undefined);
  const missing = await listRoute(undefined)();
  assert.equal(missing.status, 200);
});

// ----- the browser side -----
test("auto-sync skips hidden tabs, checks for changes first and still reloads every 2 minutes", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/app/mail-client.tsx"), "utf8");
  const sync = source.slice(source.indexOf("const syncCurrentMailbox"), source.indexOf("const interval = window.setInterval(() => void syncCurrentMailbox()"));
  assert.match(sync, /document\.visibilityState === "hidden"\) return/);
  assert.ok(sync.indexOf("/api/gmail/messages/changes") < sync.indexOf("loadMessages(view, false, pageToken)"), "asks for changes before reloading");
  assert.match(sync, /data\.changed === false/);
  assert.match(sync, /view !== "summary"/, "Summary keeps reloading, since its to-dos are not in Gmail's history");
  assert.match(source, /const FULL_SYNC_MS = 2 \* 60_000;/);
  assert.match(source, /historyIdRef\.current = null; \/\/ set again when this load succeeds/);
});
