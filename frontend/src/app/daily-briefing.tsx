"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { candidateKeys, type CalendarSuggestion } from "@/lib/calendar-suggestion";
import { PRIORITIES, type Priority } from "@/lib/mail-priority";
import { formatSender, initials, type Mail } from "./mail-detail";

// What a briefing card shows beyond the list data: the AI summary and any event the
// message suggests. It comes from the same full-body analysis the message page uses.
type BriefingEvent = { key: string; title: string; date: string; startTime: string | null };
type Insight = { summary: string; events: BriefingEvent[] };
type InsightResult = { insight: Insight | null; priority?: Priority };

// Each analysis is one LLM call, so results are kept for this tab (memory) and this
// browser (localStorage). Email content is not written to the MailFlow database.
const CACHE_PREFIX = "mailflow-insight:v1:";
const memory = new Map<string, Insight>();
const MAX_PARALLEL = 2;

function cachedInsight(id: string) {
  const known = memory.get(id);
  if (known) return known;
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_PREFIX + id) ?? "null") as Insight | null;
    if (stored && typeof stored.summary === "string" && Array.isArray(stored.events)) { memory.set(id, stored); return stored; }
  } catch { /* Storage is optional. */ }
  return null;
}

async function loadInsight(id: string): Promise<InsightResult> {
  const cached = cachedInsight(id);
  if (cached) return { insight: cached };
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`/api/gmail/messages/${encodeURIComponent(id)}/calendar-suggestions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
    if (response.status === 429) { await new Promise((resolve) => window.setTimeout(resolve, 15000)); continue; } // AI rate limit: wait, then retry.
    const data = await response.json().catch(() => null) as { analysis?: { summary?: string; reason?: string }; candidates?: CalendarSuggestion[]; priority?: Priority; prioritySaved?: boolean } | null;
    if (!response.ok || !data?.analysis) return { insight: null }; // Not analysable (or failed): the card keeps Gmail's snippet.
    const candidates = data.candidates ?? [];
    const keys = candidateKeys(candidates);
    const insight: Insight = { summary: data.analysis.summary || data.analysis.reason || "", events: candidates.map((candidate, index) => ({ key: keys[index], title: candidate.title, date: candidate.date, startTime: candidate.startTime })) };
    memory.set(id, insight);
    try { localStorage.setItem(CACHE_PREFIX + id, JSON.stringify(insight)); } catch { /* Storage is optional. */ }
    return { insight, priority: data.prioritySaved && PRIORITIES.includes(data.priority as Priority) ? data.priority : undefined };
  }
  return { insight: null };
}

/** Loads insights for the listed messages a few at a time; `undefined` = still loading, `null` = unavailable. */
function useInsights(ids: string[], onPriority: (id: string, priority: Priority) => void) {
  const [insights, setInsights] = useState<Record<string, Insight | null>>({});
  const started = useRef(new Set<string>());
  const queue = useRef<string[]>([]);
  const active = useRef(0);
  const alive = useRef(true);
  const notify = useRef(onPriority);
  useEffect(() => { notify.current = onPriority; }, [onPriority]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const pump = useCallback(function run() {
    while (alive.current && active.current < MAX_PARALLEL && queue.current.length) {
      const id = queue.current.shift()!;
      active.current++;
      void loadInsight(id).catch((): InsightResult => ({ insight: null })).then((result) => {
        active.current--;
        if (!alive.current) return;
        setInsights((current) => ({ ...current, [id]: result.insight }));
        if (result.priority) notify.current(id, result.priority);
        run();
      });
    }
  }, []);
  const idList = ids.join(",");
  useEffect(() => {
    for (const id of idList ? idList.split(",") : []) {
      if (started.current.has(id)) continue;
      started.current.add(id);
      queue.current.push(id);
    }
    pump();
  }, [idList, pump]);
  return insights;
}

const sections: Record<Priority, { label: string; hint: string; header: string; dot: string }> = {
  urgent: { label: "Urgent", hint: "Needs you soon", header: "bg-[#fce9e9] text-[#a82f35]", dot: "bg-[#d2444b]" },
  fyi: { label: "FYI", hint: "Worth knowing", header: "bg-[#fbf2dc] text-[#89651f]", dot: "bg-[#c9952b]" },
  low: { label: "Low Priority", hint: "Can wait", header: "bg-[#e8f1ee] text-[#416c60]", dot: "bg-[#5d9483]" },
};
const avatarColors = ["#b64b3b", "#4674a0", "#7751b2", "#4b806a", "#8f7a44"];

function timeLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}
function eventLabel(event: BriefingEvent) {
  const day = new Date(`${event.date}T${event.startTime ?? "00:00"}:00Z`);
  if (Number.isNaN(day.getTime())) return event.date;
  return day.toLocaleString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", ...(event.startTime ? { hour: "numeric", minute: "2-digit" } : {}) });
}
function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
/** The first suggested event the user still has to decide on, or one they already added. */
function eventStatus(insight: Insight | null | undefined, account: string, messageId: string) {
  let added: BriefingEvent | null = null;
  for (const event of insight?.events ?? []) {
    let state: string | null = null;
    try { state = localStorage.getItem(`mailflow-calendar:${account}:${messageId}:${event.key}`); } catch { /* Storage is optional. */ }
    if (state === "dismissed") continue;
    if (state === "saved") { added ??= event; continue; }
    if (event.date >= localToday()) return { event, added: false };
  }
  return added ? { event: added, added: true } : null;
}

function CalendarGlyph() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>;
}

function BriefingCard({ message, insight, account, color, onOpen }: { message: Mail; insight: Insight | null | undefined; account: string; color: string; onOpen: (message: Mail) => void }) {
  const sender = formatSender(message.from);
  const calendar = eventStatus(insight, account, message.id);
  return <button type="button" onClick={() => onOpen(message)}
    className={`block w-full rounded-xl border p-3.5 text-left transition hover:-translate-y-px hover:shadow-[0_4px_14px_rgba(31,31,27,0.09)] ${message.unread ? "border-[#dcd8ee] bg-white" : "border-[#e6e4de] bg-[#f6f5f2]"}`}>
    <span className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white" style={{ backgroundColor: color }}>{initials(sender)}</span>
      <span className={`min-w-0 flex-1 truncate text-sm ${message.unread ? "font-extrabold" : "font-semibold text-[#55524c]"}`}>{sender}</span>
      {message.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-[#5944d8]" aria-label="Unread" />}
      <time className="shrink-0 text-xs text-[#96938b]">{timeLabel(message.date)}</time>
    </span>
    <span className={`mt-2 line-clamp-2 block text-sm leading-5 ${message.unread ? "font-bold" : "font-medium"}`}>{message.subject || "(no subject)"}</span>
    {insight === undefined
      ? <span className="mt-2 block space-y-1.5" aria-label="Summarizing"><span className="block h-2.5 w-full animate-pulse rounded bg-[#eceae5]" /><span className="block h-2.5 w-2/3 animate-pulse rounded bg-[#eceae5]" /></span>
      : <span className="mt-1.5 line-clamp-3 block text-[13px] leading-5 text-[#6f6b64]">{insight?.summary || message.snippet}</span>}
    {(calendar || message.hasDraft || message.attachments.some((attachment) => !attachment.inline)) && <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {calendar && <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${calendar.added ? "bg-[#e6f4ea] text-[#256c3b]" : "bg-[#eeecfb] text-[#5742d5]"}`}><CalendarGlyph /><span className="truncate">{calendar.added ? "Added" : "Add to calendar?"} · {eventLabel(calendar.event)}</span></span>}
      {message.hasDraft && <span className="rounded-full bg-[#fce8e6] px-2.5 py-1 text-xs font-bold text-[#c5221f]">Draft</span>}
      {message.attachments.some((attachment) => !attachment.inline) && <span className="rounded-full bg-[#efeee9] px-2.5 py-1 text-xs font-bold text-[#655f58]">Attachment</span>}
    </span>}
  </button>;
}

