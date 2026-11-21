/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness loads transpiled TypeScript. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, readdirSync, statSync } = require("node:fs");
const { resolve, join } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { NextRequest } = require("next/server");

function load(file, imports = {}) {
  const exported = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname, "../src", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
    { exports: exported, Response, URL, console: { error() {} }, require: (name) => imports[name] ?? require(name) });
  return exported;
}
const rules = load("lib/user-about.ts");

function route({ userId = 7, signedIn = true } = {}) {
  const rows = new Map();
  const handlers = load("app/api/profile/about/route.ts", {
    "@/lib/user-about": rules,
    "@/lib/gmail-session": { getGmailSessionWithUser: async () => signedIn ? { tokens: {}, userId } : undefined, attachGmailSessionToUser: async () => {} },
    "@/lib/google": { createGoogleOAuthClient: () => ({ setCredentials() {} }) },
    googleapis: { google: { gmail: () => ({ users: { getProfile: async () => ({ data: { emailAddress: "me@example.com" } }) } }) } },
    "@/lib/mailflow-db": {
      upsertUser: async () => 42,
      getUserAbout: async (id) => rows.has(id) ? { ...rows.get(id), updatedAt: "2026-11-21T00:00:00.000Z" } : null,
      saveUserAbout: async (id, about) => { rows.set(id, { ...about }); return "2026-11-21T00:00:00.000Z"; },
      deleteUserAbout: async (id) => { rows.delete(id); },
    },
  });
  return { ...handlers, rows };
}
const call = (handler, method, body) => handler[method](new NextRequest("https://mailflow.test/api/profile/about", { method, headers: { cookie: "gmail_session=test", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
const mine = { role: "undergraduate", organization: "SUNY Korea", department: "Computer Science", interests: "인턴십, 장학금", notes: "" };

test("every field is optional and text is tidied, never cut", () => {
  assert.deepEqual({ ...rules.parseUserAbout({}) }, { role: "", organization: "", department: "", interests: "", notes: "" });
  assert.equal(rules.parseUserAbout({ department: "  Computer   Science " }).department, "Computer Science");
  assert.equal(rules.parseUserAbout({ interests: "가".repeat(100) }).interests.length, 100);
  for (const bad of [{ interests: "x".repeat(101) }, { role: "wizard" }, { notes: 5 }, null, "text"]) assert.equal(rules.parseUserAbout(bad), null);
});

test("saved details come back exactly, and Clear all removes them", async () => {
  const handler = route();
  assert.deepEqual((await (await call(handler, "GET")).json()).about, { role: "", organization: "", department: "", interests: "", notes: "" });
  assert.equal((await call(handler, "PUT", mine)).status, 200);
  const stored = await (await call(handler, "GET")).json();
  assert.deepEqual(stored.about, mine); assert.equal(typeof stored.updatedAt, "string");
  assert.equal((await call(handler, "DELETE")).status, 200);
  assert.equal(handler.rows.size, 0);
});

test("invalid details are rejected and signed-out requests are refused", async () => {
  const handler = route();
  assert.equal((await call(handler, "PUT", { ...mine, notes: "x".repeat(101) })).status, 400);
  assert.equal(handler.rows.size, 0);
  for (const method of ["GET", "PUT", "DELETE"]) assert.equal((await call(route({ signedIn: false }), method, method === "PUT" ? mine : undefined)).status, 401);
  const unlinked = route({ userId: null });
  await call(unlinked, "PUT", mine);
  assert.ok(unlinked.rows.has(42));
});

test("only the Settings route can write these details: no AI or analysis code touches them", () => {
  const files = [];
  (function walk(dir) { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else if (/\.tsx?$/.test(name)) files.push(path); } })(resolve(__dirname, "../src"));
  const writers = files.filter((path) => /\b(saveUserAbout|deleteUserAbout)\b/.test(readFileSync(path, "utf8"))).map((path) => path.replace(/\\/g, "/").split("/src/")[1]).sort();
  assert.deepEqual(writers, ["app/api/profile/about/route.ts", "lib/mailflow-db.ts"]);
  const migration = readFileSync(resolve(__dirname, "../db/migrations/005_user_about.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS user_about/i);
  assert.match(migration, /REFERENCES users\(id\) ON DELETE CASCADE/i);
});
