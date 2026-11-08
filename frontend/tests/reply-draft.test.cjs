/* eslint-disable @typescript-eslint/no-require-imports -- Node's CommonJS test runner loads TypeScript through dynamic import. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");

const modulePromise = import(pathToFileURL(resolve(__dirname, "../src/lib/reply-draft.ts")).href);

test("parses options with defaults and rejects unknown values", async () => {
  const { parseReplyDraftOptions } = await modulePromise;
  assert.deepEqual(parseReplyDraftOptions({}), { tone: "professional", length: "medium", instructions: undefined });
  assert.deepEqual(parseReplyDraftOptions({ tone: "friendly", length: "short", instructions: "  say yes  " }),
    { tone: "friendly", length: "short", instructions: "say yes" });
  assert.equal(parseReplyDraftOptions({ tone: "sarcastic" }), null);
  assert.equal(parseReplyDraftOptions({ length: "epic" }), null);
  assert.equal(parseReplyDraftOptions(null).tone, "professional");
});

test("converts HTML email bodies to readable text", async () => {
  const { emailBodyToText } = await modulePromise;
  const html = "<html><head><style>p{color:red}</style></head><body><p>Hi&nbsp;team,</p><p>Meeting at <b>3pm</b>.<br>Thanks &amp; regards</p></body></html>";
  assert.equal(emailBodyToText(html), "Hi team,\n\nMeeting at 3pm.\nThanks & regards");
  assert.equal(emailBodyToText("plain\r\n\r\n\r\n\r\ntext  here"), "plain\n\ntext here");
});

test("builds a prompt that carries tone, length, instructions and the original mail", async () => {
  const { buildReplyPrompt } = await modulePromise;
  const prompt = buildReplyPrompt(
    { subject: "Lunch?", from: "Ana <ana@example.com>", to: "me@example.com", date: "Mon, 3 Nov 2026", body: "Free for lunch Friday?", me: "me@example.com" },
    { tone: "friendly", length: "short", instructions: "accept and suggest 12:30" },
  );
  assert.match(prompt, /warm and friendly/);
  assert.match(prompt, /2-3 sentences/);
  assert.match(prompt, /accept and suggest 12:30/);
  assert.match(prompt, /Subject: Lunch\?/);
  assert.match(prompt, /Free for lunch Friday\?/);
  assert.match(prompt, /same language as the original email/);
  assert.match(prompt, /Hi Ana,/);
  assert.match(prompt, /nothing after it/);
});

test("truncates very long bodies", async () => {
  const { buildReplyPrompt } = await modulePromise;
  const prompt = buildReplyPrompt(
    { subject: "s", from: "f", to: "t", date: "d", body: "x".repeat(10000) },
    { tone: "concise", length: "long" },
  );
  assert.match(prompt, /message truncated/);
  assert.ok(prompt.length < 8000);
});

test("cleans model wrappers from drafts", async () => {
  const { cleanDraft } = await modulePromise;
  assert.equal(cleanDraft("```text\nHi Ana,\n\nYes!\n```"), "Hi Ana,\n\nYes!");
  assert.equal(cleanDraft("Subject: Re: Lunch\n\nHi Ana,"), "Hi Ana,");
});

test("derives greeting and sign-off names from headers", async () => {
  const { displayNameFor, senderFirstName, buildReplyPrompt } = await modulePromise;
  assert.equal(displayNameFor('"Alex Kim" <alex@gmail.com>, Sam Lee <sam@company.com>', "alex@gmail.com"), "Alex Kim");
  assert.equal(displayNameFor("Sam Lee <sam@company.com>", "ALEX@gmail.com"), undefined);
  assert.equal(displayNameFor("alex@gmail.com", "alex@gmail.com"), undefined);
  assert.equal(senderFirstName("Jason Park <jason.park@company.com>"), "Jason");
  assert.equal(senderFirstName("김지수 조교 <ta.kim@sunykorea.ac.kr>"), "김지수");
  assert.equal(senderFirstName("no-reply@zoom.us"), "no-reply");
  const prompt = buildReplyPrompt(
    { subject: "s", from: "Jason Park <j@x.com>", to: '"Alex Kim" <alex@x.com>', date: "d", body: "b", me: "alex@x.com", meName: "Alex Kim" },
    { tone: "professional", length: "medium" },
  );
  assert.match(prompt, /name "Alex" on its own line/);
});
