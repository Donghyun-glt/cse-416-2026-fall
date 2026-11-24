/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness loads transpiled TypeScript. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const { NextRequest } = require("next/server");

const text = (file) => readFileSync(resolve(__dirname, "../src", file), "utf8");
function route({ signedIn = true } = {}) {
  const rows = new Map([[7, [{ id: "a1", answer: "no", about: "audience", text: "TSM majors" }, { id: "a2", answer: "yes", about: "kind", text: "LAMBDA club programme announcement" }]], [8, [{ id: "a3", answer: "no", about: "audience", text: "faculty" }]]]);
  const about = new Map([[7, { role: "CS undergraduate" }]]);
  const exported = {};
  vm.runInNewContext(ts.transpileModule(text("app/api/profile/answers/route.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
    exports: exported, Response, URL, console: { error() {} },
    require: (name) => ({
      "@/lib/gmail-session": { getGmailSessionWithUser: async () => signedIn ? { tokens: {}, userId: 7 } : undefined },
      "@/lib/mailflow-db": {
        listSummaryAnswers: async (id) => rows.get(id) ?? [],
        deleteSummaryAnswers: async (id, answerId) => { rows.set(id, answerId === undefined ? [] : (rows.get(id) ?? []).filter((answer) => answer.id !== answerId)); },
      },
    })[name] ?? require(name),
  });
  return { ...exported, rows, about };
}
const call = (handler, method, query = "") => handler[method](new NextRequest(`https://mailflow.test/api/profile/answers${query}`, { method, headers: { cookie: "gmail_session=test" } }));

test("the user sees their remembered answers and can remove one", async () => {
  const handler = route();
  assert.deepEqual((await (await call(handler, "GET")).json()).answers.map((answer) => answer.id), ["a1", "a2"]);
  assert.equal((await call(handler, "DELETE", "?id=a1")).status, 200);
  assert.deepEqual(handler.rows.get(7).map((answer) => answer.id), ["a2"]);
  assert.equal((await call(handler, "DELETE", "?id=1%3B+DROP")).status, 400);
  assert.equal(handler.rows.get(7).length, 1);
});

test("Delete all removes every remembered answer of this user, and nothing else", async () => {
  const handler = route();
  assert.equal((await call(handler, "DELETE")).status, 200);
  assert.deepEqual(handler.rows.get(7), []);
  assert.equal(handler.rows.get(8).length, 1); // Another user's answers.
  assert.deepEqual(handler.about.get(7), { role: "CS undergraduate" }); // About you is a different store.
  assert.doesNotMatch(text("app/api/profile/answers/route.ts"), /UserAbout/);
  assert.match(text("lib/mailflow-db.ts"), /DELETE FROM summary_answers WHERE user_id = \$1"/);
});

test("signed-out requests are refused", async () => {
  const handler = route({ signedIn: false });
  assert.equal((await call(handler, "GET")).status, 401);
  assert.equal((await call(handler, "DELETE")).status, 401);
  assert.equal(handler.rows.get(7).length, 2);
});

test("Settings asks once more before deleting the profile and the history, and says what happens", () => {
  const ui = text("app/summary-answers.tsx");
  assert.match(ui, /role="alertdialog"/);
  assert.match(ui, /Delete your profile and personalization history\?/);
  assert.match(ui, /About you:<\/span> your role, organization, topics and note\. The fields above will be emptied/);
  assert.match(ui, /Personalization history:<\/span> everything remembered from your Yes \/ No answers/);
  assert.match(ui, /This cannot be undone\./);
  // The button only opens the question; both stores are deleted from the confirmation, each through its own route.
  assert.match(ui, /confirm\.current\?\.showModal\(\)/);
  assert.match(ui, /fetch\("\/api\/profile\/answers", \{ method: "DELETE" \}\), fetch\("\/api\/profile\/about", \{ method: "DELETE" \}\)/);
  // Settings then reloads the About-you form, so its fields show empty.
  assert.match(text("app/account-menu.tsx"), /<AboutYouForm key=\{aboutVersion\} \/><SummaryAnswers onDeletedAll=/);
});
