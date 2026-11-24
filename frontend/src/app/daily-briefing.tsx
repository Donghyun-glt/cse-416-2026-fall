"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { candidateKeys, type CalendarSuggestion } from "@/lib/calendar-suggestion";
import { requestMessageAnalysis } from "@/lib/message-analysis-request";
import { PRIORITIES, type Priority } from "@/lib/mail-priority";
import { formatSender, type Mail } from "./mail-detail";

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

type InsightData = { analysis?: { summary?: string; reason?: string }; candidates?: CalendarSuggestion[]; eventStates?: Record<string, StoredEventState>; priority?: Priority; prioritySaved?: boolean };

/** What a card shows, from a stored or fresh analysis of message `id`. */
function toInsight(id: string, data: InsightData & { analysis: NonNullable<InsightData["analysis"]> }): Insight {
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
  return insight;
}

/** One message analysed (or its stored analysis read back) through its own request. */
async function loadInsight(id: string): Promise<InsightResult> {
  // Waits and asks again by itself when the AI is rate limited or briefly unavailable.
  const response = await requestMessageAnalysis(id);
  const data = await response.json().catch(() => null) as InsightData | null;
  if (!response.ok || !data?.analysis) return { insight: memory.get(id) ?? null }; // Not analysable (or failed): the card keeps Gmail's snippet.
  return { insight: toInsight(id, { ...data, analysis: data.analysis }), priority: data.prioritySaved && PRIORITIES.includes(data.priority as Priority) ? data.priority : undefined };
}

const STORED_BATCH = 200; // The most ids /api/gmail/messages/insights takes at once.

/**
 * The stored analyses of many messages in one request per 200 (only database reads on the
 * server). Messages missing from the result have not been analysed yet. Throws when the
 * request fails, so the caller can fall back to asking message by message.
 */
async function loadStoredInsights(ids: string[]): Promise<Map<string, Insight>> {
  const batches = Array.from({ length: Math.ceil(ids.length / STORED_BATCH) }, (_, i) => ids.slice(i * STORED_BATCH, (i + 1) * STORED_BATCH));
  const found = new Map<string, Insight>();
  await Promise.all(batches.map(async (batch) => {
    const response = await fetch("/api/gmail/messages/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: batch }), cache: "no-store" });
    if (!response.ok) throw new Error("Stored insights could not be read.");
    const data = await response.json() as { insights?: Record<string, InsightData> };
    for (const [id, stored] of Object.entries(data.insights ?? {})) {
      if (stored.analysis) found.set(id, toInsight(id, { ...stored, analysis: stored.analysis }));
    }
  }));
  return found;
}

/**
 * A card whose priority the analysis changed moves to another group. Where the
 * browser supports view transitions the card slides there instead of jumping,
 * unless the user asked for reduced motion.
 */
function withCardMove(update: () => void) {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduceMotion || typeof document.startViewTransition !== "function") { update(); return; }
  document.startViewTransition(() => flushSync(update));
}

/**
 * Insights for the listed messages: stored ones in a single request, the others analysed a
 * few at a time. `undefined` = still loading, `null` = unavailable.
 */
