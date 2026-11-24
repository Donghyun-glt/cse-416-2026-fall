/* eslint-disable @typescript-eslint/no-require-imports -- Runs the real TypeScript Summary code in a CommonJS evaluation harness. */
// Summary tab: tries the real prompts against the AI provider with made-up emails.
// Synthetic data only; no Gmail, Calendar or database access. Run from frontend/:
//   node --env-file=.env.local scripts/evaluate-summary.cjs            every email, with and without a profile, then the answer cases
//   node --env-file=.env.local scripts/evaluate-summary.cjs tsm-only   chosen emails only ("feedback" = only the "Is this for you?" answer cases)
// Prints what the model reported for each email and what the app would then do with it.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const ts = require(path.join(root, 'node_modules/typescript'));
function load(name) {
  const exported = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: exported, require: (id) => id.startsWith('./') ? load(id.slice(2)) : require(id), process, fetch, AbortSignal, console, Intl, URL });
  return exported;
}
const { generateText } = load('gemini');
const { analysisSchema, analysisPrompt, validateMailAnalysis } = load('mail-analysis');
const { decideTodo, profileForPrompt, feedbackPrompt, feedbackSchema, decideFeedback } = load('summary-todo');
const about = { role: 'CS undergraduate', organization: 'SUNY Korea', interests: 'research, internships', notes: '' };
const mails = [
  ['makeup-class', 'Francois Rameau <prof@example.edu>', false, '[CSE 527] Make-Up Class and Updated Presentation Schedule\n\nDear CSE 527 students,\n\nWe will have a make-up class on Monday, December 7, 2026 from 3:30 to 5:00 p.m. in Room B104. Attendance is expected. The project presentation schedule has also been updated on Brightspace.\n\nBest,\nFrancois'],
  ['party', 'Student Services <ss@example.edu>', true, '[SUNY Korea] Invitation to the 2026 Year-End Party\n\nDear SUNY Korea students,\n\nYou are all invited to the 2026 Year-End Party on Friday, December 11, 2026 at 5 PM in the Multi-Complex Building. Food and prizes! If you would like to join, please fill out the RSVP form.\n\nStudent Services'],
  ['tsm-only', 'TSM Department <tsm@example.edu>', true, '[TSM] Internship report submission\n\nThis notice is for TSM majors only. Submit the internship report form by December 4, 2026 on Brightspace. Late reports are not accepted.\n\nTSM Department'],
  ['cs-club', 'LAMBDA <lambda@example.edu>', true, '[LAMBDA] Algorithmic Trading Program for CS students\n\nHi CS undergraduates! LAMBDA is hosting a beginner-friendly Algorithmic Trading Program for Computer Science students. The next weekly session is on Saturday, November 28, 2026. Sign up if you are interested.\n\nLAMBDA at SUNY Korea'],
  ['prof-question', 'Seoyeon Jo <seoyeon@example.edu>', false, 'Group5 Progress Report\n\nHi Donghyun,\n\nI started the Group5 progress report doc. Could you tell me which section you want to write? No rush.\n\nSeoyeon'],
  ['newsletter-date', 'Library <lib@example.edu>', true, 'Library newsletter\n\nThe library will show a photo exhibition from December 1, 2026 to December 20, 2026 in the lobby. Opening hours are unchanged.\n\nLibrary'],
  ['course-eval', 'Academic Team <acad@example.edu>', true, '[SUNY Korea] Fall 2026 Course Evaluation (Deadline: December 18, 2PM)\n\nDear students,\n\nThe Fall 2026 course evaluation is open. All students are required to complete their evaluations by December 18, 2026, 2PM using the link in Brightspace.\n\nSK-SBU Academic Team'],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const which = process.argv.slice(2);
  for (const [name, from, automated, source] of mails.filter((m) => !which.length || which.includes(m[0]))) {
    for (const [label, profile] of [['with profile', about], ['no profile', null]]) {
      const context = { recipientProfile: profileForPrompt(profile), sentAt: '2026-11-23T03:00:00Z', now: '2026-11-24T02:00:00Z', timeZone: 'Asia/Seoul', recipient: 'donghyun@example.edu', from, to: 'donghyun@example.edu', cc: '', automated };
      try {
        const raw = JSON.parse(await generateText(analysisPrompt(source, context), { temperature: 0, maxOutputTokens: 6500, responseJsonSchema: analysisSchema, signal: AbortSignal.timeout(45000) }));
        const analysis = validateMailAnalysis(raw, source, context);
        const t = raw.todo;
        const decision = decideTodo(t, { source, sentAt: context.sentAt, now: new Date(context.now), timeZone: 'Asia/Seoul', automated, about: profile, answers: [], events: analysis.candidates });
        console.log(`${name} [${label}] ask=${t.ask} scope=${t.audienceScope} fit=${t.audienceFit} aud="${t.audience}" kind="${t.mailKind}" due=${t.dueDate} reply=${t.needsReply} interest=${t.interestMatch} events=${analysis.candidates.length}\n   -> ${decision ? JSON.stringify(decision) : 'NOT LISTED'}`);
      } catch (e) { console.log(`${name} [${label}] ERROR ${e.code ?? e.name} ${String(e.message).slice(0, 300)}`); }
      await sleep(4500);
    }
  }
  if (which.length && !which.includes('feedback')) return;
  const cases = [
    ['CS says NO to TSM-only mail', 'no', { audience: 'TSM majors', kind: 'TSM Department internship notice' }, about],
    ['CS says YES to TSM-only mail', 'yes', { audience: 'TSM majors', kind: 'TSM Department internship notice' }, about],
    ['CS says NO to CS club weekly session', 'no', { audience: 'CS undergraduates', kind: 'LAMBDA club weekly programme announcement' }, about],
    ['CS says YES to CS club weekly session', 'yes', { audience: 'CS undergraduates', kind: 'LAMBDA club weekly programme announcement' }, about],
    ['no profile, NO to TSM-only mail', 'no', { audience: 'TSM majors', kind: 'TSM Department internship notice' }, null],
    ['no profile, YES to TSM-only mail', 'yes', { audience: 'TSM majors', kind: 'TSM Department internship notice' }, null],
    ['CS says NO to one-off party for CS students', 'no', { audience: 'CS undergraduates', kind: 'CS department year-end party invitation' }, about],
  ];
  for (const [label, answer, triage, profile] of cases) {
    const input = { answer, triage, about: profile, answers: [] };
    try {
      const raw = JSON.parse(await generateText(feedbackPrompt(input), { temperature: 0, maxOutputTokens: 400, responseJsonSchema: feedbackSchema, signal: AbortSignal.timeout(20000) }));
      console.log(`${label}: ${JSON.stringify(raw)}\n   -> ${JSON.stringify(decideFeedback(raw, input))}`);
    } catch (e) { console.log(`${label} ERROR ${e.code ?? e.name} ${String(e.message).slice(0, 300)}`); }
    await sleep(4500);
  }
})();
