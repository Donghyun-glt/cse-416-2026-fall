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
  const inserts = [];
  const source = readFileSync(resolve(__dirname, "../src/app/api/calendar/events/route.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Date, Number, Response, URL, console,
    require(name) {
      if (name === "@/lib/calendar-suggestion") return require("../src/lib/calendar-suggestion.ts");
      if (name === "@/lib/gmail-session") return { getGmailSession: async () => ({ access_token: "fake", scope }) };
      if (name === "@/lib/google") return { CALENDAR_EVENTS_SCOPE: "https://www.googleapis.com/auth/calendar.events", createGoogleOAuthClient: () => ({ setCredentials() {} }) };
      if (name === "googleapis") return { google: { calendar: () => ({ events: { insert: async (input) => { inserts.push(input); if (googleError) throw googleError; return { data: { id: input.requestBody.id ?? "new-event" } }; }, list: async () => { calls++; if (googleError) throw googleError; return { data: { items: [] } }; } } }) } };
      return require(name);
    },
  });
  return { GET: exports.GET, POST: exports.POST, calls: () => calls, inserts };
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

function approval(body) {
  return new NextRequest("https://mailflow.test/api/calendar/events", { method: "POST", headers: { cookie: "gmail_session=test", "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const approved = { title: "Meeting", start: "2026-11-20T05:00:00Z", end: "2026-11-20T06:00:00Z", sourceMessageId: "mail123", sourceCandidateKey: "2026-11-20:14:00:appointment", approved: true };
test("an email suggestion cannot be inserted without approval", async () => {
  const handler = route("https://www.googleapis.com/auth/calendar.events");
  assert.equal((await handler.POST(approval({ ...approved, approved: false }))).status, 400);
  assert.equal(handler.inserts.length, 0);
});
test("repeated approvals use the same Google event ID and support all-day deadlines", async () => {
  const handler = route("https://www.googleapis.com/auth/calendar.events");
  await handler.POST(approval(approved));
  await handler.POST(approval({ ...approved, title: "Edited title" }));
  assert.equal(handler.inserts[0].requestBody.id, handler.inserts[1].requestBody.id);
  assert.match(handler.inserts[0].requestBody.id, /^[0-9a-f]{64}$/);
  const response = await handler.POST(approval({ ...approved, allDay: true, start: "2026-11-20", end: "2026-11-21" }));
  assert.equal(response.status, 201);
  assert.equal(handler.inserts[2].requestBody.start.date, "2026-11-20");
  assert.equal(handler.inserts[2].requestBody.end.date, "2026-11-21");
});
test("Google duplicate conflicts return success so timeout retries do not create another event", async () => {
  const handler = route("https://www.googleapis.com/auth/calendar.events", { response: { status: 409 } });
  const response = await handler.POST(approval(approved));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).alreadyAdded, true);
});

test("reviewed requirements and source notes are included in the calendar event", async () => {
  const handler = route("https://www.googleapis.com/auth/calendar.events");
  await handler.POST(approval({ ...approved, description: "Bring photo ID. Check in by 08:40." }));
  assert.equal(handler.inserts[0].requestBody.description, "Bring photo ID. Check in by 08:40.");
});
