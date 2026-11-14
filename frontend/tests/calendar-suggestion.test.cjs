/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const rules = import(pathToFileURL(resolve(__dirname, '../src/lib/calendar-suggestion.ts')).href);
const times = import(pathToFileURL(resolve(__dirname, '../src/lib/calendar-time.ts')).href);
const now = new Date('2026-11-14T00:00:00Z');
const sent = '2026-11-14T10:00:00+09:00';
const evidence = 'Your appointment is confirmed for November 20, 2026 at 2 PM KST.';
const candidate = { title: 'Appointment', kind: 'appointment', date: '2026-11-20', dateEvidence: 'November 20, 2026', startTime: '14:00', endTime: null, timeZone: 'Asia/Seoul', location: '', evidence, reason: 'Confirmed appointment', confirmed: true, personallyRelevant: true, status: 'confirmed', relevance: 'required' };

test('extracts a grounded appointment without inventing an end time', async () => {
  const { validateSuggestions } = await rules;
  const result = validateSuggestions({ candidates: [candidate] }, evidence, sent, now);
  assert.equal(result.length, 1); assert.equal(result[0].startTime, '14:00'); assert.equal(result[0].endTime, null); assert.equal(result[0].timeZone, 'Asia/Seoul');
});

for (const [name, change, source] of [
  ['invented quote', { evidence: 'A fabricated appointment on November 20, 2026.' }, evidence],
  ['incorrect date', { date: '2026-11-21' }, evidence],
  ['invalid date', { date: '2026-02-30', dateEvidence: 'February 30, 2026', evidence: 'Confirmed appointment on February 30, 2026.' }, 'Confirmed appointment on February 30, 2026.'],
  ['tentative plan', { confirmed: false }, evidence],
  ['irrelevant event', { personallyRelevant: false }, evidence],
  ['cancelled commitment', { status: 'cancelled' }, `${evidence} The appointment was cancelled.`],
  ['optional promotion', { relevance: 'optional' }, `${evidence} Flash sale!`],
  ['ambiguous numeric date', { date: '2026-03-04', dateEvidence: '03/04/2026', evidence: 'Confirmed appointment on 03/04/2026.' }, 'Confirmed appointment on 03/04/2026.'],
  ['relative date normalized to the wrong day', { dateEvidence: 'tomorrow', evidence: 'Confirmed appointment tomorrow at 2 PM.' }, 'Confirmed appointment tomorrow at 2 PM.'],
]) test(`withholds ${name}`, async () => {
  const { validateSuggestions } = await rules;
  assert.equal(validateSuggestions({ candidates: [{ ...candidate, ...change }] }, source, sent, now).length, 0);
});

test('does not prefill unsupported times, zones, or locations', async () => {
  const { validateSuggestions } = await rules;
  const result = validateSuggestions({ candidates: [{ ...candidate, startTime: '15:00', endTime: '16:00', timeZone: 'America/New_York', location: 'Invented room' }] }, evidence, sent, now)[0];
  assert.equal(result.startTime, null); assert.equal(result.endTime, null); assert.equal(result.timeZone, null); assert.equal(result.location, '');
});

test('removes quoted reply history and ignores past events', async () => {
  const { latestEmailText, validateSuggestions } = await rules;
  assert.equal(latestEmailText('Thanks!\nOn Friday, Alex wrote:\n' + evidence), 'Thanks!');
  assert.equal(validateSuggestions({ candidates: [candidate] }, evidence, sent, new Date('2027-01-01')).length, 0);
});

test('resolves explicit time zones and rejects DST gaps and ambiguous times', async () => {
  const { calendarInstant } = await times;
  assert.equal(calendarInstant('2026-11-20T14:00', 'Asia/Seoul'), '2026-11-20T05:00:00.000Z');
  assert.throws(() => calendarInstant('2026-03-08T02:30', 'America/New_York'), /does not exist/);
  assert.throws(() => calendarInstant('2026-11-01T01:30', 'America/New_York'), /ambiguous/);
});

for (const [phrase, expected] of [
 ['2026.11.20(금)', '2026-11-20'], ['2026/11/20', '2026-11-20'],
 ['2026년 11월 20일', '2026-11-20'], ['11월 20일', '2026-11-20'],
 ['20 November 2026', '2026-11-20'], ['November 20, 2026', '2026-11-20'],
 ['20/11/2026', '2026-11-20'], ['11/20/2026', '2026-11-20'],
 ['내일', '2026-11-15'], ['tomorrow', '2026-11-15'], ['in 3 days', '2026-11-17'],
 ['03/04/2026', null], ['2026.02.30', null], ['next Friday', null],
]) test(`date grounding: ${phrase}`, async () => {
  const { resolveEmailDate } = await rules;
  assert.equal(resolveEmailDate(phrase, sent, 'Asia/Seoul').date, expected);
});
for (const [phrase, expected] of [
 ['오전 8시50분', '08:50'], ['오후 2시 반', '14:30'], ['오후 12시', '12:00'],
 ['오전 12시', '00:00'], ['2:30 PM', '14:30'], ['14:30', '14:30'],
]) test(`time grounding: ${phrase}`, async () => {
  const { supportedEmailTime } = await rules;
  assert.equal(supportedEmailTime(expected, phrase), true);
});
test('independent evidence for date, start, arrival and documents survives promotional/cancellation boilerplate', async () => {
 const { validateSuggestions } = await rules;
 const source = 'Your mandatory safety assessment is confirmed. Date: 2026.11.20. Start: 오전 8시50분. Check in by 8:40. Bring photo ID. Cancellation policy: fees apply. Newsletter preferences below.';
 const result = validateSuggestions({ candidates: [{ ...candidate, dateEvidence: '2026.11.20', evidence: 'Your mandatory safety assessment is confirmed.', startTime: '08:50', timeEvidence: '오전 8시50분', timeZone: null, notes: [{ text: 'Arrive by 8:40', evidence: 'Check in by 8:40.' }, { text: 'Bring photo ID', evidence: 'Bring photo ID.' }] }] }, source, sent, now);
 assert.equal(result.length, 1); assert.equal(result[0].startTime, '08:50'); assert.equal(result[0].notes.length, 2);
});
test('relative dates use message date in the reference zone, not analysis date', async () => {
 const { resolveEmailDate } = await rules;
 assert.equal(resolveEmailDate('tomorrow', '2026-11-14T23:30:00Z', 'Asia/Seoul').date, '2026-11-16');
 assert.equal(resolveEmailDate('January 3', '2026-12-30T09:00:00Z', 'UTC').date, '2027-01-03');
});
