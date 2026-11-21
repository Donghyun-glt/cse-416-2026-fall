"use client";

import { useEffect, useState } from "react";
import { ABOUT_ROLES, ABOUT_ROLE_LABELS, ABOUT_TEXT_LIMIT, EMPTY_ABOUT, type UserAbout } from "@/lib/user-about";

const textFields = [
  ["organization", "Organization", "e.g. SUNY Korea"],
  ["department", "Major or department", "e.g. Computer Science"],
  ["interests", "Topics you care about", "e.g. internships, scholarships"],
  ["notes", "Anything else", "e.g. I am a club officer"],
] as const;

/** Settings section where the user tells MailFlow about themselves. Every field is optional. */
export function AboutYouForm() {
  const [about, setAbout] = useState<UserAbout>(EMPTY_ABOUT);
  const [saved, setSaved] = useState<UserAbout>(EMPTY_ABOUT);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "load_failed">("loading");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/profile/about", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { about?: UserAbout } | null;
        if (!response.ok || !data?.about) throw new Error("load_failed");
        setAbout(data.about); setSaved(data.about); setStatus("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setStatus("load_failed"); });
    return () => controller.abort();
  }, []);

  const busy = status === "loading" || status === "saving";
  const changed = JSON.stringify(about) !== JSON.stringify(saved);
  const hasSaved = JSON.stringify(saved) !== JSON.stringify(EMPTY_ABOUT);
  const set = (field: keyof UserAbout, value: string) => { setAbout((current) => ({ ...current, [field]: value })); setMessage(null); };

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !changed) return;
    setStatus("saving"); setMessage(null);
    try {
      const response = await fetch("/api/profile/about", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(about) });
      const data = await response.json().catch(() => null) as { about?: UserAbout } | null;
      if (!response.ok || !data?.about) throw new Error("save_failed");
      setAbout(data.about); setSaved(data.about);
      setMessage({ kind: "ok", text: "Saved." });
    } catch { setMessage({ kind: "error", text: "Couldn’t save. Please try again." }); }
    finally { setStatus("ready"); }
  }
  async function clear() {
    if (busy) return;
    setStatus("saving"); setMessage(null);
    try {
      const response = await fetch("/api/profile/about", { method: "DELETE" });
      if (!response.ok) throw new Error("clear_failed");
      setAbout(EMPTY_ABOUT); setSaved(EMPTY_ABOUT);
      setMessage({ kind: "ok", text: "Cleared." });
    } catch { setMessage({ kind: "error", text: "Couldn’t clear. Please try again." }); }
    finally { setStatus("ready"); }
  }

  const label = "block text-xs font-semibold text-mail-secondary";
  const field = "mt-1 w-full rounded-lg border border-mail-line bg-mail-surface px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-mail-accent/40 disabled:opacity-60";
  return (
    <form onSubmit={save} className="mt-6 border-t border-mail-line pt-5" aria-busy={busy}>
      <h3 className="px-1 text-xs font-semibold text-mail-muted">About you</h3>
      <p className="mt-1 px-1 text-xs leading-5 text-mail-muted">Optional. Helps MailFlow tell which emails concern you. Only you can change these; MailFlow never fills them in or edits them. Please leave out sensitive details.</p>
      {status === "load_failed" ? <p role="alert" className="mt-3 rounded-lg bg-mail-danger-tint px-3 py-2 text-xs text-mail-danger">Couldn’t load your details. Close Settings and try again.</p> : (
        <div className="mt-3 space-y-3">
          <label className={label}>Role
            <select value={about.role} onChange={(event) => set("role", event.target.value)} disabled={busy} className={field}>
              <option value="">Not specified</option>
              {ABOUT_ROLES.map((role) => <option key={role} value={role}>{ABOUT_ROLE_LABELS[role]}</option>)}
            </select>
          </label>
          {textFields.map(([name, text, placeholder]) => (
            <label key={name} className={label}>
              <span className="flex justify-between"><span>{text}</span><span className="font-normal tabular-nums text-mail-muted">{[...about[name]].length}/{ABOUT_TEXT_LIMIT}</span></span>
              <input value={about[name]} onChange={(event) => set(name, event.target.value)} maxLength={ABOUT_TEXT_LIMIT} placeholder={placeholder} disabled={busy} autoComplete="off" className={field} />
            </label>
          ))}
          <div className="flex items-center gap-3 pt-1">
            <button type="submit" disabled={busy || !changed} className="h-9 rounded-lg bg-[#5944d8] px-4 text-sm font-semibold text-white transition hover:bg-[#4b3dc0] disabled:cursor-not-allowed disabled:opacity-50">{status === "saving" ? "Saving…" : "Save"}</button>
            {hasSaved && <button type="button" onClick={() => void clear()} disabled={busy} className="text-sm font-semibold text-mail-danger hover:underline disabled:opacity-50">Clear all</button>}
            {message && <span role={message.kind === "error" ? "alert" : "status"} className={`text-xs ${message.kind === "error" ? "text-mail-danger" : "text-mail-success"}`}>{message.text}</span>}
          </div>
        </div>
      )}
    </form>
  );
}
