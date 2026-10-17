/* eslint-disable @typescript-eslint/no-require-imports -- The CommonJS test harness runs a transpiled route with a fake Gmail API. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const nextServer = require("next/server");

test("All Emails returns a page before mailbox-wide indexing finishes", async () => {
  const scheduled = [];
  let indexStarted = false;
  const gmail = {
    users: {
      messages: {
        list: async () => ({ data: { messages: [{ id: "mail-1" }], nextPageToken: "next", resultSizeEstimate: 2000 } }),
        get: async () => ({ data: { id: "mail-1", labelIds: [], snippet: "Please approve today", payload: { headers: [] } } }),
      },
    },
  };
  const source = readFileSync(resolve(__dirname, "../src/app/api/gmail/messages/route.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, console,
    require(name) {
      if (name === "next/server") return { NextResponse: nextServer.NextResponse, after: (callback) => scheduled.push(callback) };
      if (name === "googleapis") return { google: { gmail: () => gmail } };
      if (name === "@/lib/google") return { createGoogleOAuthClient: () => ({ setCredentials() {}, on() {} }) };
      if (name === "@/lib/gmail-session") return { getGmailSession: () => ({ access_token: "fake" }), saveGmailSession() {} };
      if (name === "@/lib/gmail-message") return { parseGmailMessage: () => ({ id: "mail-1", date: "2026-10-17T00:00:00Z", draft: false }) };
      if (name === "@/lib/gmail-priority") return { ensurePriorityLabels: async () => ({ urgent: "u", fyi: "f", low: "l" }) };
      if (name === "@/lib/priority-index") return {
        getReadyPriorityIndex: () => null,
        getPriorityIndex: () => { indexStarted = true; return new Promise(() => {}); },
      };
      if (name === "@/lib/mail-priority") return {
        classifyPriority: () => "urgent", priorityFromLabels: () => null,
        comparePriority: () => 0,
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const request = new nextServer.NextRequest("https://mailflow.test/api/gmail/messages?mode=all&page=0", { headers: { cookie: "gmail_session=valid" } });
  const response = await exports.GET(request);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.messages[0].id, "mail-1");
  assert.equal(body.messages[0].priority, "urgent");
  assert.equal(body.sortingPending, true);
  assert.equal(body.nextPageToken, "next");
  assert.equal(indexStarted, false);
  assert.equal(scheduled.length, 1);
});
