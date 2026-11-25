/* eslint-disable @typescript-eslint/no-require-imports -- The Node test runner loads TypeScript sources directly. */
// Changing a message's priority uses the MailFlow user the session already knows, instead of
// asking Gmail for the profile and writing the user row again on every change.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const nextServer = require("next/server");

function route({ userId = 7, signedIn = true } = {}) {
  const calls = [];
  const session = signedIn ? { tokens: { access_token: "a" }, userId } : undefined;
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../src/app/api/gmail/messages/[id]/route.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: exported, console: { error() {} },
    require: (name) => ({
      "next/server": { NextResponse: nextServer.NextResponse },
      googleapis: { google: { gmail: () => ({ users: { getProfile: async () => { calls.push("gmail.getProfile"); return { data: { emailAddress: "me@example.com" } }; } } }) } },
      "@/lib/google": { createGoogleOAuthClient: () => ({ setCredentials() {} }) },
      "@/lib/gmail-session": {
        getGmailSession: async () => session?.tokens,
        getGmailSessionWithUser: async () => session,
        attachGmailSessionToUser: async (sessionId, id) => { calls.push(`attach ${sessionId} ${id}`); },
      },
      "@/lib/gmail-message": { parseGmailMessage: () => ({}) },
      "@/lib/gmail-priority": { getOrAssignPriority: async () => "fyi", setPriority: async (id, priority, user) => { calls.push(`setPriority ${id} ${priority} ${user}`); } },
      "@/lib/mailflow-db": { upsertUser: async (email) => { calls.push(`upsertUser ${email}`); return 42; } },
      "@/lib/mail-priority": { isPriority: (value) => ["urgent", "fyi", "low"].includes(value) },
    })[name] ?? (() => { throw new Error(`Unexpected import: ${name}`); })(),
  });
  const patch = (body) => exported.PATCH(new nextServer.NextRequest("https://mailflow.test/api/gmail/messages/m1", { method: "PATCH", headers: { cookie: "gmail_session=s1", "Content-Type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "m1" }) });
  return { patch, calls };
}

test("a linked session changes the priority with no Gmail profile call and no user write", async () => {
  const { patch, calls } = route({ userId: 7 });
  const response = await patch({ action: "priority", priority: "urgent" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { priority: "urgent" });
  assert.deepEqual(calls, ["setPriority m1 urgent 7"]);
});

test("a session not linked to a user yet is looked up once and linked, as before", async () => {
  const { patch, calls } = route({ userId: null });
  assert.equal((await patch({ action: "priority", priority: "low" })).status, 200);
  assert.deepEqual(calls, ["gmail.getProfile", "upsertUser me@example.com", "attach s1 42", "setPriority m1 low 42"]);
});

test("an invalid priority or a signed-out request changes nothing", async () => {
  const invalid = route();
  assert.equal((await invalid.patch({ action: "priority", priority: "someday" })).status, 400);
  const signedOut = route({ signedIn: false });
  assert.equal((await signedOut.patch({ action: "priority", priority: "urgent" })).status, 401);
  assert.deepEqual([...invalid.calls, ...signedOut.calls], []);
});
