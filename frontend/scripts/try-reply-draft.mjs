// Batch-tests AI reply drafting against sample emails without the UI.
//
//   node scripts/try-reply-draft.mjs                      # every fixture, default tone/length
//   node scripts/try-reply-draft.mjs --all                # every fixture x every tone x every length
//   node scripts/try-reply-draft.mjs --id korean-formal   # one fixture
//   node scripts/try-reply-draft.mjs --tone friendly --length short
//   node scripts/try-reply-draft.mjs --prompt             # also print the prompt sent to Gemini
//
// Reads GEMINI_API_KEY (and optional GEMINI_MODEL) from frontend/.env.local.
// Results are also written to tmp/reply-drafts-<timestamp>.md for side-by-side review.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
  if (match) process.env[match[1]] ??= match[2];
}

const { generateText, geminiModel } = await import(pathToFileURL(resolve(root, "src/lib/gemini.ts")).href);
const { buildReplyPrompt, cleanDraft, displayNameFor, REPLY_TONES, REPLY_LENGTHS } = await import(pathToFileURL(resolve(root, "src/lib/reply-draft.ts")).href);

const args = process.argv.slice(2);
const flag = (name) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; };
const all = args.includes("--all");
const showPrompt = args.includes("--prompt");
const onlyId = flag("id");
const tones = all ? REPLY_TONES : [flag("tone") ?? "professional"];
const lengths = all ? REPLY_LENGTHS : [flag("length") ?? "medium"];

const fixtures = JSON.parse(readFileSync(resolve(root, "tests/fixtures/reply-emails.json"), "utf8"))
  .filter((fixture) => !onlyId || fixture.id === onlyId);
if (fixtures.length === 0) { console.error(`No fixture with id "${onlyId}"`); process.exit(1); }

const report = [`# Reply drafts — ${geminiModel()} — ${new Date().toISOString()}`, ""];
let ok = 0, failed = 0;
const started = Date.now();

for (const fixture of fixtures) {
  const me = fixture.to.match(/<([^>]+)>/)?.[1] ?? fixture.to.split(",")[0].trim();
  const context = { subject: fixture.subject, from: fixture.from, to: fixture.to, date: fixture.date, body: fixture.body, me, meName: displayNameFor(fixture.to, me) };
  for (const tone of tones) {
    for (const length of lengths) {
      const options = { tone, length, instructions: fixture.instructions || undefined };
      const prompt = buildReplyPrompt(context, options);
      const label = `${fixture.id} · ${tone}/${length}${options.instructions ? ` · "${options.instructions}"` : ""}`;
      process.stdout.write(`\n\x1b[1m=== ${label}\x1b[0m\n`);
      if (showPrompt) console.log(`\x1b[2m${prompt}\x1b[0m\n---`);
      const t0 = Date.now();
      try {
        const draft = cleanDraft(await generateText(prompt));
        const ms = Date.now() - t0;
        ok += 1;
        console.log(draft);
        console.log(`\x1b[2m(${ms} ms, ${draft.split(/\s+/).length} words)\x1b[0m`);
        report.push(`## ${label}`, "", `_${ms} ms_`, "", "```", draft, "```", "");
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.log(`\x1b[31mFAILED: ${message}\x1b[0m`);
        report.push(`## ${label}`, "", `**FAILED:** ${message}`, "");
        if (/rate limit/i.test(message)) { console.log("Waiting 20s for the free-tier rate limit…"); await new Promise((r) => setTimeout(r, 20_000)); }
      }
      // Free tier is ~15 requests/minute on flash-lite; a small pause keeps batch runs under it.
      await new Promise((r) => setTimeout(r, 4_500));
    }
  }
}

mkdirSync(resolve(root, "tmp"), { recursive: true });
const out = resolve(root, "tmp", `reply-drafts-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
writeFileSync(out, report.join("\n"));
console.log(`\n${ok} ok, ${failed} failed in ${Math.round((Date.now() - started) / 1000)}s → ${out}`);
