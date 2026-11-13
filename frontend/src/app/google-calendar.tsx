"use client";

import { useEffect, useState } from "react";

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

  return <div className="space-y-5">
    <section className="rounded-2xl border border-[#e1ded8] bg-white p-5 shadow-sm md:p-7">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-extrabold">{new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long" }).format(month)}</h2><div className="flex gap-2"><button onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(key(now)); }} className="rounded-lg border px-3 py-2 text-sm">Today</button><button aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="rounded-lg border px-3 py-2">‹</button><button aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="rounded-lg border px-3 py-2">›</button><button onClick={showForm} className="rounded-lg bg-[#5944d8] px-4 py-2 text-sm font-bold text-white">Add event</button></div></div>
      {reauthorize && <p className="mb-4 rounded-xl bg-[#eeecfb] p-4 text-sm">Calendar access is required. <a href="/api/google/connect" className="font-bold text-[#5944d8] underline">Reconnect Google account</a></p>}
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      <div className="grid grid-cols-7 border-l border-t border-[#e8e5df]">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <div key={day} className="border-b border-r py-2 text-center text-xs font-bold text-[#88847b]">{day}</div>)}{days.map((date) => { const current = key(date); const items = dayEvents(date); return <button key={current} onClick={() => { setSelected(current); if (date.getMonth() !== month.getMonth()) setMonth(new Date(date.getFullYear(), date.getMonth(), 1)); }} aria-pressed={current === selected} className={`min-h-20 overflow-hidden border-b border-r p-1 text-left md:min-h-24 ${date.getMonth() === month.getMonth() ? "bg-white" : "bg-[#faf9f7] text-[#aaa69d]"} ${current === selected ? "ring-2 ring-inset ring-[#5944d8]" : ""}`}><span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${current === key(new Date()) ? "bg-[#5944d8] text-white" : ""}`}>{date.getDate()}</span>{items.slice(0, 2).map((item, i) => <span key={`${item.id}-${i}`} className="mt-1 block truncate rounded bg-[#eeecfb] px-1 text-[10px] text-[#5742d5]">{item.title}</span>)}{items.length > 2 && <span className="text-[10px]">+{items.length - 2}</span>}</button>; })}</div>
      {loading && <p className="mt-3 text-sm text-[#88847b]">Loading events…</p>}
    </section>
    <section className="rounded-2xl border border-[#e1ded8] bg-white p-5 shadow-sm md:p-7"><h3 className="mb-4 text-lg font-extrabold">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(new Date(`${selected}T12:00:00`))} events</h3>{selectedEvents.length === 0 ? <p className="text-sm text-[#88847b]">No events for this day.</p> : <ul className="space-y-3">{selectedEvents.map((item, i) => <li key={`${item.id}-${i}`} className="rounded-xl border p-3"><strong className="block text-sm">{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-[#5944d8] underline">{item.title}</a> : item.title}</strong><span className="mt-1 block text-xs text-[#88847b]">{item.allDay ? "All day" : new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(item.start))}{item.location ? ` · ${item.location}` : ""}</span></li>)}</ul>}</section>
    {form && <form onSubmit={save} className="rounded-2xl border border-[#e1ded8] bg-white p-5 shadow-sm md:p-7"><h3 className="mb-4 text-lg font-extrabold">New event</h3><div className="grid gap-3 md:grid-cols-2"><label className="text-sm">Title<input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label><label className="text-sm">Location<input maxLength={500} value={location} onChange={(e) => setLocation(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label><label className="text-sm">Start<input required type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label><label className="text-sm">End<input required type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label></div><div className="mt-4 flex gap-2"><button disabled={saving} className="rounded-lg bg-[#5944d8] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? "Saving…" : "Save to Google Calendar"}</button><button type="button" onClick={() => setForm(false)} className="rounded-lg border px-4 py-2 text-sm">Cancel</button></div></form>}
  </div>;
}
