"use client";

import { useRef, type ReactNode } from "react";
import { RefractionFilter, refractionStyle, useEdgeRefraction } from "./liquid-glass";

export type MailView = "briefing" | "summary" | "calendar" | "inbox" | "all" | "starred" | "sent" | "drafts" | "spam" | "trash";

type Motion = "pulse" | "lift" | "turn" | "write";
type RailItem = { key: MailView | "compose"; label: string; motion: Motion; icon: ReactNode };

// Line icons in the style of the design preview (24px grid, 1.8 stroke).
const items: RailItem[][] = [
  [
    { key: "briefing", label: "Daily Briefing", motion: "pulse", icon: <path d="M4 18h16M6.5 14.5a5.5 5.5 0 0 1 11 0M12 3v3M4.9 7.4 7 9M19.1 7.4 17 9" /> },
    { key: "summary", label: "Summary", motion: "lift", icon: <><rect x="5" y="4" width="14" height="17" rx="2.5" /><path d="M9 4.5v-.7a.8.8 0 0 1 .8-.8h4.4a.8.8 0 0 1 .8.8v.7M9 10h6M9 14h6M9 18h3" /></> },
    { key: "calendar", label: "Calendar", motion: "turn", icon: <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M8 3v4M16 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01" /></> },
  ],
  [
    { key: "inbox", label: "Inbox", motion: "lift", icon: <><path d="M3 13.5 5.5 5.8a2 2 0 0 1 1.9-1.3h9.2a2 2 0 0 1 1.9 1.3l2.5 7.7V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4.5Z" /><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5" /></> },
    { key: "starred", label: "Starred", motion: "pulse", icon: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" /> },
    { key: "sent", label: "Sent", motion: "lift", icon: <path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5 21 3Z" /> },
    { key: "drafts", label: "Drafts", motion: "write", icon: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></> },
    { key: "all", label: "All Emails", motion: "lift", icon: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></> },
    { key: "spam", label: "Spam", motion: "pulse", icon: <><path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3L8.3 3Z" /><path d="M12 8v4.5M12 16h.01" /></> },
    { key: "trash", label: "Trash", motion: "lift", icon: <path d="M4 7h16M9 7V4.5h6V7M6.5 7l.9 12.2A2 2 0 0 0 9.4 21h5.2a2 2 0 0 0 2-1.8L17.5 7M10 11v6M14 11v6" /> },
  ],
  [
    { key: "compose", label: "Compose", motion: "write", icon: <><path d="m14.5 5.5 4 4M4 20l3.8-.8L19 8a2.1 2.1 0 0 0-3-3L4.8 16.2 4 20Z" /><path d="m6 15 3 3" /></> },
  ],
];


/** The icon and name of each page, shared with the phone tab bar. */
export const viewIcons = Object.fromEntries(items.flat().map((item) => [item.key, item.icon])) as Record<MailView | "compose", ReactNode>;
export const viewLabels = Object.fromEntries(items.flat().map((item) => [item.key, item.label])) as Record<MailView | "compose", string>;

/**
 * Navigation as a dock of icon buttons fixed at the bottom centre of the screen, so it
 * stays in place while the page scrolls. Phones use MobileTabBar instead. Each button
 * names itself in a tooltip above it on hover or keyboard focus.
 */
const REFRACTION_ID = "mailflow-dock-refraction";

export function ActionRail({ view, onSelect, onCompose, composeOpen = false }: {
  view: MailView;
  onSelect: (view: MailView) => void;
  /** Opens the compose window, or closes it when it is already open. */
  onCompose: () => void;
  composeOpen?: boolean;
}) {
  const dock = useRef<HTMLElement>(null);
  const refraction = useEdgeRefraction(dock);
  return (
    <>
    <RefractionFilter id={REFRACTION_ID} map={refraction} />
    <nav ref={dock} aria-label="Mailbox" style={refractionStyle(REFRACTION_ID, refraction)}
      className="glass-dock fixed bottom-4 left-1/2 z-40 hidden -translate-x-1/2 items-center gap-1.5 rounded-[26px] border p-2.5 sm:flex md:gap-[9px]">
      {items.map((group, groupIndex) => (
        <div key={groupIndex} className="contents">
          {groupIndex > 0 && <span className="glass-divider mx-0.5 h-7 w-px shrink-0" aria-hidden="true" />}
          {group.map((item) => {
            const isCompose = item.key === "compose";
            // Compose shows as pressed while its window is open, so a second press reads as "close".
            const active = isCompose ? composeOpen : item.key === view;
            return (
              <button key={item.key} type="button" aria-label={item.label} aria-current={!isCompose && active ? "page" : undefined} aria-pressed={isCompose ? composeOpen : undefined}
                onClick={() => item.key === "compose" ? onCompose() : onSelect(item.key)}
                className={`rail-button group relative grid h-12 w-12 shrink-0 place-items-center rounded-[15px] border transition sm:h-11 sm:w-11 md:h-12 md:w-12 ${active
                  ? "glass-button-active text-mail-accent"
                  : "glass-button text-foreground hover:text-mail-accent"}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                  className={`h-6 w-6 rail-icon-${item.motion}`}>{item.icon}</svg>
                <span className="pointer-events-none invisible absolute bottom-[calc(100%+10px)] left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#302d38] px-[9px] py-1.5 text-[11px] font-bold text-white opacity-0 shadow-[0_4px_12px_rgba(39,37,32,0.14)] transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100 sm:block">{isCompose && composeOpen ? "Close compose" : item.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
    </>
  );
}
