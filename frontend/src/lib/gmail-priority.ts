import type { gmail_v1 } from "googleapis";
import { classifyPriority, PRIORITIES, PRIORITY_LABEL_NAMES, priorityFromLabels, type Priority } from "./mail-priority";

type Gmail = gmail_v1.Gmail;
type PriorityLabels = Record<Priority, string>;

export async function ensurePriorityLabels(gmail: Gmail): Promise<PriorityLabels> {
  const existing = (await gmail.users.labels.list({ userId: "me" })).data.labels ?? [];
  const labels = {} as PriorityLabels;
  for (const priority of PRIORITIES) {
    const name = PRIORITY_LABEL_NAMES[priority];
    const found = existing.find((label) => label.name === name);
    if (found?.id) {
      labels[priority] = found.id;
      continue;
    }
    try {
      const created = await gmail.users.labels.create({ userId: "me", requestBody: { name, labelListVisibility: "labelHide", messageListVisibility: "hide" } });
      if (!created.data.id) throw new Error(`Gmail did not return an ID for ${name}`);
      labels[priority] = created.data.id;
    } catch (error) {
      // Another simultaneous request may have created the label first.
      const refreshed = (await gmail.users.labels.list({ userId: "me" })).data.labels ?? [];
      const concurrent = refreshed.find((label) => label.name === name);
      if (!concurrent?.id) throw error;
      labels[priority] = concurrent.id;
    }
  }
  return labels;
}

export async function getOrAssignPriority(gmail: Gmail, message: gmail_v1.Schema$Message, labels: PriorityLabels): Promise<Priority> {
  const existing = priorityFromLabels(message.labelIds, labels);
  if (existing) return existing;
  // A manual edit or another fetch can label this message after our first get.
  const latest = (await gmail.users.messages.get({ userId: "me", id: message.id!, format: "minimal" })).data;
  const concurrent = priorityFromLabels(latest.labelIds, labels);
  if (concurrent) return concurrent;
  const priority = classifyPriority(message);
  await gmail.users.messages.modify({ userId: "me", id: message.id!, requestBody: { addLabelIds: [labels[priority]] } });
  return priority;
}

export async function setPriority(gmail: Gmail, id: string, priority: Priority, labels: PriorityLabels) {
  await gmail.users.messages.modify({
    userId: "me",
    id,
    requestBody: { addLabelIds: [labels[priority]], removeLabelIds: PRIORITIES.filter((item) => item !== priority).map((item) => labels[item]) },
  });
}