/** Today's inbox as three priority sections, each card carrying an AI summary and a calendar flag. */
export function DailyBriefing({ messages, account, onOpen, onPriority }: { messages: Mail[]; account: string; onOpen: (message: Mail) => void; onPriority: (id: string, priority: Priority) => void }) {
  const insights = useInsights(messages.map((message) => message.id), onPriority);
  return <div className="grid gap-4 lg:grid-cols-3">
    {PRIORITIES.map((priority) => {
      const group = messages.filter((message) => message.priority === priority);
      const section = sections[priority];
      return <section key={priority} aria-label={`${section.label} emails`} className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#e1ded8] bg-white shadow-[0_2px_8px_rgba(31,31,27,0.04)]">
        <header className={`flex items-center gap-2 px-4 py-3 ${section.header}`}>
          <span className={`h-2 w-2 rounded-full ${section.dot}`} aria-hidden="true" />
          <h3 className="text-xs font-extrabold uppercase tracking-wide">{section.label}</h3>
          <span className="text-xs font-semibold opacity-70">{section.hint}</span>
          <span className="ml-auto rounded-full bg-white/70 px-2 py-0.5 text-xs font-extrabold">{group.length}</span>
        </header>
        <div className="flex flex-1 flex-col gap-2.5 p-3">
          {group.length === 0 ? <p className="py-8 text-center text-sm text-[#a5a299]">Nothing here today</p>
            : group.map((message) => <BriefingCard key={message.id} message={message} insight={insights[message.id]} account={account} color={avatarColors[messages.indexOf(message) % avatarColors.length]} onOpen={onOpen} />)}
        </div>
      </section>;
    })}
  </div>;
}
