/* eslint-disable @typescript-eslint/no-require-imports -- The CommonJS test harness runs the transpiled Gemini client with a fake fetch. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Each fake reply is { status, body }; the client sees them in order.
function loadGemini(replies) {
  const source = readFileSync(resolve(__dirname, "../src/lib/gemini.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const queue = [...replies];
  let calls = 0;
  vm.runInNewContext(compiled, {
    exports, Error, Set, Promise, JSON, AbortSignal,
    process: { env: { GEMINI_API_KEY: "test-key" } },
    setTimeout: (callback) => setTimeout(callback, 0), // No real 1.5 s wait in tests.
    clearTimeout,
    fetch: async (url, init) => {
      calls++;
      const reply = queue.shift();
      if (!reply) throw new Error("Unexpected extra Gemini request");
      // "hang": Gemini holds the request until the caller gives up, as it does when overloaded.
      if (reply === "hang") return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, json: async () => reply.body };
    },
  });
  return { ...exports, calls: () => calls };
}
const answer = (text, finishReason = "STOP") => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] }, finishReason }] } });

test("an overloaded Gemini (5xx) is retried once and the second answer is used", async () => {
  const gemini = loadGemini([{ status: 503, body: { error: { message: "The model is overloaded." } } }, answer("hello")]);
  assert.equal(await gemini.generateText("prompt"), "hello");
  assert.equal(gemini.calls(), 2);
});

test("an empty answer is retried once, but a refusal is not", async () => {
  const empty = loadGemini([answer("", "MAX_TOKENS"), answer("second try")]);
  assert.equal(await empty.generateText("prompt"), "second try");
  assert.equal(empty.calls(), 2);

  const refused = loadGemini([answer("", "SAFETY")]);
  await assert.rejects(refused.generateText("prompt"), (error) => error.code === "empty_response" && error.retryable === false && /SAFETY/.test(error.message));
  assert.equal(refused.calls(), 1);
});

test("a failure that persists surfaces as retryable after exactly one retry", async () => {
  const gemini = loadGemini([{ status: 500, body: {} }, { status: 503, body: {} }]);
  await assert.rejects(gemini.generateText("prompt"), (error) => error.code === "request_failed" && error.status === 503 && error.retryable === true);
  assert.equal(gemini.calls(), 2);
});

test("rate limits and rejected requests are not retried here", async () => {
  const limited = loadGemini([{ status: 429, body: {} }]);
  await assert.rejects(limited.generateText("prompt"), (error) => error.code === "rate_limited");
  assert.equal(limited.calls(), 1);

  const rejected = loadGemini([{ status: 400, body: { error: { message: "Invalid schema" } } }]);
  await assert.rejects(rejected.generateText("prompt"), (error) => error.code === "request_failed" && error.retryable === false);
  assert.equal(rejected.calls(), 1);
});

test("a request already cancelled by its caller is not retried", async () => {
  const gemini = loadGemini([{ status: 503, body: {} }]);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(gemini.generateText("prompt", { signal: controller.signal }), (error) => error.retryable === true);
  assert.equal(gemini.calls(), 1);
});

test("an attempt Gemini holds too long is cut off and retried", async () => {
  const gemini = loadGemini(["hang", answer("after retry")]);
  assert.equal(await gemini.generateText("prompt", { attemptTimeoutMs: 30, signal: AbortSignal.timeout(5000) }), "after retry");
  assert.equal(gemini.calls(), 2);
});

test("running out of the overall time ends as a temporary failure the browser can retry", async () => {
  const gemini = loadGemini(["hang", "hang"]);
  await assert.rejects(gemini.generateText("prompt", { attemptTimeoutMs: 30, signal: AbortSignal.timeout(5000) }),
    (error) => error.name === "GeminiError" && error.code === "request_failed" && error.status === 504 && error.retryable === true);
  assert.equal(gemini.calls(), 2);

  const once = loadGemini(["hang"]);
  await assert.rejects(once.generateText("prompt", { signal: AbortSignal.timeout(40) }), (error) => error.retryable === true && error.status === 504);
  assert.equal(once.calls(), 1);
});
