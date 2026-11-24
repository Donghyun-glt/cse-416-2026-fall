"use client";

import { useEffect, useState } from "react";

type Answer = { id: string; answer: "yes" | "no"; about: "audience" | "kind"; text: string };

/**
 * Settings: what MailFlow remembered from the user's "Is this for you?" answers on the
 * Summary tab. Kept apart from About you, which only the user writes. Hidden when empty.
 */
export function SummaryAnswers() {
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [busy, setBusy] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/profile/answers", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { answers?: Answer[] } | null;
        if (response.ok && data?.answers) setAnswers(data.answers);
      })
      .catch(() => { /* Nothing to show; the list is optional. */ });
    return () => controller.abort();
  }, []);

  async function remove(id: string) {
    if (busy) return;
    setBusy(id); setFailed(false);
    try {
      const response = await fetch(`/api/profile/answers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("remove_failed");
      setAnswers((current) => current.filter((answer) => answer.id !== id));
    } catch { setFailed(true); }
    finally { setBusy(""); }
  }

  if (answers.length === 0) return null;
  return (
    <section className="mt-6 border-t border-mail-line pt-5" aria-labelledby="summary-answers-heading">
      <h3 id="summary-answers-heading" className="px-1 text-xs font-semibold text-mail-muted">Learned from your answers</h3>
      <p className="mt-1 px-1 text-xs leading-5 text-mail-muted">When Summary asked “Is this for you?”, MailFlow kept these so it does not ask again. They never change About you. Remove any that no longer fit.</p>
      <ul className="mt-3 divide-y divide-mail-line rounded-lg border border-mail-line">
        {answers.map((answer) => (
          <li key={answer.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 break-words"><span className="font-semibold">{answer.answer === "yes" ? "Yes" : "No"}</span> · {answer.about === "audience" ? "mail for " : ""}{answer.text}</span>
            <button type="button" onClick={() => void remove(answer.id)} disabled={Boolean(busy)} className="shrink-0 text-xs font-semibold text-mail-danger hover:underline disabled:opacity-50">{busy === answer.id ? "Removing…" : "Remove"}</button>
          </li>
        ))}
      </ul>
      {failed && <p role="alert" className="mt-2 px-1 text-xs text-mail-danger">Couldn’t remove that. Please try again.</p>}
    </section>
  );
}
