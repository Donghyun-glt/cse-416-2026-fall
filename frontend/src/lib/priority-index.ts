import type { gmail_v1 } from "googleapis";
import { comparePriority, type Priority } from "./mail-priority";
import { ensurePriorityLabels, getOrAssignPriority } from "./gmail-priority";

type Entry = { id: string; date: string; priority: Priority };
type CacheEntry = { expiresAt: number; entries: Entry[] };
const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<Entry[]>>();
const versions = new Map<string, number>();

export function getReadyPriorityIndex(sessionId: string): Entry[] | null {
  const cached = cache.get(sessionId);
  return cached?.entries ?? null;
}

export function priorityIndexNeedsRefresh(sessionId: string): boolean {
  const cached = cache.get(sessionId);
  return (!cached || cached.expiresAt <= Date.now()) && !pending.has(sessionId);
}

export function invalidatePriorityIndex(sessionId: string) {
  const cached = cache.get(sessionId);
  if (cached) cached.expiresAt = 0;
  versions.set(sessionId, (versions.get(sessionId) ?? 0) + 1);
}

export function updatePriorityIndex(sessionId: string, id: string, priority: Priority) {
  const cached = cache.get(sessionId);
  if (cached) {
    const entry = cached.entries.find((item) => item.id === id);
    if (entry) entry.priority = priority;
    cached.entries.sort(comparePriority);
  }
  invalidatePriorityIndex(sessionId);
}

export function removeFromPriorityIndex(sessionId: string, id: string) {
  const cached = cache.get(sessionId);
  if (cached) cached.entries = cached.entries.filter((entry) => entry.id !== id);
  invalidatePriorityIndex(sessionId);
}

async function buildPriorityIndex(gmail: gmail_v1.Gmail, previous: Entry[] = []): Promise<Entry[]> {
  const labels = await ensurePriorityLabels(gmail);
  const known = new Map(previous.map((entry) => [entry.id, entry]));
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await gmail.users.messages.list({ userId: "me", maxResults: 500, pageToken });
    ids.push(...(page.data.messages ?? []).flatMap((message) => message.id ? [message.id] : []));
    pageToken = page.data.nextPageToken ?? undefined;
  } while (pageToken);

  const entries: Entry[] = ids.flatMap((id) => known.has(id) ? [known.get(id)!] : []);
  const newIds = ids.filter((id) => !known.has(id));
  // Bound simultaneous Gmail calls while indexing a large mailbox.
  for (let start = 0; start < newIds.length; start += 10) {
    const batch = await Promise.all(newIds.slice(start, start + 10).map(async (id) => {
      let message = (await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["Date", "Subject", "From"] })).data;
      if (message.labelIds?.includes("DRAFT")) return null;
      // Metadata has headers but no body snippet. Fetch full content only for an
      // email that has not yet received one of our priority labels.
      if (!Object.values(labels).some((label) => message.labelIds?.includes(label))) {
        message = (await gmail.users.messages.get({ userId: "me", id, format: "full" })).data;
      }
      const priority = await getOrAssignPriority(gmail, message, labels);
      const date = new Date(Number(message.internalDate ?? 0)).toISOString();
      return { id, date, priority } satisfies Entry;
    }));
    entries.push(...batch.filter((entry): entry is Entry => entry !== null));
  }
  return entries.sort(comparePriority);
}

export async function getPriorityIndex(sessionId: string, gmail: gmail_v1.Gmail): Promise<Entry[]> {
  const cached = cache.get(sessionId);
  if (cached && cached.expiresAt > Date.now()) return cached.entries;
  const existing = pending.get(sessionId);
  if (existing) {
    await existing;
    return getPriorityIndex(sessionId, gmail);
  }
  const version = versions.get(sessionId) ?? 0;
  const work = buildPriorityIndex(gmail, cached?.entries);
  pending.set(sessionId, work);
  try {
    const entries = await work;
    if ((versions.get(sessionId) ?? 0) === version) {
      cache.set(sessionId, { entries, expiresAt: Date.now() + 60_000 });
      return entries;
    }
    const refreshed = await buildPriorityIndex(gmail);
    cache.set(sessionId, { entries: refreshed, expiresAt: Date.now() + 60_000 });
    return refreshed;
  } finally {
    pending.delete(sessionId);
  }
}
