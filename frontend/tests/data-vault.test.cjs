/* eslint-disable @typescript-eslint/no-require-imports -- Node's CommonJS test runner loads TypeScript through dynamic import. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");
process.env.DATA_ENCRYPTION_KEY = "test-data-key";
const vault = import(pathToFileURL(resolve(__dirname, "../src/lib/data-vault.ts")).href);

test("stored values are unreadable and come back only for the same user, row and column", async () => {
  const { seal, open } = await vault;
  const stored = seal(7, "todo_items.task:m1", "Submit the internship form 제출");
  assert.match(stored, /^enc:v1:/); assert.ok(!stored.includes("Submit") && !stored.includes("제출"));
  assert.notEqual(seal(7, "todo_items.task:m1", "Submit the internship form 제출"), stored); // Fresh IV each time.
  assert.equal(open(7, "todo_items.task:m1", stored), "Submit the internship form 제출");
  assert.equal(open(8, "todo_items.task:m1", stored), null); // Another user's key.
  assert.equal(open(7, "todo_items.task:m2", stored), null); // Moved to another row.
  assert.equal(open(7, "reply_drafts.draft:m1", stored), null); // Moved to another column.
  assert.equal(open(7, "todo_items.task:m1", `${stored.slice(0, -3)}AAA`), null); // Tampered.
});

test("a different server key cannot open the data", async () => {
  const { seal, open } = await vault;
  const stored = seal(7, "user_about.notes", "club officer");
  process.env.DATA_ENCRYPTION_KEY = "another-key";
  assert.equal(open(7, "user_about.notes", stored), null);
  process.env.DATA_ENCRYPTION_KEY = "test-data-key";
  assert.equal(open(7, "user_about.notes", stored), "club officer");
});

test("rows written before encryption still read, and JSON columns are sealed whole", async () => {
  const { open, sealJson, openJson } = await vault;
  assert.equal(open(7, "x", "old plain text"), "old plain text"); assert.equal(open(7, "x", null), null);
  const stored = JSON.parse(sealJson(7, "message_insights.analysis:m1", { summary: "Meet at 4", candidates: [{ title: "Meeting" }] }));
  assert.deepEqual(Object.keys(stored), ["enc"]); assert.ok(!JSON.stringify(stored).includes("Meet"));
  assert.deepEqual(openJson(7, "message_insights.analysis:m1", stored), { summary: "Meet at 4", candidates: [{ title: "Meeting" }] });
  assert.deepEqual(openJson(7, "message_insights.analysis:m1", { summary: "legacy" }), { summary: "legacy" });
  assert.equal(openJson(8, "message_insights.analysis:m1", stored), null);
});

test("lookup tokens match the same text for one user without revealing it", async () => {
  const { lookupToken } = await vault;
  const token = lookupToken(7, "reply_drafts.instructions", "write it in English");
  assert.equal(token, lookupToken(7, "reply_drafts.instructions", "write it in English"));
  assert.notEqual(token, lookupToken(8, "reply_drafts.instructions", "write it in English"));
  assert.ok(!token.includes("English")); assert.equal(lookupToken(7, "reply_drafts.instructions", ""), "");
});

test("every content column is written through the vault, never as plain text", () => {
  const db = readFileSync(resolve(__dirname, "../src/lib/mailflow-db.ts"), "utf8");
  for (const column of ["reply_drafts.draft", "reply_panel_states.draft", "reply_panel_states.instructions", "message_insights.analysis", "calendar_event_states.details", "user_about.", "todo_items.task"]) {
    assert.ok(new RegExp(`seal(Json)?\\(.*\`?${column.replace(".", "\\.")}`).test(db), `${column} must be sealed`);
  }
  assert.doesNotMatch(db, /JSON\.stringify\(input\.(analysis|details)\)/);
  assert.doesNotMatch(db, /analysis->>/); // Nothing inside the analysis is read in SQL any more.
});
