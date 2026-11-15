/* eslint-disable @typescript-eslint/no-require-imports -- The CommonJS test harness runs the transpiled message builder. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const exported = {};
vm.runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib/outgoing-mail.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports: exported, Buffer, require });
const { buildNewMessage, readNewDraft } = exported;
const decode = (raw) => Buffer.from(raw, "base64url").toString("utf8");
const part = (mime, type) => Buffer.from(mime.split(`Content-Type: text/${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n`)[1].split("\r\n--")[0].replace(/\r\n/g, ""), "base64").toString("utf8");

test("a new message carries its recipients, subject and both body versions", () => {
  const result = buildNewMessage({ to: "Kim <kim@example.com>; lee@example.com", cc: "cc@example.com", bcc: "hidden@example.com", subject: "도서관 모임", body: "See you at 4.", html: "See you at <b>4</b>.<script>alert(1)</script>" }, []);
  const mime = decode(result.raw);
  assert.match(mime, /^To: kim@example\.com, lee@example\.com\r\n/);
  assert.match(mime, /\r\nCc: cc@example\.com\r\n/); assert.match(mime, /\r\nBcc: hidden@example\.com\r\n/);
  assert.match(mime, /\r\nSubject: =\?UTF-8\?B\?/);
  assert.doesNotMatch(mime, /In-Reply-To|References/);
  assert.equal(part(mime, "plain"), "See you at 4.");
  assert.equal(part(mime, "html"), '<div dir="ltr">See you at <b>4</b>.</div>');
});

test("attachments are included and a message may consist of only a file", () => {
  const mime = decode(buildNewMessage({ to: "kim@example.com" }, [{ filename: "notes.txt", mimeType: "text/plain", data: Buffer.from("hello") }]).raw);
  assert.match(mime, /multipart\/mixed/); assert.match(mime, /filename\*=UTF-8''notes\.txt/);
});

test("a message is refused without a recipient, with a mistyped address, or with nothing in it", () => {
  assert.equal(buildNewMessage({ subject: "Hi", body: "x" }, []).error, "recipient_missing");
  const mistyped = buildNewMessage({ to: "kim@example.com, lee@", body: "x" }, []);
  assert.equal(mistyped.error, "invalid_recipient"); assert.deepEqual([...mistyped.invalid], ["lee@"]);
  assert.equal(buildNewMessage({ to: "kim@example.com", subject: " ", body: " " }, []).error, "empty_message");
});

test("a line break in a field cannot add headers", () => {
  const mime = decode(buildNewMessage({ to: "kim@example.com", subject: "Hi\r\nBcc: spy@example.com", body: "x" }, []).raw);
  assert.doesNotMatch(mime, /\r\nBcc:/);
});

test("a draft is saved in any state and comes back exactly as typed", () => {
  const typed = { to: "kim@example.com, lee@", cc: "", bcc: "", subject: "", body: "", html: "" };
  const saved = buildNewMessage(typed, [], { draft: true });
  assert.equal(saved.error, undefined);
  const mime = decode(saved.raw);
  assert.match(mime, /\r\nTo: kim@example\.com\r\n/); // Only the valid address reaches the real header.
  const headers = mime.split("\r\n\r\n")[0].split("\r\n").map((line) => { const at = line.indexOf(": "); return { name: line.slice(0, at), value: line.slice(at + 2) }; });
  const restored = readNewDraft({ payload: { mimeType: "text/plain", headers, body: { data: "" } } });
  assert.equal(restored.to, "kim@example.com, lee@");
  assert.equal(buildNewMessage({}, [], { draft: true }).error, undefined); // Even an empty window can be saved.
});

test("a draft with Korean recipients' names and formatting round-trips", () => {
  const saved = buildNewMessage({ to: "김동현 <kim@example.com>", subject: "모임", body: "Hello", html: "<b>Hello</b>" }, [], { draft: true });
  const mime = decode(saved.raw);
  const headers = mime.split("\r\n\r\n")[0].split("\r\n").map((line) => { const at = line.indexOf(": "); return { name: line.slice(0, at), value: line.slice(at + 2) }; });
  const html = Buffer.from(part(mime, "html"), "utf8").toString("base64url");
  const restored = readNewDraft({ payload: { mimeType: "multipart/alternative", headers, parts: [{ mimeType: "text/html", body: { data: html } }] } });
  assert.equal(restored.to, "김동현 <kim@example.com>"); assert.equal(restored.html, "<b>Hello</b>");
});
