/* eslint-disable @typescript-eslint/no-require-imports -- The CommonJS test harness runs a transpiled route with a fake Gmail API. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const nextServer = require("next/server");

test("All Emails preserves Gmail order while attaching priority labels", async () => {
  const gmail = {
    users: {
      messages: {
        list: async () => ({ data: { messages: [{ id: "new-low" }, { id: "old-urgent" }], nextPageToken: "next", resultSizeEstimate: 2000 } }),
        get: async ({ id }) => ({ data: { id, labelIds: [], snippet: "", payload: { headers: [] } } }),
      },
    },
  };
  const source = readFileSync(resolve(__dirname, "../src/app/api/gmail/messages/route.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, console,
    require(name) {
      if (name === "next/server") return { NextResponse: nextServer.NextResponse };
      if (name === "googleapis") return { google: { gmail: () => gmail } };
      if (name === "@/lib/google") return { createGoogleOAuthClient: () => ({ setCredentials() {}, on() {} }) };
      if (name === "@/lib/gmail-session") return { getGmailSession: () => ({ access_token: "fake" }), saveGmailSession() {} };
      if (name === "@/lib/gmail-message") return { parseGmailMessage: (message) => ({ id: message.id, date: message.id === "new-low" ? "2026-10-17T00:00:00Z" : "2026-10-16T00:00:00Z", draft: false }) };
      if (name === "@/lib/gmail-priority") return {
        ensurePriorityLabels: async () => ({ urgent: "u", fyi: "f", low: "l" }),
        getOrAssignPriority: async (_gmail, message) => message.id === "new-low" ? "low" : "urgent",
      };
      if (name === "@/lib/mail-priority") return {
        comparePriority: (a, b) => a.priority.localeCompare(b.priority),
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const request = new nextServer.NextRequest("https://mailflow.test/api/gmail/messages?mode=all&page=0", { headers: { cookie: "gmail_session=valid" } });
  const response = await exports.GET(request);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.messages.map((message) => message.id), ["new-low", "old-urgent"]);
  assert.deepEqual(body.messages.map((message) => message.priority), ["low", "urgent"]);
  assert.equal("sortingPending" in body, false);
  assert.equal(body.nextPageToken, "next");
});
