"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MailAnalysis } from "@/lib/mail-analysis";
import type { Priority } from "@/lib/mail-priority";
import { candidateKeys, type CalendarSuggestion } from "@/lib/calendar-suggestion";
import { calendarInstant } from "@/lib/calendar-time";
import { deviceDay, summarySection } from "@/lib/summary-sections";

const errorMessages: Record<string, string> = {
  calendar_api_disabled: "Enable the Google Calendar API in your Google Cloud project.",
  calendar_authorization_required: "Reconnect Google to grant calendar access.",
  calendar_rate_limited: "Google Calendar is busy. Try again shortly.",
  not_configured: "Calendar analysis is not configured on this server.",
  rate_limited: "AI is busy. Try again shortly.",
};

function addHour(local: string) {
  const next = new Date(`${local}:00Z`);
  if (!Number.isFinite(next.getTime())) return "";
  next.setUTCHours(next.getUTCHours() + 1);
  return next.toISOString().slice(0, 16);
}

function whenLabel(date: string, time: string | null) {
  const day = new Date(`${date}T${time ?? "00:00"}:00Z`);
  if (!Number.isFinite(day.getTime())) return date;
  return day.toLocaleString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", ...(time ? { hour: "numeric", minute: "2-digit" } : {}) });
}

type EventStatus = "pending" | "saved" | "dismissed";
type EventDetails = { title: string; allDay: boolean; date: string; start: string; end: string; zone: string; location: string; description: string };
export type EventState = { status: EventStatus; details: Partial<EventDetails> };
const text = (value: unknown, fallback: string) => typeof value === "string" ? value : fallback;

