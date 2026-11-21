/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness loads transpiled TypeScript. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const text = (file) => readFileSync(resolve(__dirname, "../src", file), "utf8");
const exported = {};
vm.runInNewContext(ts.transpileModule(text("lib/summary-todo.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { exports: exported, require: (name) => require(name === "./calendar-suggestion" ? "../src/lib/calendar-suggestion.ts" : name === "./user-about" ? "../src/lib/user-about.ts" : name) });
const { decideTodo, profileForPrompt } = exported;

const source = "TSM Department\n\nThis notice is for TSM majors only. Submit the internship form by December 4, 2026. Can you confirm by reply?";
const base = { hasTask: true, task: "Submit the internship form by December 4.", taskEvidence: "Submit the internship form by December 4, 2026.", dueDate: "2026-12-04", dueEvidence: "December 4, 2026",
  needsReply: false, replyEvidence: "", audience: "", audienceEvidence: "", audienceFit: "not_stated", interestMatch: false };
const input = (extra = {}) => ({ source, sentAt: "2026-11-20T03:00:00Z", now: new Date("2026-11-21T00:00:00Z"), timeZone: "Asia/Seoul", events: [], ...extra });
const cs = { role: "undergraduate", organization: "SUNY Korea", department: "Computer Science", interests: "", notes: "" };
const plain = (value) => JSON.parse(JSON.stringify(value));

test("a real task is listed with its checked deadline, however far away it is", () => {
  assert.deepEqual(plain(decideTodo(base, input())), { task: "Submit the internship form by December 4.", dueDate: "2026-12-04", reasons: ["task"], confirmAudience: false });
});

test("nothing to do means not listed; invented tasks, quotes and numbers are not trusted", () => {
  assert.equal(decideTodo({ ...base, hasTask: false }, input()), null);
  assert.equal(decideTodo({ ...base, taskEvidence: "Pay the fee today." }, input()), null);
  assert.equal(decideTodo({ ...base, task: "Submit 3 forms by December 4." }, input()), null);
  assert.equal(decideTodo({ ...base, dueDate: "2026-12-05" }, input()).dueDate, null); // Wrong date: keep the task, drop the date.
  assert.equal(decideTodo(undefined, input()), null);
});

test("a reply request from a person is listed; one from an automated sender is not", () => {
  const asks = { ...base, hasTask: false, needsReply: true, replyEvidence: "Can you confirm by reply?" };
  assert.deepEqual(plain(decideTodo(asks, input())), { task: "Reply to this email", dueDate: null, reasons: ["reply"], confirmAudience: false });
  assert.equal(decideTodo(asks, input({ automated: true })), null);
});

test("an undecided calendar suggestion is listed on its own", () => {
  const decided = decideTodo({ ...base, hasTask: false }, input({ events: [{ title: "Office hours", date: "2026-11-25" }] }));
  assert.deepEqual(plain(decided.reasons), ["event"]); assert.equal(decided.dueDate, "2026-11-25"); assert.match(decided.task, /Office hours/);
});

test("the user's profile removes mail addressed to another group, and only then", () => {
  const forTsm = { ...base, audience: "TSM majors", audienceEvidence: "This notice is for TSM majors only.", audienceFit: "does_not_apply" };
  assert.equal(decideTodo(forTsm, input({ about: cs })), null);
  // No profile to compare with: keep it and ask the user to check.
  assert.equal(decideTodo(forTsm, input()).confirmAudience, true);
  assert.equal(decideTodo(forTsm, input({ about: { ...cs, role: "", organization: "", department: "" } })).confirmAudience, true);
  // The audience claim must be quoted from the email.
  assert.equal(decideTodo({ ...forTsm, audienceEvidence: "For business students." }, input({ about: cs })).confirmAudience, true);
  // A stated interest keeps it.
  assert.ok(decideTodo({ ...forTsm, interestMatch: true }, input({ about: cs })));
  assert.equal(decideTodo({ ...base, audienceFit: "unclear" }, input({ about: cs })).confirmAudience, true);
});

test("a deadline that passed long before the email was analysed is not listed", () => {
  assert.equal(decideTodo(base, input({ now: new Date("2026-12-20T00:00:00Z") })), null);
});

test("the model only sees profile fields the user filled in", () => {
  assert.deepEqual(plain(profileForPrompt(cs)), { role: "Undergraduate student", organization: "SUNY Korea", majorOrDepartment: "Computer Science" });
  assert.deepEqual(plain(profileForPrompt(null)), {});
});

test("Summary and priority are decided separately", () => {
  const todoCode = text("lib/summary-todo.ts").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(todoCode, /priority|urgent|mail-priority|mail-analysis/i);
  const priorityCode = text("lib/mail-analysis.ts");
  assert.doesNotMatch(priorityCode.slice(priorityCode.indexOf("export function validateMailAnalysis")), /todo/i);
  const migration = readFileSync(resolve(__dirname, "../db/migrations/006_todo_items.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS todo_items/i);
  assert.doesNotMatch(migration.replace(/--.*/g, ""), /priority/i);
});
