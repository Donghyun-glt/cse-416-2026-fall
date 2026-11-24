"use client";

import { useRef, useState } from "react";
import { viewIcons, viewLabels, type MailView } from "./action-rail";
import { BottomSheet } from "./bottom-sheet";
import { RefractionFilter, refractionStyle, useEdgeRefraction } from "./liquid-glass";

// Phone navigation: four pages always in reach, the other mailboxes one tap away in "More".
const PRIMARY: MailView[] = ["briefing", "summary", "inbox", "calendar"];
const MORE: MailView[] = ["starred", "sent", "drafts", "all", "spam", "trash"];
const tabLabel: Partial<Record<MailView, string>> = { briefing: "Briefing" };

function Icon({ children, className = "size-6" }: { children: React.ReactNode; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{children}</svg>;
}

const REFRACTION_ID = "mailflow-tabbar-refraction";

/**
 * Bottom tab bar for phones (below 640 px; wider screens use the dock). It is the same
 * clear Liquid Glass as the desktop dock, floating off the screen edges so its rim and edge
 * refraction show all round. Each tab shows its name, since phones have no hover tooltips.
 * Hidden while a message is open.
 */
export function MobileTabBar({ view, onSelect, hidden = false }: { view: MailView; onSelect: (view: MailView) => void; hidden?: boolean }) {
  const [moreOpen, setMoreOpen] = useState(false);
  const bar = useRef<HTMLElement>(null);
  const refraction = useEdgeRefraction(bar);
  const inMore = MORE.includes(view);
  const tab = (key: string, label: string, icon: React.ReactNode, active: boolean, onClick: () => void) => (
    <button key={key} type="button" data-mobile-tab={label} onClick={onClick} aria-current={active ? "page" : undefined}
      className={`glass-label flex h-[54px] flex-col items-center justify-center gap-0.5 text-[10.5px] font-bold transition-colors ${active ? "text-mail-accent" : "text-foreground"}`}>
      <span className={`grid h-8 w-12 place-items-center rounded-full border transition-colors ${active ? "glass-button-active" : "border-transparent"}`}><Icon className="glass-icon size-6">{icon}</Icon></span>
      {label}
    </button>
  );
  return (
    <>
      <RefractionFilter id={REFRACTION_ID} map={refraction} />
      <nav ref={bar} aria-label="Mailbox" style={refractionStyle(REFRACTION_ID, refraction)}
        className={`glass-dock fixed inset-x-3 bottom-[calc(10px+env(safe-area-inset-bottom))] z-40 grid grid-cols-5 rounded-[26px] border p-1 sm:hidden ${hidden ? "hidden" : ""}`}>
        {PRIMARY.map((key) => tab(key, tabLabel[key] ?? viewLabels[key], viewIcons[key], view === key, () => onSelect(key)))}
        {tab("more", inMore ? viewLabels[view] : "More", inMore ? viewIcons[view] : <><circle cx="5" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="19" cy="12" r="1.4" /></>, inMore || moreOpen, () => setMoreOpen(true))}
      </nav>
      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Mailboxes">
        <div className="grid grid-cols-3 gap-2">
          {MORE.map((key) => (
            <button key={key} type="button" data-mobile-tab={viewLabels[key]} onClick={() => { setMoreOpen(false); onSelect(key); }} aria-current={view === key ? "page" : undefined}
              className={`flex h-[76px] flex-col items-center justify-center gap-1.5 rounded-[14px] border text-xs font-bold transition-colors ${view === key
                ? "border-mail-accent-line bg-mail-accent-tint text-mail-accent"
                : "border-mail-line bg-mail-surface text-foreground hover:bg-mail-muted-surface"}`}>
              <Icon>{viewIcons[key]}</Icon>{viewLabels[key]}
            </button>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}
