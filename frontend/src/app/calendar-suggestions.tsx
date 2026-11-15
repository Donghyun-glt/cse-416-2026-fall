"use client";

import { useEffect, useState } from "react";
import type { MailAnalysis } from "@/lib/mail-analysis";
import type { Priority } from "@/lib/mail-priority";
import { candidateKeys, type CalendarSuggestion } from "@/lib/calendar-suggestion";
import { calendarInstant } from "@/lib/calendar-time";

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

function Candidate({ candidate, candidateKey, messageId, storageKey }: { candidate: CalendarSuggestion; candidateKey: string; messageId: string; storageKey: string }) {
  const initialStart = candidate.startTime ? `${candidate.date}T${candidate.startTime}` : "";
  const [hidden, setHidden] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(candidate.title);
  const [allDay, setAllDay] = useState(!candidate.startTime);
  const [date, setDate] = useState(candidate.date);
  const [start, setStart] = useState(initialStart);
  // The email rarely states an end time or zone. Prefill editable defaults (one hour,
  // this device's zone) instead of leaving required fields blank; nothing is saved
  // until the user confirms the form.
  const [end, setEnd] = useState(candidate.endTime ? `${candidate.date}T${candidate.endTime}` : initialStart ? addHour(initialStart) : "");
  const [zone, setZone] = useState(() => candidate.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [location, setLocation] = useState(candidate.location);
  const [description, setDescription] = useState(() => [candidate.notes?.length ? candidate.notes.join("\n") : "", `From the email:\n${candidate.evidence}`].filter(Boolean).join("\n\n").slice(0, 8000));
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      try { setHidden(localStorage.getItem(`${storageKey}:${candidateKey}`) === "dismissed"); setSaved(localStorage.getItem(`${storageKey}:${candidateKey}`) === "saved"); } catch { /* Storage is optional. */ }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [storageKey, candidateKey]);
  const remember = (value: string) => { try { localStorage.setItem(`${storageKey}:${candidateKey}`, value); } catch { /* Storage is optional. */ } };
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
      setSaved(true); setEditing(false); remember("saved");
    } catch (cause) { setError(cause instanceof RangeError ? "Enter a valid time zone, e.g. Asia/Seoul." : cause instanceof Error ? cause.message : "Could not save the event."); }
    finally { setSaving(false); }
  }
  if (hidden) return null;
  if (saved) return <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">Added to calendar: {title}</p>;
  const field = "mt-1 w-full rounded-lg border border-[#d8d5df] p-2 text-sm";
  const checks = candidate.warnings?.length ?? 0;
  const assumed = !candidate.endTime || !candidate.timeZone;
  return <article className="rounded-xl border border-[#ded8f7] p-4 text-sm">
    <p className="font-semibold">{candidate.title}</p>
    <p className="mt-1 text-[#666]">{whenLabel(candidate.date, candidate.startTime)}{candidate.timeZone ? ` · ${candidate.timeZone}` : ""}{candidate.location ? ` · ${candidate.location}` : ""}</p>
    <details className="mt-2 text-xs text-[#666]">
      <summary className="cursor-pointer text-[#5944d8]">Details{checks ? ` · ${checks} to check` : ""}</summary>
      {[candidate.evidence, ...(candidate.supportingEvidence ?? []).filter((quote) => !candidate.evidence.includes(quote))].map((quote, index) => <blockquote key={index} className="mt-2 whitespace-pre-wrap border-l-2 border-[#b9acf4] pl-3">{quote}</blockquote>)}
      {Boolean(candidate.notes?.length) && <ul className="mt-2 list-disc space-y-1 pl-4">{candidate.notes!.map((note, index) => <li key={index}>{note}</li>)}</ul>}
      {checks > 0 && <ul className="mt-2 list-disc space-y-1 rounded-lg bg-amber-50 p-3 pl-6 text-amber-900">{candidate.warnings!.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    </details>
    {!editing ? <div className="mt-3 flex gap-3"><button onClick={() => setEditing(true)} className="rounded-lg bg-[#5944d8] px-3 py-2 font-semibold text-white">Edit &amp; add</button><button onClick={() => { remember("dismissed"); setHidden(true); }} className="px-2 py-2 text-[#666]">Dismiss</button></div> : <form onSubmit={save} className="mt-3 space-y-3 border-t border-[#ece9f7] pt-3">
      <label className="block">Title<input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={field} /></label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={allDay} onChange={(e) => { setAllDay(e.target.checked); setChecked(false); }} />All day</label>
      {allDay ? <label className="block">Date<input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} /></label> : <>
        <label className="block">Start<input type="datetime-local" required value={start} onChange={(e) => changeStart(e.target.value)} className={field} /></label>
        <label className="block">End<input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} className={field} /></label>
        <label className="block">Time zone<input required placeholder="Asia/Seoul" value={zone} onChange={(e) => setZone(e.target.value)} className={field} /></label>
        {assumed && <p className="text-xs text-amber-900">End time and time zone are defaults when the email does not state them.</p>}
      </>}
      <label className="block">Location<input maxLength={500} value={location} onChange={(e) => setLocation(e.target.value)} className={field} /></label>
      <label className="block">Notes<textarea rows={3} maxLength={8000} value={description} onChange={(e) => setDescription(e.target.value)} className={field} /></label>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" required checked={checked} onChange={(e) => setChecked(e.target.checked)} />I checked these details.</label>
      <div className="flex gap-3"><button disabled={!checked || saving} className="rounded-lg bg-[#5944d8] px-3 py-2 font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Add to calendar"}</button><button type="button" disabled={saving} onClick={() => setEditing(false)} className="px-2 py-2 text-[#666]">Cancel</button></div>
    </form>}
    {error && <p role="alert" className="mt-3 text-xs text-red-700">{error} {error === errorMessages.calendar_authorization_required && <a href="/api/google/connect" className="underline">Reconnect Google</a>}</p>}
  </article>;
}

