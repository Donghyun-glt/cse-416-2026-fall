/* eslint-disable @typescript-eslint/no-require-imports -- Node's CommonJS test runner loads TypeScript through dynamic import. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");
const modulePromise = import(pathToFileURL(resolve(__dirname, "../src/lib/naver-imap-check.ts")).href);

// A scripted IMAP server: greets on connect, then answers each command line.
function server(reply, greeting = "* OK IMAP4rev1 ready\r\n") {
  const sent = [];
  const connect = () => {
    const socket = new EventEmitter();
    socket.write = (data) => { sent.push(data); const answer = reply(data); if (answer) setImmediate(() => socket.emit("data", Buffer.from(answer))); };
    socket.destroy = () => {};
    if (greeting) setImmediate(() => socket.emit("data", Buffer.from(greeting)));
    return socket;
  };
  return { connect, sent };
}

test("reachability only: no password means no LOGIN is sent", async () => {
  const { checkImapLogin } = await modulePromise;
  const imap = server(() => "");
  const result = await checkImapLogin({ user: "me@naver.com", connect: imap.connect });
  assert.equal(result.connected, true); assert.equal(result.login, "skipped");
  assert.ok(imap.sent.every((line) => !line.includes("LOGIN")));
});

test("an accepted application password reports ok, a refused one reports the server's reason", async () => {
  const { checkImapLogin } = await modulePromise;
  const good = server((line) => line.startsWith("a1 LOGIN") ? "* CAPABILITY IMAP4rev1\r\na1 OK LOGIN completed\r\n" : "");
  assert.equal((await checkImapLogin({ user: "me@naver.com", password: "abcd1234", connect: good.connect })).login, "ok");
  assert.equal(good.sent[0], 'a1 LOGIN "me@naver.com" "abcd1234"\r\n');
  const bad = server((line) => line.startsWith("a1 LOGIN") ? "a1 NO Authentication failed\r\n" : "");
  const refused = await checkImapLogin({ user: "me@naver.com", password: "wrong", connect: bad.connect });
  assert.equal(refused.login, "rejected"); assert.match(refused.detail, /Authentication failed/); assert.doesNotMatch(JSON.stringify(refused), /wrong/);
});

test("credentials cannot smuggle a second command, and quotes are escaped", async () => {
  const { checkImapLogin } = await modulePromise;
  const imap = server(() => "a1 NO\r\n");
  const injected = await checkImapLogin({ user: "me@naver.com", password: "x\r\na2 DELETE INBOX", connect: imap.connect });
  assert.equal(injected.login, "not_reached"); assert.equal(imap.sent.length, 0);
  await checkImapLogin({ user: "me@naver.com", password: 'a"b\\c', connect: imap.connect });
  assert.equal(imap.sent[0], 'a1 LOGIN "me@naver.com" "a\\"b\\\\c"\r\n');
});

test("an unreachable or silent server is reported instead of hanging", async () => {
  const { checkImapLogin } = await modulePromise;
  const silent = server(() => "", "");
  const result = await checkImapLogin({ user: "me@naver.com", connect: silent.connect, timeoutMs: 30 });
  assert.equal(result.connected, false); assert.equal(result.login, "not_reached"); assert.match(result.detail, /No response/);
});
