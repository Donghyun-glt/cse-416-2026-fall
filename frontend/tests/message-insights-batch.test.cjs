/* eslint-disable @typescript-eslint/no-require-imports -- The Node test runner loads TypeScript sources directly. */
// The Daily Briefing reads every stored analysis in one request (POST /api/gmail/messages/insights)
// instead of one request per card.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const ts = require("typescript");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { NextRequest } = require("next/server");

function load(file, imports) {
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, "../src", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exported, require: (name) => imports[name] ?? require(name), console });
  return exported;
}

function database(rowsFor) {
  const queries = [];
  const db = load("lib/mailflow-db.ts", {
    "./postgres": { query: async (text, values) => { queries.push({ text, values: JSON.parse(JSON.stringify(values)) }); return { rows: rowsFor(text) }; }, withTransaction: async () => { throw new Error("not used"); } },
    "./user-about": { ABOUT_FIELDS: [], roleText: () => "" },
    // Stored JSON comes back as-is here; the real vault decrypts it per user.
    "./data-vault": { lookupToken: () => "", open: (u, c, v) => v, openJson: (u, c, v) => v ?? null, seal: (u, c, v) => v, sealJson: (u, c, v) => JSON.stringify(v) },
  });
  return { db, queries };
}

test("stored analyses and event states of many messages are read in one query each", async () => {
  const { db, queries } = database((text) => text.includes("FROM message_insights")
    ? [{ gmail_message_id: "m1", analysis: { summary: "Review before Thursday" } }, { gmail_message_id: "m3", analysis: { reason: "Newsletter" } }]
    : [{ gmail_message_id: "m1", candidate_key: "a", status: "saved", details: { title: "Review" } }, { gmail_message_id: "m1", candidate_key: "b", status: "dismissed", details: null }]);
  const ids = ["m1", "m2", "m3"];
  const insights = await db.getMessageInsights(7, ids);
  const states = await db.getCalendarEventStatesForMessages(7, ids);

  assert.equal(queries.length, 2);
  for (const { text, values } of queries) {
    assert.match(text, /gmail_message_id = ANY\(\$2::text\[\]\)/);
    assert.deepEqual(values, [7, ids]);
  }
  assert.deepEqual([...insights.keys()], ["m1", "m3"]); // m2 not analysed yet: absent
  assert.equal(insights.get("m1").summary, "Review before Thursday");
  assert.deepEqual([...states.keys()], ["m1"]);
  assert.equal(states.get("m1").a.status, "saved");
  assert.equal(states.get("m1").a.details.title, "Review");
  assert.deepEqual({ ...states.get("m1").b.details }, {});
});

test("no ids means no query", async () => {
  const { db, queries } = database(() => []);
  assert.equal((await db.getMessageInsights(7, [])).size, 0);
  assert.equal((await db.getCalendarEventStatesForMessages(7, [])).size, 0);
  assert.equal(queries.length, 0);
});

function route({ session = { tokens: {}, userId: 1 }, analyses = new Map(), states = new Map(), fail = false } = {}) {
  const calls = [];
  const handler = load("app/api/gmail/messages/insights/route.ts", {
    "@/lib/gmail-session": { getGmailSessionWithUser: async () => session },
    "@/lib/mailflow-db": {
      getMessageInsights: async (userId, ids) => { calls.push(["insights", userId, [...ids]]); if (fail) throw new Error("db down"); return analyses; },
      getCalendarEventStatesForMessages: async (userId, ids) => { calls.push(["states", userId, [...ids]]); return states; },
    },
  });
  return { handler, calls };
}
const post = (body, cookie = "gmail_session=s") => new NextRequest("https://mailflow.test/api/gmail/messages/insights", { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("returns what the cards show for analysed messages only, in one request", async () => {
  const analyses = new Map([["m1", { summary: "Share the prototype", reason: "Asked by the professor", keyPoints: [{ text: "quoted email" }], candidates: [{ title: "Review", date: "2026-11-26", startTime: "14:00" }] }]]);
  const states = new Map([["m1", { k: { status: "saved", details: {} } }]]);
  const { handler, calls } = route({ analyses, states });
  const response = await handler.POST(post({ ids: ["m1", "m2", "m1"] }));
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(Object.keys(data.insights), ["m1"]);
  assert.deepEqual(data.insights.m1.analysis, { summary: "Share the prototype", reason: "Asked by the professor" }); // no key points or other fields
  assert.equal(data.insights.m1.candidates[0].title, "Review");
  assert.equal(data.insights.m1.eventStates.k.status, "saved");
  assert.deepEqual(calls, [["insights", 1, ["m1", "m2"]], ["states", 1, ["m1", "m2"]]]); // duplicates removed
});

test("signed out, bad input and unlinked sessions are answered without reading insights", async () => {
  const signedOut = route({ session: null }); // no session row for the cookie
  assert.equal((await signedOut.handler.POST(post({ ids: ["m1"] }))).status, 401);
  const bad = route();
  for (const body of [{}, { ids: "m1" }, { ids: ["../x"] }, { ids: [1] }, { ids: Array.from({ length: 201 }, (_, i) => `m${i}`) }]) {
    assert.equal((await bad.handler.POST(post(body))).status, 400);
  }
  const unlinked = route({ session: { tokens: {}, userId: null } });
  assert.deepEqual(await (await unlinked.handler.POST(post({ ids: ["m1"] }))).json(), { insights: {} });
  assert.equal(signedOut.calls.length + bad.calls.length + unlinked.calls.length, 0);
});

test("a database failure is a 502 so the briefing falls back to per-message requests", async () => {
  const { handler } = route({ fail: true });
  const response = await handler.POST(post({ ids: ["m1"] }));
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "insights_unavailable");
});

test("the batch route only reads: no Gmail, AI or priority code", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/app/api/gmail/messages/insights/route.ts"), "utf8");
  assert.doesNotMatch(source, /googleapis|gemini|recordPriority|saveMessageInsight|createTodoItem/);
});

test("the briefing reads stored insights together before queuing AI analyses", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/app/daily-briefing.tsx"), "utf8");
  assert.match(source, /\/api\/gmail\/messages\/insights/);
  const effect = source.slice(source.indexOf("const idList"));
  assert.ok(effect.indexOf("loadStoredInsights(fresh)") < effect.indexOf("queue.current.push"), "stored insights are read before anything is queued");
  assert.match(effect, /queue\.current\.push\(\.\.\.fresh\);/, "falls back to per-message requests when the batch read fails");
});
