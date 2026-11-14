/* eslint-disable @typescript-eslint/no-require-imports -- Runs the real TypeScript analysis code in a CommonJS evaluation harness. */
// Synthetic, anonymized evaluation only. No Gmail or Calendar API calls.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(name) {
 const filename = path.resolve(__dirname, '../src/lib', name + '.ts');
 const exported = {};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exported, require: (id) => id.startsWith('./') ? load(id.slice(2)) : require(id), process, fetch, AbortSignal, console });
 return exported;
}
const { generateText } = load('gemini');
const { analysisSchema, analysisPrompt, validateMailAnalysis } = load('mail-analysis');
const fixtures = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../tests/fixtures/mail-analysis.json'), 'utf8'));
async function main() {
 let passed = 0;
 const selected = process.argv.slice(2);
 for (const fixture of fixtures.filter((item) => !selected.length || selected.includes(item.name))) {
  const context = { sentAt: '2026-11-12T08:00:00Z', now: '2026-11-14T00:00:00Z', timeZone: 'Asia/Seoul', recipient: 'person@example.com', from: 'notifications@example.org', to: 'person@example.com', cc: '', automated: true };
  try {
   const text = await generateText(analysisPrompt(fixture.source, context), { temperature: 0, maxOutputTokens: 6500, responseJsonSchema: analysisSchema, signal: AbortSignal.timeout(45000) });
   const raw = JSON.parse(text);
   const result = validateMailAnalysis(raw, fixture.source, context);
   const expected = fixture.expected;
   const failures = [];
   if (expected.importance && result.importance !== expected.importance) failures.push('importance');
   if (expected.relevance && result.relevance !== expected.relevance) failures.push('relevance');
   if (expected.relevanceOneOf && !expected.relevanceOneOf.includes(result.relevance)) failures.push('relevance');
   if (expected.events !== undefined && result.candidates.length !== expected.events) failures.push('event count');
   if (expected.eventsMin !== undefined && result.candidates.length < expected.eventsMin) failures.push('event count');
   if (expected.date && result.candidates[0]?.date !== expected.date) failures.push('event date');
   if (expected.time && result.candidates[0]?.startTime !== expected.time) failures.push('start time');
   if (expected.notUrgent && result.priority === 'urgent') failures.push('urgency');
   for (const kind of expected.kinds) if (!result.keyPoints.some((point) => point.kind === kind)) failures.push('missing '+kind);
   if (!failures.length) passed++;
   console.log(`${failures.length ? 'FAIL' : 'PASS'} ${fixture.name}: ${result.importance}, ${result.candidates.length} events, ${result.keyPoints.length} key points${failures.length ? '; '+failures.join(', ') : ''}`);
   if (failures.length) { process.exitCode = 1; if (process.env.EVAL_DEBUG === "1") console.log(JSON.stringify(raw.keyPoints)); }
  } catch (error) { console.log(`ERROR ${fixture.name}: ${error.code ?? error.name} ${error.message}`); process.exitCode = 1; }
 }
 console.log('Passed synthetic fixtures: '+passed);
}
main().catch(() => { process.exitCode = 1; });
