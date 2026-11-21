/* eslint-disable @typescript-eslint/no-require-imports -- The CommonJS test harness runs a transpiled route with a fake Gmail API. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const nextServer = require("next/server");

function loadRoute(gmail, database = {}, assignPriorities = async (messages) => new Map(messages.map((message) => [message.id, message.id === "new-low" ? "low" : "urgent"]))) {
  const source = readFileSync(resolve(__dirname, "../src/app/api/gmail/messages/route.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, console,
    require(name) {
      if (name === "next/server") return { NextResponse: nextServer.NextResponse };
      if (name === "googleapis") return { google: { gmail: () => gmail } };
      if (name === "@/lib/google") return { createGoogleOAuthClient: () => ({ setCredentials() {}, on() {} }) };
      if (name === "@/lib/gmail-session") return {
        getGmailSessionWithUser: async () => ({ tokens: { access_token: "fake" }, userId: null }),
        attachGmailSessionToUser: async () => {},
      };
      if (name === "@/lib/gmail-message") return { parseGmailMessage: (message) => ({ id: message.id, date: message.id === "new-low" ? "2026-10-17T00:00:00Z" : "2026-10-16T00:00:00Z", draft: false }) };
      if (name === "@/lib/gmail-priority") return {
        getOrAssignPriorities: assignPriorities,
      };
      if (name === "@/lib/mailflow-db") return { upsertUser: async () => 1, ...database };
      if (name === "@/lib/mail-priority") return {
        comparePriority: (a, b) => a.priority.localeCompare(b.priority),
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return (query) => exports.GET(new nextServer.NextRequest(`https://mailflow.test/api/gmail/messages?${query}`, { headers: { cookie: "gmail_session=valid" } }));
}

test("All Emails preserves Gmail order while attaching database priorities", async () => {
  const gmail = {
    users: {
      getProfile: async () => ({ data: { emailAddress: "demo@example.com" } }),
      messages: {
        list: async () => ({ data: { messages: [{ id: "new-low" }, { id: "old-urgent" }], nextPageToken: "next", resultSizeEstimate: 2000 } }),
        get: async ({ id }) => ({ data: { id, threadId: `thread-${id}`, labelIds: [], snippet: "", payload: { headers: [] } } }),
      },
      drafts: { list: async () => ({ data: { drafts: [{ id: "d1", message: { id: "draft-message", threadId: "thread-old-urgent" } }] } }) },
    },
  };
  const response = await loadRoute(gmail)("mode=all&page=0");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.messages.map((message) => message.id), ["new-low", "old-urgent"]);
  assert.deepEqual(body.messages.map((message) => message.priority), ["low", "urgent"]);
  assert.equal("sortingPending" in body, false);
  assert.equal(body.nextPageToken, "next");
  assert.deepEqual(body.messages.map((message) => message.partial), [true, true]);
  // Only the message whose thread holds an unfinished reply is marked.
  assert.deepEqual(body.messages.map((message) => message.hasDraft), [false, true]);
  assert.deepEqual(body.messages.map((message) => message.html), ["", ""]);
});

test("Summary lists open to-do items whatever their priority, and reports recent mail still to analyse", async () => {
  const item = (id, extra = {}) => ({ gmailMessageId: id, task: `Do ${id}`, dueDate: null, reasons: ["task"], confirmAudience: false, status: "open", ...extra });
  const items = [item("fyi-task", { dueDate: "2026-12-04" }), item("urgent-task"), item("finished", { status: "done" }), item("trash"), item("spam"), item("missing")];
  const labelById = { trash: "TRASH", spam: "SPAM" };
  const fetched = [];
  const gmail = {
    users: {
      getProfile: async () => ({ data: { emailAddress: "demo@example.com" } }),
      messages: {
        list: async (options) => {
          assert.equal(options.pageToken, undefined);
          assert.match(options.q, /newer_than:14d/);
          return { data: { messages: [{ id: "fresh" }, { id: "urgent-task" }], nextPageToken: "unscanned" } };
        },
        get: async ({ id, format }) => {
          assert.equal(format, "metadata");
          fetched.push(id);
          if (id === "missing") throw Object.assign(new Error("Missing"), { code: 404 });
          return { data: { id, internalDate: "100", labelIds: labelById[id] ? [labelById[id]] : ["INBOX"] } };
        },
      },
    },
  };
  let labelled = [];
  const request = loadRoute(gmail, {
    getStoredPriorities: async (userId, ids) => new Map([["urgent-task", "urgent"], ["fyi-task", "fyi"]].filter(([id]) => ids.includes(id))),
    getAnalysedMessageIds: async () => new Set(["urgent-task"]),
    getInsightSummaries: async () => new Map([["fyi-task", "Submit the form by December 4."]]),
    listTodoItems: async (userId) => { assert.equal(userId, 1); return items; },
  }, async (messages) => { labelled = messages.map((message) => message.id); return new Map(); });
  const response = await request("mode=summary&unread=1&attachment=1&pageToken=unrelated");
  const body = await response.json();
  assert.equal(response.status, 200);
  // A task in an FYI message is listed beside an urgent one; trashed, spam and deleted mail is not.
  assert.deepEqual(body.messages.map(({ id, priority, summary, todo }) => [id, priority, summary, todo.status, todo.dueDate]), [
    ["fyi-task", "fyi", "Submit the form by December 4.", "open", "2026-12-04"], ["urgent-task", "urgent", undefined, "open", null], ["finished", "fyi", undefined, "done", null],
  ]);
  assert.deepEqual([...labelled], ["fresh"]); // New mail still gets its provisional label.
  assert.deepEqual(body.pending, ["fresh"]); // And is reported so the client can have it analysed.
  assert.equal(body.nextPageToken, undefined);
});