function Candidate({ candidate, candidateKey, messageId, initial }: { candidate: CalendarSuggestion; candidateKey: string; messageId: string; initial?: EventState }) {
  const kept = initial?.details ?? {};
  const initialStart = candidate.startTime ? `${candidate.date}T${candidate.startTime}` : "";
  const [status, setStatus] = useState<EventStatus>(initial?.status ?? "pending");
  const [editing, setEditing] = useState(false);
  // Every field starts from what the user last left (stored on the server), else from the email.
  const [title, setTitle] = useState(text(kept.title, candidate.title));
  const [allDay, setAllDay] = useState(typeof kept.allDay === "boolean" ? kept.allDay : !candidate.startTime);
  const [date, setDate] = useState(text(kept.date, candidate.date));
  const [start, setStart] = useState(text(kept.start, initialStart));
  // The email rarely states an end time or zone. Prefill editable defaults (one hour,
  // this device's zone) instead of leaving required fields blank; nothing is saved
  // to the calendar until the user confirms the form.
  const [end, setEnd] = useState(text(kept.end, candidate.endTime ? `${candidate.date}T${candidate.endTime}` : initialStart ? addHour(initialStart) : ""));
  const [zone, setZone] = useState(() => text(kept.zone, candidate.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone));
  const [location, setLocation] = useState(text(kept.location, candidate.location));
  const [description, setDescription] = useState(() => text(kept.description, [candidate.notes?.length ? candidate.notes.join("\n") : "", `From the email:\n${candidate.evidence}`].filter(Boolean).join("\n\n").slice(0, 8000)));
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Persist the user's last state of this event (edits, added, dismissed) on the server.
  const stateUrl = `/api/gmail/messages/${encodeURIComponent(messageId)}/calendar-suggestions/state`;
  const pending = useRef<{ status: EventStatus; details: EventDetails } | undefined>(undefined);
  const snapshot = JSON.stringify({ status, details: { title, allDay, date, start, end, zone, location, description } satisfies EventDetails });
  const stored = useRef(snapshot); // What the server already has (or the untouched defaults).
  const flush = useCallback(() => {
    const next = pending.current;
    if (!next) return;
    pending.current = undefined;
    void fetch(stateUrl, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: candidateKey, ...next }), keepalive: true }).catch(() => { /* Best effort; the next change writes again. */ });
  }, [stateUrl, candidateKey]);
  useEffect(() => {
    if (snapshot === stored.current) return; // Nothing changed.
    stored.current = snapshot;
    pending.current = JSON.parse(snapshot) as { status: EventStatus; details: EventDetails };
    if (status !== "pending") { flush(); return; } // Added or dismissed: write at once.
    const timer = window.setTimeout(flush, 800);
    return () => window.clearTimeout(timer);
  }, [snapshot, status, flush]);
  useEffect(() => flush, [flush]); // Leaving the message still writes the last edit.

  const changeStart = (value: string) => { setStart(value); if (value && (!end || end <= value)) setEnd(addHour(value)); };
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!checked || saving) return;
    setSaving(true); setError("");
    try {
      let eventStart: string, eventEnd: string;
      if (allDay) {
        eventStart = date;
        const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
        eventEnd = next.toISOString().slice(0, 10);
      } else {
        eventStart = calendarInstant(start, zone); eventEnd = calendarInstant(end, zone);
        if (eventEnd <= eventStart) throw new Error("End time must be after start time.");
      }
      const response = await fetch("/api/calendar/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, start: eventStart, end: eventEnd, allDay, location, description, sourceMessageId: messageId, sourceCandidateKey: candidateKey, approved: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(errorMessages[data.error] ?? "Could not save the event. Check the details and try again.");
      setStatus("saved"); setEditing(false);
    } catch (cause) { setError(cause instanceof RangeError ? "Enter a valid time zone, e.g. Asia/Seoul." : cause instanceof Error ? cause.message : "Could not save the event."); }
    finally { setSaving(false); }
  }
  if (status === "dismissed") return null;
  if (status === "saved") return <p role="status" className="rounded-xl bg-mail-success-tint p-3 text-sm text-mail-success">Added to calendar: {title}</p>;
  const field = "mt-1 w-full rounded-lg border border-mail-line p-2 text-sm";
  const checks = candidate.warnings?.length ?? 0;
  const assumed = !candidate.endTime || !candidate.timeZone;
  const shownDate = allDay ? date : start.slice(0, 10) || date;
  const shownTime = allDay || start.length < 16 ? null : start.slice(11, 16);
  return <article className="rounded-xl border border-mail-accent-line p-4 text-sm">
    <p className="font-semibold">{title}</p>
    <p className="mt-1 text-mail-secondary">{whenLabel(shownDate, shownTime)}{candidate.timeZone ? ` · ${candidate.timeZone}` : ""}{location ? ` · ${location}` : ""}</p>
    <details className="mt-2 text-xs text-mail-secondary">
      <summary className="cursor-pointer text-mail-accent">Details{checks ? ` · ${checks} to check` : ""}</summary>
      {[candidate.evidence, ...(candidate.supportingEvidence ?? []).filter((quote) => !candidate.evidence.includes(quote))].map((quote, index) => <blockquote key={index} className="mt-2 whitespace-pre-wrap border-l-2 border-mail-accent-line pl-3">{quote}</blockquote>)}
      {Boolean(candidate.notes?.length) && <ul className="mt-2 list-disc space-y-1 pl-4">{candidate.notes!.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      {checks > 0 && <ul className="mt-2 list-disc space-y-1 rounded-lg bg-mail-warning-tint p-3 pl-6 text-mail-warning">{candidate.warnings!.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    </details>
    {!editing ? <div className="mt-3 flex gap-3"><button onClick={() => setEditing(true)} className="rounded-lg bg-[#5944d8] px-3 py-2 font-semibold text-white">Edit &amp; add</button><button onClick={() => setStatus("dismissed")} className="px-2 py-2 text-mail-secondary">Dismiss</button></div> : <form onSubmit={save} className="mt-3 space-y-3 border-t border-mail-accent-line pt-3">
      <label className="block">Title<input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={field} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={allDay} onChange={(e) => { setAllDay(e.target.checked); setChecked(false); }} />All day</label>
      {allDay ? <label className="block">Date<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} /></label> : <>
        <label className="block">Start<input type="datetime-local" required value={start} onChange={(e) => changeStart(e.target.value)} className={field} /></label>
        <label className="block">End<input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} className={field} /></label>
        <label className="block">Time zone<input required placeholder="Asia/Seoul" value={zone} onChange={(e) => setZone(e.target.value)} className={field} /></label>
        {assumed && <p className="text-xs text-mail-warning">End time and time zone are defaults when the email does not state them.</p>}
      </>}
      <label className="block">Location<input maxLength={500} value={location} onChange={(e) => setLocation(e.target.value)} className={field} /></label>
      <label className="block">Notes<textarea rows={3} maxLength={8000} value={description} onChange={(e) => setDescription(e.target.value)} className={field} /></label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" required checked={checked} onChange={(e) => setChecked(e.target.checked)} />I checked these details.</label>
      <div className="flex gap-3"><button disabled={!checked || saving} className="rounded-lg bg-[#5944d8] px-3 py-2 font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Add to calendar"}</button><button type="button" disabled={saving} onClick={() => setEditing(false)} className="px-2 py-2 text-mail-secondary">Cancel</button></div>
    </form>}
    {error && <p role="alert" className="mt-3 text-xs text-mail-danger">{error} {error === errorMessages.calendar_authorization_required && <a href="/api/google/connect" className="underline">Reconnect Google</a>}</p>}
  </article>;
}

