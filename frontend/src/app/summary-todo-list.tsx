"use client";

import { useEffect, useRef, useState } from "react";
import { formatSender, type Mail, type MailTodo } from "./mail-detail";

// Summary tab: the emails that still need something from the user, shown as things
// to do rather than as a mailbox. Which emails are listed is decided on the server
// (todo_items), separately from the Urgent / FYI / Low priority label.

type Status = MailTodo["status"];
const reasonLabel: Record<string, string> = { task: "To do", reply: "Reply needed", event: "Calendar", manual: "Added by you" };
const groups = [["today", "Today"], ["week", "Next 7 days"], ["later", "Later"], ["undated", "No deadline"], ["past", "Past deadline"]] as const;
type GroupKey = (typeof groups)[number][0];

const localDay = (offset = 0) => {
  const day = new Date(); day.setDate(day.getDate() + offset);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
};
function groupOf(due: string | null): GroupKey {
  if (!due) return "undated";
  if (due < localDay()) return "past";
  if (due === localDay()) return "today";
  return due <= localDay(7) ? "week" : "later";
}
const dueLabel = (due: string) => new Date(`${due}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

export function SummaryTodoList({ messages, pending, loading, error, onOpen, onRefresh }: {
  messages: Mail[];
  /** Recent emails not analysed yet; they are analysed here so Summary works on its own. */
  pending: string[];
  loading: boolean;
  error: string | null;
  onOpen: (message: Mail) => void;
  onRefresh: () => void;
}) {
  // What the user just clicked, shown at once; the refreshed list then confirms it.
  const [override, setOverride] = useState<Record<string, Status>>({});
  const [failed, setFailed] = useState("");
  const [checking, setChecking] = useState(0);
  const started = useRef(new Set<string>());
  const refresh = useRef(onRefresh);
  useEffect(() => { refresh.current = onRefresh; }, [onRefresh]);

  // Have new mail analysed, three at a time, then reload the list once.
  const pendingKey = pending.join(",");
  useEffect(() => {
    const ids = (pendingKey ? pendingKey.split(",") : []).filter((id) => !started.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => started.current.add(id));
    let alive = true;
    setChecking((count) => count + ids.length);
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await fetch(`/api/gmail/messages/${encodeURIComponent(id)}/calendar-suggestions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) }).catch(() => null);
          if (response?.status !== 429) break;
          await new Promise((resolve) => window.setTimeout(resolve, 15000)); // AI rate limit: wait, then retry once.
        }
        if (alive) setChecking((count) => Math.max(0, count - 1));
      }
    };
    void Promise.all([worker(), worker(), worker()]).then(() => { if (alive) refresh.current(); });
    return () => { alive = false; };
  }, [pendingKey]);

  async function mark(message: Mail, status: Status) {
    setFailed("");
    setOverride((current) => ({ ...current, [message.id]: status }));
    try {
      const response = await fetch(`/api/gmail/messages/${encodeURIComponent(message.id)}/todo`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      if (!response.ok) throw new Error("todo_failed");
      refresh.current();
    } catch {
      setOverride((current) => { const next = { ...current }; delete next[message.id]; return next; });
      setFailed("Couldn’t update that item. Please try again.");
    }
  }

  const items = messages.flatMap((message) => message.todo ? [{ message, todo: message.todo, status: override[message.id] ?? message.todo.status }] : []);
  const open = items.filter((item) => item.status === "open").sort((a, b) => (a.todo.dueDate ?? "9999").localeCompare(b.todo.dueDate ?? "9999") || Date.parse(b.message.date) - Date.parse(a.message.date));
  const done = items.filter((item) => item.status === "done");
  const dueToday = open.filter((item) => item.todo.dueDate === localDay()).length;
  const replies = open.filter((item) => item.todo.reasons.includes("reply")).length;
  const action = "rounded-lg border border-mail-line bg-mail-surface px-2.5 py-1 text-xs font-semibold text-mail-secondary transition-colors hover:bg-mail-muted-surface";

  const row = (item: (typeof items)[number]) => {
    const { message, todo } = item;
    const group = groupOf(todo.dueDate);
    return (
      <li key={message.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4 sm:px-6">
        <button type="button" onClick={() => onOpen(message)} className="min-w-0 flex-1 text-left">
          <span className={`block text-sm font-bold leading-5 ${item.status === "done" ? "text-mail-muted line-through" : ""}`}>{todo.task || message.summary || message.subject || "(no subject)"}</span>
          <span className="mt-0.5 block truncate text-xs text-mail-muted">{formatSender(message.from)} — {message.subject || "(no subject)"}</span>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {todo.dueDate && <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${group === "past" ? "bg-mail-muted-surface text-mail-muted" : group === "today" ? "bg-mail-danger-tint text-mail-danger" : "bg-mail-warning-tint text-mail-warning"}`}>{group === "past" ? "Was due" : "Due"} {dueLabel(todo.dueDate)}</span>}
            {todo.reasons.map((reason) => <span key={reason} className="rounded-full bg-mail-accent-tint px-2 py-0.5 text-xs font-bold text-mail-accent">{reasonLabel[reason] ?? reason}</span>)}
            {todo.confirmAudience && <span className="rounded-full border border-mail-line px-2 py-0.5 text-xs font-semibold text-mail-secondary">Check if this applies to you</span>}
          </span>
        </button>
        <span className="flex shrink-0 gap-1.5">
          {item.status === "open" ? <>
            <button type="button" onClick={() => void mark(message, "done")} className={action}>Done</button>
            <button type="button" onClick={() => void mark(message, "not_relevant")} className={action} title="Remove from Summary: this is not for me">Not for me</button>
          </> : <button type="button" onClick={() => void mark(message, "open")} className={action}>Undo</button>}
        </span>
      </li>
    );
  };

  return (
    <section aria-labelledby="summary-heading" aria-busy={loading} className="overflow-hidden rounded-2xl border border-mail-line bg-mail-surface shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-mail-line px-4 py-4 sm:px-6">
        <h2 id="summary-heading" className="text-sm font-semibold tracking-tight sm:text-base">To do</h2>
        {!loading && <p className="text-xs tabular-nums text-mail-muted">{open.length} open{dueToday > 0 && <> · {dueToday} due today</>}{replies > 0 && <> · {replies} need a reply</>}</p>}
      </div>
      {checking > 0 && <p role="status" className="border-b border-mail-line bg-mail-muted-surface px-5 py-2 text-xs text-mail-muted">Checking {checking} new email{checking === 1 ? "" : "s"}…</p>}
      {(error || failed) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-mail-danger-line bg-mail-danger-tint px-5 py-3 text-sm text-mail-danger">
          <p role="alert">{failed || "Couldn’t load your summary."}</p>
          {!failed && <button type="button" onClick={onRefresh} className="rounded-lg border border-mail-danger-line bg-mail-surface px-3 py-1.5 font-semibold hover:bg-mail-muted-surface">Try again</button>}
        </div>
      )}
      {loading && items.length === 0 ? (
        <p role="status" className="px-5 py-10 text-center text-sm text-mail-muted">Loading your summary…</p>
      ) : open.length > 0 ? groups.map(([key, label]) => {
        const inGroup = open.filter((item) => groupOf(item.todo.dueDate) === key);
        return inGroup.length > 0 && (
          <div key={key}>
            <h3 className="border-b border-mail-line bg-mail-muted-surface px-4 py-1.5 text-xs font-extrabold uppercase tracking-wide text-mail-secondary sm:px-6">{label} <span className="font-semibold text-mail-muted">{inGroup.length}</span></h3>
            <ul className="divide-y divide-mail-line border-b border-mail-line">{inGroup.map(row)}</ul>
          </div>
        );
      }) : !error && checking === 0 && (
        <div className="px-5 py-12 text-center">
          <span aria-hidden="true" className="mx-auto grid size-11 place-items-center rounded-full bg-mail-success-tint text-mail-success">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5"><path d="m5 12 4 4L19 6" /></svg>
          </span>
          <p className="mt-3 text-sm font-bold">Nothing left to do</p>
          <p className="mt-1 text-sm text-mail-muted">Emails that need something from you will appear here.</p>
        </div>
      )}
      {done.length > 0 && (
        <details className="border-t border-mail-line">
          <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-mail-muted sm:px-6">Done recently ({done.length})</summary>
          <ul className="divide-y divide-mail-line border-t border-mail-line">{done.map(row)}</ul>
        </details>
      )}
    </section>
  );
}