export function CalendarSuggestions({ messageId, account, onAnalyzedPriority }: { messageId: string; account: string; onAnalyzedPriority?: (priority: Priority) => void }) {
  const [candidates, setCandidates] = useState<CalendarSuggestion[]>([]);
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
  const importanceLabel = { high: "Important", normal: "For your information", low: "Low importance" };
  const relevanceLabel = { recipient_action: "Action required", recipient_info: "Relevant information", optional: "Optional", unrelated: "Not directed at you", unclear: "Needs your review" };
  const kindLabel = { action: "Action", deadline: "Deadline", preparation: "Preparation", consequence: "Consequence", logistics: "Logistics", change: "Schedule change", information: "Information" };
  const keys = candidateKeys(candidates);
  return <section className="mb-4 space-y-4 rounded-2xl border border-[#e3e3e3] bg-white p-5 shadow-sm" aria-label="Email insights">
    <h2 className="text-xs font-bold uppercase tracking-wide text-[#5944d8]">Email insights</h2>
    {analysis && <>
      <div className="flex flex-wrap gap-2 text-xs font-semibold"><span className={`rounded-full px-3 py-1 ${analysis.importance === "high" ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{importanceLabel[analysis.importance]}</span><span className="rounded-full bg-[#eeecfb] px-3 py-1 text-[#5944d8]">{relevanceLabel[analysis.relevance]}</span></div>
      <p className="text-sm leading-6">{analysis.reason}</p>
      {analysis.keyPoints.length > 0 && <div><h3 className="mb-2 text-sm font-bold">What matters</h3><ul className="space-y-3">{analysis.keyPoints.map((point, index) => <li key={index} className={`rounded-lg border p-3 ${point.importance === "critical" ? "border-amber-200 bg-amber-50" : "border-[#e3e3e3]"}`}><span className="text-[10px] font-bold uppercase tracking-wide text-[#666]">{kindLabel[point.kind]}{point.owner === "other" ? " · Someone else's action" : point.owner === "unclear" ? " · Confirm who this applies to" : ""}</span><p className="mt-1 text-sm">{point.text}</p><details className="mt-2 text-xs text-[#666]"><summary className="cursor-pointer text-[#5944d8]">Source text</summary><blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-[#b9acf4] pl-2">{point.evidence}</blockquote></details></li>)}</ul></div>}
      {analysis.reviewNotes.map((note, index) => <p key={index} className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{note}</p>)}
      <p className="text-[10px] text-[#777]">AI-generated. Verify before acting.</p>
    </>}
    <div className="border-t border-[#e3e3e3] pt-3"><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[#5944d8]">Suggested events</h3>{status && <p role="status" className="text-xs text-[#666]">{status}</p>}</div>
    {failed && <button onClick={() => setRetry((value) => value + 1)} className="text-xs text-[#5944d8] underline">Retry analysis</button>}
    {candidates.map((candidate, index) => <Candidate key={keys[index]} candidate={candidate} candidateKey={keys[index]} messageId={messageId} storageKey={`mailflow-calendar:${account}:${messageId}`} />)}
  </section>;
}
