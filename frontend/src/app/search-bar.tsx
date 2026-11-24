"use client";

import { useEffect, useRef } from "react";
import type { Mail } from "./mail-detail";

/**
 * Search box in the page header. Mailbox views search Gmail when the user presses
 * Enter (each search is a Gmail request); Summary filters the to-dos already on
 * screen, so it passes `live` and updates as the user types.
 */
export function SearchBar({ value, active, placeholder, live = false, onChange, onSubmit, onClear }: {
  value: string;
  /** A search is applied to the list below (shows the clear button even after the text is edited). */
  active: boolean;
  placeholder: string;
  live?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" jumps to the search box, as in Gmail, unless the user is typing somewhere.
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <form role="search" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}
      className="flex h-[42px] w-full items-center gap-2 rounded-[10px] border border-mail-line bg-mail-surface px-[13px] transition focus-within:border-mail-accent-line focus-within:ring-2 focus-within:ring-mail-accent/20">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-mail-muted" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input ref={inputRef} type="search" value={value} placeholder={placeholder} aria-label={placeholder} enterKeyHint="search" maxLength={500}
        onChange={(event) => { onChange(event.target.value); if (live) onSubmit(); }}
        onKeyDown={(event) => { if (event.key === "Escape" && (value || active)) { event.preventDefault(); onClear(); } }}
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-mail-muted [&::-webkit-search-cancel-button]:hidden" />
      {(value || active) && <button type="button" onClick={() => { onClear(); inputRef.current?.focus(); }} aria-label="Clear search"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-mail-muted transition hover:bg-mail-hover hover:text-foreground">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>}
    </form>
  );
}

/** Summary search: every word must appear in the to-do, its email's subject, sender, AI summary or snippet. */
export function matchesSummarySearch(message: Mail, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = [message.todo?.task, message.summary, message.subject, message.from, message.snippet].filter(Boolean).join(" ").toLowerCase();
  return words.every((word) => text.includes(word));
}
