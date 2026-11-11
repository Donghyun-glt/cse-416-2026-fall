import type { gmail_v1 } from "googleapis";
import { getStoredPriorities, getStoredPriority, recordPriority } from "./mailflow-db";
import { classifyPriorityWithReason, type Priority } from "./mail-priority";

export async function getOrAssignPriority(
  message: gmail_v1.Schema$Message,
  userId: number,
): Promise<Priority> {
  if (!message.id) throw new Error("A Gmail message ID is required to store priority");

  const existing = await getStoredPriority(userId, message.id);
  if (existing) return existing;

  const decision = classifyPriorityWithReason(message);
  await recordPriority({
    userId,
    gmailMessageId: message.id,
    priority: decision.priority,
    source: "automatic",
    reason: decision.reason,
    signals: decision.signals,
  });
  return decision.priority;
}

/**
 * Priorities for a whole list page. Stored priorities come back in a single
 * query; only messages MailFlow has never seen are classified and recorded.
 * Classification reads the Subject and From headers and the snippet, so
 * metadata-format Gmail messages are enough.
 */
export async function getOrAssignPriorities(
  messages: readonly gmail_v1.Schema$Message[],
  userId: number,
): Promise<Map<string, Priority>> {
  const ids = messages.flatMap((message) => (message.id ? [message.id] : []));
  const priorities = await getStoredPriorities(userId, ids);
  await Promise.all(messages.map(async (message) => {
    if (!message.id || priorities.has(message.id)) return;
    const decision = classifyPriorityWithReason(message);
    await recordPriority({
      userId,
      gmailMessageId: message.id,
      priority: decision.priority,
      source: "automatic",
      reason: decision.reason,
      signals: decision.signals,
    });
    priorities.set(message.id, decision.priority);
  }));
  return priorities;
}

export async function setPriority(id: string, priority: Priority, userId: number) {
  await recordPriority({
    userId,
    gmailMessageId: id,
    priority,
    source: "manual",
    reason: "The user changed the priority in MailFlow",
  });
}
