"use client";

import { useEffect, useId, useRef, useState } from "react";
import { GOOGLE_REAUTH_ATTEMPT_KEY } from "@/lib/google-login";
import type { MailTheme } from "@/lib/mail-theme";
import { initials } from "./mail-detail";
import { AboutYouForm } from "./about-you-form";

const icons = {
  chevrons: <path d="m8 9 4-4 4 4m-8 6 4 4 4-4" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M10 3h4l.6 2.3 1.8 1 2.3-.6 2 3.5-1.7 1.7v2.2l1.7 1.7-2 3.5-2.3-.6-1.8 1-.6 2.3h-4l-.6-2.3-1.8-1-2.3.6-2-3.5L5 13.1v-2.2L3.3 9.2l2-3.5 2.3.6 1.8-1L10 3Z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M20.9 13.3A9 9 0 0 1 10.7 3.1a9 9 0 1 0 10.2 10.2Z" />,
  logout: <path d="M10 17v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m4 1 4 4-4 4m-6-4h10" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
};

function AccountIcon({ name, className = "size-4" }: { name: keyof typeof icons; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{icons[name]}</svg>;
}

function ThemePicker({ theme, onChange }: { theme: MailTheme; onChange: (theme: MailTheme) => void }) {
  const name = useId();
  return (
    <fieldset>
      <legend className="mb-2 px-1 text-xs font-semibold text-mail-muted">Appearance</legend>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-mail-muted-surface p-1">
        {(["light", "dark"] as const).map((option) => (
          <label key={option} className="cursor-pointer">
            <input type="radio" name={name} value={option} checked={theme === option} onChange={() => onChange(option)} className="peer sr-only" />
            <span className="flex h-9 items-center justify-center gap-2 rounded-lg border border-transparent px-2 text-sm font-semibold capitalize text-mail-secondary transition-colors hover:text-foreground peer-checked:border-mail-line peer-checked:bg-mail-surface peer-checked:text-mail-accent peer-checked:shadow-xs peer-focus-visible:ring-2 peer-focus-visible:ring-mail-accent">
              <AccountIcon name={option === "light" ? "sun" : "moon"} />{option}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AccountMenu({ profile, theme, onThemeChange }: {
  profile: { name: string; email: string };
  theme: MailTheme;
  onThemeChange: (theme: MailTheme) => void;
}) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const menuId = useId();
  const settingsTitleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const settings = useRef<HTMLDialogElement>(null);
  const displayName = profile.name || "Gmail user";
  const email = profile.email || "Connected account";
  const avatar = profile.name ? initials(profile.name) : "G";

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError("");
    try {
      const response = await fetch("/api/google/logout", { method: "POST", mode: "same-origin" });
      if (!response.ok) throw new Error("Logout failed");
    } catch {
      setError("Couldn’t sign out. Please try again.");
      setSigningOut(false);
      return;
    }

    try {
      window.sessionStorage.removeItem(GOOGLE_REAUTH_ATTEMPT_KEY);
    } finally {
      window.location.replace("/");
    }
  }

  return (
    <>
      <div ref={root} className="relative max-w-[300px] lg:max-w-none"
        onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }}>
        <button ref={trigger} type="button" aria-label={`Account options for ${profile.email || displayName}`} aria-expanded={open} aria-controls={open ? menuId : undefined}
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-2.5 rounded-xl border border-transparent p-2 text-left transition-colors hover:bg-mail-muted-surface aria-expanded:border-mail-line aria-expanded:bg-mail-muted-surface">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-mail-accent-tint text-xs font-extrabold text-mail-accent" aria-hidden="true">{avatar}</span>
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{displayName}</span><span className="mt-0.5 block truncate text-xs text-mail-muted">{email}</span></span>
          <AccountIcon name="chevrons" className="size-4 shrink-0 text-mail-muted" />
        </button>

        {open && (
          <div id={menuId} className="absolute left-0 top-full z-40 mt-2 w-[min(17.5rem,calc(100vw-2rem))] space-y-2 rounded-2xl border border-mail-line bg-mail-surface p-2 text-foreground shadow-[0_16px_44px_rgba(23,17,51,.2)] lg:bottom-full lg:top-auto lg:mb-2 lg:mt-0">
            <button type="button" onClick={() => { setSettingsOpen(true); settings.current?.showModal(); setOpen(false); }}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm font-semibold transition-colors hover:bg-mail-muted-surface">
              <span className="grid size-8 place-items-center rounded-lg bg-mail-accent-tint text-mail-accent"><AccountIcon name="settings" /></span>
              Settings
            </button>
            <div className="px-2 pb-1"><ThemePicker theme={theme} onChange={onThemeChange} /></div>
            <div className="border-t border-mail-line pt-2">
              <button type="button" onClick={() => void signOut()} aria-disabled={signingOut}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm font-semibold text-mail-danger transition-colors hover:bg-mail-danger-tint aria-disabled:cursor-wait aria-disabled:opacity-70">
                <span className="grid size-8 place-items-center rounded-lg bg-mail-danger-tint"><AccountIcon name="logout" /></span>
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
              {error && <p role="alert" className="px-2 pb-1 pt-2 text-xs text-mail-danger">{error}</p>}
            </div>
          </div>
        )}
      </div>

      <dialog ref={settings} aria-labelledby={settingsTitleId} onClose={() => { setSettingsOpen(false); trigger.current?.focus(); }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border border-mail-line bg-mail-surface p-6 text-foreground shadow-2xl backdrop:bg-black/50">
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 id={settingsTitleId} className="text-xl font-extrabold tracking-tight">Settings</h2>
          <form method="dialog"><button type="submit" aria-label="Close settings" className="grid size-9 place-items-center rounded-full text-mail-secondary transition-colors hover:bg-mail-muted-surface"><AccountIcon name="close" /></button></form>
        </div>
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-mail-line bg-mail-muted-surface p-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-mail-accent-tint text-sm font-extrabold text-mail-accent" aria-hidden="true">{avatar}</span>
          <div className="min-w-0"><p className="break-words text-sm font-bold">{displayName}</p><p className="mt-1 break-all text-xs text-mail-muted">{email}</p></div>
        </div>
        <ThemePicker theme={theme} onChange={onThemeChange} />
        {/* Mounted while Settings is open, so it always shows what is stored now. */}
        {settingsOpen && <AboutYouForm />}
      </dialog>
    </>
  );
}
