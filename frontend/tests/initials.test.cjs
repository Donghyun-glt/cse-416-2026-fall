/* eslint-disable @typescript-eslint/no-require-imports -- The CommonJS test harness runs the transpiled helper. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const helper = {};
vm.runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib/initials.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: helper });
const { initials } = helper;

test("initials take the first letter of the first two words", () => {
  assert.equal(initials("Professor Kim"), "PK");
  assert.equal(initials("donghyun lim"), "DL");
  assert.equal(initials("Registrar"), "R");
});

test("emoji and symbols are skipped whole, never cut into a broken character", () => {
  // The sender that drew a broken glyph: "📕 The Effect of Background ..."
  assert.equal(initials("📕 The Effect of Background"), "TE");
  assert.equal(initials("🎉🎉 Event Team"), "ET");
  assert.equal(initials("- IT Services -"), "IS");
  assert.equal(initials('"Career Center"'), "CC");
  for (const value of ["📕 The Effect", "🎉 Party"]) assert.equal(/[\uD800-\uDFFF]/.test(initials(value)), false);
});

test("non-Latin names and names without letters", () => {
  assert.equal(initials("김승훈"), "김");
  assert.equal(initials("이 진상"), "이진");
  assert.equal(initials("2026 Registrar"), "2R");
  assert.equal(initials("📕📕"), "M");
  assert.equal(initials("", "G"), "G");
});
