import type { Priority, PrioritySignals } from "./mail-priority";
import { query, withTransaction } from "./postgres";
import type { UserAbout } from "./user-about";

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

export async function getUrgentMessageSummaries(userId: number) {
  const result = await query<{ gmail_message_id: string; summary: string | null }>(`
    SELECT p.gmail_message_id, COALESCE(NULLIF(i.analysis->>'summary', ''), i.analysis->>'reason') AS summary
    FROM message_priorities p
    LEFT JOIN message_insights i USING (user_id, gmail_message_id)
    WHERE p.user_id = $1 AND p.priority = 'urgent'
  `, [userId]);
  return result.rows;
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
  `, [input.userId, input.gmailMessageId, input.tone, input.length, input.instructions]);
  const row = result.rows[0];
  return row ? { draft: row.draft, model: row.model, generatedAt: row.generated_at.toISOString() } : null;
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
  `, [input.userId, input.gmailMessageId, input.tone, input.length, input.instructions, input.draft, input.model]);
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
  return result.rows[0] ?? null;
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
  `, [input.userId, input.gmailMessageId, input.draft, input.tone, input.length, input.instructions]);
}

export async function deleteReplyPanelState(userId: number, gmailMessageId: string) {
  await query("DELETE FROM reply_panel_states WHERE user_id = $1 AND gmail_message_id = $2", [userId, gmailMessageId]);
}

/** The stored AI reading of a message, or null if it has not been analysed yet. */
export async function getMessageInsight(userId: number, gmailMessageId: string): Promise<unknown | null> {
  const result = await query<{ analysis: unknown }>(`
    SELECT analysis FROM message_insights WHERE user_id = $1 AND gmail_message_id = $2
  `, [userId, gmailMessageId]);
  return result.rows[0]?.analysis ?? null;
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
  `, [input.userId, input.gmailMessageId, input.version, JSON.stringify(input.analysis)]);
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
  return Object.fromEntries(result.rows.map((row) => [row.candidate_key, { status: row.status, details: row.details ?? {} }]));
}

export async function saveCalendarEventState(input: CalendarEventState & { userId: number; gmailMessageId: string; candidateKey: string }) {
  await query(`
    INSERT INTO calendar_event_states (user_id, gmail_message_id, candidate_key, status, details, updated_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
    ON CONFLICT (user_id, gmail_message_id, candidate_key) DO UPDATE SET
      status = EXCLUDED.status,
      details = EXCLUDED.details,
      updated_at = NOW()
  `, [input.userId, input.gmailMessageId, input.candidateKey, input.status, JSON.stringify(input.details)]);
}

/** The "About you" details the user entered in Settings, or null if they never saved any. */
export async function getUserAbout(userId: number): Promise<(UserAbout & { updatedAt: string }) | null> {
  const result = await query<UserAbout & { updated_at: Date }>(`
    SELECT role, organization, department, interests, notes, updated_at FROM user_about WHERE user_id = $1
  `, [userId]);
  const row = result.rows[0];
  return row ? { role: row.role, organization: row.organization, department: row.department, interests: row.interests, notes: row.notes, updatedAt: row.updated_at.toISOString() } : null;
}

/**
 * Stores the details exactly as the user submitted them. Call this only from the
 * Settings save route: nothing an AI produced may ever be written here.
 */
export async function saveUserAbout(userId: number, about: UserAbout) {
  const result = await query<{ updated_at: Date }>(`
    INSERT INTO user_about (user_id, role, organization, department, interests, notes, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      role = EXCLUDED.role,
      organization = EXCLUDED.organization,
      department = EXCLUDED.department,
      interests = EXCLUDED.interests,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING updated_at
  `, [userId, about.role, about.organization, about.department, about.interests, about.notes]);
  return result.rows[0].updated_at.toISOString();
}

export async function deleteUserAbout(userId: number) {
  await query("DELETE FROM user_about WHERE user_id = $1", [userId]);
}

export type TodoStatus = "open" | "done" | "not_relevant";
export type TodoItem = { gmailMessageId: string; task: string; dueDate: string | null; reasons: string[]; confirmAudience: boolean; status: TodoStatus };
type TodoRow = { gmail_message_id: string; task: string; due_date: string | null; reasons: string[]; confirm_audience: boolean; status: TodoStatus };
const TODO_COLUMNS = "gmail_message_id, task, to_char(due_date, 'YYYY-MM-DD') AS due_date, reasons, confirm_audience, status";
const todoItem = (row: TodoRow): TodoItem => ({ gmailMessageId: row.gmail_message_id, task: row.task, dueDate: row.due_date, reasons: row.reasons, confirmAudience: row.confirm_audience, status: row.status });

/** Lists a message on the Summary tab the first time it is analysed. Never changes an existing row. */
export async function createTodoItem(input: { userId: number; gmailMessageId: string; task: string; dueDate: string | null; reasons: string[]; confirmAudience: boolean }) {
  await query(`
    INSERT INTO todo_items (user_id, gmail_message_id, task, due_date, reasons, confirm_audience)
    VALUES ($1, $2, $3, $4::date, $5::text[], $6)
    ON CONFLICT (user_id, gmail_message_id) DO NOTHING
  `, [input.userId, input.gmailMessageId, input.task, input.dueDate, input.reasons, input.confirmAudience]);
}

export async function getTodoItem(userId: number, gmailMessageId: string): Promise<TodoItem | null> {
  const result = await query<TodoRow>(`SELECT ${TODO_COLUMNS} FROM todo_items WHERE user_id = $1 AND gmail_message_id = $2`, [userId, gmailMessageId]);
  return result.rows[0] ? todoItem(result.rows[0]) : null;
}

/** Everything still open, plus what was finished in the last two weeks (so it can be undone). */
export async function listTodoItems(userId: number): Promise<TodoItem[]> {
  const result = await query<TodoRow>(`
    (SELECT ${TODO_COLUMNS}, updated_at FROM todo_items WHERE user_id = $1 AND status = 'open')
    UNION ALL
    (SELECT ${TODO_COLUMNS}, updated_at FROM todo_items WHERE user_id = $1 AND status = 'done' AND updated_at > NOW() - INTERVAL '14 days' ORDER BY updated_at DESC LIMIT 20)
  `, [userId]);
  return result.rows.map(todoItem);
}

/** The user's own choice: done, not relevant, or (re)opened. Opening a message with no row adds it by hand. */
export async function setTodoStatus(userId: number, gmailMessageId: string, status: TodoStatus) {
  await query(`
    INSERT INTO todo_items (user_id, gmail_message_id, reasons, status)
    VALUES ($1, $2, ARRAY['manual'], $3)
    ON CONFLICT (user_id, gmail_message_id) DO UPDATE SET
      status = EXCLUDED.status,
      reasons = CASE WHEN EXCLUDED.status = 'open' AND cardinality(todo_items.reasons) = 0 THEN ARRAY['manual'] ELSE todo_items.reasons END,
      updated_at = NOW()
  `, [userId, gmailMessageId, status]);
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
  const result = await query<{ gmail_message_id: string; summary: string | null }>(`
    SELECT gmail_message_id, COALESCE(NULLIF(analysis->>'summary', ''), analysis->>'reason') AS summary
    FROM message_insights WHERE user_id = $1 AND gmail_message_id = ANY($2::text[])
  `, [userId, [...gmailMessageIds]]);
  for (const row of result.rows) if (row.summary) summaries.set(row.gmail_message_id, row.summary);
  return summaries;
}
