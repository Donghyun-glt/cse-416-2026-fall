"use client";

import { useEffect, useState } from "react";
import { SectionHead, chip, field, primaryButton, secondaryButton } from "./ui";

type Event = { id: string; title: string; start: string; end: string; allDay: boolean; location: string; url: string };
const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const inputTime = (date: Date) => `${key(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

export function GoogleCalendar() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(() => key(new Date()));
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reauthorize, setReauthorize] = useState(false);
  const [form, setForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [location, setLocation] = useState("");

  async function load(target: Date, signal?: AbortSignal) {
    setLoading(true);
    setError("");
    try {
      const first = new Date(target.getFullYear(), target.getMonth(), 1);
      const next = new Date(target.getFullYear(), target.getMonth() + 1, 1);
      const query = new URLSearchParams({ start: first.toISOString(), end: next.toISOString() });
      const response = await fetch(`/api/calendar/events?${query}`, { cache: "no-store", signal });
      const data = await response.json() as { error?: string; events?: Event[] };
      if (data.error === "calendar_authorization_required") { setReauthorize(true); setEvents([]); return; }
      if (data.error === "calendar_api_disabled") throw new Error("Enable the Google Calendar API in your Google Cloud project.");
      if (data.error === "calendar_rate_limited") throw new Error("Google Calendar is temporarily rate limited. Please try again shortly.");
      if (data.error === "calendar_forbidden") throw new Error("Google Calendar denied access. Check the connected account and calendar settings.");
      if (!response.ok) throw new Error("Could not load Google Calendar events.");
      setReauthorize(false);
      setEvents(data.events ?? []);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Could not load events.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void load(month, controller.signal), 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [month]);

  const gridStart = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
  const days = Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  const dayEvents = (date: Date) => events.filter((event) => {
    if (!event.start || !event.end) return false;
    const beginning = event.allDay ? new Date(`${event.start}T00:00:00`) : new Date(event.start);
    const ending = event.allDay ? new Date(`${event.end}T00:00:00`) : new Date(event.end);
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    return beginning < dayEnd && ending > dayStart;
  });
  const selectedEvents = dayEvents(new Date(`${selected}T00:00:00`));

  const showForm = () => {
    const date = new Date(`${selected}T09:00:00`);
    setStart(inputTime(date)); date.setHours(10); setEnd(inputTime(date));
    setTitle(""); setLocation(""); setError(""); setForm(true);
  };

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (new Date(end) <= new Date(start)) { setError("End time must be after start time."); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/calendar/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, start: new Date(start).toISOString(), end: new Date(end).toISOString(), location }) });
      const data = await response.json() as { error?: string };
      if (data.error === "calendar_authorization_required") { setReauthorize(true); throw new Error("Reconnect your Google account to grant calendar access."); }
      if (data.error === "calendar_api_disabled") throw new Error("Enable the Google Calendar API in your Google Cloud project.");
      if (data.error === "calendar_rate_limited") throw new Error("Google Calendar is temporarily rate limited. Please try again shortly.");
      if (data.error === "calendar_forbidden") throw new Error("Google Calendar denied access. Check the connected account and calendar settings.");
      if (!response.ok) throw new Error(response.status === 400 ? "Check the event details." : "Could not save the event.");
      setForm(false);
      await load(month);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the event."); }
    finally { setSaving(false); }
  }

  const monthLabel = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long" }).format(month);
  const todayKey = key(new Date());
  const label = "block text-xs font-extrabold";
  return <div className="space-y-8">
    <section>
      <SectionHead eyebrow={monthLabel} title="Your calendar"
        actions={<>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(key(now)); }} className={chip(false)}>Today</button>
            <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className={`${chip(false)} w-8 justify-center px-0 text-base`}>‹</button>
            <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className={`${chip(false)} w-8 justify-center px-0 text-base`}>›</button>
          </div>
          <button type="button" onClick={showForm} className={primaryButton}>+ Add event</button>
        </>} />
      {reauthorize && <p className="mb-4 rounded-[10px] bg-mail-accent-tint p-4 text-[13px]">Calendar access is required. <a href="/api/google/connect" className="font-bold text-mail-accent underline">Reconnect Google account</a></p>}
      {error && <p role="alert" className="mb-4 rounded-[10px] border border-mail-danger-line bg-mail-danger-tint p-4 text-[13px] text-mail-danger">{error}</p>}
      <div className="grid grid-cols-7 border-l border-t border-mail-line">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <b key={day} className="border-b border-r border-mail-line py-3 text-center text-[11px] font-bold text-mail-muted">{day}</b>)}
        {days.map((date) => {
          const current = key(date);
          const items = dayEvents(date);
          return <button key={current} type="button" aria-pressed={current === selected}
            onClick={() => { setSelected(current); if (date.getMonth() !== month.getMonth()) setMonth(new Date(date.getFullYear(), date.getMonth(), 1)); }}
            className={`flex min-h-[70px] flex-col justify-start overflow-hidden border-b border-r border-mail-line p-[3px] max-sm:min-h-[54px] max-sm:items-center text-left text-xs transition hover:bg-mail-muted-surface sm:min-h-[105px] sm:p-[9px] ${date.getMonth() === month.getMonth() ? "bg-mail-surface" : "bg-mail-muted-surface text-mail-muted"} ${current === selected ? "ring-2 ring-inset ring-mail-accent" : ""}`}>
            <span className={`inline-flex h-6 min-w-6 self-start items-center justify-center rounded-full px-1.5 ${current === todayKey ? "bg-[#5944d8] font-bold text-white" : ""}`}>{date.getDate()}</span>
            {items.slice(0, 2).map((item, i) => <small key={`${item.id}-${i}`} className="mt-1.5 block truncate rounded-[5px] bg-mail-accent-tint px-[5px] py-[3px] text-[8px] leading-[1.3] text-mail-accent max-sm:hidden sm:mt-2.5 sm:p-[5px] sm:text-[10px]">{item.title}</small>)}
            {items.length > 2 && <span className="mt-1 block text-[10px] text-mail-muted max-sm:hidden">+{items.length - 2} more</span>}
            {/* Phones: one dot per event (up to three); the list below the month names them. */}
            {items.length > 0 && <span className="mt-1.5 flex gap-[3px] sm:hidden" aria-label={`${items.length} event${items.length === 1 ? "" : "s"}`}>{items.slice(0, 3).map((item, i) => <span key={`${item.id}-${i}`} className="size-[5px] rounded-full bg-mail-accent" />)}</span>}
          </button>;
        })}
      </div>
      {loading && <p className="mt-3 text-[13px] text-mail-muted">Loading events…</p>}
    </section>
    <section className="border-t border-mail-line pt-7">
      <SectionHead eyebrow="Selected day" as="h3" title={new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${selected}T12:00:00`))} className="mb-0" />
      {selectedEvents.length === 0 ? <p className="mt-[18px] border-t border-mail-line pt-[13px] text-[13px] text-mail-muted">No events for this day.</p> : <ul className="mt-[18px]">{selectedEvents.map((item, i) => <li key={`${item.id}-${i}`} className="flex items-center gap-5 border-t border-mail-line py-[13px] text-[13px]">
        <strong className="w-[65px] shrink-0 text-mail-accent">{item.allDay ? "All day" : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(item.start))}</strong>
        <span className="min-w-0"><b className="block">{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-mail-accent underline-offset-2 hover:underline">{item.title}</a> : item.title}</b>{item.location && <small className="mt-[3px] block text-mail-muted">{item.location}</small>}</span>
      </li>)}</ul>}
    </section>
    {form && <form onSubmit={save} className="border-t border-mail-line pt-7">
      <SectionHead eyebrow="New event" as="h3" title="Add to Google Calendar" />
      <div className="grid gap-3 md:grid-cols-2">
        <label className={label}>Title<input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={`${field} mt-1.5`} /></label>
        <label className={label}>Location<input maxLength={500} value={location} onChange={(e) => setLocation(e.target.value)} className={`${field} mt-1.5`} /></label>
        <label className={label}>Start<input required type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className={`${field} mt-1.5`} /></label>
        <label className={label}>End<input required type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className={`${field} mt-1.5`} /></label>
      </div>
      <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setForm(false)} className={secondaryButton}>Cancel</button><button disabled={saving} className={primaryButton}>{saving ? "Saving…" : "Save to Google Calendar"}</button></div>
    </form>}
  </div>;
}
