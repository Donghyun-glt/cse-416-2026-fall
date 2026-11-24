"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A panel that slides up from the bottom of a phone screen over a dimmed page. Closes on
 * a tap outside, the Escape key or its own buttons; the page behind does not scroll
 * while it is open. Padded for the iPhone home bar.
 */
export function BottomSheet({ open, onClose, title, children, className = "" }: {
  open: boolean;
  onClose: () => void;
  /** Shown at the top and used as the dialog's name. */
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const previousFocus = document.activeElement as HTMLElement | null;
    sheet.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      previousFocus?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  // Rendered at the end of <body>: inside the page header (blurred, stacked at z-30) a fixed
  // panel would be positioned and layered with the header, under the phone tab bar.
  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div className="sheet-backdrop absolute inset-0 bg-[#15121e]/45" onClick={onClose} aria-hidden="true" />
      <div ref={sheet} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        className={`sheet-panel absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[22px] border-t border-mail-line bg-mail-surface px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2 text-foreground shadow-[0_-12px_40px_rgba(21,17,26,0.22)] outline-none ${className}`}>
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-mail-line-strong/40" aria-hidden="true" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-mail-accent">{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="grid size-8 place-items-center rounded-full text-mail-secondary hover:bg-mail-muted-surface">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-4" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
