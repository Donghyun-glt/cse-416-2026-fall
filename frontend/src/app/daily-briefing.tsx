"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { candidateKeys, type CalendarSuggestion } from "@/lib/calendar-suggestion";
import { PRIORITIES, type Priority } from "@/lib/mail-priority";
import { formatSender, initials, type Mail } from "./mail-detail";

// What a briefing card shows beyond the list data: the AI summary and any event the
// message suggests. Both are decided once on the server (the first time a message is
// analysed, normally here) and stored, so this only reads them back afterwards.
type BriefingEvent = { key: string; title: string; date: string; startTime: string | null; status: "pending" | "saved" | "dismissed" };
type Insight = { summary: string; events: BriefingEvent[] };
type InsightResult = { insight: Insight | null; priority?: Priority };
type StoredEventState = { status?: BriefingEvent["status"]; details?: { title?: string; allDay?: boolean; date?: string; start?: string } };

// Shown instantly when the briefing is reopened in this tab, then refreshed from the server.
const memory = new Map<string, Insight>();
const MAX_PARALLEL = 3;

async function loadInsight(id: string): Promise<InsightResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`/api/gmail/messages/${encodeURIComponent(id)}/calendar-suggestions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
    if (response.status === 429) { await new Promise((resolve) => window.setTimeout(resolve, 15000)); continue; } // AI rate limit: wait, then retry.
    const data = await response.json().catch(() => null) as { analysis?: { summary?: string; reason?: string }; candidates?: CalendarSuggestion[]; eventStates?: Record<string, StoredEventState>; priority?: Priority; prioritySaved?: boolean } | null;
    if (!response.ok || !data?.analysis) return { insight: memory.get(id) ?? null }; // Not analysable (or failed): the card keeps Gmail's snippet.
    const candidates = data.candidates ?? [];
    const keys = candidateKeys(candidates);
    const insight: Insight = {
      summary: data.analysis.summary || data.analysis.reason || "",
      events: candidates.map((candidate, index) => {
        // The user's last edit of the event wins over what the email said.
        const state = data.eventStates?.[keys[index]];
        const edited = state?.details ?? {};
        const timed = edited.allDay === false && typeof edited.start === "string" && edited.start.length >= 16;
        return {
          key: keys[index], status: state?.status ?? "pending", title: edited.title || candidate.title,
          date: timed ? edited.start!.slice(0, 10) : edited.allDay && edited.date ? edited.date : candidate.date,
          startTime: timed ? edited.start!.slice(11, 16) : edited.allDay ? null : candidate.startTime,
        };
      }),
    };
    memory.set(id, insight);
    return { insight, priority: data.prioritySaved && PRIORITIES.includes(data.priority as Priority) ? data.priority : undefined };
  }
  return { insight: memory.get(id) ?? null };
}

/** Loads insights for the listed messages a few at a time; `undefined` = still loading, `null` = unavailable. */
function useInsights(ids: string[], onPriority: (id: string, priority: Priority) => void) {
  const [insights, setInsights] = useState<Record<string, Insight | null>>(() => Object.fromEntries(ids.flatMap((id) => memory.has(id) ? [[id, memory.get(id)!]] : [])));
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

const sections: Record<Priority, { label: string; header: string; dot: string }> = {
  urgent: { label: "Urgent", header: "bg-mail-danger-tint text-mail-danger", dot: "bg-[#d2444b]" },
  fyi: { label: "FYI", header: "bg-mail-warning-tint text-mail-warning", dot: "bg-[#c9952b]" },
  low: { label: "Low Priority", header: "bg-mail-success-tint text-mail-success", dot: "bg-[#5d9483]" },
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
function eventStatus(insight: Insight | null | undefined) {
  const events = insight?.events ?? [];
  const open = events.find((event) => event.status === "pending" && event.date >= localToday());
  if (open) return { event: open, added: false };
  const added = events.find((event) => event.status === "saved");
  return added ? { event: added, added: true } : null;
}

function CalendarGlyph() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>;
}

function BriefingCard({ message, insight, color, onOpen }: { message: Mail; insight: Insight | null | undefined; color: string; onOpen: (message: Mail) => void }) {
  const sender = formatSender(message.from);
  const calendar = eventStatus(insight);
  const hasAttachment = message.attachments.some((attachment) => !attachment.inline);
  return <button type="button" onClick={() => onOpen(message)}
    className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition hover:shadow-[0_3px_12px_rgba(31,31,27,0.08)] ${message.unread ? "border-mail-accent-line bg-mail-surface" : "border-mail-line bg-mail-muted-surface"}`}>
    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white" style={{ backgroundColor: color }}>{initials(sender)}</span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span className={`min-w-0 flex-1 truncate text-sm ${message.unread ? "font-extrabold" : "font-semibold text-mail-secondary"}`}>{sender} <span className={message.unread ? "font-bold" : "font-medium"}>— {message.subject || "(no subject)"}</span></span>
        {message.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-[#5944d8]" aria-label="Unread" />}
        <time className="shrink-0 text-xs text-mail-muted">{timeLabel(message.date)}</time>
      </span>
      {insight === undefined
        ? <span className="mt-2 block space-y-1.5" aria-label="Summarizing"><span className="block h-2.5 w-full animate-pulse rounded bg-mail-hover" /><span className="block h-2.5 w-1/2 animate-pulse rounded bg-mail-hover" /></span>
        : <span className="mt-1 line-clamp-2 block text-[13px] leading-5 text-mail-muted">{insight?.summary || message.snippet}</span>}
      {(calendar || message.hasDraft || hasAttachment) && <span className="mt-2 flex flex-wrap items-center gap-1.5">
        {calendar && <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${calendar.added ? "bg-mail-success-tint text-mail-success" : "bg-mail-accent-tint text-mail-accent"}`}><CalendarGlyph /><span className="truncate">{calendar.added ? "Added" : "Add to calendar?"} · {eventLabel(calendar.event)}</span></span>}
        {message.hasDraft && <span className="rounded-full bg-mail-danger-tint px-2.5 py-1 text-xs font-bold text-mail-danger">Draft</span>}
        {hasAttachment && <span className="rounded-full bg-mail-muted-surface px-2.5 py-1 text-xs font-bold text-mail-secondary">Attachment</span>}
      </span>}
    </span>
  </button>;
}

/** Today's inbox as a vertical list grouped by priority; each row carries an AI summary and a calendar flag. */
export function DailyBriefing({ messages, onOpen, onPriority }: { messages: Mail[]; onOpen: (message: Mail) => void; onPriority: (id: string, priority: Priority) => void }) {
  const insights = useInsights(messages.map((message) => message.id), onPriority);
  return <div className="space-y-5">
    {PRIORITIES.map((priority) => {
      const group = messages.filter((message) => message.priority === priority);
      if (group.length === 0) return null; // An empty group would only add white space.
      const section = sections[priority];
      return <section key={priority} aria-label={`${section.label} emails`}>
        <header className={`mb-2 inline-flex items-center gap-2 rounded-full px-3 py-1.5 ${section.header}`}>
          <span className={`h-2 w-2 rounded-full ${section.dot}`} aria-hidden="true" />
          <h3 className="text-xs font-extrabold uppercase tracking-wide">{section.label}</h3>
          <span className="text-xs font-extrabold opacity-70">{group.length}</span>
        </header>
        <div className="space-y-2">
          {group.map((message) => <BriefingCard key={message.id} message={message} insight={insights[message.id]} color={avatarColors[messages.indexOf(message) % avatarColors.length]} onOpen={onOpen} />)}
        </div>
      </section>;
    })}
  </div>;
}
