import type { ReactNode } from "react";

// Shared pieces of the MailFlow look (the /demo design preview), built on the theme
// tokens in globals.css so the same classes work in light and dark mode.

/** A white card with a soft edge: the basic container of every screen. */
export const panel = "rounded-[17px] border border-mail-line bg-mail-surface shadow-[0_3px_12px_rgba(40,39,34,0.03)]";
/** Inner spacing of a panel. */
export const panelPad = "p-[17px] sm:p-[23px]";

// Buttons. Rounded pills: the primary one is the violet gradient of the logo, the compose
// button and the dock, lit along its top edge; it stays the same in dark mode. Sizes and
// padding are unchanged, so call sites that adjust them still line up.
export const primaryButton = "inline-flex items-center justify-center gap-2 rounded-full border border-transparent bg-gradient-to-br from-[#8b7bff] via-[#6a55e6] to-[#4a36c4] px-4 py-2.5 text-[13px] font-extrabold text-white shadow-[0_6px_16px_rgba(89,68,216,0.3),inset_0_1px_0_rgba(255,255,255,0.35)] transition hover:-translate-y-px hover:brightness-110 hover:shadow-[0_9px_22px_rgba(89,68,216,0.4),inset_0_1px_0_rgba(255,255,255,0.35)] active:translate-y-0 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none";
export const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-full border border-mail-line bg-mail-surface px-4 py-2.5 text-[13px] font-extrabold text-mail-secondary shadow-[0_1px_2px_rgba(40,39,34,0.06),inset_0_1px_0_rgba(255,255,255,0.06)] transition hover:border-mail-accent-line hover:text-mail-accent active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45";
/** Small outlined button for actions inside rows and toolbars. */
export const smallButton = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-mail-line bg-mail-surface px-2.5 py-1 text-xs font-bold text-mail-secondary transition hover:bg-mail-muted-surface disabled:cursor-not-allowed disabled:opacity-45";
/** Purple text link-button ("View full calendar →", "← Back to emails"). */
export const textButton = "inline-flex items-center gap-1.5 text-[13px] font-extrabold text-mail-accent transition hover:opacity-80";

/** Round filter pill; pass `selected` for the active one. */
export function chip(selected: boolean) {
  return `inline-flex h-8 items-center gap-1.5 rounded-full border px-[13px] text-xs font-bold transition ${selected
    ? "border-mail-accent-line bg-mail-accent-tint text-mail-accent"
    : "border-mail-line bg-mail-surface text-mail-secondary hover:bg-mail-muted-surface"}`;
}

/** Text field look shared by inputs, selects and textareas. */
export const field = "w-full rounded-[9px] border border-mail-line bg-mail-surface px-3 py-2.5 text-[13px] text-foreground outline-none transition placeholder:text-mail-muted focus:border-mail-accent-line focus:ring-2 focus:ring-mail-accent/20";

/** Small purple label above a heading ("YOUR DAY", "ORIGINAL EMAIL"). */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`block text-[11px] font-extrabold uppercase tracking-[0.12em] text-mail-accent ${className}`}>{children}</span>;
}

/** Eyebrow + heading on the left, actions on the right. */
export function SectionHead({ eyebrow, title, detail, actions, className = "mb-[18px]", as: Heading = "h2" }: {
  eyebrow: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <Eyebrow>{eyebrow}</Eyebrow>
        <Heading className="mt-1.5 text-[21px] leading-tight tracking-[-0.03em]">{title}</Heading>
        {detail && <p className="mt-1 text-xs text-mail-muted">{detail}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// Sender colours: each pair is a gradient that keeps white initials readable in light and
// dark mode. A sender always gets the same pair, so people are easy to tell apart in a list.
const AVATAR_COLORS: readonly [string, string][] = [
  ["#f0776b", "#cf4339"], // red
  ["#f59f5b", "#d7682a"], // orange
  ["#e0ac3a", "#b98010"], // amber
  ["#5cc28d", "#2b9461"], // green
  ["#43c1b5", "#138f84"], // teal
  ["#5ab4ec", "#2681c3"], // sky
  ["#6f8ff5", "#4360d2"], // blue
  ["#9a7cf6", "#6a4ed6"], // violet
  ["#d77ce6", "#a548b9"], // magenta
  ["#ef7aa6", "#cb467a"], // pink
];

/** A stable colour for a sender, picked from their email address (FNV-1a hash). */
export function avatarColors(seed: string): [string, string] {
  let hash = 0x811c9dc5;
  for (const char of seed.trim().toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
  return AVATAR_COLORS[(hash >>> 0) % AVATAR_COLORS.length] as [string, string];
}

/**
 * Round initials badge. With a `seed` (an email address) it gets that sender's own colour;
 * without one it uses the quiet purple tint.
 */
export function Avatar({ label, seed, className = "h-[38px] w-[38px] text-[11px]" }: { label: string; seed?: string; className?: string }) {
  if (!seed) return <span className={`flex shrink-0 items-center justify-center rounded-full bg-mail-accent-tint font-extrabold text-mail-accent ${className}`} aria-hidden="true">{label}</span>;
  const [from, to] = avatarColors(seed);
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-extrabold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3)] [text-shadow:0_1px_1px_rgba(0,0,0,0.18)] ${className}`}
      style={{ backgroundImage: `linear-gradient(135deg, ${from}, ${to})` }} aria-hidden="true">{label}</span>
  );
}
