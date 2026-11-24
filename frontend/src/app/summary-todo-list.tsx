"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatSender, type Mail, type MailTodo } from "./mail-detail";
import { requestMessageAnalysis } from "@/lib/message-analysis-request";
import { SUMMARY_SECTIONS, deviceDay, summarySection } from "@/lib/summary-sections";
import { SectionHead, smallButton } from "./ui";

// Summary tab: the emails that still need something from the user, shown as things
// to do rather than as a mailbox. Which emails are listed is decided on the server
// (todo_items), separately from the Urgent / FYI / Low priority label. A row shows only
// its date; why it is listed (task, reply, event) is kept but not displayed.

type Status = MailTodo["status"];
const MAX_PARALLEL = 3;
const REFRESH_DELAY_MS = 1200;
const dueLabel = (due: string) => new Date(`${due}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

export function SummaryTodoList({ messages, searchQuery = "", search, pending, loading, error, onOpen, onRefresh }: {
  messages: Mail[];
  /** The search the list is already narrowed by; it only changes what an empty list says. */
  searchQuery?: string;
  /** The search box, shown under the heading. */
  search?: ReactNode;
  /** Recent emails not analysed yet; they are analysed here so Summary works on its own. */
  pending: string[];
  loading: boolean;
  error: string | null;
  onOpen: (message: Mail) => void;
  onRefresh: () => void;
}) {
  // What the user just clicked, shown at once; the refreshed list then confirms it.
  const [override, setOverride] = useState<Record<string, { status?: Status; confirmAudience?: boolean }>>({});
  const [failed, setFailed] = useState("");
  const [checking, setChecking] = useState(0);
  const started = useRef(new Set<string>());
  const queue = useRef<string[]>([]);
  const active = useRef(0);
  const alive = useRef(true);
  const refreshTimer = useRef<number | undefined>(undefined);
  const refresh = useRef(onRefresh);
  useEffect(() => { refresh.current = onRefresh; }, [onRefresh]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; window.clearTimeout(refreshTimer.current); };
  }, []);

  // Several analyses finishing close together share one list reload.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== undefined) return;
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = undefined;
      if (alive.current) refresh.current();
    }, REFRESH_DELAY_MS);
  }, []);

  // Have new mail analysed, three at a time. An analysis that adds a to-do reloads
  // the list right away, so items appear one by one instead of after the whole
  // batch; the last one reloads once more to pick up the next pending emails.
  const pump = useCallback(function run() {
    while (alive.current && active.current < MAX_PARALLEL && queue.current.length > 0) {
      const id = queue.current.shift()!;
      active.current++;
      void requestMessageAnalysis(id)
        .then(async (response) => response.ok && Boolean((await response.json().catch(() => null) as { todo?: unknown } | null)?.todo))
        .catch(() => false)
        .then((addedTodo) => {
          active.current--;
          if (!alive.current) return;
          setChecking((count) => Math.max(0, count - 1));
          if (addedTodo || (active.current === 0 && queue.current.length === 0)) scheduleRefresh();
          run();
        });
    }
  }, [scheduleRefresh]);

  const pendingKey = pending.join(",");
  useEffect(() => {
    const ids = (pendingKey ? pendingKey.split(",") : []).filter((id) => !started.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => started.current.add(id));
    queue.current.push(...ids);
    setChecking((count) => count + ids.length);
    pump();
  }, [pendingKey, pump]);

  // change: a new status (Done, Undo), or the answer to "Is this for you?".
  async function update(message: Mail, change: { status: Status } | { forMe: boolean }) {
    setFailed("");
    const shown = "status" in change ? { status: change.status } : change.forMe ? { confirmAudience: false } : { status: "not_relevant" as Status };
    setOverride((current) => ({ ...current, [message.id]: { ...current[message.id], ...shown } }));
    try {
      const response = await fetch(`/api/gmail/messages/${encodeURIComponent(message.id)}/todo`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify("status" in change ? { ...change, today: deviceDay() } : change) });
      if (!response.ok) throw new Error("todo_failed");
      refresh.current();
    } catch {
      setOverride((current) => { const next = { ...current }; delete next[message.id]; return next; });
      setFailed("Couldn’t update that item. Please try again.");
    }
  }

  const today = deviceDay();
  const items = messages.flatMap((message) => message.todo ? [{
    message, todo: message.todo, status: override[message.id]?.status ?? message.todo.status,
    asking: override[message.id]?.confirmAudience ?? message.todo.confirmAudience,
    // An item reopened here stays visible even when its date has passed (the server then files it as added by hand).
    section: summarySection(message.todo, today) ?? (override[message.id]?.status === "open" ? "manual" as const : null),
  }] : []);
  const open = items.filter((item) => item.status === "open" && item.section).sort((a, b) => (a.todo.dueDate ?? "9999").localeCompare(b.todo.dueDate ?? "9999") || Date.parse(b.message.date) - Date.parse(a.message.date));
  const done = items.filter((item) => item.status === "done");
  const dueToday = open.filter((item) => item.section === "today").length;
  const replies = open.filter((item) => item.todo.reasons.includes("reply")).length;
  const action = smallButton;

  const row = (item: (typeof items)[number]) => {
    const { message, todo } = item;
    const dated = item.section === "today" || item.section === "upcoming" || (item.status === "done" && Boolean(todo.dueDate));
    return (
      <li key={message.id} className="flex flex-col gap-2 py-[15px] sm:flex-row sm:items-start sm:gap-4">
        <button type="button" onClick={() => onOpen(message)} className="min-w-0 flex-1 text-left">
          <span className={`block text-sm font-bold leading-5 hover:text-mail-accent ${item.status === "done" ? "text-mail-muted line-through" : ""}`}>{todo.task || message.summary || message.subject || "(no subject)"}</span>
          <span className="mt-0.5 block truncate text-xs text-mail-muted">{formatSender(message.from)} — {message.subject || "(no subject)"}</span>
          {dated && todo.dueDate && <span className="mt-2 flex">
            <span className={`rounded-xl px-2 py-1 text-[10px] font-bold ${item.status === "done" ? "bg-mail-muted-surface text-mail-muted" : item.section === "today" ? "bg-mail-danger-tint text-mail-danger" : "bg-mail-warning-tint text-mail-warning"}`}>{dueLabel(todo.dueDate)}</span>
          </span>}
        </button>
        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
          {item.status === "open" ? <>
            {item.asking && <span role="group" aria-label="Is this for you?" className="flex items-center gap-1.5 rounded-lg border border-dashed border-mail-line py-0.5 pl-2.5 pr-1">
              <span className="text-xs font-semibold text-mail-secondary">Is this for you?</span>
              <button type="button" onClick={() => void update(message, { forMe: true })} className={action} title="Keep it in Summary">Yes</button>
              <button type="button" onClick={() => void update(message, { forMe: false })} className={action} title="Remove it from Summary">No</button>
            </span>}
            <button type="button" onClick={() => void update(message, { status: "done" })} className={action}>Done</button>
          </> : <button type="button" onClick={() => void update(message, { status: "open" })} className={action}>Undo</button>}
        </span>
      </li>
    );
  };

  return (
    <section aria-labelledby="summary-heading" aria-busy={loading}>
      <SectionHead eyebrow="To do" title={<span id="summary-heading">What still needs you</span>}
        detail={loading ? "Loading your summary…" : <span className="tabular-nums">{open.length} open{dueToday > 0 && <> · {dueToday} due today</>}{replies > 0 && <> · {replies} need a reply</>}</span>} />
      {search}
      {checking > 0 && <p role="status" className="mt-4 rounded-[10px] bg-mail-accent-tint px-4 py-2.5 text-xs font-semibold text-mail-accent">Checking {checking} new email{checking === 1 ? "" : "s"}…</p>}
      {(error || failed) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-mail-danger-line bg-mail-danger-tint px-4 py-3 text-[13px] text-mail-danger">
          <p role="alert">{failed || "Couldn’t load your summary."}</p>
          {!failed && <button type="button" onClick={onRefresh} className={smallButton}>Try again</button>}
        </div>
      )}
      <div className="mt-4">
      {loading && items.length === 0 ? (
        <p role="status" className="py-10 text-center text-sm text-mail-muted">Loading your summary…</p>
      ) : open.length > 0 ? SUMMARY_SECTIONS.map(([key, label]) => {
        const inGroup = open.filter((item) => item.section === key);
        return inGroup.length > 0 && (
          <div key={key} className="mt-5 first:mt-0">
            <h3 className="flex items-center gap-2 border-b border-mail-line pb-2.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-mail-accent">{label} <span className="rounded-full bg-mail-accent-tint px-2 py-0.5 text-[10px] tracking-normal">{inGroup.length}</span></h3>
            <ul className="divide-y divide-mail-line">{inGroup.map(row)}</ul>
          </div>
        );
      }) : searchQuery ? (
        <p role="status" className="py-10 text-center text-sm text-mail-muted">No open to-dos match “{searchQuery}”.{done.length > 0 && " Check Done recently below."}</p>
      ) : !error && checking === 0 && (
        <div className="py-12 text-center">
          <span aria-hidden="true" className="mx-auto grid size-11 place-items-center rounded-full bg-mail-success-tint text-mail-success">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-5"><path d="m5 12 4 4L19 6" /></svg>
          </span>
          <p className="mt-3 text-sm font-bold">Nothing left to do</p>
          <p className="mt-1 text-sm text-mail-muted">Emails that need something from you will appear here.</p>
        </div>
      )}
      {done.length > 0 && (
        <details className="mt-5 border-t border-mail-line pt-3">
          <summary className="cursor-pointer text-xs font-bold text-mail-muted">Done recently ({done.length})</summary>
          <ul className="mt-2 divide-y divide-mail-line">{done.map(row)}</ul>
        </details>
      )}
      </div>
    </section>
  );
}
