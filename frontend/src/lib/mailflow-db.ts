import type { Priority, PrioritySignals } from "./mail-priority";
import { query, withTransaction } from "./postgres";
import { ABOUT_FIELDS, roleText, type UserAbout } from "./user-about";
import type { SummaryAnswer, TodoTriage } from "./summary-todo";
import { lookupToken, open, openJson, seal, sealJson } from "./data-vault";

// Content columns (drafts, AI readings, edited event details, About-you answers, task
// text) are encrypted per user before they reach the database; see data-vault.ts.
// What stays readable there is only what queries need: ids, labels, dates and statuses.

export type PrioritySource = "automatic" | "manual";

export async function upsertUser(email: string, displayName?: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) throw new Error("A Gmail email address is required to store MailFlow data");

  const result = await query<{ id: number }>(`
    INSERT INTO users (email, display_name)
    VALUES ($1, $2)
    ON CONFLICT (email) DO UPDATE SET
      display_name = COALESCE(EXCLUDED.display_name, users.display_name),
      updated_at = NOW()
    RETURNING id
  `, [normalizedEmail, displayName?.trim() || null]);

  const user = result.rows[0];
  if (!user) throw new Error("MailFlow could not create the user record");
  return user.id;
}

export async function getStoredPriority(userId: number, gmailMessageId: string) {
  const result = await query<{ priority: Priority }>(`
    UPDATE message_priorities
    SET last_seen_at = NOW()
    WHERE user_id = $1 AND gmail_message_id = $2
    RETURNING priority
  `, [userId, gmailMessageId]);
  return result.rows[0]?.priority ?? null;
}

/** One round trip for a whole page of messages instead of one query each. */
export async function getStoredPriorities(userId: number, gmailMessageIds: readonly string[]) {
  const stored = new Map<string, Priority>();
  if (gmailMessageIds.length === 0) return stored;
  const result = await query<{ gmail_message_id: string; priority: Priority }>(`
    UPDATE message_priorities
    SET last_seen_at = NOW()
    WHERE user_id = $1 AND gmail_message_id = ANY($2::text[])
    RETURNING gmail_message_id, priority
  `, [userId, [...gmailMessageIds]]);
  for (const row of result.rows) stored.set(row.gmail_message_id, row.priority);
  return stored;
}

