"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

type Answer = { id: string; answer: "yes" | "no"; about: "audience" | "kind"; text: string };

/**
 * Settings: the personalization history, i.e. what MailFlow remembered from the user's
 * Yes / No answers to "Is this for you?" on the Summary tab. Kept apart from About you,
 * which only the user writes. The user can remove one entry here. The button at the
 * bottom deletes this history and the About-you details together, after a confirmation
 * that spells out what is and is not deleted; `onDeletedAll` lets Settings empty the
 * About-you fields on screen afterwards.
 */
export function SummaryAnswers({ onDeletedAll }: { onDeletedAll?: () => void }) {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "load_failed">("loading");
  const [busy, setBusy] = useState(""); // An answer id, or "all".
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const confirm = useRef<HTMLDialogElement>(null);
  const headingId = useId(), confirmTitleId = useId(), confirmTextId = useId();

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/profile/answers", { cache: "no-store", signal });
      const data = await response.json().catch(() => null) as { answers?: Answer[] } | null;
      if (!response.ok || !data?.answers) throw new Error("load_failed");
      setAnswers(data.answers); setStatus("ready");
    } catch { if (!signal?.aborted) setStatus("load_failed"); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => void load(controller.signal), 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [load]);

  async function remove(id: string) {
    if (busy) return;
    setBusy(id); setMessage(null);
    try {
      const response = await fetch(`/api/profile/answers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("remove_failed");
      setAnswers((current) => current.filter((answer) => answer.id !== id));
    } catch { setMessage({ kind: "error", text: "Couldn’t remove that. Please try again." }); }
    finally { setBusy(""); }
  }

  // Both stores, each through its own route. If one request fails the other may already
  // have gone through, so afterwards the screen is reloaded from what is actually stored.
  async function deleteAll() {
    if (busy) return;
    setBusy("all"); setMessage(null);
    try {
      const responses = await Promise.all([fetch("/api/profile/answers", { method: "DELETE" }), fetch("/api/profile/about", { method: "DELETE" })]);
      if (responses.some((response) => !response.ok)) throw new Error("delete_failed");
      setMessage({ kind: "ok", text: "Deleted." });
    } catch { setMessage({ kind: "error", text: "Couldn’t delete everything. Please try again." }); }
    finally {
      await load();
      onDeletedAll?.();
      setBusy(""); confirm.current?.close();
    }
  }

  return (
    <section className="mt-6 border-t border-mail-line pt-5" aria-labelledby={headingId}>
      <h3 id={headingId} className="px-1 text-xs font-semibold text-mail-muted">Personalization history</h3>
      <p className="mt-1 px-1 text-xs leading-5 text-mail-muted">When Summary asks “Is this for you?”, MailFlow may remember your Yes or No so it does not ask again about the same kind of mail. This is separate from About you and never changes it.</p>
      {status === "load_failed" ? <p role="alert" className="mt-3 rounded-lg bg-mail-danger-tint px-3 py-2 text-xs text-mail-danger">Couldn’t load your history. Close Settings and try again.</p> : <>
        {answers.length > 0 ? (
          <ul className="mt-3 divide-y divide-mail-line rounded-lg border border-mail-line">
            {answers.map((answer) => (
              <li key={answer.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 break-words"><span className="font-semibold">{answer.answer === "yes" ? "Yes" : "No"}</span> · {answer.about === "audience" ? "mail for " : ""}{answer.text}</span>
                <button type="button" onClick={() => void remove(answer.id)} disabled={Boolean(busy)} className="shrink-0 text-xs font-semibold text-mail-danger hover:underline disabled:opacity-50">{busy === answer.id ? "Removing…" : "Remove"}</button>
              </li>
            ))}
          </ul>
        ) : status === "ready" && <p className="mt-3 px-1 text-xs text-mail-muted">Nothing is saved yet.</p>}
      </>}
      <div className="mt-6 border-t border-mail-line pt-5">
        <p className="px-1 text-xs leading-5 text-mail-muted">Remove what MailFlow knows about you: your About you details and the personalization history above.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => { setMessage(null); confirm.current?.showModal(); }} disabled={status === "loading" || Boolean(busy)}
            className="h-9 rounded-lg border border-mail-danger-line px-4 text-sm font-semibold text-mail-danger transition-colors hover:bg-mail-danger-tint disabled:cursor-not-allowed disabled:opacity-50">Delete profile and personalization history</button>
          {message && <span role={message.kind === "error" ? "alert" : "status"} className={`text-xs ${message.kind === "error" ? "text-mail-danger" : "text-mail-success"}`}>{message.text}</span>}
        </div>
      </div>

      {/* Asked once more before anything is deleted. Opens above Settings; Esc or Cancel closes only this. */}
      <dialog ref={confirm} role="alertdialog" aria-labelledby={confirmTitleId} aria-describedby={confirmTextId}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-mail-line bg-mail-surface p-5 text-foreground shadow-2xl backdrop:bg-black/50">
        <h4 id={confirmTitleId} className="text-base font-extrabold tracking-tight">Delete your profile and personalization history?</h4>
        <div id={confirmTextId} className="mt-3 space-y-2 text-sm leading-6 text-mail-secondary">
          <p>This deletes both of these from MailFlow:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><span className="font-semibold text-foreground">About you:</span> your role, organization, topics and note. The fields above will be emptied, including anything typed but not saved.</li>
            <li><span className="font-semibold text-foreground">Personalization history:</span> everything remembered from your Yes / No answers to “Is this for you?” ({answers.length} saved).</li>
          </ul>
          <p>Emails already in Summary stay where they are. For new mail, MailFlow will know nothing about you, so it may ask “Is this for you?” more often.</p>
          <p className="font-semibold text-foreground">This cannot be undone.</p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => confirm.current?.close()} disabled={busy === "all"} className="h-9 rounded-lg border border-mail-line px-4 text-sm font-semibold text-mail-secondary hover:bg-mail-muted-surface disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => void deleteAll()} disabled={busy === "all"} className="h-9 rounded-lg bg-[#a82f35] px-4 text-sm font-semibold text-white transition hover:bg-[#8f272c] disabled:cursor-wait disabled:opacity-60">{busy === "all" ? "Deleting…" : "Delete all"}</button>
        </div>
      </dialog>
    </section>
  );
}
