"use client";

import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { GOOGLE_REAUTH_ATTEMPT_KEY } from "@/lib/google-login";
import type { MailTheme } from "@/lib/mail-theme";
import { initials } from "./mail-detail";
import { BottomSheet } from "./bottom-sheet";
import { useIsPhone } from "./use-is-phone";
import { AboutYouForm } from "./about-you-form";
import { SummaryAnswers } from "./summary-answers";

const icons = {
  chevronDown: <path d="m6 9 6 6 6-6" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M10 3h4l.6 2.3 1.8 1 2.3-.6 2 3.5-1.7 1.7v2.2l1.7 1.7-2 3.5-2.3-.6-1.8 1-.6 2.3h-4l-.6-2.3-1.8-1-2.3.6-2-3.5L5 13.1v-2.2L3.3 9.2l2-3.5 2.3.6 1.8-1L10 3Z" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  moon: <path d="M20.9 13.3A9 9 0 0 1 10.7 3.1a9 9 0 1 0 10.2 10.2Z" />,
  logout: <path d="M10 17v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m4 1 4 4-4 4m-6-4h10" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
};

function AccountIcon({ name, className = "size-4" }: { name: keyof typeof icons; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{icons[name]}</svg>;
}

/** Initials on a purple gradient; `connected` adds the green "Gmail connected" dot. */
function ProfileAvatar({ label, picture = "", className = "size-9 text-xs", connected = false }: { label: string; picture?: string; className?: string; connected?: boolean }) {
  // The Google profile photo when there is one; the initials show until it loads and if it fails.
  const [failed, setFailed] = useState("");
  const showPicture = Boolean(picture) && failed !== picture;
  return (
    <span className={`relative flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#8b7bff] via-[#6a55e6] to-[#4a36c4] font-extrabold tracking-tight text-white shadow-[0_4px_12px_rgba(89,68,216,0.35)] ${className}`} aria-hidden="true">
      {label}
      {/* eslint-disable-next-line @next/next/no-img-element -- Google's image host, sized by the URL; next/image would need remote config for it */}
      {showPicture && <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setFailed(picture)} className="absolute inset-0 size-full rounded-full object-cover" />}
      {connected && <span className="absolute bottom-0 right-0 size-3 rounded-full bg-[#2fbf86] ring-2 ring-mail-surface" />}
    </span>
  );
}

