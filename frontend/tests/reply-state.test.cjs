/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness loads a transpiled route. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { NextRequest } = require("next/server");

function route({ userId = 7, signedIn = true } = {}) {
  const rows = new Map();
  const calls = { profile: 0 };
  const source = readFileSync(resolve(__dirname, "../src/app/api/gmail/messages/[id]/reply-state/route.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Response, URL, console: { error() {} },
    require(name) {
      if (name === "@/lib/gmail-session") return { getGmailSessionWithUser: async () => signedIn ? { tokens: {}, userId } : undefined, attachGmailSessionToUser: async () => {} };
      if (name === "@/lib/google") return { createGoogleOAuthClient: () => ({ setCredentials() {} }) };
      if (name === "googleapis") return { google: { gmail: () => ({ users: { getProfile: async () => { calls.profile++; return { data: { emailAddress: "me@example.com" } }; } } }) } };
      if (name === "@/lib/mailflow-db") return {
        upsertUser: async () => 42,
        getReplyPanelState: async (user, id) => rows.get(`${user}:${id}`) ?? null,
        saveReplyPanelState: async ({ userId: user, gmailMessageId, ...state }) => { rows.set(`${user}:${gmailMessageId}`, state); },
        deleteReplyPanelState: async (user, id) => { rows.delete(`${user}:${id}`); },
      };
      if (name === "@/lib/reply-draft") return { isReplyTone: (value) => ["professional", "friendly", "concise", "formal"].includes(value), isReplyLength: (value) => ["short", "medium", "long"].includes(value) };
      return require(name);
    },
  });
  return { ...exports, rows, calls };
}

function call(handler, method, body, id = "mail123") {
  const request = new NextRequest(`https://mailflow.test/api/gmail/messages/${id}/reply-state`, { method, headers: { cookie: "gmail_session=test", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return handler[method](request, { params: Promise.resolve({ id }) });
}
const state = { draft: "Hi Kim,\n\nSee you at 4.", tone: "formal", length: "short", instructions: "write it in English" };

test("a saved reply panel comes back exactly, including manual edits and controls", async () => {
  const handler = route();
  assert.equal((await (await call(handler, "GET")).json()).state, null);
  assert.equal((await call(handler, "PUT", state)).status, 200);
  assert.deepEqual((await (await call(handler, "GET")).json()).state, state);
  assert.equal((await (await call(handler, "GET", undefined, "another")).json()).state, null);
});

test("sending or clearing the reply removes the saved panel", async () => {
  const handler = route();
  await call(handler, "PUT", state);
  assert.equal((await call(handler, "DELETE")).status, 200);
  assert.equal((await (await call(handler, "GET")).json()).state, null);
});

test("invalid panel states are rejected and never stored", async () => {
  const handler = route();
  for (const change of [{ draft: "   " }, { tone: "angry" }, { length: "huge" }, { instructions: "x".repeat(501) }, { draft: "x".repeat(20001) }]) {
    assert.equal((await call(handler, "PUT", { ...state, ...change })).status, 400);
  }
  assert.equal(handler.rows.size, 0);
});

test("signed-out requests are refused and an unlinked session is linked only when saving", async () => {
  assert.equal((await call(route({ signedIn: false }), "GET")).status, 401);
  const handler = route({ userId: null });
  assert.equal((await (await call(handler, "GET")).json()).state, null);
  assert.equal(handler.calls.profile, 0);
  await call(handler, "PUT", state);
  assert.equal(handler.calls.profile, 1);
  assert.ok(handler.rows.has("42:mail123"));
});
