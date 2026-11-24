/* eslint-disable @typescript-eslint/no-require-imports -- The CommonJS test harness runs the transpiled library. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, imports = {}) {
  const helper = {};
  const source = readFileSync(resolve(__dirname, "../src/lib", file), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: helper, require: (name) => imports[name] ?? require(name) });
  return helper;
}
const compose = load("compose-draft.ts", { "./reply-draft": load("reply-draft.ts") });

test("a request needs instructions and valid tone and length", () => {
  assert.equal(compose.parseComposeDraftRequest({}), null);
  assert.equal(compose.parseComposeDraftRequest({ instructions: "   " }), null);
  assert.equal(compose.parseComposeDraftRequest({ instructions: "Ask for notes", tone: "rude" }), null);
  const parsed = compose.parseComposeDraftRequest({ instructions: "  Ask for the lecture notes  ", to: "Kim <kim@example.edu>", currentBody: "x".repeat(9000) });
  assert.equal(parsed.instructions, "Ask for the lecture notes");
  assert.equal(parsed.tone, "professional");
  assert.equal(parsed.length, "medium");
  assert.equal(parsed.currentBody.length, 8000);
});

test("the prompt greets the recipient by name, signs with the user's name and forbids invented facts", () => {
  const prompt = compose.buildComposePrompt(compose.parseComposeDraftRequest({ instructions: "교수님께 금요일로 미팅을 옮겨달라고 부탁", tone: "formal", to: '"Jason Park" <jason@example.edu>', senderName: "Seunghoon Jang" }));
  assert.match(prompt, /greeting to Jason\./);
  assert.match(prompt, /sign-off followed by the name "Seunghoon"/);
  assert.match(prompt, /Never invent facts/);
  assert.match(prompt, /다나까체/); // the formal tone guide shared with AI replies
  assert.match(prompt, /교수님께 금요일로/);
  assert.doesNotMatch(prompt, /Current draft:/);
});

test("with text already in the editor the prompt asks for a revision of it", () => {
  const prompt = compose.buildComposePrompt(compose.parseComposeDraftRequest({ instructions: "make it shorter", currentBody: "Hi Jason,\nCould we meet?", subject: "Meeting" }));
  assert.match(prompt, /Revise it to satisfy the request/);
  assert.match(prompt, /Current draft:\nHi Jason,\nCould we meet\?/);
  assert.match(prompt, /return it unchanged unless the request asks to change it\): Meeting/);
  assert.match(prompt, /greeting that suits the recipient/); // no recipient name to use
});

test("recipient names come only from a display name, never from a bare address", () => {
  assert.equal(compose.recipientFirstName('"Park, Jason" <jason@x.com>, Kim <k@x.com>'), "Park,");
  assert.equal(compose.recipientFirstName("Kim Minji <minji@x.com>"), "Kim");
  assert.equal(compose.recipientFirstName("minji@x.com"), undefined);
  assert.equal(compose.recipientFirstName(""), undefined);
});

test("the model's answer is read safely", () => {
  assert.deepEqual({ ...compose.parseComposeDraftResponse('{"subject":"Subject: Moving our meeting","body":"Hi Jason,\\n\\nCould we meet Friday?\\n\\nBest,\\nSeunghoon"}') },
    { subject: "Moving our meeting", body: "Hi Jason,\n\nCould we meet Friday?\n\nBest,\nSeunghoon" });
  assert.equal(compose.parseComposeDraftResponse("not json"), null);
  assert.equal(compose.parseComposeDraftResponse('{"subject":"Hi","body":"   "}'), null);
});

test("draft text becomes editor HTML without being read as markup", () => {
  assert.equal(compose.draftTextToHtml("Hi <b>Jason</b> & team,\n\nThanks"), "<div>Hi &lt;b&gt;Jason&lt;/b&gt; &amp; team,</div><div><br></div><div>Thanks</div>");
});

test("the language is decided from the request, then from the draft being revised", () => {
  assert.equal(compose.draftLanguage({ instructions: "Ask the library to extend my booking", currentBody: "" }), "English");
  assert.equal(compose.draftLanguage({ instructions: "교수님께 미팅 변경 부탁", currentBody: "" }), "Korean");
  assert.equal(compose.draftLanguage({ instructions: "make it shorter", currentBody: "안녕하세요 교수님," }), "Korean");
  assert.equal(compose.draftLanguage({ instructions: "make it shorter", currentBody: "Hi Jason," }), "English");
  const english = compose.buildComposePrompt(compose.parseComposeDraftRequest({ instructions: "Ask the library to extend my booking", tone: "friendly" }));
  assert.match(english, /Write the email in English unless/);
  assert.match(english, /blank line between paragraphs/);
  const korean = compose.buildComposePrompt(compose.parseComposeDraftRequest({ instructions: "도서관에 예약 연장 문의" }));
  assert.match(korean, /Write the email in Korean/);
});