/** True for a click on a modal dialog's backdrop: the dialog itself is the target, but the point lies outside its box. */
function outsideDialog(event: ReactMouseEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  const box = event.currentTarget.getBoundingClientRect();
  return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
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
  profile: { name: string; email: string; picture?: string };
  theme: MailTheme;
  onThemeChange: (theme: MailTheme) => void;
}) {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Bumped after "Delete profile and personalization history", so the About-you form reloads empty.
  const [aboutVersion, setAboutVersion] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const menuId = useId();
  const settingsTitleId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const settings = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  const displayName = profile.name || "Gmail user";
  const email = profile.email || "Connected account";
  const avatar = profile.name ? initials(profile.name) : "G";

  // Phones open the menu as a bottom sheet, which closes on its own backdrop, Escape and X.
  const isPhone = useIsPhone();
  useEffect(() => {
    if (!open || isPhone) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    // A click inside the email body (its own iframe document) never reaches this page,
    // but it does take focus away from the page, so that closes the menu too.
    const closeOnLeave = () => setOpen(false);
    document.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("blur", closeOnLeave);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("blur", closeOnLeave);
    };
  }, [isPhone, open]);

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

  // The menu's contents: a dropdown under the account button, or a bottom sheet on phones.
  const menuContent = (
    <>
    <div className="mb-1 flex items-center gap-3 rounded-[13px] bg-gradient-to-br from-mail-accent-tint to-transparent p-3">
      <ProfileAvatar label={avatar} picture={profile.picture} className="size-11 text-sm" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{displayName}</span>
        <span className="mt-0.5 block truncate text-xs text-mail-muted">{email}</span>
        <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-mail-success-tint px-2 py-0.5 text-[10px] font-bold text-mail-success"><span className="size-1.5 rounded-full bg-[#2fbf86]" aria-hidden="true" />Gmail connected</span>
      </span>
    </div>
    <button type="button" onClick={() => { setSettingsOpen(true); settings.current?.showModal(); setOpen(false); }}
      className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm font-semibold transition-colors hover:bg-mail-muted-surface">
      <span className="grid size-8 place-items-center rounded-lg bg-mail-accent-tint text-mail-accent"><AccountIcon name="settings" /></span>
      Settings
    </button>
    <div className="border-t border-mail-line pt-2">
      <button type="button" onClick={() => void signOut()} aria-disabled={signingOut}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left text-sm font-semibold text-mail-danger transition-colors hover:bg-mail-danger-tint aria-disabled:cursor-wait aria-disabled:opacity-70">
        <span className="grid size-8 place-items-center rounded-lg bg-mail-danger-tint"><AccountIcon name="logout" /></span>
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
      {error && <p role="alert" className="px-2 pb-1 pt-2 text-xs text-mail-danger">{error}</p>}
    </div>
    </>
  );

  return (
    <>
      <div ref={root} className="relative shrink-0"
        onBlur={(event) => { if (!isPhone && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !open) return;
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }}>
        <button ref={trigger} type="button" aria-label={`Account options for ${profile.email || displayName}`} aria-expanded={open} aria-controls={open ? menuId : undefined}
          onClick={() => setOpen(!open)}
          className="group flex items-center gap-3 rounded-full border border-mail-line/60 bg-mail-surface/50 p-1.5 text-left backdrop-blur transition duration-200 hover:border-mail-accent-line/70 hover:bg-mail-accent-tint/60 md:gap-3.5 md:pr-2.5 aria-expanded:border-mail-accent-line/70 aria-expanded:bg-mail-accent-tint/60 motion-reduce:transition-none">
          <ProfileAvatar label={avatar} picture={profile.picture} className="size-11 text-sm max-sm:size-9 max-sm:text-xs" connected />
          <span className="hidden min-w-0 max-w-[220px] md:block">
            <span className="block truncate text-sm font-bold leading-tight">{displayName}</span>
            <span className="mt-1 block truncate text-xs leading-tight text-mail-muted">{email}</span>
          </span>
          <span className="hidden size-7 shrink-0 place-items-center rounded-full text-mail-muted transition duration-200 group-hover:bg-mail-surface group-hover:text-mail-accent group-aria-expanded:bg-mail-surface group-aria-expanded:text-mail-accent md:grid">
            <AccountIcon name="chevronDown" className="size-4 transition-transform duration-200 group-aria-expanded:rotate-180" />
          </span>
        </button>

        {open && !isPhone && (
          <div id={menuId} className="account-menu-in absolute right-0 top-full z-50 mt-2.5 w-[min(18.5rem,calc(100vw-2rem))] origin-top-right space-y-1 rounded-[18px] border border-mail-line bg-mail-surface p-2 text-foreground shadow-[0_18px_48px_rgba(23,17,51,.22)]">
            {menuContent}
          </div>
        )}
      </div>

      <BottomSheet open={open && isPhone} onClose={() => setOpen(false)} title="Account">
        <div id={menuId} className="space-y-1">{menuContent}</div>
      </BottomSheet>

      <dialog ref={settings} aria-labelledby={settingsTitleId} onClose={() => { setSettingsOpen(false); trigger.current?.focus(); }}
        // A click on the dimmed area around the window closes it, like its X button. Only a
        // press and release both outside count, so selecting text inside never closes it.
        onPointerDown={(event) => { pressedOutside.current = outsideDialog(event); }}
        onClick={(event) => { if (pressedOutside.current && outsideDialog(event)) settings.current?.close(); pressedOutside.current = false; }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-[18px] max-sm:mb-0 max-sm:mt-auto max-sm:w-full max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-[22px] max-sm:pb-[calc(27px+env(safe-area-inset-bottom))] border border-mail-line bg-mail-surface p-[27px] text-foreground shadow-[0_25px_70px_rgba(21,17,26,0.27)] backdrop:bg-[#211f2b88]">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div><span className="block text-[11px] font-extrabold uppercase tracking-[0.12em] text-mail-accent">Account</span><h2 id={settingsTitleId} className="mt-1.5 text-2xl tracking-[-0.03em]">Settings</h2></div>
          <form method="dialog"><button type="submit" aria-label="Close settings" className="grid size-9 place-items-center rounded-full text-mail-secondary transition-colors hover:bg-mail-muted-surface"><AccountIcon name="close" /></button></form>
        </div>
        <div className="mb-5 flex items-center gap-3 rounded-[13px] border border-mail-line bg-mail-muted-surface p-4">
          <ProfileAvatar label={avatar} picture={profile.picture} className="size-10 text-sm" />
          <div className="min-w-0"><p className="break-words text-sm font-bold">{displayName}</p><p className="mt-1 break-all text-xs text-mail-muted">{email}</p></div>
        </div>
        <ThemePicker theme={theme} onChange={onThemeChange} />
        {/* Mounted while Settings is open, so it always shows what is stored now. */}
        {settingsOpen && <><AboutYouForm key={aboutVersion} /><SummaryAnswers onDeletedAll={() => setAboutVersion((version) => version + 1)} /></>}
      </dialog>
    </>
  );
}