export function CalendarSuggestions({ messageId, onAnalyzedPriority }: { messageId: string; onAnalyzedPriority?: (priority: Priority) => void }) {
  const [candidates, setCandidates] = useState<CalendarSuggestion[]>([]);
  const [eventStates, setEventStates] = useState<Record<string, EventState>>({});
  // This message's place on the Summary tab (null = not listed). Separate from its priority.
  const [todo, setTodo] = useState<{ status: "open" | "done" | "not_relevant"; task: string; dueDate: string | null; reasons: string[] } | null>(null);
  // Listed there now: open, and dated today or later, waiting for a reply, or added by hand.
  const inSummary = todo?.status === "open" && summarySection({ dueDate: todo.dueDate ?? null, reasons: todo.reasons ?? [] }, deviceDay()) !== null;
  const [todoBusy, setTodoBusy] = useState(false);
  const markTodo = async (status: "open" | "done") => {
    if (todoBusy) return;
    setTodoBusy(true);
    try {
      const response = await fetch(`/api/gmail/messages/${encodeURIComponent(messageId)}/todo`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, today: deviceDay() }) });
      const data = await response.json().catch(() => null) as { todo?: typeof todo } | null;
      if (response.ok) setTodo(data?.todo ?? null);
    } finally { setTodoBusy(false); }
  };
  const [analysis, setAnalysis] = useState<MailAnalysis | null>(null);
  const [status, setStatus] = useState("Reading this email for important information…");
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setStatus("Reading this email for important information…"); setFailed(false);
      try {
        const response = await fetch(`/api/gmail/messages/${encodeURIComponent(messageId)}/calendar-suggestions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(errorMessages[data.error] ?? "Could not check this email for events.");
        if (controller.signal.aborted) return;
        setAnalysis(data.analysis ?? null);
        setEventStates(data.eventStates ?? {});
        setTodo(data.todo ?? null);
        setCandidates(data.candidates ?? []);
        if (data.prioritySaved && ["urgent", "fyi", "low"].includes(data.priority)) onAnalyzedPriority?.(data.priority);
        setStatus(data.note ?? (data.candidates?.length ? "" : "No event found in this email."));
      } catch (cause) {
        if (controller.signal.aborted) return;
        setFailed(true); setStatus(cause instanceof Error ? cause.message : "Could not check this email for events.");
      }
    }, 0);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [messageId, retry, onAnalyzedPriority]);
  const keys = candidateKeys(candidates);
  return <section className="mb-4 space-y-4 rounded-2xl border border-mail-line bg-mail-surface p-5 shadow-sm" aria-label="Email insights">
    <h2 className="text-xs font-bold uppercase tracking-wide text-mail-accent">Email insights</h2>
    {analysis && <>
      <p className="text-sm leading-6">{analysis.reason}</p>
      {analysis.reviewNotes.map((note, index) => <p key={index} className="rounded-lg bg-mail-warning-tint p-3 text-xs text-mail-warning">{note}</p>)}
    </>}
    {analysis && <div className="flex items-center justify-between gap-3 border-t border-mail-line pt-3 text-xs">
      <span className="min-w-0 text-mail-secondary">{inSummary ? <>In Summary{todo.task ? <>: <span className="font-semibold text-foreground">{todo.task}</span></> : ""}</> : todo?.status === "done" ? "Marked done in Summary" : "Not in Summary"}</span>
      <button type="button" disabled={todoBusy} onClick={() => void markTodo(inSummary ? "done" : "open")} className="shrink-0 rounded-lg border border-mail-line px-2.5 py-1 font-semibold text-mail-secondary hover:bg-mail-muted-surface disabled:opacity-50">{inSummary ? "Mark done" : "Add to Summary"}</button>
    </div>}
    <div className="border-t border-mail-line pt-3"><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-mail-accent">Suggested events</h3>{status && <p role="status" className="text-xs text-mail-secondary">{status}</p>}</div>
    {failed && <button onClick={() => setRetry((value) => value + 1)} className="text-xs text-mail-accent underline">Retry analysis</button>}
    {candidates.map((candidate, index) => <Candidate key={keys[index]} candidate={candidate} candidateKey={keys[index]} messageId={messageId} initial={eventStates[keys[index]]} />)}
  </section>;
}
