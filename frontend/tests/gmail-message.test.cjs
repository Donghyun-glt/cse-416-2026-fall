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
