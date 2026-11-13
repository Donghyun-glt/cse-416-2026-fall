/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness loads a transpiled route. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { NextRequest } = require("next/server");

function route(scope, googleError) {
  let calls = 0;
  const source = readFileSync(resolve(__dirname, "../src/app/api/calendar/events/route.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date, Number, Response, URL, console,
    require(name) {
      if (name === "@/lib/gmail-session") return { getGmailSession: async () => ({ access_token: "fake", scope }) };
      if (name === "@/lib/google") return { CALENDAR_EVENTS_SCOPE: "https://www.googleapis.com/auth/calendar.events", createGoogleOAuthClient: () => ({ setCredentials() {} }) };
      if (name === "googleapis") return { google: { calendar: () => ({ events: { list: async () => { calls++; if (googleError) throw googleError; return { data: { items: [] } }; } } }) } };
      return require(name);
    },
  });
  return { GET: exports.GET, calls: () => calls };
}

function request() {
  return new NextRequest("https://mailflow.test/api/calendar/events?start=2026-11-01T00%3A00%3A00.000Z&end=2026-12-01T00%3A00%3A00.000Z", { headers: { cookie: "gmail_session=test" } });
}

test("old Gmail-only sessions need calendar consent before an API call", async () => {
  const handler = route("https://www.googleapis.com/auth/gmail.modify");
  const response = await handler.GET(request());
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "calendar_authorization_required");
  assert.equal(handler.calls(), 0);
});

test("disabled Calendar API has a separate setup error", async () => {
  const handler = route("https://www.googleapis.com/auth/calendar.events", { response: { status: 403, data: { error: { details: [{ reason: "SERVICE_DISABLED" }] } } } });
  const response = await handler.GET(request());
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "calendar_api_disabled");
});

test("a valid Calendar session can list events", async () => {
  const handler = route("https://www.googleapis.com/auth/calendar.events");
  const response = await handler.GET(request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).events, []);
  assert.equal(handler.calls(), 1);
});
