/* eslint-disable @typescript-eslint/no-require-imports -- The CommonJS test harness runs a transpiled route with a fake Gmail API. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const nextServer = require("next/server");

function loadTypeScript(relativePath, requireFn) {
  const source = readFileSync(resolve(__dirname, "..", relativePath), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, console, Buffer, Response, require: requireFn });
  return exports;
}

function loadRoutes(sent, drafts = []) {
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
      drafts: {
        create: async (request) => { drafts.push(["create", request]); return { data: { id: "d1" } }; },
        update: async (request) => {
          drafts.push(["update", request]);
          if (request.id === "gone") throw Object.assign(new Error("Not Found"), { code: 404 });
          return { data: { id: request.id } };
        },
        delete: async (request) => { drafts.push(["delete", request]); return { data: {} }; },
      },
    },
  };
  const outgoingMail = loadTypeScript("src/lib/outgoing-mail.ts", (name) => {
    if (name === "node:crypto") return require("node:crypto");
    throw new Error(`Unexpected import: ${name}`);
  });
  const requireFn = (name) => {
    if (name === "googleapis") return { google: { gmail: () => gmail } };
    if (name === "@/lib/google") return { createGoogleOAuthClient: () => ({ setCredentials() {} }) };
    if (name === "@/lib/gmail-session") return { getGmailSession: async () => ({ access_token: "fake" }) };
    if (name === "@/lib/outgoing-mail") return outgoingMail;
    throw new Error(`Unexpected import: ${name}`);
  };
  return {
    send: loadTypeScript("src/app/api/gmail/messages/[id]/send/route.ts", requireFn),
    draft: loadTypeScript("src/app/api/gmail/messages/[id]/draft/route.ts", requireFn),
  };
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
  const route = loadRoutes(sent).send;
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
  const route = loadRoutes(sent).send;
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
  const route = loadRoutes(sent).send;
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

function draftRequest(fields, method = "POST", query = "") {
  const init = { method, headers: { cookie: "gmail_session=valid" } };
  if (fields) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    init.body = form;
  }
  return new nextServer.NextRequest(`https://mailflow.test/api/gmail/messages/m1/draft${query}`, init);
}

test("an unfinished reply is saved as a Gmail draft in the original thread, then updated in place", async () => {
  const sent = [];
  const drafts = [];
  const route = loadRoutes(sent, drafts).draft;

  const created = await route.POST(draftRequest({ action: "reply", body: "First thoughts", html: "<b>First</b> thoughts" }), context);
  assert.equal(created.status, 200);
  assert.equal((await created.json()).draftId, "d1");
  assert.equal(drafts[0][0], "create");
  assert.equal(drafts[0][1].requestBody.message.threadId, "t1");
  const raw = Buffer.from(drafts[0][1].requestBody.message.raw, "base64url").toString("utf8");
  assert.match(raw, /^To: alex@example\.com\r\n/);
  assert.match(raw, /Subject: Re: Project update/);

  const updated = await route.POST(draftRequest({ action: "reply", body: "Second thoughts", draftId: "d1" }), context);
  assert.equal((await updated.json()).draftId, "d1");
  assert.deepEqual(drafts.map(([kind]) => kind), ["create", "update"]);
  assert.equal(sent.length, 0);
});

test("a forward can be saved as a draft before a recipient is entered, but not sent", async () => {
  const sent = [];
  const drafts = [];
  const routes = loadRoutes(sent, drafts);
  const saved = await routes.draft.POST(draftRequest({ action: "forward", body: "FYI" }), context);
  assert.equal(saved.status, 200);
  const raw = Buffer.from(drafts[0][1].requestBody.message.raw, "base64url").toString("utf8");
  assert.doesNotMatch(raw, /^To:/m);
  assert.match(raw, /Subject: Fwd: Project update/);

  const form = new FormData();
  form.set("action", "forward");
  form.set("body", "FYI");
  const response = await routes.send.POST(new nextServer.NextRequest("https://mailflow.test/api/gmail/messages/m1/send", { method: "POST", headers: { cookie: "gmail_session=valid" }, body: form }), context);
  assert.equal(response.status, 400);
  assert.equal(sent.length, 0);
});

test("a draft deleted elsewhere is recreated, and sending removes the saved draft", async () => {
  const sent = [];
  const drafts = [];
  const routes = loadRoutes(sent, drafts);
  const recreated = await routes.draft.POST(draftRequest({ action: "reply", body: "Still writing", draftId: "gone" }), context);
  assert.equal((await recreated.json()).draftId, "d1");
  assert.deepEqual(drafts.map(([kind]) => kind), ["update", "create"]);

  const form = new FormData();
  form.set("action", "reply");
  form.set("body", "Done");
  form.set("draftId", "d1");
  const response = await routes.send.POST(new nextServer.NextRequest("https://mailflow.test/api/gmail/messages/m1/send", { method: "POST", headers: { cookie: "gmail_session=valid" }, body: form }), context);
  assert.equal(response.status, 200);
  assert.equal(sent.length, 1);
  assert.equal(drafts.at(-1)[0], "delete");
  assert.equal(drafts.at(-1)[1].id, "d1");

  const discarded = await routes.draft.DELETE(draftRequest(null, "DELETE", "?draftId=d1"));
  assert.equal(discarded.status, 200);
  assert.equal((await discarded.json()).discarded, true);
});
