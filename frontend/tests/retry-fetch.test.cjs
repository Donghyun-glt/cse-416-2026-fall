/* eslint-disable @typescript-eslint/no-require-imports -- The CommonJS test harness runs the transpiled helper with a fake fetch. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Each reply is { status, retryAfter? }; waits are recorded instead of slept.
function load(replies) {
  const helper = {};
  const queue = [...replies];
  const waits = [];
  let calls = 0;
  vm.runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname, "../src/lib/retry-fetch.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports: helper, Promise, Number, Math,
    setTimeout: (callback, ms) => { waits.push(ms); return setTimeout(callback, 0); },
    clearTimeout,
    fetch: async () => {
      calls++;
      const reply = queue.shift();
      if (!reply) throw new Error("Unexpected extra request");
      return { status: reply.status, ok: reply.status < 300, headers: { get: (name) => (name === "Retry-After" && reply.retryAfter ? String(reply.retryAfter) : null) }, body: { cancel: async () => {} } };
    },
  });
  return { fetchWithRetry: helper.fetchWithRetry, calls: () => calls, waits };
}
const options = { attempts: 3, maxWaitSeconds: 8 };

test("an overloaded answer is retried after its Retry-After until one succeeds", async () => {
  const retried = [];
  const client = load([{ status: 503, retryAfter: 5 }, { status: 503, retryAfter: 5 }, { status: 200 }]);
  const response = await client.fetchWithRetry("/x", { method: "POST", body: "{}" }, { ...options, onRetry: (next, seconds) => retried.push([next, seconds]) });
  assert.equal(response.status, 200);
  assert.equal(client.calls(), 3);
  assert.deepEqual(client.waits, [5000, 5000]);
  assert.deepEqual(retried.map((pair) => [...pair]), [[2, 5], [3, 5]]);
});

test("it stops after the allowed attempts and returns the last answer", async () => {
  const client = load([{ status: 503, retryAfter: 5 }, { status: 503, retryAfter: 5 }, { status: 503, retryAfter: 5 }]);
  assert.equal((await client.fetchWithRetry("/x", {}, options)).status, 503);
  assert.equal(client.calls(), 3);
});

test("waits are capped, and answers without Retry-After are not retried", async () => {
  const limited = load([{ status: 429, retryAfter: 15 }, { status: 200 }]);
  await limited.fetchWithRetry("/x", {}, options);
  assert.deepEqual(limited.waits, [8000]);

  const rejected = load([{ status: 502 }]);
  assert.equal((await rejected.fetchWithRetry("/x", {}, options)).status, 502);
  assert.equal(rejected.calls(), 1);
});

test("cancelling while it waits to retry stops it", async () => {
  const client = load([{ status: 503, retryAfter: 5 }, { status: 200 }]);
  const controller = new AbortController();
  const pending = client.fetchWithRetry("/x", { signal: controller.signal }, { ...options, onRetry: () => controller.abort() });
  await assert.rejects(pending);
  assert.equal(client.calls(), 1);
});
