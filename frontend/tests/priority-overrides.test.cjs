/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function storage(initial) {
 let current = initial;
 let history = 0;
 const exported = {};
 const client = { query: async (sql, values) => {
  if (/SELECT priority, source/.test(sql)) return { rows: current ? [current] : [] };
  if (/INSERT INTO message_priorities/.test(sql)) current = { priority: values[2], source: values[3] };
  if (/INSERT INTO priority_events/.test(sql)) history++;
  return { rows: [] };
 } };
 const source = fs.readFileSync(path.resolve(__dirname, '../src/lib/mailflow-db.ts'), 'utf8');
 vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exported, require: () => ({ withTransaction: async (work) => work(client) }) });
 return { record: exported.recordPriority, current: () => current, history: () => history };
}
test('late AI analysis cannot overwrite a manually chosen priority', async () => {
 const db = storage({ priority: 'low', source: 'manual' });
 assert.equal(await db.record({ userId: 1, gmailMessageId: 'm', priority: 'urgent', source: 'automatic', reason: 'AI' }), 'low');
 assert.equal(db.current().priority, 'low'); assert.equal(db.history(), 0);
});
test('choosing the existing label manually still protects future edits and preserves audit history', async () => {
 const db = storage({ priority: 'fyi', source: 'automatic' });
 await db.record({ userId: 1, gmailMessageId: 'm', priority: 'fyi', source: 'manual', reason: 'User' });
 assert.equal(db.current().source, 'manual'); assert.equal(db.history(), 1);
 assert.equal(await db.record({ userId: 1, gmailMessageId: 'm', priority: 'urgent', source: 'automatic', reason: 'AI' }), 'fyi');
});
