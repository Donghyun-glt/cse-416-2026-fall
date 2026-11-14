/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { NextRequest } = require('next/server');
function load(file, imports) {
 const exported = {};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exported, require: (name) => imports[name] ?? require(name), console, AbortSignal });
 return exported;
}
function handler({ signedOut = false, superseded = false } = {}) {
 let generations = 0, saved;
 const source = 'Your account is locked. Reset your access now.';
 const raw = { relevance: 'recipient_action', stakes: 'high', reason: 'Access is blocked and requires action.', reasonEvidence: 'Your account is locked.', activeBlocker: true, blockerEvidence: 'Your account is locked.', keyPoints: [{ kind: 'action', text: 'Reset your access now.', evidence: 'Reset your access now.', owner: 'recipient', importance: 'critical', date: null, dateEvidence: '' }], candidates: [] };
 const analysis = load('lib/mail-analysis.ts', { './calendar-suggestion': require('../src/lib/calendar-suggestion.ts') });
 const route = load('app/api/gmail/messages/[id]/calendar-suggestions/route.ts', {
  '@/lib/google': { createGoogleOAuthClient: () => ({ setCredentials() {} }) },
  '@/lib/gmail-session': { getGmailSessionWithUser: async () => signedOut ? undefined : { tokens: {}, userId: 1 }, attachGmailSessionToUser: async () => {} },
  googleapis: { google: { gmail: () => ({ users: { messages: { get: async () => ({ data: { id: 'm1', threadId: 't1', labelIds: ['INBOX'] } }) }, threads: { get: async () => ({ data: { messages: [{ id: superseded ? 'm2' : 'm1', internalDate: '2' }] } }) }, getProfile: async () => ({ data: { emailAddress: 'me@example.com' } }) } }), calendar: () => { throw new Error('Analysis must never write to Calendar'); } } },
  '@/lib/gmail-message': { parseGmailMessage: () => ({ subject: 'Notice', html: source, unsubscribeUrl: 'https://example.com/unsubscribe', date: '2026-11-14T00:00:00Z', from: 'noreply@example.com', to: 'me@example.com', cc: '' }) },
  '@/lib/reply-draft': { emailBodyToText: (body) => body },
  '@/lib/gemini': { generateText: async () => { generations++; return JSON.stringify(raw); }, GeminiError: class extends Error {}, geminiModel: () => 'test' },
  '@/lib/mail-analysis': analysis,
  '@/lib/mailflow-db': { upsertUser: async () => 1, recordPriority: async (input) => { saved = input; return 'low'; } },
 });
 return { ...route, generations: () => generations, saved: () => saved };
}
const request = () => new NextRequest('https://mailflow.test/api/gmail/messages/m1/calendar-suggestions', { method: 'POST', headers: { cookie: 'gmail_session=session', 'Content-Type': 'application/json' }, body: JSON.stringify({ timeZone: 'Asia/Seoul' }) });
test('bulk/automated email gets full content analysis, cached per user, without overwriting manual UI priority', async () => {
 const route = handler();
 const response = await route.POST(request(), { params: Promise.resolve({ id: 'm1' }) });
 const data = await response.json();
 assert.equal(response.status, 200); assert.equal(data.analysis.importance, 'high'); assert.equal(data.analysis.priority, 'urgent'); assert.equal(data.priority, 'low'); assert.equal(data.analysis.keyPoints.length, 1);
 assert.equal(route.saved().source, 'automatic'); assert.doesNotMatch(route.saved().reason, /account is locked/);
 await route.POST(request(), { params: Promise.resolve({ id: 'm1' }) });
 assert.equal(route.generations(), 1);
});
test('a superseded message retains important content and warns about newer context', async () => {
 const route = handler({ superseded: true });
 const data = await (await route.POST(request(), { params: Promise.resolve({ id: 'm1' }) })).json();
 assert.equal(data.analysis.keyPoints.length, 1); assert.match(data.analysis.reviewNotes[0], /newer/);
});
test('analysis requires a valid session and performs no work while signed out', async () => {
 const route = handler({ signedOut: true });
 assert.equal((await route.POST(request(), { params: Promise.resolve({ id: 'm1' }) })).status, 401);
 assert.equal(route.generations(), 0);
});
