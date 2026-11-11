/* eslint-disable @typescript-eslint/no-require-imports -- The CommonJS test harness runs a transpiled route with a fake Gmail API. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const nextServer = require("next/server");

function loadSendRoute(sent) {
  const original = {
    id: "m1",
    threadId: "t1",
    snippet: "Original snippet",
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "Subject", value: "Project update" },
        { name: "From", value: "Alex <alex@example.com>" },
        { name: "Date", value: "Mon, 9 Nov 2026 10:00:00 +0900" },
        { name: "Message-ID", value: "<abc@example.com>" },
      ],
      body: { data: Buffer.from("Original <b>text</b>", "utf8").toString("base64url") },
    },
  };
  const gmail = {
    users: {
      getProfile: async () => ({ data: { emailAddress: "me@example.com" } }),
      messages: {
        get: async () => ({ data: original }),
        send: async (request) => { sent.push(request); return { data: {} }; },
      },
    },
  };
  const source = readFileSync(resolve(__dirname, "../src/app/api/gmail/messages/[id]/send/route.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, console, Buffer, Response,
    require(name) {
      if (name === "node:crypto") return require("node:crypto");
      if (name === "googleapis") return { google: { gmail: () => gmail } };
      if (name === "@/lib/google") return { createGoogleOAuthClient: () => ({ setCredentials() {} }) };
      if (name === "@/lib/gmail-session") return { getGmailSession: async () => ({ access_token: "fake" }) };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return exports;
}

function decodeRaw(sent) {
  return Buffer.from(sent[0].requestBody.raw, "base64url").toString("utf8");
}

function decodedParts(raw) {
  return [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n(?:[^\r\n]+\r\n)*\r\n([A-Za-z0-9+/=\r\n]+)/g)]
    .map((match) => Buffer.from(match[1].replace(/\r\n/g, ""), "base64").toString("utf8"));
}

const context = { params: Promise.resolve({ id: "m1" }) };

test("JSON replies are still sent as plain text in the original thread", async () => {
  const sent = [];
  const route = loadSendRoute(sent);
  const request = new nextServer.NextRequest("https://mailflow.test/api/gmail/messages/m1/send", {
    method: "POST",
    headers: { cookie: "gmail_session=valid", "content-type": "application/json" },
    body: JSON.stringify({ action: "reply", body: "Thanks!" }),
  });
  const response = await route.POST(request, context);
  assert.equal(response.status, 200);
  const raw = decodeRaw(sent);
  assert.match(raw, /^To: alex@example\.com\r\n/);
  assert.match(raw, /Content-Type: text\/plain; charset=UTF-8/);
  assert.doesNotMatch(raw, /multipart/);
  assert.equal(sent[0].requestBody.threadId, "t1");
  assert.match(decodedParts(raw)[0], /^Thanks!\r\n\r\nOn .* wrote:\r\n> Original <b>text<\/b>$/);
});

test("formatted replies carry text and HTML versions plus uploaded attachments", async () => {
  const sent = [];
  const route = loadSendRoute(sent);
  const form = new FormData();
  form.set("action", "reply");
  form.set("body", "Hello there");
  form.set("html", '<span style="font-family: Georgia, serif">Hello <b onclick="steal()">there</b></span><script>alert(1)</script>');
  form.append("files", new File(["report body"], "보고서.txt", { type: "text/plain" }));
  const request = new nextServer.NextRequest("https://mailflow.test/api/gmail/messages/m1/send", {
    method: "POST",
    headers: { cookie: "gmail_session=valid" },
    body: form,
  });
  const response = await route.POST(request, context);
  assert.equal(response.status, 200);
  const raw = decodeRaw(sent);
  assert.match(raw, /Content-Type: multipart\/mixed; boundary=/);
  assert.match(raw, /Content-Type: multipart\/alternative; boundary=/);
  assert.match(raw, new RegExp(`filename\\*=UTF-8''${encodeURIComponent("보고서.txt")}`));
  const [text, html, file] = decodedParts(raw);
  assert.match(text, /^Hello there\r\n\r\nOn /);
  assert.match(html, /font-family: Georgia, serif/);
  assert.match(html, /<b>there<\/b>/);
  assert.doesNotMatch(html, /script|onclick|alert/);
  // The quoted original is escaped, never inserted as markup.
  assert.match(html, /Original &lt;b&gt;text&lt;\/b&gt;/);
  assert.equal(file, "report body");
});

test("uploads over the size limit are rejected before anything is sent", async () => {
  const sent = [];
  const route = loadSendRoute(sent);
  const form = new FormData();
  form.set("action", "reply");
  form.set("body", "Big file");
  form.append("files", new File([new Uint8Array(4 * 1024 * 1024 + 1)], "big.bin"));
  const request = new nextServer.NextRequest("https://mailflow.test/api/gmail/messages/m1/send", {
    method: "POST",
    headers: { cookie: "gmail_session=valid" },
    body: form,
  });
  const response = await route.POST(request, context);
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "attachments_too_large");
  assert.equal(sent.length, 0);
});