function useInsights(messages: Mail[], onPriority: (id: string, priority: Priority) => void) {
  const ids = messages.map((message) => message.id);
  const [insights, setInsights] = useState<Record<string, Insight | null>>(() => Object.fromEntries(ids.flatMap((id) => memory.has(id) ? [[id, memory.get(id)!]] : [])));
  const started = useRef(new Set<string>());
  const queue = useRef<string[]>([]);
  const active = useRef(0);
  const alive = useRef(true);
  const notify = useRef(onPriority);
  const shownPriority = useRef(new Map<string, Priority>());
  useEffect(() => { notify.current = onPriority; }, [onPriority]);
  useEffect(() => { shownPriority.current = new Map(messages.map((message) => [message.id, message.priority])); }, [messages]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const pump = useCallback(function run() {
    while (alive.current && active.current < MAX_PARALLEL && queue.current.length) {
      const id = queue.current.shift()!;
      active.current++;
      void loadInsight(id).catch((): InsightResult => ({ insight: null })).then((result) => {
        active.current--;
        if (!alive.current) return;
        const apply = () => {
          setInsights((current) => ({ ...current, [id]: result.insight }));
          if (result.priority) notify.current(id, result.priority);
        };
        // Only a change of group moves the card; a summary replaces the snippet in place.
        if (result.priority && result.priority !== shownPriority.current.get(id)) withCardMove(apply);
        else apply();
        run();
      });
    }
  }, []);
  const idList = ids.join(",");
  useEffect(() => {
    const fresh = (idList ? idList.split(",") : []).filter((id) => !started.current.has(id));
    if (fresh.length === 0) return;
    for (const id of fresh) started.current.add(id);
    // Most cards were analysed before (on an earlier visit, or by Summary): read all of those
    // in one request and show them together. Only the rest need the AI, a few at a time.
    void loadStoredInsights(fresh).then((stored) => {
      if (!alive.current) return;
      if (stored.size > 0) setInsights((current) => ({ ...current, ...Object.fromEntries(stored) }));
      queue.current.push(...fresh.filter((id) => !stored.has(id)));
    }, () => {
      queue.current.push(...fresh); // Batch read unavailable: ask message by message, as before.
    }).finally(pump);
  }, [idList, pump]);
  return insights;
}

// Each priority is a lane with a tab on top, as in the design preview.
const lanes: Record<Priority, { label: string; short: string; lane: string; tab: string; text: string }> = {
  urgent: { label: "Urgent", short: "Urgent", lane: "border-mail-lane-urgent-line bg-mail-lane-urgent", tab: "bg-mail-danger-tint text-mail-danger", text: "text-mail-danger" },
  fyi: { label: "FYI", short: "FYI", lane: "border-mail-lane-fyi-line bg-mail-lane-fyi", tab: "bg-mail-warning-tint text-mail-warning", text: "text-mail-warning" },
  low: { label: "Low Priority", short: "Low", lane: "border-mail-lane-low-line bg-mail-lane-low", tab: "bg-mail-success-tint text-mail-success", text: "text-mail-success" },
};

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

function BriefingCard({ message, insight, onOpen }: { message: Mail; insight: Insight | null | undefined; onOpen: (message: Mail) => void }) {
  const sender = formatSender(message.from);
  const calendar = eventStatus(insight);
  const hasAttachment = message.attachments.some((attachment) => !attachment.inline);
  const summarizing = insight === undefined;
  return <button type="button" onClick={() => onOpen(message)} style={{ viewTransitionName: `briefing-card-${message.id}` }}
    className="group block w-full border-b border-mail-line bg-mail-surface/85 p-[18px] text-left transition first:rounded-t-xl last:rounded-b-xl last:border-b-0 hover:bg-mail-surface">
    <span className="flex items-center gap-2 text-[11px] text-mail-secondary">
      <span className={`min-w-0 flex-1 truncate ${message.unread ? "font-bold text-foreground" : ""}`}>{sender}</span>
      {summarizing && <span className="flex shrink-0 items-center gap-1 font-semibold text-mail-accent" title="MailFlow AI is reading this email">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" aria-hidden="true" />Summarizing
      </span>}
      {message.unread && <><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-mail-accent" aria-hidden="true" /><span className="sr-only">Unread</span></>}
      <time className="shrink-0 text-mail-muted">{timeLabel(message.date)}</time>
    </span>
    <b className={`mb-[5px] mt-2.5 block truncate text-sm ${message.unread ? "font-extrabold" : "font-bold"}`}>{message.subject || "(no subject)"}</b>
    {/* Gmail's snippet shows at once; the AI summary replaces it when it arrives. Both are
        clamped to two lines, so the card keeps its height. */}
    <span className={`line-clamp-2 block text-xs leading-[1.5] text-mail-muted transition-opacity duration-300 ${summarizing ? "opacity-70" : "opacity-100"}`}>{insight?.summary || message.snippet}</span>
    {(calendar || message.hasDraft || hasAttachment) && <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
      {calendar && <span className={`inline-flex max-w-full items-center gap-1.5 rounded-xl px-2 py-1 text-[11px] font-bold ${calendar.added ? "bg-mail-success-tint text-mail-success" : "bg-mail-accent-tint text-mail-accent"}`}><CalendarGlyph /><span className="truncate">{calendar.added ? "Added" : "Add to calendar?"} · {eventLabel(calendar.event)}</span></span>}
      {message.hasDraft && <span className="rounded-xl bg-mail-danger-tint px-2 py-1 text-[11px] font-bold text-mail-danger">Draft</span>}
      {hasAttachment && <span className="rounded-xl bg-mail-muted-surface px-2 py-1 text-[11px] font-bold text-mail-secondary">Attachment</span>}
    </span>}
    <span className="mt-3 block text-[11px] font-extrabold text-mail-accent">Read message →</span>
  </button>;
}

/** Today's inbox in three priority lanes; each card carries an AI summary and a calendar flag. */
export function DailyBriefing({ messages, onOpen, onPriority }: { messages: Mail[]; onOpen: (message: Mail) => void; onPriority: (id: string, priority: Priority) => void }) {
  const insights = useInsights(messages, onPriority);
  // Phones show one lane at a time, picked with the tabs below; it starts on the most
  // urgent lane that has mail. Wider screens show all three lanes side by side.
  const [chosenLane, setChosenLane] = useState<Priority | null>(null);
  const count = (priority: Priority) => messages.filter((message) => message.priority === priority).length;
  const phoneLane = chosenLane ?? PRIORITIES.find((priority) => count(priority) > 0) ?? "urgent";
  return <>
  <div role="tablist" aria-label="Priority" className="grid grid-cols-3 gap-1 rounded-[14px] bg-mail-muted-surface p-1 sm:hidden">
    {PRIORITIES.map((priority) => {
      const selected = priority === phoneLane;
      return <button key={priority} type="button" role="tab" aria-selected={selected} onClick={() => setChosenLane(priority)}
        className={`flex h-10 items-center justify-center gap-1.5 rounded-[11px] text-[13px] font-bold transition ${selected ? `bg-mail-surface shadow-[0_2px_8px_rgba(39,37,32,0.1)] ${lanes[priority].text}` : "text-mail-secondary"}`}>
        {lanes[priority].short}<span className={`rounded-full px-1.5 text-[11px] ${selected ? lanes[priority].tab : "bg-mail-hover"}`}>{count(priority)}</span>
      </button>;
    })}
  </div>
  {/* grid-cols-1 keeps a lane from growing wider than the screen when a subject is long. */}
  <div className="grid grid-cols-1 items-start gap-[18px] pt-[17px] max-sm:pt-0 md:grid-cols-2 xl:grid-cols-3">
    {PRIORITIES.map((priority) => {
      const group = messages.filter((message) => message.priority === priority);
      const lane = lanes[priority];
      return <section key={priority} aria-label={`${lane.label} emails`} className={`relative min-w-0 rounded-[17px] border px-[13px] pb-[13px] pt-[18px] shadow-[0_5px_18px_rgba(39,37,32,0.05)] max-sm:pt-[13px] ${lane.lane} ${priority === phoneLane ? "" : "max-sm:hidden"}`}>
        <h3 className={`absolute -top-[17px] right-4 z-[2] rounded-[10px_10px_3px_3px] px-4 py-[9px] text-xs font-extrabold leading-none shadow-[0_3px_8px_rgba(39,37,32,0.07)] max-sm:hidden ${lane.tab}`}>{group.length} {lane.label}</h3>
        {group.length === 0
          ? <p className="rounded-xl bg-mail-surface/60 px-4 py-6 text-center text-xs text-mail-muted">No {lane.label.toLowerCase()} email today.</p>
          : <div>{group.map((message) => <BriefingCard key={message.id} message={message} insight={insights[message.id]} onOpen={onOpen} />)}</div>}
      </section>;
    })}
  </div>
  </>;
}
