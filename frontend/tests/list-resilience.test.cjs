/* eslint-disable @typescript-eslint/no-require-imports -- The Node test runner loads TypeScript sources directly. */
// One message that cannot be read must not fail a whole mailbox list, and a large Daily
// Briefing must not fire hundreds of Gmail reads at once.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const nextServer = require("next/server");

/** The list route with a fake Gmail whose reads behave as `read(id, state)` decides. */
function listRoute({ ids, read, pageSize = 100 }) {
  const state = { inFlight: 0, maxInFlight: 0, reads: 0 };
  const gmail = { users: {
    getProfile: async () => ({ data: { historyId: "1" } }),
    messages: {
      list: async ({ pageToken }) => {
        const start = Number(pageToken ?? 0);
        const page = ids.slice(start, start + pageSize);
        return { data: { messages: page.map((id) => ({ id })), nextPageToken: start + pageSize < ids.length ? String(start + pageSize) : undefined } };
      },
      get: async ({ id }) => {
        state.reads++; state.inFlight++; state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
        try { await new Promise((r) => setTimeout(r, 5)); return { data: await read(id, state) }; } finally { state.inFlight--; }
      },
    },
    drafts: { list: async () => ({ data: { drafts: [] } }) },
  } };
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../src/app/api/gmail/messages/route.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: exported, console: { error() {} }, setTimeout, Math,
    require: (name) => ({
      "next/server": { NextResponse: nextServer.NextResponse },
      googleapis: { google: { gmail: () => gmail } },
      "@/lib/google": { createGoogleOAuthClient: () => ({ setCredentials() {} }) },
      "@/lib/gmail-session": { getGmailSessionWithUser: async () => ({ tokens: {}, userId: 1 }), attachGmailSessionToUser: async () => {} },
      "@/lib/gmail-message": { parseGmailMessage: (message) => ({ id: message.id, draft: false }) },
      "@/lib/gmail-priority": { getOrAssignPriorities: async (messages) => new Map(messages.map((m) => [m.id, "fyi"])) },
      "@/lib/mailflow-db": { upsertUser: async () => 1, getStoredPriorities: async () => new Map(), getAnalysedMessageIds: async () => new Set(), getInsightSummaries: async () => new Map(), listTodoItems: async () => [] },
      "@/lib/mail-priority": { comparePriority: () => 0 },
    })[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })(),
  });
  const get = (query) => exported.GET(new nextServer.NextRequest(`https://mailflow.test/api/gmail/messages?${query}`, { headers: { cookie: "gmail_session=s" } }));
  return { get, state };
}
const ids = (n) => Array.from({ length: n }, (_, i) => `m${i + 1}`);
const gmailError = (code, reason) => Object.assign(new Error(reason ?? `HTTP ${code}`), { code, status: code, ...(reason ? { errors: [{ reason }] } : {}) });
const message = (id) => ({ id, threadId: `t-${id}`, labelIds: ["INBOX"], internalDate: String(Date.now()) });

test("a message deleted after the list was made is left out; the rest of the page loads in Gmail's order", async () => {
  const { get } = listRoute({ ids: ids(50), read: async (id) => { if (id === "m7") throw gmailError(404); return message(id); } });
  const response = await get("mode=inbox");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.messages.length, 49);
  assert.equal(body.messages.some((m) => m.id === "m7"), false);
  assert.deepEqual(body.messages.slice(0, 7).map((m) => m.id), ["m1", "m2", "m3", "m4", "m5", "m6", "m8"]);
});

test("a read Gmail refuses for a moment is retried and the page is complete", async () => {
  const failed = new Map();
  const { get } = listRoute({ ids: ids(50), read: async (id) => {
    const times = failed.get(id) ?? 0;
    // m3 is rate limited once (429), m9 once (403 userRateLimitExceeded), m20 hits a Gmail 503 twice.
    const limit = { m3: 1, m9: 1, m20: 2 }[id] ?? 0;
    if (times < limit) { failed.set(id, times + 1); throw id === "m9" ? gmailError(403, "userRateLimitExceeded") : gmailError(id === "m3" ? 429 : 503); }
    return message(id);
  } });
  const response = await get("mode=inbox");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).messages.length, 50);
});

test("a lasting failure or a permission error still fails the request, as before", async () => {
  const lasting = listRoute({ ids: ids(5), read: async (id) => { if (id === "m2") throw gmailError(503); return message(id); } });
  assert.equal((await lasting.get("mode=inbox")).status, 502);
  const forbidden = listRoute({ ids: ids(5), read: async (id) => { if (id === "m2") throw gmailError(403, "insufficientPermissions"); return message(id); } });
  assert.equal((await forbidden.get("mode=inbox")).status, 502);
  assert.equal(forbidden.state.reads, 5, "permission errors are not retried");
});

test("a large Daily Briefing keeps at most 50 reads in flight, and a full page still goes out at once", async () => {
  const briefing = listRoute({ ids: ids(300), read: async (id) => message(id) });
  const response = await briefing.get(`after=${Date.now() - 3_600_000}`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).messages.length, 300);
  assert.equal(briefing.state.maxInFlight, 50);

  const page = listRoute({ ids: ids(50), read: async (id) => message(id) });
  await page.get("mode=inbox");
  assert.equal(page.state.maxInFlight, 50);
});

test("Summary uses the same reads: a deleted to-do message is skipped", async () => {
  const route = listRoute({ ids: ids(3), read: async (id) => { if (id === "m2") throw gmailError(404); return message(id); } });
  assert.equal((await route.get("mode=summary")).status, 200);
});
