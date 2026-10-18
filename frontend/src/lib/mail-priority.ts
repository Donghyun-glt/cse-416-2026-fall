import type { gmail_v1 } from "googleapis";

export const PRIORITIES = ["urgent", "fyi", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

export type PrioritySignals = {
  automated: boolean;
  directAction: boolean;
  timeSensitive: boolean;
  activeBlocker: boolean;
};

export type PriorityDecision = {
  priority: Priority;
  reason: string;
  signals: PrioritySignals;
};

export const PRIORITY_LABEL_NAMES: Record<Priority, string> = {
  urgent: "MailFlow/Urgent",
  fyi: "MailFlow/FYI",
  low: "MailFlow/Low Priority",
};

export function isPriority(value: unknown): value is Priority {
  return PRIORITIES.includes(value as Priority);
}

export function priorityFromLabels(labelIds: string[] | null | undefined, labels: Record<Priority, string>): Priority | null {
  return PRIORITIES.find((priority) => labelIds?.includes(labels[priority])) ?? null;
}

export function classifyPriorityWithReason(message: Pick<gmail_v1.Schema$Message, "payload" | "snippet">): PriorityDecision {
  const headers = new Map((message.payload?.headers ?? []).map((header) => [header.name?.toLowerCase(), header.value ?? ""]));
  const subject = headers.get("subject") ?? "";
  const from = headers.get("from") ?? "";
  const text = `${subject} ${message.snippet ?? ""}`.toLowerCase();
  const automated = /(?:no-?reply|notifications?|newsletter|digest|updates?|mailer-daemon|marketing)@/i.test(from)
    || /\b(?:newsletter|digest|unsubscribe|receipt|order confirmation|recording is ready|weekly roundup|notification(?:s)?)\b/i.test(text);
  const directAction = /\b(?:please|could you|can you|need you to|your approval|your response|reply|respond|review|approve|sign(?:[ -]?off)?|send|submit|fix|blocked|waiting (?:on|for) you)\b/i.test(text)
    || /(?:확인해\s*주세요|회신|답장|승인|서명|처리해\s*주세요|부탁드립니다)/.test(text);
  const timeSensitive = /\b(?:today|tonight|asap|immediately|by (?:[1-9](?::\d{2})?\s*(?:am|pm)?|noon|midnight|end of day|eod)|before (?:[1-9](?::\d{2})?\s*(?:am|pm)?|noon|midnight|end of day|eod)|deadline|overdue|within \d+ hours?|by tomorrow|tomorrow morning)\b/i.test(text)
    || /(?:오늘|내일\s*오전|마감|긴급|당장|즉시)/.test(text);
  const activeBlocker = /\b(?:production (?:issue|outage)|service (?:down|outage)|client is waiting|customer is waiting|blocked|cannot proceed)\b/i.test(text)
    || /(?:서비스\s*장애|고객이\s*기다|진행할\s*수\s*없)/.test(text);

  const signals = { automated, directAction, timeSensitive, activeBlocker };
  if (!automated && activeBlocker) {
    return { priority: "urgent", reason: "A non-automated message contains an active blocker", signals };
  }
  if (!automated && directAction && timeSensitive) {
    return { priority: "urgent", reason: "A direct request includes time-sensitive language", signals };
  }
  if (automated && !directAction) {
    return { priority: "low", reason: "An automated message does not request direct action", signals };
  }
  return { priority: "fyi", reason: "No urgent or low-priority rule matched", signals };
}

export function classifyPriority(message: Pick<gmail_v1.Schema$Message, "payload" | "snippet">): Priority {
  return classifyPriorityWithReason(message).priority;
}

export function comparePriority(a: { priority: Priority; date: string }, b: { priority: Priority; date: string }) {
  const rank = PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority);
  return rank || Date.parse(b.date) - Date.parse(a.date);
}
