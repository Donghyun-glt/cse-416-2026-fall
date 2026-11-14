/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname, '../src/lib/mail-analysis.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsObject, require: (name) => name === './calendar-suggestion' ? require('../src/lib/calendar-suggestion.ts') : require(name) });
const { validateMailAnalysis } = exportsObject;
const context = { sentAt: '2026-11-12T08:00:00Z', now: '2026-11-14T00:00:00Z', timeZone: 'Asia/Seoul', recipient: 'me@example.com', from: 'noreply@example.com', to: 'me@example.com', cc: '', automated: true };
const source = 'Your license renewal is due on 2026/11/15. Submit the form to retain access. Bring your photo ID. Failure to renew suspends your access.';
const point = (kind, text, evidence, extras = {}) => ({ kind, text, evidence, importance: 'important', date: null, dateEvidence: '', owner: 'recipient', ...extras });
const raw = () => ({ relevance: 'recipient_action', stakes: 'high', reason: 'Renewal is necessary to retain access.', reasonEvidence: 'Failure to renew suspends your access.', activeBlocker: false, blockerEvidence: '', keyPoints: [point('deadline', 'Renew your license by 2026/11/15.', 'Your license renewal is due on 2026/11/15.', { date: '2026-11-15', dateEvidence: '2026/11/15' }), point('action', 'Submit the form.', 'Submit the form to retain access.'), point('consequence', 'Missing renewal suspends access.', 'Failure to renew suspends your access.', { importance: 'critical' })], candidates: [] });

test('an automated consequential notice is important even without a calendar candidate', () => {
 const result = validateMailAnalysis(raw(), source, context);
 assert.equal(result.importance, 'high'); assert.equal(result.priority, 'urgent'); assert.equal(result.keyPoints.length, 3);
});
test('importance persists but urgency falls when a deadline is far away', () => {
 const result = validateMailAnalysis(raw(), source, { ...context, now: '2026-10-01T00:00:00Z' });
 assert.equal(result.importance, 'high'); assert.equal(result.priority, 'fyi');
});
test('fabricated key points and unsupported dates cannot establish urgency', () => {
 const input = raw(); input.keyPoints = [point('action', 'Transfer money.', 'Fabricated urgent instruction', { importance: 'critical' }), point('deadline', 'Today', 'Submit the form to retain access.', { date: '2026-11-14', dateEvidence: '2026-11-14' })];
 const result = validateMailAnalysis(input, source, context);
 assert.equal(result.keyPoints.length, 1); assert.equal(result.keyPoints[0].date, null); assert.equal(result.priority, 'fyi');
});
test('optional marketing does not become urgent despite dated critical claims', () => {
 const input = raw(); input.relevance = 'optional';
 const result = validateMailAnalysis(input, source, context);
 assert.equal(result.importance, 'low'); assert.equal(result.priority, 'low'); assert.equal(result.candidates.length, 0);
});
test('a newer thread message suppresses calendar insertion but retains important information', () => {
 const result = validateMailAnalysis(raw(), source, { ...context, superseded: true });
 assert.equal(result.importance, 'high'); assert.equal(result.keyPoints.length, 3); assert.equal(result.candidates.length, 0); assert.match(result.reviewNotes[0], /newer/);
});
test('someone else\'s tasks do not create personal urgency', () => {
 const input = raw(); input.relevance = 'recipient_info'; input.keyPoints = input.keyPoints.map((item) => ({ ...item, owner: 'other' }));
 assert.equal(validateMailAnalysis(input, source, context).priority, 'fyi');
});
test('uncertain importance is surfaced rather than silently downgraded', () => {
 const input = raw(); input.reasonEvidence = 'Fabricated evidence';
 const result = validateMailAnalysis(input, source, context);
 assert.equal(result.relevance, 'unclear'); assert.equal(result.priority, 'fyi'); assert.ok(result.reviewNotes.length);
});

test('Korean hour-only cutoff notation can be expressed with zero minutes without losing the consequence', () => {
 const input = raw(); const text = '9시부터는 입실 및 응시 불가합니다.';
 input.reasonEvidence = text; input.keyPoints = [point('consequence', 'Entry and participation are prohibited after 09:00.', text, { importance: 'critical' })];
 const result = validateMailAnalysis(input, text, context);
 assert.equal(result.keyPoints.length, 1);
});
test('an invented numeric requirement is not shown as a verified key point', () => {
 const input = raw(); input.keyPoints = [point('preparation', 'Bring 3 photo IDs.', 'Bring your photo ID.')];
 assert.equal(validateMailAnalysis(input, source, context).keyPoints.length, 0);
});
