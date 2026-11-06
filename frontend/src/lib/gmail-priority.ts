import type { gmail_v1 } from "googleapis";
import { getStoredPriority, recordPriority } from "./mailflow-db";
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

export async function setPriority(id: string, priority: Priority, userId: number) {
  await recordPriority({
    userId,
    gmailMessageId: id,
    priority,
    source: "manual",
    reason: "The user changed the priority in MailFlow",
  });
}
