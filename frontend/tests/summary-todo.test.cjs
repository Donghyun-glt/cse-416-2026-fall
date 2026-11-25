/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS test harness loads transpiled TypeScript. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const text = (file) => readFileSync(resolve(__dirname, "../src", file), "utf8");
const exported = {};
vm.runInNewContext(ts.transpileModule(text("lib/summary-todo.ts"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText,
  { exports: exported, require: (name) => require(name === "./calendar-suggestion" ? "../src/lib/calendar-suggestion.ts" : name === "./user-about" ? "../src/lib/user-about.ts" : name) });
const { decideTodo, profileForPrompt, localDay, decideFeedback, feedbackPrompt, todoPrompt } = exported;
const sections = require("../src/lib/summary-sections.ts");

const source = "TSM Department\n\nThis notice is for TSM majors only. Submit the internship form by December 4, 2026. Can you confirm by reply?";
const base = { ask: "action", task: "Submit the internship form by December 4.", taskEvidence: "Submit the internship form by December 4, 2026.", dueDate: "2026-12-04", dueEvidence: "December 4, 2026",
  needsReply: false, replyEvidence: "", mailKind: "TSM Department internship notice", audience: "", audienceEvidence: "", audienceScope: "not_stated", audienceFit: "not_stated", profileEvidence: "",
  interestMatch: false, interestEvidence: "", pastAnswerId: "" };
const input = (extra = {}) => ({ source, sentAt: "2026-11-20T03:00:00Z", now: new Date("2026-11-21T00:00:00Z"), timeZone: "Asia/Seoul", events: [], ...extra });
const cs = { role: "CS undergraduate", organization: "SUNY Korea", interests: "", notes: "" };
const plain = (value) => JSON.parse(JSON.stringify(value));

test("step 1: a real task is listed with its checked date, however far away it is", () => {
  assert.deepEqual(plain(decideTodo(base, input())), { task: "Submit the internship form by December 4.", dueDate: "2026-12-04", dueIsEvent: false, reasons: ["task"], confirmAudience: false, triage: null });
});

test("step 1: nothing asked means not listed; invented tasks, quotes and numbers are not trusted", () => {
  assert.equal(decideTodo({ ...base, ask: "none" }, input()), null);
  assert.equal(decideTodo({ ...base, ask: "something else" }, input()), null);
  assert.equal(decideTodo({ ...base, taskEvidence: "Pay the fee today." }, input()), null);
  assert.equal(decideTodo({ ...base, task: "Submit 3 forms by December 4." }, input()), null);
  assert.equal(decideTodo(undefined, input()), null);
});

test("step 1: a date in the body or a suggested calendar event does not list an email by itself", () => {
  const events = [{ title: "Office hours", date: "2026-11-25" }];
  assert.equal(decideTodo({ ...base, ask: "none", task: "" }, input({ events })), null);
  // Something the reader is expected to attend is listed, on the day of the event.
  const attend = decideTodo({ ...base, ask: "attendance", task: "Attend office hours.", taskEvidence: "Submit the internship form", dueDate: null, dueEvidence: "" }, input({ events }));
  assert.deepEqual(plain(attend.reasons), ["task", "event"]); assert.equal(attend.dueDate, "2026-11-25");
  // That date is the event's day, not a deadline the email states, and is marked so.
  assert.equal(attend.dueIsEvent, true);
  // A deadline the email states wins over a suggested event and is not marked.
  const stated = decideTodo(base, input({ events }));
  assert.equal(stated.dueDate, "2026-12-04"); assert.equal(stated.dueIsEvent, false);
  // A stated deadline that has passed is not replaced by a later event.
  const passed = decideTodo({ ...base, needsReply: true, replyEvidence: "Can you confirm by reply?" }, input({ now: new Date("2026-12-10T00:00:00Z"), events: [{ title: "Office hours", date: "2026-12-20" }] }));
  assert.equal(passed.dueDate, null); assert.equal(passed.dueIsEvent, false);
});

test("step 2: the user's profile removes mail addressed to another group, and only then", () => {
  const forTsm = { ...base, audience: "TSM majors", audienceEvidence: "This notice is for TSM majors only.", audienceScope: "group", audienceFit: "does_not_apply", profileEvidence: "CS undergraduate" };
  assert.equal(decideTodo(forTsm, input({ about: cs })), null);
  // No profile to compare with: keep it and ask the user, remembering how the email described itself.
  const asked = decideTodo(forTsm, input());
  assert.equal(asked.confirmAudience, true); assert.deepEqual(plain(asked.triage), { audience: "TSM majors", kind: "TSM Department internship notice" });
  assert.equal(decideTodo(forTsm, input({ about: { ...cs, role: "", organization: "" } })).confirmAudience, true);
  // The audience claim must be quoted from the email.
  assert.equal(decideTodo({ ...forTsm, audienceEvidence: "For business students." }, input({ about: cs })).confirmAudience, true);
  // A stated interest keeps it.
  assert.ok(decideTodo({ ...forTsm, interestMatch: true }, input({ about: cs })));
  assert.equal(decideTodo({ ...base, audienceFit: "unclear" }, input({ about: cs })).confirmAudience, true);
});

test("step 2: the fact that rules a message out may be typed in any profile field, but must really be there", () => {
  const forTsm = { ...base, audience: "TSM majors", audienceEvidence: "This notice is for TSM majors only.", audienceScope: "group", audienceFit: "does_not_apply" };
  // Major written only in "Anything else", or tucked into Organization.
  assert.equal(decideTodo({ ...forTsm, profileEvidence: "CS major" }, input({ about: { role: "", organization: "", interests: "", notes: "I am a CS major and a club officer" } })), null);
  assert.equal(decideTodo({ ...forTsm, profileEvidence: "컴퓨터과학" }, input({ about: { role: "학부생", organization: "한국뉴욕주립대 컴퓨터과학", interests: "", notes: "" } })), null);
  // The model names nothing, or words the user never typed: keep the message and ask the user.
  assert.equal(decideTodo(forTsm, input({ about: cs })).confirmAudience, true);
  assert.equal(decideTodo({ ...forTsm, profileEvidence: "Biology major" }, input({ about: cs })).confirmAudience, true);
  // Caring about a topic is not membership of a group.
  assert.equal(decideTodo({ ...forTsm, profileEvidence: "internships" }, input({ about: { role: "", organization: "", interests: "internships", notes: "" } })).confirmAudience, true);
  assert.match(text("lib/summary-todo.ts"), /whichever field a fact was typed in/);
});

test("step 2: an offer the reader may take or leave is listed only when it is aimed at them", () => {
  const offer = { ...base, ask: "optional", task: "Join the internship info session by December 4.", audience: "all students", audienceEvidence: "Submit the internship form", audienceScope: "everyone", audienceFit: "applies", profileEvidence: "CS undergraduate" };
  // Open to everyone and not a topic they named: left out.
  assert.equal(decideTodo(offer, input({ about: cs })), null);
  assert.equal(decideTodo({ ...offer, interestMatch: true, interestEvidence: "internships" }, input({ about: cs })), null); // The profile never said so.
  // A topic they said they care about: listed without asking.
  assert.equal(decideTodo({ ...offer, interestMatch: true, interestEvidence: "internships" }, input({ about: { ...cs, interests: "internships, scholarships" } })).confirmAudience, false);
  // Sent to a group their profile puts them in: listed, and they are asked.
  const mine = decideTodo({ ...offer, audience: "CS undergraduates", audienceScope: "group" }, input({ about: cs }));
  assert.equal(mine.confirmAudience, true); assert.equal(mine.triage.audience, "CS undergraduates");
  assert.equal(decideTodo({ ...offer, audienceScope: "group", audienceFit: "unclear", profileEvidence: "" }, input({ about: cs })), null);
  // Written to them personally by a person: asked. A mail-merged advert is not personal.
  assert.equal(decideTodo({ ...offer, audienceScope: "personal" }, input({ about: cs })).confirmAudience, true);
  assert.equal(decideTodo({ ...offer, audienceScope: "personal" }, input({ about: cs, automated: true })), null);
});

test("step 2: an earlier answer settles the same audience or kind of mail, and nothing else", () => {
  const forTsm = { ...base, audience: "TSM majors", audienceEvidence: "This notice is for TSM majors only.", audienceScope: "group", audienceFit: "unclear" };
  const no = { id: "a1", answer: "no", about: "audience", text: "TSM majors" }, yes = { ...no, answer: "yes" };
  assert.equal(decideTodo({ ...forTsm, pastAnswerId: "a1" }, input({ answers: [no] })), null);
  const kept = decideTodo({ ...forTsm, pastAnswerId: "a1" }, input({ answers: [yes] }));
  assert.equal(kept.confirmAudience, false); assert.equal(kept.triage, null);
  // Not referenced by the model, an unknown id, or a note about something else: the question is still asked.
  assert.equal(decideTodo(forTsm, input({ answers: [no] })).confirmAudience, true);
  assert.equal(decideTodo({ ...forTsm, pastAnswerId: "a9" }, input({ answers: [no] })).confirmAudience, true);
  assert.equal(decideTodo({ ...forTsm, pastAnswerId: "a1" }, input({ answers: [{ ...no, text: "Biology seniors" }] })).confirmAudience, true);
  assert.equal(decideTodo({ ...forTsm, pastAnswerId: "a2" }, input({ answers: [{ id: "a2", answer: "no", about: "kind", text: "TSM Department internship notice" }] })), null);
  // A yes also lists an offer that would otherwise be left out.
  assert.ok(decideTodo({ ...forTsm, ask: "optional", pastAnswerId: "a1" }, input({ answers: [yes] })));
});

test("step 3: a dated item is listed by date; an undated one only when a person wants a reply", () => {
  assert.equal(decideTodo({ ...base, dueDate: null, dueEvidence: "" }, input()), null);
  assert.equal(decideTodo({ ...base, dueDate: "2026-12-05" }, input()), null); // A date the email does not state is dropped, leaving no date.
  const asks = { ...base, ask: "none", task: "", needsReply: true, replyEvidence: "Can you confirm by reply?" };
  assert.deepEqual(plain(decideTodo(asks, input())), { task: "Reply to this email", dueDate: null, dueIsEvent: false, reasons: ["reply"], confirmAudience: false, triage: null });
  assert.equal(decideTodo(asks, input({ automated: true })), null);
  // A task with a reply request keeps both, so it is still listed after its date.
  assert.deepEqual(plain(decideTodo({ ...base, needsReply: true, replyEvidence: "Can you confirm by reply?" }, input()).reasons), ["task", "reply"]);
});

test("step 3: a date that has passed is no longer something to do", () => {
  assert.equal(decideTodo(base, input({ now: new Date("2026-12-20T00:00:00Z") })), null);
  assert.equal(decideTodo(base, input({ now: new Date("2026-12-04T14:00:00Z") })).dueDate, "2026-12-04"); // 23:00 in Seoul: still today.
  assert.equal(decideTodo(base, input({ now: new Date("2026-12-04T15:30:00Z") })), null); // 00:30 the next day in Seoul.
  assert.equal(localDay(new Date("2026-12-04T15:30:00Z"), "Asia/Seoul"), "2026-12-05");
  assert.equal(localDay(new Date("2026-12-04T15:30:00Z")), "2026-12-04");
  const late = decideTodo({ ...base, needsReply: true, replyEvidence: "Can you confirm by reply?" }, input({ now: new Date("2026-12-20T00:00:00Z") }));
  assert.equal(late.dueDate, null); assert.deepEqual(plain(late.reasons), ["task", "reply"]);
});

test("the list shows Today, then later dates, then replies; a passed date leaves the list", () => {
  const { summarySection } = sections;
  assert.deepEqual(sections.SUMMARY_SECTIONS.map(([key]) => key), ["today", "upcoming", "reply", "manual"]);
  assert.equal(summarySection({ dueDate: "2026-11-24", reasons: ["task"] }, "2026-11-24"), "today");
  assert.equal(summarySection({ dueDate: "2026-12-18", reasons: ["task", "reply"] }, "2026-11-24"), "upcoming");
  assert.equal(summarySection({ dueDate: "2026-11-17", reasons: ["task"] }, "2026-11-24"), null);
  assert.equal(summarySection({ dueDate: null, reasons: ["task"] }, "2026-11-24"), null);
  assert.equal(summarySection({ dueDate: "2026-11-17", reasons: ["task", "reply"] }, "2026-11-24"), "reply");
  assert.equal(summarySection({ dueDate: null, reasons: ["manual"] }, "2026-11-24"), "manual");
  const list = text("app/summary-todo-list.tsx");
  assert.doesNotMatch(list, /Past deadline|Was due|Not for me|reasonLabel/);
  assert.match(list, /Is this for you\?/);
  assert.match(text("lib/mailflow-db.ts"), /status = 'done' AND updated_at > NOW\(\) - INTERVAL '7 days'/);
});

test("an answer is remembered only when it adds something, and never as text the model wrote", () => {
  const triage = { audience: "TSM majors", kind: "TSM Department internship notice" };
  const none = { explained: false, explainedBy: "", recurring: false, sensitive: false, remember: "none" };
  const given = (extra = {}) => ({ answer: "no", triage, about: cs, answers: [], ...extra });
  assert.equal(decideFeedback(none, given()), null);
  assert.equal(decideFeedback(undefined, given()), null);
  // A CS student says no to mail for another major: the profile already explains it.
  assert.equal(decideFeedback({ ...none, explained: true, explainedBy: "CS undergraduate", remember: "audience" }, given()), null);
  // "Explained" has to quote the profile; a made-up quote does not count.
  assert.deepEqual(plain(decideFeedback({ ...none, explained: true, explainedBy: "Biology major", remember: "audience" }, given())), { answer: "no", about: "audience", text: "TSM majors" });
  // The profile is silent about the group: remember the answer for that audience, yes or no alike.
  assert.deepEqual(plain(decideFeedback({ ...none, remember: "audience" }, given({ about: null }))), { answer: "no", about: "audience", text: "TSM majors" });
  assert.deepEqual(plain(decideFeedback({ ...none, remember: "audience" }, given({ about: null, answer: "yes" }))), { answer: "yes", about: "audience", text: "TSM majors" });
  // A preference about a kind of mail needs it to recur; a one-off leaves nothing behind.
  assert.equal(decideFeedback({ ...none, remember: "kind" }, given()), null);
  assert.deepEqual(plain(decideFeedback({ ...none, remember: "kind", recurring: true }, given())), { answer: "no", about: "kind", text: "TSM Department internship notice" });
  assert.equal(decideFeedback({ ...none, remember: "audience", sensitive: true }, given()), null);
  assert.equal(decideFeedback({ ...none, remember: "audience" }, given({ triage: { audience: "", kind: "x" } })), null);
  // Already remembered with the same answer: nothing new. The opposite answer replaces it.
  const known = [{ id: "a1", answer: "no", about: "audience", text: "tsm majors" }];
  assert.equal(decideFeedback({ ...none, remember: "audience" }, given({ about: null, answers: known })), null);
  assert.equal(decideFeedback({ ...none, remember: "audience" }, given({ about: null, answers: known, answer: "yes" })).answer, "yes");
});

test("the prompts keep yes and no on equal terms and treat the profile as read-only", () => {
  const prompt = feedbackPrompt({ answer: "no", triage: { audience: "TSM majors", kind: "TSM notice" }, about: cs, answers: [{ id: "a1", answer: "yes", about: "kind", text: "LAMBDA sessions" }] });
  assert.match(prompt, /A Yes and a No are handled by exactly the same rules/);
  assert.match(prompt, /"none" is always an acceptable result/);
  assert.match(prompt, /"profile":\{"role":"CS undergraduate","organization":"SUNY Korea"\}/);
  assert.doesNotMatch(prompt, /"id"/); // Note ids are not needed to judge one answer.
  assert.match(todoPrompt, /how many of them say yes or no tells nothing about this email/);
  assert.match(todoPrompt, /do not lean towards showing or hiding it/);
  // Only the Settings route writes About you; the answers live in their own table.
  assert.doesNotMatch(text("app/api/gmail/messages/[id]/todo/route.ts"), /saveUserAbout|deleteUserAbout/);
  const migration = readFileSync(resolve(__dirname, "../db/migrations/009_summary_answers.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS summary_answers/i); assert.doesNotMatch(migration.replace(/--.*/g, ""), /user_about/);
});

test("the model only sees profile fields the user filled in", () => {
  assert.deepEqual(plain(profileForPrompt(cs)), { role: "CS undergraduate", organization: "SUNY Korea" });
  assert.deepEqual(plain(profileForPrompt(null)), {});
});

test("Summary and priority are decided separately", () => {
  const todoCode = text("lib/summary-todo.ts").replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(todoCode, /priority|urgent|mail-priority|mail-analysis/i);
  const priorityCode = text("lib/mail-analysis.ts");
  assert.doesNotMatch(priorityCode.slice(priorityCode.indexOf("export function validateMailAnalysis")), /todo/i);
  const migration = readFileSync(resolve(__dirname, "../db/migrations/006_todo_items.sql"), "utf8");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS todo_items/i);
  assert.doesNotMatch(migration.replace(/--.*/g, ""), /priority/i);
});
