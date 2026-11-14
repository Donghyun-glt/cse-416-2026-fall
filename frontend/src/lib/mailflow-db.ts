import type { Priority, PrioritySignals } from "./mail-priority";
import { query, withTransaction } from "./postgres";

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
