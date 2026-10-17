/* eslint-disable @typescript-eslint/no-require-imports -- Node's CommonJS test runner loads TypeScript through dynamic import. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");

const modulePromise = import(pathToFileURL(resolve(__dirname, "../src/lib/mail-priority.ts")).href);

function message(subject, snippet = "", from = "person@example.com") {
  return { snippet, payload: { headers: [{ name: "Subject", value: subject }, { name: "From", value: from }] } };
}

test("urgent requires a real blocker or direct time-sensitive request", async () => {
  const { classifyPriority } = await modulePromise;
  assert.equal(classifyPriority(message("Please approve the contract before 2pm")), "urgent");
  assert.equal(classifyPriority(message("Need your sign-off before 2pm today")), "urgent");
  assert.equal(classifyPriority(message("Production outage on checkout flow")), "urgent");
  assert.equal(classifyPriority(message("URGENT SALE: shop today", "Unsubscribe", "deals@marketing.example")), "low");
});

test("routine notifications are low priority and ambiguous mail defaults to FYI", async () => {
  const { classifyPriority } = await modulePromise;
  assert.equal(classifyPriority(message("Your recording is ready", "View it any time", "notifications@zoom.example")), "low");
  assert.equal(classifyPriority(message("Notes from yesterday's design review")), "fyi");
});

test("sorts by priority and then newest first", async () => {
  const { comparePriority } = await modulePromise;
  const items = [
    { priority: "low", date: "2026-10-17T12:00:00Z" },
    { priority: "urgent", date: "2026-10-16T12:00:00Z" },
    { priority: "fyi", date: "2026-10-17T12:00:00Z" },
    { priority: "urgent", date: "2026-10-17T12:00:00Z" },
  ];
  assert.deepEqual(items.sort(comparePriority).map((item) => item.priority), ["urgent", "urgent", "fyi", "low"]);
  assert.equal(items[0].date, "2026-10-17T12:00:00Z");
});