export async function recordPriority(input: {
  userId: number;
  gmailMessageId: string;
  priority: Priority;
  source: PrioritySource;
  reason: string;
  signals?: PrioritySignals;
}) {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `${input.userId}:${input.gmailMessageId}`,
    ]);

    const current = await client.query<{ priority: Priority; source: PrioritySource }>(`
      SELECT priority, source
      FROM message_priorities
      WHERE user_id = $1 AND gmail_message_id = $2
      FOR UPDATE
    `, [input.userId, input.gmailMessageId]);
    const previousPriority = current.rows[0]?.priority;
    // Automatic analysis may finish after a manual edit. Respect that edit
    // inside the same lock used by both writers, including edits to the same label.
    if (current.rows[0]?.source === "manual" && input.source === "automatic") return previousPriority;

    if (previousPriority === input.priority && current.rows[0]?.source === input.source) {
      await client.query(`
        UPDATE message_priorities
        SET last_seen_at = NOW(), reason = $3, signals = $4
        WHERE user_id = $1 AND gmail_message_id = $2
      `, [input.userId, input.gmailMessageId, input.reason, input.signals ?? null]);
      return input.priority;
    }

    const signals = input.signals ?? null;
    await client.query(`
      INSERT INTO message_priorities (
        user_id, gmail_message_id, priority, source, reason, signals,
        classified_at, updated_at, last_seen_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NOW())
      ON CONFLICT (user_id, gmail_message_id) DO UPDATE SET
        priority = EXCLUDED.priority,
        source = EXCLUDED.source,
        reason = EXCLUDED.reason,
        signals = EXCLUDED.signals,
        updated_at = NOW(),
        last_seen_at = NOW()
    `, [
      input.userId,
      input.gmailMessageId,
      input.priority,
      input.source,
      input.reason,
      signals,
    ]);
    await client.query(`
      INSERT INTO priority_events (
        user_id, gmail_message_id, previous_priority, new_priority,
        source, reason, signals
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      input.userId,
      input.gmailMessageId,
      previousPriority ?? null,
      input.priority,
      input.source,
      input.reason,
      signals,
    ]);
    return input.priority;
  });
}

/**
 * First automatic priorities for a page of messages MailFlow has never seen, in one
 * statement. A search or an older mailbox page can bring up to 50 such messages, and
 * a recordPriority transaction for each (about six database round trips apiece) kept
 * the list waiting for seconds or ran out of pool connections.
 *
 * A message that gained a priority in the meantime (a manual choice or an AI
 * analysis) keeps it: rows that already exist are left alone and read back. Each new
 * row gets its audit entry in priority_events, as recordPriority would write.
 */
export async function recordFirstAutomaticPriorities(userId: number, decisions: readonly {
  gmailMessageId: string;
  priority: Priority;
  reason: string;
  signals?: PrioritySignals;
}[]) {
  const saved = new Map<string, Priority>();
  const unique = [...new Map(decisions.map((decision) => [decision.gmailMessageId, decision])).values()];
  if (unique.length === 0) return saved;
  const rows = JSON.stringify(unique.map((decision) => ({
    id: decision.gmailMessageId, priority: decision.priority, reason: decision.reason, signals: decision.signals ?? null,
  })));
  const result = await query<{ gmail_message_id: string; priority: Priority }>(`
    WITH input AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb) AS t(id TEXT, priority TEXT, reason TEXT, signals JSONB)
    ), inserted AS (
      INSERT INTO message_priorities (
        user_id, gmail_message_id, priority, source, reason, signals,
        classified_at, updated_at, last_seen_at
      )
      SELECT $1, id, priority, 'automatic', reason, signals, NOW(), NOW(), NOW() FROM input
      ON CONFLICT (user_id, gmail_message_id) DO NOTHING
      RETURNING gmail_message_id, priority, reason, signals
    ), events AS (
      INSERT INTO priority_events (user_id, gmail_message_id, previous_priority, new_priority, source, reason, signals)
      SELECT $1, gmail_message_id, NULL, priority, 'automatic', reason, signals FROM inserted
    )
    SELECT gmail_message_id, priority FROM inserted
  `, [userId, rows]);
  for (const row of result.rows) saved.set(row.gmail_message_id, row.priority);
  const existing = unique.filter((decision) => !saved.has(decision.gmailMessageId)).map((decision) => decision.gmailMessageId);
  for (const [id, priority] of await getStoredPriorities(userId, existing)) saved.set(id, priority);
  return saved;
}

export type StoredReplyDraft = {
  draft: string;
  model: string;
  generatedAt: string;
};

export async function getStoredReplyDraft(input: {
  userId: number;
  gmailMessageId: string;
  tone: string;
  length: string;
  instructions: string;
}): Promise<StoredReplyDraft | null> {
  const result = await query<{ draft: string; model: string; generated_at: Date }>(`
    UPDATE reply_drafts
    SET last_seen_at = NOW()
    WHERE user_id = $1 AND gmail_message_id = $2 AND tone = $3 AND length = $4 AND instructions = $5
    RETURNING draft, model, generated_at
  `, [input.userId, input.gmailMessageId, input.tone, input.length, lookupToken(input.userId, "reply_drafts.instructions", input.instructions)]);
  const row = result.rows[0];
  const draft = row ? open(input.userId, `reply_drafts.draft:${input.gmailMessageId}`, row.draft) : null;
  return row && draft !== null ? { draft, model: row.model, generatedAt: row.generated_at.toISOString() } : null;
}

export async function saveReplyDraft(input: {
  userId: number;
  gmailMessageId: string;
  tone: string;
  length: string;
  instructions: string;
  draft: string;
  model: string;
}) {
  await query(`
    INSERT INTO reply_drafts (user_id, gmail_message_id, tone, length, instructions, draft, model, generated_at, last_seen_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
    ON CONFLICT (user_id, gmail_message_id, tone, length, instructions) DO UPDATE SET
      draft = EXCLUDED.draft,
      model = EXCLUDED.model,
      generated_at = NOW(),
      last_seen_at = NOW()
  `, [input.userId, input.gmailMessageId, input.tone, input.length, lookupToken(input.userId, "reply_drafts.instructions", input.instructions),
    seal(input.userId, `reply_drafts.draft:${input.gmailMessageId}`, input.draft), input.model]);
}

export type ReplyPanelState = {
  draft: string;
  tone: string;
  length: string;
  instructions: string;
};

/** The reply panel as the user last left it for this message, or null if they never changed it. */
export async function getReplyPanelState(userId: number, gmailMessageId: string): Promise<ReplyPanelState | null> {
  const result = await query<ReplyPanelState>(`
    SELECT draft, tone, length, instructions
    FROM reply_panel_states
    WHERE user_id = $1 AND gmail_message_id = $2
  `, [userId, gmailMessageId]);
  const row = result.rows[0];
  if (!row) return null;
  const draft = open(userId, `reply_panel_states.draft:${gmailMessageId}`, row.draft);
  return draft === null ? null : { ...row, draft, instructions: open(userId, `reply_panel_states.instructions:${gmailMessageId}`, row.instructions) ?? "" };
}

export async function saveReplyPanelState(input: ReplyPanelState & { userId: number; gmailMessageId: string }) {
  await query(`
    INSERT INTO reply_panel_states (user_id, gmail_message_id, draft, tone, length, instructions, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (user_id, gmail_message_id) DO UPDATE SET
      draft = EXCLUDED.draft,
      tone = EXCLUDED.tone,
      length = EXCLUDED.length,
      instructions = EXCLUDED.instructions,
      updated_at = NOW()
  `, [input.userId, input.gmailMessageId, seal(input.userId, `reply_panel_states.draft:${input.gmailMessageId}`, input.draft), input.tone, input.length,
    seal(input.userId, `reply_panel_states.instructions:${input.gmailMessageId}`, input.instructions)]);
}

export async function deleteReplyPanelState(userId: number, gmailMessageId: string) {
  await query("DELETE FROM reply_panel_states WHERE user_id = $1 AND gmail_message_id = $2", [userId, gmailMessageId]);
}

/** The stored AI reading of a message, or null if it has not been analysed yet. */
export async function getMessageInsight(userId: number, gmailMessageId: string): Promise<unknown | null> {
  const result = await query<{ analysis: unknown }>(`
    SELECT analysis FROM message_insights WHERE user_id = $1 AND gmail_message_id = $2
  `, [userId, gmailMessageId]);
  return openJson(userId, `message_insights.analysis:${gmailMessageId}`, result.rows[0]?.analysis);
}

/**
 * Stores a message's analysis the first time only. Returns false when one was
 * already stored, so callers keep the original instead of replacing it.
 */
export async function saveMessageInsight(input: { userId: number; gmailMessageId: string; version: string; analysis: unknown }) {
  const result = await query(`
    INSERT INTO message_insights (user_id, gmail_message_id, version, analysis)
    VALUES ($1, $2, $3, $4::jsonb)
    ON CONFLICT (user_id, gmail_message_id) DO NOTHING
    RETURNING user_id
  `, [input.userId, input.gmailMessageId, input.version, sealJson(input.userId, `message_insights.analysis:${input.gmailMessageId}`, input.analysis)]);
  return (result.rowCount ?? 0) > 0;
}

export type CalendarEventStatus = "pending" | "saved" | "dismissed";
export type CalendarEventState = { status: CalendarEventStatus; details: Record<string, unknown> };

/** Per suggested event of a message: what the user last did with it, keyed by candidate key. */
export async function getCalendarEventStates(userId: number, gmailMessageId: string): Promise<Record<string, CalendarEventState>> {
  const result = await query<{ candidate_key: string; status: CalendarEventStatus; details: Record<string, unknown> }>(`
    SELECT candidate_key, status, details
    FROM calendar_event_states
    WHERE user_id = $1 AND gmail_message_id = $2
  `, [userId, gmailMessageId]);
  return Object.fromEntries(result.rows.map((row) => [row.candidate_key, {
    status: row.status,
    details: (openJson(userId, `calendar_event_states.details:${gmailMessageId}:${row.candidate_key}`, row.details) ?? {}) as Record<string, unknown>,
  }]));
}

/**
 * Stored analyses of many messages in one query (the Daily Briefing reads a whole day at once).
 * Messages that have not been analysed yet are simply absent from the map.
 */
export async function getMessageInsights(userId: number, gmailMessageIds: readonly string[]): Promise<Map<string, unknown>> {
  const insights = new Map<string, unknown>();
  if (gmailMessageIds.length === 0) return insights;
  const result = await query<{ gmail_message_id: string; analysis: unknown }>(`
    SELECT gmail_message_id, analysis FROM message_insights WHERE user_id = $1 AND gmail_message_id = ANY($2::text[])
  `, [userId, [...gmailMessageIds]]);
  for (const row of result.rows) {
    const analysis = openJson(userId, `message_insights.analysis:${row.gmail_message_id}`, row.analysis);
    if (analysis) insights.set(row.gmail_message_id, analysis);
  }
  return insights;
}

/** getCalendarEventStates for many messages in one query, keyed by message id. */
export async function getCalendarEventStatesForMessages(userId: number, gmailMessageIds: readonly string[]): Promise<Map<string, Record<string, CalendarEventState>>> {
  const states = new Map<string, Record<string, CalendarEventState>>();
  if (gmailMessageIds.length === 0) return states;
  const result = await query<{ gmail_message_id: string; candidate_key: string; status: CalendarEventStatus; details: Record<string, unknown> }>(`
    SELECT gmail_message_id, candidate_key, status, details
    FROM calendar_event_states
    WHERE user_id = $1 AND gmail_message_id = ANY($2::text[])
  `, [userId, [...gmailMessageIds]]);
  for (const row of result.rows) {
    const forMessage = states.get(row.gmail_message_id) ?? {};
    forMessage[row.candidate_key] = {
      status: row.status,
      details: (openJson(userId, `calendar_event_states.details:${row.gmail_message_id}:${row.candidate_key}`, row.details) ?? {}) as Record<string, unknown>,
    };
    states.set(row.gmail_message_id, forMessage);
  }
  return states;
}

export async function saveCalendarEventState(input: CalendarEventState & { userId: number; gmailMessageId: string; candidateKey: string }) {
  await query(`
    INSERT INTO calendar_event_states (user_id, gmail_message_id, candidate_key, status, details, updated_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
    ON CONFLICT (user_id, gmail_message_id, candidate_key) DO UPDATE SET
      status = EXCLUDED.status,
      details = EXCLUDED.details,
      updated_at = NOW()
  `, [input.userId, input.gmailMessageId, input.candidateKey, input.status, sealJson(input.userId, `calendar_event_states.details:${input.gmailMessageId}:${input.candidateKey}`, input.details)]);
}

/** The "About you" details the user entered in Settings, or null if they never saved any. */
export async function getUserAbout(userId: number): Promise<(UserAbout & { updatedAt: string }) | null> {
  const result = await query<UserAbout & { updated_at: Date }>(`
    SELECT role, organization, interests, notes, updated_at FROM user_about WHERE user_id = $1
  `, [userId]);
  const row = result.rows[0];
  if (!row) return null;
  const field = (name: keyof UserAbout) => open(userId, `user_about.${name}`, row[name]) ?? "";
  return { role: roleText(field("role")), organization: field("organization"), interests: field("interests"), notes: field("notes"), updatedAt: row.updated_at.toISOString() };
}

/**
 * Stores the details exactly as the user submitted them. Call this only from the
 * Settings save route: nothing an AI produced may ever be written here.
 */
export async function saveUserAbout(userId: number, about: UserAbout) {
  const result = await query<{ updated_at: Date }>(`
    INSERT INTO user_about (user_id, role, organization, interests, notes, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      role = EXCLUDED.role,
      organization = EXCLUDED.organization,
      department = '', -- Field removed from Settings: never keep an old value the user cannot see.
      interests = EXCLUDED.interests,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING updated_at
  `, [userId, ...ABOUT_FIELDS.map((name) => about[name] ? seal(userId, `user_about.${name}`, about[name]) : "")]);
  return result.rows[0].updated_at.toISOString();
}

export async function deleteUserAbout(userId: number) {
  await query("DELETE FROM user_about WHERE user_id = $1", [userId]);
}

export type TodoStatus = "open" | "done" | "not_relevant";
export type TodoItem = { gmailMessageId: string; task: string; dueDate: string | null; reasons: string[]; confirmAudience: boolean; status: TodoStatus };
type TodoRow = { gmail_message_id: string; task: string; due_date: string | null; reasons: string[]; confirm_audience: boolean; status: TodoStatus };
const TODO_COLUMNS = "gmail_message_id, task, to_char(due_date, 'YYYY-MM-DD') AS due_date, reasons, confirm_audience, status";
const todoItem = (userId: number, row: TodoRow): TodoItem => ({ gmailMessageId: row.gmail_message_id, task: open(userId, `todo_items.task:${row.gmail_message_id}`, row.task) ?? "", dueDate: row.due_date, reasons: row.reasons, confirmAudience: row.confirm_audience, status: row.status });

/** Lists a message on the Summary tab the first time it is analysed. Never changes an existing row. */
export async function createTodoItem(input: { userId: number; gmailMessageId: string; task: string; dueDate: string | null; reasons: string[]; confirmAudience: boolean; triage?: TodoTriage | null }) {
  await query(`
    INSERT INTO todo_items (user_id, gmail_message_id, task, due_date, reasons, confirm_audience, triage)
    VALUES ($1, $2, $3, $4::date, $5::text[], $6, $7)
    ON CONFLICT (user_id, gmail_message_id) DO NOTHING
  `, [input.userId, input.gmailMessageId, input.task ? seal(input.userId, `todo_items.task:${input.gmailMessageId}`, input.task) : "", input.dueDate, input.reasons, input.confirmAudience,
    input.triage ? seal(input.userId, `todo_items.triage:${input.gmailMessageId}`, JSON.stringify(input.triage)) : ""]);
}

export async function getTodoItem(userId: number, gmailMessageId: string): Promise<TodoItem | null> {
  const result = await query<TodoRow>(`SELECT ${TODO_COLUMNS} FROM todo_items WHERE user_id = $1 AND gmail_message_id = $2`, [userId, gmailMessageId]);
  return result.rows[0] ? todoItem(userId, result.rows[0]) : null;
}

/**
 * What the Summary tab can show: open items that are dated today or later, wait for a
 * reply or were added by hand, plus what was finished in the last 7 days (so it can be
 * undone). An item whose date has passed is not returned; the one-day margin covers time
 * zones ahead of the database, and the list applies the user's own calendar day.
 */
export async function listTodoItems(userId: number): Promise<TodoItem[]> {
  const result = await query<TodoRow>(`
    (SELECT ${TODO_COLUMNS}, updated_at FROM todo_items WHERE user_id = $1 AND status = 'open'
      AND (due_date >= CURRENT_DATE - 1 OR 'reply' = ANY(reasons) OR 'manual' = ANY(reasons)))
    UNION ALL
    (SELECT ${TODO_COLUMNS}, updated_at FROM todo_items WHERE user_id = $1 AND status = 'done' AND updated_at > NOW() - INTERVAL '7 days' ORDER BY updated_at DESC LIMIT 20)
  `, [userId]);
  return result.rows.map((row) => todoItem(userId, row));
}

/**
 * The user's own choice: done, not relevant, or (re)opened. Opening a message with no row
 * adds it by hand; so does reopening one that would otherwise not be shown (no date ahead
 * as of `today`, the user's calendar day, and no reply wanted), so it cannot vanish again.
 */
export async function setTodoStatus(userId: number, gmailMessageId: string, status: TodoStatus, today?: string) {
  await query(`
    INSERT INTO todo_items (user_id, gmail_message_id, reasons, status)
    VALUES ($1, $2, ARRAY['manual'], $3)
    ON CONFLICT (user_id, gmail_message_id) DO UPDATE SET
      status = EXCLUDED.status,
      reasons = CASE WHEN EXCLUDED.status = 'open' AND NOT ('manual' = ANY(todo_items.reasons)) AND NOT ('reply' = ANY(todo_items.reasons))
        AND (todo_items.due_date IS NULL OR todo_items.due_date < COALESCE($4::date, CURRENT_DATE))
        THEN array_append(todo_items.reasons, 'manual') ELSE todo_items.reasons END,
      updated_at = NOW()
  `, [userId, gmailMessageId, status, today ?? null]);
}

/**
 * The user answered "Is this for you?": yes keeps the item and stops asking, no takes it
 * off the list. Returns false when there was no open question to answer.
 */
export async function answerTodoAudience(userId: number, gmailMessageId: string, forMe: boolean) {
  const result = await query(`
    UPDATE todo_items SET confirm_audience = FALSE, status = CASE WHEN $3 THEN status ELSE 'not_relevant' END, updated_at = NOW()
    WHERE user_id = $1 AND gmail_message_id = $2 AND status = 'open' AND confirm_audience
  `, [userId, gmailMessageId, forMe]);
  return (result.rowCount ?? 0) > 0;
}

/** How the email described its audience and kind, for an item the app was unsure about. */
export async function getTodoTriage(userId: number, gmailMessageId: string): Promise<TodoTriage | null> {
  const result = await query<{ triage: string }>("SELECT triage FROM todo_items WHERE user_id = $1 AND gmail_message_id = $2", [userId, gmailMessageId]);
  const stored = result.rows[0]?.triage ? open(userId, `todo_items.triage:${gmailMessageId}`, result.rows[0].triage) : null;
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as Partial<TodoTriage>;
    return { audience: typeof value.audience === "string" ? value.audience : "", kind: typeof value.kind === "string" ? value.kind : "" };
  } catch { return null; }
}

/** The user's remembered "Is this for you?" answers, oldest first. */
export async function listSummaryAnswers(userId: number): Promise<SummaryAnswer[]> {
  const result = await query<{ id: string; answer: "yes" | "no"; about: "audience" | "kind"; text: string }>(`
    SELECT id::text AS id, answer, about, text FROM summary_answers WHERE user_id = $1 ORDER BY updated_at, id
  `, [userId]);
  return result.rows.flatMap((row) => { const text = open(userId, "summary_answers.text", row.text); return text ? [{ id: `a${row.id}`, answer: row.answer, about: row.about, text }] : []; });
}

const SUMMARY_ANSWER_LIMIT = 20;
/** Remembers one answer. A newer answer about the same audience or kind replaces the older one; only the latest few are kept. */
export async function saveSummaryAnswer(userId: number, input: { answer: "yes" | "no"; about: "audience" | "kind"; text: string }) {
  await query(`
    INSERT INTO summary_answers (user_id, answer, about, text, text_token)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id, about, text_token) DO UPDATE SET answer = EXCLUDED.answer, text = EXCLUDED.text, updated_at = NOW()
  `, [userId, input.answer, input.about, seal(userId, "summary_answers.text", input.text), lookupToken(userId, "summary_answers.text", input.text.toLowerCase())]);
  await query(`
    DELETE FROM summary_answers WHERE user_id = $1 AND id IN (SELECT id FROM summary_answers WHERE user_id = $1 ORDER BY updated_at DESC, id DESC OFFSET $2)
  `, [userId, SUMMARY_ANSWER_LIMIT]);
}

/** Removes one remembered answer (id as listed), or all of them when no id is given. */
export async function deleteSummaryAnswers(userId: number, id?: string) {
  if (id === undefined) await query("DELETE FROM summary_answers WHERE user_id = $1", [userId]);
  else await query("DELETE FROM summary_answers WHERE user_id = $1 AND id = $2::bigint", [userId, id.replace(/^a/, "")]);
}

/** One reason is dealt with (the reply was sent, the event was decided). The item is done when none is left. */
export async function resolveTodoReason(userId: number, gmailMessageId: string, reason: string) {
  await query(`
    UPDATE todo_items SET
      reasons = array_remove(reasons, $3),
      status = CASE WHEN cardinality(array_remove(reasons, $3)) = 0 THEN 'done' ELSE status END,
      updated_at = NOW()
    WHERE user_id = $1 AND gmail_message_id = $2 AND status = 'open' AND $3 = ANY(reasons)
  `, [userId, gmailMessageId, reason]);
}

/** Which of these messages have already been analysed. */
export async function getAnalysedMessageIds(userId: number, gmailMessageIds: readonly string[]) {
  if (gmailMessageIds.length === 0) return new Set<string>();
  const result = await query<{ gmail_message_id: string }>(`
    SELECT gmail_message_id FROM message_insights WHERE user_id = $1 AND gmail_message_id = ANY($2::text[])
  `, [userId, [...gmailMessageIds]]);
  return new Set(result.rows.map((row) => row.gmail_message_id));
}

/** AI summaries for the Summary rows that have one. */
export async function getInsightSummaries(userId: number, gmailMessageIds: readonly string[]) {
  const summaries = new Map<string, string>();
  if (gmailMessageIds.length === 0) return summaries;
  // The analysis is encrypted, so the summary is read out here rather than in SQL.
  const result = await query<{ gmail_message_id: string; analysis: unknown }>(`
    SELECT gmail_message_id, analysis FROM message_insights WHERE user_id = $1 AND gmail_message_id = ANY($2::text[])
  `, [userId, [...gmailMessageIds]]);
  for (const row of result.rows) {
    const analysis = openJson(userId, `message_insights.analysis:${row.gmail_message_id}`, row.analysis) as { summary?: string; reason?: string } | null;
    const summary = analysis?.summary || analysis?.reason;
    if (summary) summaries.set(row.gmail_message_id, summary);
  }
  return summaries;
}
