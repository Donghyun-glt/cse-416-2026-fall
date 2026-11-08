/* eslint-disable @typescript-eslint/no-require-imports -- The CommonJS harness transpiles the TypeScript parser in isolation. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadParser() {
  const source = readFileSync(resolve(__dirname, "../src/lib/gmail-message.ts"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, Buffer });
  return exports.parseGmailMessage;
}

test("Gmail MIME parser exposes attachments and restores cid images", () => {
  const parseGmailMessage = loadParser();
  const html = '<p>Invitation</p><img src="cid:banner@example">';
  const message = parseGmailMessage({
    id: "message-1",
    payload: {
      mimeType: "multipart/mixed",
      headers: [{ name: "Subject", value: "Event" }],
      parts: [
        { mimeType: "text/html", body: { data: Buffer.from(html).toString("base64url") } },
        {
          partId: "2",
          mimeType: "image/png",
          filename: "banner.png",
          headers: [
            { name: "Content-ID", value: "<banner@example>" },
            { name: "Content-Disposition", value: "inline" },
          ],
          body: { attachmentId: "inline-id", size: 1200 },
        },
        {
          partId: "3",
          mimeType: "application/pdf",
          filename: "agenda.pdf",
          headers: [{ name: "Content-Disposition", value: "attachment" }],
          body: { attachmentId: "pdf-id", size: 64000 },
        },
      ],
    },
  });

  assert.equal(message.attachments.length, 2);
  assert.equal(message.attachments[0].inline, true);
  assert.equal(message.attachments[1].filename, "agenda.pdf");
  assert.equal(message.attachments[1].downloadUrl, "/api/gmail/messages/message-1/attachments/3?download=1");
  assert.match(message.html, /src="\/api\/gmail\/messages\/message-1\/attachments\/2"/);
  assert.doesNotMatch(message.html, /cid:banner@example/);
});

test("Content-ID attachments that the body does not embed stay visible (Outlook PDFs)", () => {
  const parseGmailMessage = loadParser();
  const html = '<p>Poster below</p><img src="cid:poster@sunykorea">';
  const message = parseGmailMessage({
    id: "message-2",
    payload: {
      mimeType: "multipart/mixed",
      headers: [{ name: "To", value: "SUNY <all@sunykorea.ac.kr>" }],
      parts: [
        {
          mimeType: "multipart/related",
          parts: [
            { mimeType: "text/html", body: { data: Buffer.from(html).toString("base64url") } },
            {
              partId: "0.1",
              mimeType: "image/png",
              filename: "image001.png",
              headers: [{ name: "Content-ID", value: "<poster@sunykorea>" }, { name: "Content-Disposition", value: "inline" }],
              body: { attachmentId: "img", size: 900 },
            },
          ],
        },
        {
          partId: "1",
          mimeType: "application/pdf",
          filename: "Year-End Party.pdf",
          headers: [
            { name: "Content-ID", value: "<F1A2B3@namprd.outlook.com>" },
            { name: "Content-Disposition", value: "inline; filename=\"Year-End Party.pdf\"" },
          ],
          body: { attachmentId: "pdf", size: 250000 },
        },
      ],
    },
  });

  const visible = message.attachments.filter((attachment) => !attachment.inline);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].filename, "Year-End Party.pdf");
  assert.equal(message.attachments.find((a) => a.filename === "image001.png").inline, true);
  assert.equal(message.to, "SUNY <all@sunykorea.ac.kr>");
});

test("An attached .html/.txt file is never used as the message body", () => {
  const parseGmailMessage = loadParser();
  const message = parseGmailMessage({
    id: "message-3",
    payload: {
      mimeType: "multipart/mixed",
      parts: [
        { partId: "0", mimeType: "text/plain", body: { data: Buffer.from("Real body").toString("base64url") } },
        {
          partId: "1",
          mimeType: "text/html",
          filename: "report.html",
          headers: [{ name: "Content-Disposition", value: "attachment" }],
          body: { data: Buffer.from("<h1>Attached file</h1>").toString("base64url"), size: 22 },
        },
      ],
    },
  });

  assert.match(message.html, /Real body/);
  assert.doesNotMatch(message.html, /Attached file/);
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].inline, false);
});

test("List-Unsubscribe prefers the https target", () => {
  const parseGmailMessage = loadParser();
  const message = parseGmailMessage({
    id: "m4",
    payload: {
      mimeType: "text/plain",
      headers: [{ name: "List-Unsubscribe", value: "<mailto:u@list.example>, <https://list.example/u?id=1>" }],
      body: { data: Buffer.from("hi").toString("base64url") },
    },
  });
  assert.equal(message.unsubscribeUrl, "https://list.example/u?id=1");
});
