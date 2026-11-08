"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Priority } from "@/lib/mail-priority";
import type { GmailAttachment } from "@/lib/gmail-message";
import type { ReplyLength, ReplyTone } from "@/lib/reply-draft";

export type Mail = {
  id: string;
  subject: string;
  from: string;
  to: string;
  cc: string;
  unsubscribeUrl: string;
  date: string;
  snippet: string;
  html: string;
  unread: boolean;
  starred: boolean;
  draft: boolean;
  priority: Priority;
  attachments: GmailAttachment[];
};

type ComposeMode = "reply" | "replyAll" | "forward";

// Slider stops for the AI panel (left -> right).
const TONE_STOPS: ReplyTone[] = ["friendly", "professional", "formal"];
const LENGTH_STOPS: ReplyLength[] = ["short", "medium", "long"];
const toneLabel: Record<ReplyTone, string> = { friendly: "Friendly", professional: "Professional", concise: "Concise", formal: "Formal" };
const lengthLabel: Record<ReplyLength, string> = { short: "Short", medium: "Medium", long: "Detailed" };

/** System-generated mail (no-reply senders, list mail) does not expect a reply, so no draft is generated up front. */
function looksAutomated(from: string, unsubscribeUrl: string) {
  return Boolean(unsubscribeUrl) || /(?:^|[<\s"'])(?:no-?reply|do-?not-?reply|notifications?|noreply|mailer-daemon|newsletter|alerts?|info|support|marketing|news)[+.\w-]*@/i.test(from);
}

const aiErrorMessage: Record<string, string> = {
  ai_not_configured: "AI drafting is not configured on this server (GEMINI_API_KEY missing).",
  ai_rate_limited: "AI is busy right now. Wait a few seconds and try again.",
  gmail_fetch_failed: "Could not load the original message for the AI draft.",
};

// Gmail-like palette (Material 3 tokens used by mail.google.com).
const GMAIL_FONT = '"Google Sans", "Google Sans Text", Roboto, "Segoe UI", Arial, "Malgun Gothic", sans-serif';

const priorityChip: Record<Priority, { label: string; className: string }> = {
  urgent: { label: "Urgent", className: "bg-[#fad2cf] text-[#a50e0e]" },
  fyi: { label: "FYI", className: "bg-[#feefc3] text-[#594300]" },
  low: { label: "Low Priority", className: "bg-[#ceead6] text-[#0d652d]" },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatSender(from: string) {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return match ? match[1].trim() || match[2].trim() : from.trim();
}

function senderAddress(from: string) {
  return from.match(/<([^>]+)>/)?.[1]?.trim() ?? (from.includes("@") ? from.trim() : "");
}

export function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "M";
}

function splitAddresses(value: string) {
  return value.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((item) => item.trim()).filter(Boolean);
}

function avatarColor(seed: string) {
  const colors = ["#c2185b", "#7b1fa2", "#512da8", "#1976d2", "#0097a7", "#388e3c", "#f57c00", "#5d4037", "#455a64"];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

// "7:13 PM (1 hour ago)" / "Mon, Nov 2, 3:12 PM (4 days ago)" / "Oct 2, 2025, 3:12 PM"
function gmailTime(value: string, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const sameDay = date.toDateString() === now.toDateString();
  const sameYear = date.getFullYear() === now.getFullYear();
  const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
  const absolute = sameDay
    ? clock
    : sameYear
      ? `${new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date)}, ${clock}`
      : `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)}, ${clock}`;
  const diffMinutes = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60_000));
  let relative = "";
  if (diffMinutes < 1) relative = "0 minutes ago";
  else if (diffMinutes < 60) relative = `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  else if (diffMinutes < 60 * 24) {
    const hours = Math.floor(diffMinutes / 60);
    relative = `${hours} hour${hours === 1 ? "" : "s"} ago`;
  } else if (diffMinutes < 60 * 24 * 30) {
    const days = Math.floor(diffMinutes / (60 * 24));
    relative = `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return relative && sameYear ? `${absolute} (${relative})` : absolute;
}

function fullDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function formatBytes(value: number) {
  if (!value) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

type FileKind = "pdf" | "image" | "doc" | "sheet" | "slide" | "zip" | "file";

function fileKind(attachment: GmailAttachment): FileKind {
  const type = attachment.mimeType.toLowerCase();
  const ext = attachment.filename.split(".").pop()?.toLowerCase() ?? "";
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  if (/word|opendocument\.text|rtf/.test(type) || ["doc", "docx", "hwp", "hwpx", "rtf", "odt"].includes(ext)) return "doc";
  if (/sheet|excel|csv/.test(type) || ["xls", "xlsx", "csv", "ods"].includes(ext)) return "sheet";
  if (/presentation|powerpoint/.test(type) || ["ppt", "pptx", "odp", "key"].includes(ext)) return "slide";
  if (/zip|compressed|x-7z|x-rar|gzip|tar/.test(type) || ["zip", "7z", "rar", "gz", "tar"].includes(ext)) return "zip";
  return "file";
}

function canPreviewInline(attachment: GmailAttachment) {
  return /^(image\/(?:png|jpeg|gif|webp)|application\/pdf)$/i.test(attachment.mimeType);
}

// ---------------------------------------------------------------------------
// Icons (Material Symbols paths, the same set Gmail uses)
// ---------------------------------------------------------------------------

const ICONS = {
  back: "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z",
  archive: "M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM6.24 5h11.52l.81.97H5.44l.8-.97zM5 19V8h14v11H5zm8.45-9h-2.9v3H8l4 4 4-4h-2.55z",
  spam: "M15.73 3H8.27L3 8.27v7.46L8.27 21h7.46L21 15.73V8.27L15.73 3zM19 14.9L14.9 19H9.1L5 14.9V9.1L9.1 5h5.8L19 9.1v5.8zM11 7h2v6h-2zm0 8h2v2h-2z",
  trash: "M16 9v10H8V9h8m-1.5-6h-5l-1 1H5v2h14V4h-3.5l-1-1zM18 7H6v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7z",
  unread: "M22 8.98V18c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2h10.1c-.06.32-.1.66-.1 1 0 1.48.65 2.79 1.67 3.71L12 11 4 6v2l8 5 5.3-3.32c.54.2 1.1.32 1.7.32 1.13 0 2.16-.39 3-1.02zM16 5c0 1.66 1.34 3 3 3s3-1.34 3-3-1.34-3-3-3-3 1.34-3 3z",
  chevronLeft: "M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  chevronRight: "M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  print: "M19 8h-1V3H6v5H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zM8 5h8v3H8V5zm8 12v2H8v-4h8v2zm2-2v-2H6v2H4v-4c0-.55.45-1 1-1h14c.55 0 1 .45 1 1v4h-2z M18 11.5c0 .55-.45 1-1 1s-1-.45-1-1 .45-1 1-1 1 .45 1 1z",
  openNew: "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z",
  star: "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z",
  starBorder: "M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z",
  reply: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  replyAll: "M7 8V5l-7 7 7 7v-3l-4-4 4-4zm6 1V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  forward: "M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z",
  more: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  attach: "M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z",
  download: "M18 15v3H6v-3H4v3c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-3h-2zm-1-4l-1.41-1.41L13 12.17V4h-2v8.17L8.41 9.59 7 11l5 5 5-5z",
  dropDown: "M7 10l5 5 5-5z",
  close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
  file: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
  image: "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z",
  sparkle: "M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25L19 9zm-7.5.5L9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12l-5.5-2.5zM19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25L19 15z",
  zip: "M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-2 6h-2v2h2v2h-2v2h-2v-2h2v-2h-2v-2h2v-2h-2V8h2v2h2v2z",
} as const;

type IconName = keyof typeof ICONS;

function GIcon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true"><path d={ICONS[name]} /></svg>;
}

function ToolbarButton({ icon, label, onClick, disabled, active, className = "" }: { icon: IconName; label: string; onClick?: () => void; disabled?: boolean; active?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[#1f1f1f14] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent ${active ? "text-[#e2a600]" : "text-[#444746]"} ${className}`}>
      <GIcon name={icon} />
    </button>
  );
}

function Divider() {
  return <span className="mx-2 h-5 w-px shrink-0 bg-[#c4c7c5]" aria-hidden="true" />;
}

function FileBadge({ kind, className = "h-5 w-5" }: { kind: FileKind; className?: string }) {
  if (kind === "pdf") {
    return <span className={`inline-flex shrink-0 items-center justify-center rounded-[3px] bg-[#ea4335] text-[7px] font-bold leading-none tracking-tight text-white ${className}`}>PDF</span>;
  }
  const color = { image: "#d93025", doc: "#4285f4", sheet: "#0f9d58", slide: "#f4b400", zip: "#5f6368", file: "#5f6368" }[kind];
  return <span style={{ color }} className="inline-flex shrink-0"><GIcon name={kind === "image" ? "image" : kind === "zip" ? "zip" : "file"} className={className} /></span>;
}

// ---------------------------------------------------------------------------
// Email body (sandboxed iframe that grows with its content)
// ---------------------------------------------------------------------------

function EmailBody({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(120);
  const syncHeight = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (doc) setHeight(Math.max(60, doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0));
  }, []);
  const handleLoad = useCallback(() => {
    syncHeight();
    const doc = frameRef.current?.contentDocument;
    if (!doc?.body) return;
    observerRef.current?.disconnect();
    observerRef.current = new ResizeObserver(syncHeight);
    observerRef.current.observe(doc.body);
    // Late-loading inline images change the height after onLoad.
    doc.querySelectorAll("img").forEach((img) => img.addEventListener("load", syncHeight));
  }, [syncHeight]);
  // srcdoc can finish loading before React attaches onLoad (fast/cached
  // renders), in which case the iframe would stay at its initial height.
  useEffect(() => {
    if (frameRef.current?.contentDocument?.readyState === "complete") handleLoad();
    return () => observerRef.current?.disconnect();
  }, [handleLoad, html]);
  return <iframe ref={frameRef} srcDoc={html} onLoad={handleLoad} title="Message body" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="block w-full border-0 bg-transparent" style={{ height }} />;
}

// ---------------------------------------------------------------------------
// Attachments: Gmail-style cards + full screen viewer
// ---------------------------------------------------------------------------

function AttachmentCard({ attachment, onOpen }: { attachment: GmailAttachment; onOpen: () => void }) {
  const kind = fileKind(attachment);
  const [thumbFailed, setThumbFailed] = useState(false);
  const showImageThumb = kind === "image" && canPreviewInline(attachment) && !thumbFailed;
  return (
    <div className="group relative h-[120px] w-[180px] shrink-0 overflow-hidden rounded-lg border border-[#e0e0e0] bg-[#f8fafd]">
      <button type="button" onClick={onOpen} className="absolute inset-0 text-left" aria-label={`Preview ${attachment.filename}`}>
        <span className="absolute inset-x-0 top-0 bottom-10 flex items-center justify-center overflow-hidden bg-[#f1f3f4]">
          {showImageThumb
            // eslint-disable-next-line @next/next/no-img-element -- authenticated API route, not a static asset
            ? <img src={attachment.previewUrl} alt="" loading="lazy" onError={() => setThumbFailed(true)} className="h-full w-full object-cover" />
            : kind === "pdf"
              ? <span className="flex h-[62px] w-[48px] flex-col items-center justify-center rounded-sm bg-white shadow-[0_1px_2px_rgba(60,64,67,.3)]"><FileBadge kind="pdf" className="h-6 w-6" /></span>
              : <FileBadge kind={kind} className="h-10 w-10" />}
        </span>
        <span className="absolute inset-x-0 bottom-0 flex h-10 items-center gap-2 border-t border-[#e0e0e0] bg-white px-2.5 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
          <FileBadge kind={kind} className="h-4 w-4" />
          <span className="min-w-0 truncate text-xs font-medium text-[#1f1f1f]">{attachment.filename}</span>
        </span>
      </button>
      {/* Hover layer, like Gmail: name on top, actions at the bottom */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between bg-[#00000099] p-2.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <div className="flex items-start gap-2 text-white"><FileBadge kind={kind} className="h-4 w-4" /><span className="line-clamp-2 break-all text-xs font-medium">{attachment.filename}</span></div>
        <div className="flex items-end justify-between">
          <span className="text-[11px] text-white/80">{formatBytes(attachment.size)}</span>
          <a href={attachment.downloadUrl} aria-label={`Download ${attachment.filename}`} title="Download" className="pointer-events-auto flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white transition hover:bg-white/35">
            <GIcon name="download" />
          </a>
        </div>
      </div>
    </div>
  );
}

function AttachmentViewer({ attachments, index, onIndexChange, onClose }: { attachments: GmailAttachment[]; index: number; onIndexChange: (index: number) => void; onClose: () => void }) {
  const attachment = attachments[index];
  const kind = fileKind(attachment);
  const hasPrev = index > 0;
  const hasNext = index < attachments.length - 1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && hasPrev) onIndexChange(index - 1);
      if (event.key === "ArrowRight" && hasNext) onIndexChange(index + 1);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; };
  }, [hasNext, hasPrev, index, onClose, onIndexChange]);

  let content: ReactNode;
  if (canPreviewInline(attachment) && kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element -- authenticated API route
    content = <img src={attachment.previewUrl} alt={attachment.filename} className="max-h-full max-w-full object-contain shadow-2xl" />;
  } else if (canPreviewInline(attachment) && kind === "pdf") {
    content = (
      <object data={attachment.previewUrl} type="application/pdf" aria-label={attachment.filename} className="h-full w-full max-w-[1000px] rounded shadow-2xl">
        <div className="flex h-full w-full items-center justify-center"><NoPreview attachment={attachment} note="This browser can't show PDFs inline." /></div>
      </object>
    );
  } else {
    content = <NoPreview attachment={attachment} />;
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={attachment.filename} className="fixed inset-0 z-[100] flex flex-col bg-[#000000e6]" style={{ fontFamily: GMAIL_FONT }} onClick={onClose}>
      <header className="flex h-16 shrink-0 items-center gap-3 px-3 text-white" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Close" title="Close" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/15"><GIcon name="back" /></button>
        <FileBadge kind={kind} className="h-5 w-5" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{attachment.filename}</span>
        {attachments.length > 1 && <span className="hidden text-sm text-white/70 sm:inline">{index + 1} of {attachments.length}</span>}
        {canPreviewInline(attachment) && <a href={attachment.previewUrl} target="_blank" rel="noreferrer" aria-label="Open in new window" title="Open in new window" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/15"><GIcon name="openNew" /></a>}
        <a href={attachment.downloadUrl} aria-label="Download" title="Download" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/15"><GIcon name="download" /></a>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-20">
        <div className="flex h-full w-full items-center justify-center" onClick={(event) => event.stopPropagation()}>{content}</div>
        {hasPrev && <button type="button" onClick={(event) => { event.stopPropagation(); onIndexChange(index - 1); }} aria-label="Previous attachment" className="absolute left-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-[#3c4043cc] text-white hover:bg-[#5f6368]"><GIcon name="chevronLeft" className="h-7 w-7" /></button>}
        {hasNext && <button type="button" onClick={(event) => { event.stopPropagation(); onIndexChange(index + 1); }} aria-label="Next attachment" className="absolute right-3 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-[#3c4043cc] text-white hover:bg-[#5f6368]"><GIcon name="chevronRight" className="h-7 w-7" /></button>}
      </div>
    </div>
  );
}

function NoPreview({ attachment, note }: { attachment: GmailAttachment; note?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg bg-[#3c4043] px-10 py-8 text-center text-white">
      <FileBadge kind={fileKind(attachment)} className="h-12 w-12" />
      <div><p className="text-base">No preview available</p>{note && <p className="mt-1 text-sm text-white/70">{note}</p>}</div>
      <div className="flex gap-2">
        {note && <a href={attachment.previewUrl} target="_blank" rel="noreferrer" className="rounded-full border border-white/40 px-5 py-2 text-sm font-medium hover:bg-white/10">Open</a>}
        <a href={attachment.downloadUrl} className="rounded-full bg-[#a8c7fa] px-5 py-2 text-sm font-medium text-[#062e6f] hover:bg-[#bdd4fb]">Download</a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small popovers
// ---------------------------------------------------------------------------

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [close, open]);
  return ref;
}

function MenuItem({ icon, label, onClick }: { icon: IconName; label: string; onClick: () => void }) {
  return <button type="button" role="menuitem" onClick={onClick} className="flex h-9 w-full items-center gap-4 px-4 text-left text-sm text-[#1f1f1f] hover:bg-[#f2f2f2]"><GIcon name={icon} className="h-5 w-5 text-[#444746]" />{label}</button>;
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

export type MailDetailProps = {
  message: Mail;
  myEmail: string;
  deleting: boolean;
  error: string | null;
  position: number;
  total: number;
  onBack: () => void;
  onNewer?: () => void;
  onOlder?: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onSpam?: () => void;
  onMarkUnread?: () => void;
  onPriorityChange: (priority: Priority) => void;
  onStar: () => void;
};

export function MailDetail({ message, myEmail, deleting, error, position, total, onBack, onNewer, onOlder, onDelete, onArchive, onSpam, onMarkUnread, onPriorityChange, onStar }: MailDetailProps) {
  const sender = formatSender(message.from);
  const address = senderAddress(message.from);
  const visibleAttachments = useMemo(() => message.attachments.filter((attachment) => !attachment.inline), [message.attachments]);
  const recipients = useMemo(() => [...splitAddresses(message.to), ...splitAddresses(message.cc)], [message.cc, message.to]);
  const me = myEmail.toLowerCase();
  const otherRecipients = recipients.filter((recipient) => !recipient.toLowerCase().includes(me || "\u0000"));
  const canReplyAll = !message.draft && otherRecipients.length > 0;

  const [composeMode, setComposeMode] = useState<ComposeMode | null>(null);
  const [forwardTo, setForwardTo] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const automated = looksAutomated(message.from, message.unsubscribeUrl);
  const [aiTone, setAiTone] = useState<ReplyTone>("professional");
  const [aiLength, setAiLength] = useState<ReplyLength>("medium");
  const [suggestion, setSuggestion] = useState<{ status: "skipped" | "loading" | "ready" | "error" | "sent"; draft: string; cached: boolean; message: string }>(
    { status: message.draft || automated ? "skipped" : "loading", draft: "", cached: false, message: "" },
  );
  const [replyAll, setReplyAll] = useState(false);
  const [sendingSuggestion, setSendingSuggestion] = useState(false);
  const suggestionRef = useRef<HTMLTextAreaElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const closeDetails = useCallback(() => setDetailsOpen(false), []);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  const detailsRef = useDismiss(detailsOpen, closeDetails);
  const moreRef = useDismiss(moreOpen, closeMore);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const openComposer = (mode: ComposeMode) => {
    setComposeMode(mode);
    setForwardTo("");
    setBody("");
    setComposeError(null);
    setMoreOpen(false);
    window.setTimeout(() => {
      composerRef.current?.focus();
      composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  };

  const requestDraft = useCallback(async (input: { tone: ReplyTone; length: ReplyLength; regenerate: boolean }) => {
    const response = await fetch(`/api/gmail/messages/${encodeURIComponent(message.id)}/reply-draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, instructions: "" }),
    });
    const result = await response.json().catch(() => ({})) as { draft?: string; cached?: boolean; error?: string; detail?: string };
    if (!response.ok || !result.draft) {
      const known = aiErrorMessage[result.error ?? ""];
      throw new Error(known ?? `AI draft could not be generated${result.error ? ` (${result.error})` : ""}${result.detail ? `: ${result.detail}` : ""}.`);
    }
    return { draft: result.draft, cached: Boolean(result.cached) };
  }, [message.id]);

  const loadSuggestion = useCallback((input: { tone: ReplyTone; length: ReplyLength; regenerate: boolean }) => {
    let cancelled = false;
    requestDraft(input)
      .then((result) => { if (!cancelled) setSuggestion({ status: "ready", draft: result.draft, cached: result.cached, message: "" }); })
      .catch((suggestError) => { if (!cancelled) setSuggestion({ status: "error", draft: "", cached: false, message: suggestError instanceof Error ? suggestError.message : "AI draft could not be generated." }); });
    return () => { cancelled = true; };
  }, [requestDraft]);

  // Generate a suggested reply as soon as a person-to-person message is opened
  // (MailDetail is keyed by message id, so this runs once per opened message).
  // Cached on the server, so reopening the same message costs no LLM call.
  useEffect(() => {
    if (message.draft || automated) return;
    return loadSuggestion({ tone: "professional", length: "medium", regenerate: false });
  }, [message.draft, automated, loadSuggestion]);

  const changeSuggestionOptions = (tone: ReplyTone, length: ReplyLength) => {
    setAiTone(tone);
    setAiLength(length);
    setSuggestion((current) => ({ ...current, status: "loading", message: "" }));
    loadSuggestion({ tone, length, regenerate: false });
  };

  const regenerateSuggestion = () => {
    setSuggestion((current) => ({ ...current, status: "loading", message: "" }));
    loadSuggestion({ tone: aiTone, length: aiLength, regenerate: true });
  };

  const sendSuggestion = async () => {
    const text = suggestion.draft.trim();
    if (!text || sendingSuggestion) return;
    setSendingSuggestion(true);
    try {
      const response = await fetch(`/api/gmail/messages/${encodeURIComponent(message.id)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: replyAll && canReplyAll ? "replyAll" : "reply", body: text }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Reply could not be sent.");
      setSuggestion((current) => ({ ...current, status: "sent" }));
      setToast("Reply sent");
    } catch (sendError) {
      setSuggestion((current) => ({ ...current, message: sendError instanceof Error ? sendError.message : "Reply could not be sent." }));
    } finally {
      setSendingSuggestion(false);
    }
  };

  const sendMessage = async () => {
    if (!composeMode || !body.trim() || (composeMode === "forward" && !forwardTo.trim())) return;
    setSending(true);
    setComposeError(null);
    try {
      const response = await fetch(`/api/gmail/messages/${encodeURIComponent(message.id)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: composeMode, to: forwardTo, body }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Message could not be sent.");
      setComposeMode(null);
      setBody("");
      setForwardTo("");
      setToast("Message sent");
    } catch (sendError) {
      setComposeError(sendError instanceof Error ? sendError.message : "Message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  const writeWindow = (print: boolean) => {
    const popup = window.open("", "_blank");
    if (!popup) return;
    const escape = (value: string) => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] ?? char));
    const header = `<div style="font:14px Arial,sans-serif;color:#202124;border-bottom:1px solid #ccc;padding:0 0 12px;margin:0 0 16px">
      <h2 style="font-size:20px;font-weight:400;margin:0 0 8px">${escape(message.subject)}</h2>
      <div><b>${escape(sender)}</b> &lt;${escape(address)}&gt;</div>
      <div style="color:#5f6368">${escape(fullDate(message.date))}</div>
      ${message.to ? `<div style="color:#5f6368">To: ${escape(message.to)}</div>` : ""}
    </div>`;
    popup.document.open();
    popup.document.write(message.html.replace(/<body>/i, `<body style="padding:24px;max-width:900px;margin:0 auto">${header}`));
    popup.document.close();
    if (print) {
      // Give inline images a moment to load before the print dialog snapshots the page.
      let printed = false;
      const doPrint = () => { if (!printed) { printed = true; popup.focus(); popup.print(); } };
      popup.addEventListener("load", doPrint, { once: true });
      window.setTimeout(doPrint, 1200);
    }
    setMoreOpen(false);
  };

  const downloadAll = () => {
    visibleAttachments.forEach((attachment, index) => {
      window.setTimeout(() => {
        const link = document.createElement("a");
        link.href = attachment.downloadUrl;
        link.download = attachment.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }, index * 400);
    });
  };

  const attachmentHeading = visibleAttachments.length === 1 ? "One attachment" : `${visibleAttachments.length} attachments`;
  const pillClass = "flex h-9 items-center gap-2 rounded-full border border-[#747775] bg-white pl-3 pr-4 text-sm font-medium text-[#444746] transition-colors hover:bg-[#f2f2f2] hover:shadow-[0_1px_2px_rgba(60,64,67,.3)]";

  return (
    <section className="flex min-h-screen flex-col bg-white text-[#1f1f1f]" style={{ fontFamily: GMAIL_FONT }}>
      {/* ---------- Top action toolbar ---------- */}
      <div className="sticky top-0 z-20 flex h-12 shrink-0 items-center bg-white pl-2 pr-3 sm:pl-4">
        <ToolbarButton icon="back" label="Back to Inbox" onClick={onBack} />
        <span className="ml-2 flex items-center">
          {onArchive && <ToolbarButton icon="archive" label="Archive" onClick={onArchive} className="hidden sm:flex" />}
          {onSpam && <ToolbarButton icon="spam" label="Report spam" onClick={onSpam} className="hidden sm:flex" />}
          {onDelete && <ToolbarButton icon="trash" label="Delete" onClick={onDelete} disabled={deleting} />}
          {onMarkUnread && <><Divider /><ToolbarButton icon="unread" label="Mark as unread" onClick={onMarkUnread} /></>}
        </span>
        {deleting && <span className="ml-2 text-xs text-[#5e5e5e]">Deleting…</span>}
        <span className="ml-auto flex items-center gap-1">
          {total > 0 && <span className="mr-2 hidden whitespace-nowrap text-xs text-[#444746] sm:inline">{position.toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>}
          <ToolbarButton icon="chevronLeft" label="Newer" onClick={onNewer} disabled={!onNewer} />
          <ToolbarButton icon="chevronRight" label="Older" onClick={onOlder} disabled={!onOlder} />
        </span>
      </div>

      <div className="flex-1 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start lg:gap-6 lg:bg-[#f6f8fc] lg:px-6 lg:py-5 xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="min-w-0 lg:rounded-2xl lg:border lg:border-[#e3e3e3] lg:bg-white lg:pb-6">
        {error && <p className="mx-4 mb-2 rounded-lg bg-[#fce8e6] px-4 py-3 text-sm text-[#a50e0e] sm:ml-[72px]">{error}</p>}

        {/* ---------- Subject + labels ---------- */}
        <div className="flex items-start gap-2 pl-4 pr-4 pt-5 sm:pl-[72px]">
          <div className="min-w-0 flex-1">
            <h1 className="text-[22px] font-normal leading-7 text-[#1f1f1f]">
              {message.subject}
              {!message.draft && (
                <label className="relative ml-2 inline-flex translate-y-[-2px] align-middle">
                  <span className="sr-only">Priority</span>
                  <select value={message.priority} onChange={(event) => onPriorityChange(event.target.value as Priority)} title="Priority"
                    className={`h-5 cursor-pointer appearance-none rounded px-1.5 pr-4 text-xs font-normal leading-5 outline-none ${priorityChip[message.priority].className}`}>
                    <option value="urgent">Urgent</option><option value="fyi">FYI</option><option value="low">Low Priority</option>
                  </select>
                  <GIcon name="dropDown" className="pointer-events-none absolute right-0 top-0.5 h-4 w-4 opacity-70" />
                </label>
              )}
            </h1>
          </div>
          <span className="hidden shrink-0 items-center sm:flex">
            <ToolbarButton icon="print" label="Print all" onClick={() => writeWindow(true)} />
            <ToolbarButton icon="openNew" label="In new window" onClick={() => writeWindow(false)} />
          </span>
        </div>

        {/* ---------- Sender row ---------- */}
        <div className="flex items-start gap-3 px-4 pt-5 sm:gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg font-medium text-white" style={{ backgroundColor: avatarColor(address || sender) }}>{initials(sender).slice(0, 1)}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-1">
              <span className="text-sm font-bold text-[#1f1f1f]">{sender}</span>
              {address && address !== sender && <span className="truncate text-xs text-[#5e5e5e]">&lt;{address}&gt;</span>}
              {message.unsubscribeUrl && <a href={message.unsubscribeUrl} target="_blank" rel="noreferrer" className="ml-3 text-xs text-[#0b57d0] underline-offset-2 hover:underline">Unsubscribe</a>}
            </div>
            <div ref={detailsRef} className="relative">
              <button type="button" onClick={() => setDetailsOpen((open) => !open)} aria-expanded={detailsOpen} aria-label="Show details" className="flex items-center text-xs text-[#5e5e5e] hover:text-[#1f1f1f]">
                <span className="max-w-[60vw] truncate">to {recipients.length === 0 ? "me" : recipients.map((recipient) => (me && recipient.toLowerCase().includes(me) ? "me" : formatSender(recipient))).join(", ")}</span>
                <GIcon name="dropDown" className="h-5 w-5" />
              </button>
              {detailsOpen && (
                <div className="absolute left-0 top-6 z-30 w-[min(480px,85vw)] rounded-lg bg-white p-4 text-xs text-[#1f1f1f] shadow-[0_4px_8px_3px_rgba(60,64,67,.15),0_1px_3px_rgba(60,64,67,.3)]">
                  <dl className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-1.5">
                    <dt className="text-right text-[#5e5e5e]">from:</dt><dd className="break-all"><b>{sender}</b> {address && `<${address}>`}</dd>
                    {message.to && <><dt className="text-right text-[#5e5e5e]">to:</dt><dd className="break-all">{message.to}</dd></>}
                    {message.cc && <><dt className="text-right text-[#5e5e5e]">cc:</dt><dd className="break-all">{message.cc}</dd></>}
                    <dt className="text-right text-[#5e5e5e]">date:</dt><dd>{fullDate(message.date)}</dd>
                    <dt className="text-right text-[#5e5e5e]">subject:</dt><dd className="break-words">{message.subject}</dd>
                  </dl>
                </div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            {visibleAttachments.length > 0 && <GIcon name="attach" className="mr-1 hidden h-4 w-4 -rotate-45 text-[#5e5e5e] sm:block" />}
            <time className="mr-1 hidden whitespace-nowrap text-xs text-[#5e5e5e] sm:inline" dateTime={message.date}>{gmailTime(message.date)}</time>
            <ToolbarButton icon={message.starred ? "star" : "starBorder"} label={message.starred ? "Starred" : "Not starred"} onClick={onStar} active={message.starred} />
            {!message.draft && <ToolbarButton icon="reply" label="Reply" onClick={() => openComposer("reply")} className="hidden sm:flex" />}
            <div ref={moreRef} className="relative">
              <ToolbarButton icon="more" label="More" onClick={() => setMoreOpen((open) => !open)} />
              {moreOpen && (
                <div role="menu" className="absolute right-0 top-10 z-30 w-56 rounded bg-white py-2 shadow-[0_4px_8px_3px_rgba(60,64,67,.15),0_1px_3px_rgba(60,64,67,.3)]">
                  {!message.draft && <MenuItem icon="reply" label="Reply" onClick={() => openComposer("reply")} />}
                  {canReplyAll && <MenuItem icon="replyAll" label="Reply all" onClick={() => openComposer("replyAll")} />}
                  {!message.draft && <MenuItem icon="forward" label="Forward" onClick={() => openComposer("forward")} />}
                  <div className="my-2 h-px bg-[#e0e0e0]" />
                  {onDelete && <MenuItem icon="trash" label="Delete this message" onClick={() => { setMoreOpen(false); onDelete(); }} />}
                  {onMarkUnread && <MenuItem icon="unread" label="Mark as unread" onClick={() => { setMoreOpen(false); onMarkUnread(); }} />}
                  <MenuItem icon="print" label="Print" onClick={() => writeWindow(true)} />
                </div>
              )}
            </div>
          </div>
        </div>
        <time className="block pl-[68px] pt-1 text-xs text-[#5e5e5e] sm:hidden" dateTime={message.date}>{gmailTime(message.date)}</time>

        {/* ---------- Body ---------- */}
        <div className="pl-4 pr-4 pt-4 sm:pl-[72px] sm:pr-6">
          <EmailBody html={message.html} />
        </div>

        {/* ---------- Attachments ---------- */}
        {visibleAttachments.length > 0 && (
          <div className="ml-4 mr-4 mt-6 border-t border-[#e0e0e0] pb-2 pt-4 sm:ml-[72px] sm:mr-6">
            <div className="mb-4 flex items-center gap-2 text-sm text-[#444746]">
              <span className="font-medium">{attachmentHeading}</span>
              {visibleAttachments.length > 1 && <button type="button" onClick={downloadAll} aria-label="Download all attachments" title="Download all" className="ml-auto flex h-9 w-9 items-center justify-center rounded-full text-[#444746] hover:bg-[#1f1f1f14]"><GIcon name="download" /></button>}
            </div>
            <div className="flex flex-wrap gap-4">
              {visibleAttachments.map((attachment, index) => <AttachmentCard key={attachment.partId} attachment={attachment} onOpen={() => setViewerIndex(index)} />)}
            </div>
          </div>
        )}

        {/* ---------- Inline composer (replaces the bottom bar, like Gmail) ---------- */}
        {composeMode && (
          <div className="flex gap-3 px-4 pb-8 pt-6 sm:gap-4">
            <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0b57d0] text-lg font-medium text-white sm:flex">{initials(myEmail || "Me").slice(0, 1)}</span>
            <div className="min-w-0 flex-1 rounded-lg bg-white shadow-[0_1px_2px_rgba(60,64,67,.3),0_2px_6px_2px_rgba(60,64,67,.15)]">
              <div className="flex min-h-11 items-center gap-2 border-b border-[#e0e0e0] px-3 text-sm">
                <GIcon name={composeMode === "forward" ? "forward" : composeMode === "replyAll" ? "replyAll" : "reply"} className="h-5 w-5 shrink-0 text-[#444746]" />
                {composeMode === "forward" ? (
                  <input value={forwardTo} onChange={(event) => setForwardTo(event.target.value)} type="text" inputMode="email" placeholder="Recipients" aria-label="Recipients" autoFocus
                    className="min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-[#5e5e5e]" />
                ) : (
                  <span className="flex min-w-0 flex-1 flex-wrap gap-1 py-2">
                    <span className="rounded-full bg-[#e9eef6] px-2 py-0.5 text-xs text-[#1f1f1f]">{sender}</span>
                    {composeMode === "replyAll" && otherRecipients.map((recipient) => <span key={recipient} className="rounded-full bg-[#e9eef6] px-2 py-0.5 text-xs text-[#1f1f1f]">{formatSender(recipient)}</span>)}
                  </span>
                )}
              </div>
              <textarea ref={composerRef} value={body} onChange={(event) => setBody(event.target.value)} rows={6} aria-label="Message body"
                className="block w-full resize-y bg-transparent px-4 py-3 text-sm leading-6 outline-none" />
              {composeMode === "forward" && visibleAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 pb-3">
                  {visibleAttachments.map((attachment) => <span key={attachment.partId} className="flex max-w-[240px] items-center gap-2 rounded bg-[#f2f2f2] px-2 py-1 text-xs"><FileBadge kind={fileKind(attachment)} className="h-4 w-4" /><span className="truncate font-medium text-[#0b57d0]">{attachment.filename}</span><span className="text-[#5e5e5e]">({formatBytes(attachment.size)})</span></span>)}
                </div>
              )}
              {composeError && <p className="mx-4 mb-3 rounded bg-[#fce8e6] px-3 py-2 text-xs text-[#a50e0e]">{composeError}</p>}
              <div className="flex items-center gap-2 px-4 pb-3">
                <button type="button" onClick={() => void sendMessage()} disabled={sending || !body.trim() || (composeMode === "forward" && !forwardTo.trim())}
                  className="h-9 rounded-full bg-[#0b57d0] px-6 text-sm font-medium text-white transition hover:bg-[#0a4ebb] hover:shadow-[0_1px_3px_1px_rgba(0,0,0,.15)] disabled:cursor-not-allowed disabled:opacity-50">{sending ? "Sending…" : "Send"}</button>
                <span className="ml-auto" />
                <ToolbarButton icon="trash" label="Discard draft" onClick={() => setComposeMode(null)} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ---------- Right column: AI reply panel ---------- */}
      {!message.draft && (
        <aside className="mx-4 mt-6 lg:sticky lg:top-16 lg:mx-0 lg:mt-0">
          <div className="rounded-2xl border border-[#e3e3e3] bg-white p-5 shadow-[0_1px_2px_rgba(60,64,67,.08)]">
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[#5b4bd6]">
              <GIcon name="sparkle" className="h-4 w-4" />Suggested reply
              {suggestion.status === "ready" && <span className="font-normal normal-case tracking-normal text-[#7a7a7a]">{suggestion.cached ? "· saved" : "· just generated"}</span>}
            </div>

            {suggestion.status === "skipped" && (
              <>
                <div className="mb-4 flex gap-3 rounded-xl bg-[#f3f3f1] p-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#5e5e5e] text-white"><GIcon name="unread" className="h-5 w-5" /></span>
                  <div className="text-sm">
                    <p className="font-semibold text-[#1f1f1f]">Automated notification</p>
                    <p className="mt-0.5 text-[#5e5e5e]">This looks like a system-generated message rather than a note from a person, so no reply draft was generated.</p>
                  </div>
                </div>
                <p className="text-sm text-[#5e5e5e]">Notifications like this don&apos;t usually expect a reply — but you can still have one drafted if you need it.</p>
                <div className="mt-4 flex justify-end">
                  <button type="button" onClick={() => changeSuggestionOptions(aiTone, aiLength)} className="flex h-10 items-center gap-2 rounded-lg bg-[#5b4bd6] px-4 text-sm font-semibold text-white hover:bg-[#4b3dc0]"><GIcon name="reply" className="h-4 w-4" />Reply anyway</button>
                </div>
              </>
            )}

            {suggestion.status === "sent" && (
              <div className="rounded-xl bg-[#e6f4ea] p-4 text-sm text-[#0d652d]">
                <p className="font-semibold">Reply sent</p>
                <p className="mt-1 whitespace-pre-wrap text-[#1f1f1f]/80">{suggestion.draft}</p>
              </div>
            )}

            {(suggestion.status === "loading" || suggestion.status === "ready" || suggestion.status === "error") && (
              <>
                <div className="relative rounded-xl border border-[#e3e3e3] bg-[#fbfbfb]">
                  <textarea ref={suggestionRef} value={suggestion.draft} onChange={(event) => setSuggestion((current) => ({ ...current, draft: event.target.value }))}
                    rows={10} aria-label="Suggested reply" disabled={suggestion.status === "loading"} placeholder={suggestion.status === "error" ? "" : "Generating a reply with AI…"}
                    className="block min-h-[220px] w-full resize-y rounded-xl bg-transparent px-4 py-3 text-sm leading-6 text-[#1f1f1f] outline-none focus:ring-2 focus:ring-[#5b4bd6]/30 disabled:text-[#9a9a9a]" />
                  {suggestion.status === "loading" && <span className="pointer-events-none absolute right-3 top-3 h-4 w-4 animate-spin rounded-full border-2 border-[#5b4bd6]/30 border-t-[#5b4bd6]" aria-hidden="true" />}
                </div>
                {suggestion.status === "error" && <p className="mt-3 rounded-lg bg-[#fce8e6] px-3 py-2 text-xs text-[#a50e0e]">{suggestion.message}</p>}
                {suggestion.status === "ready" && suggestion.message && <p className="mt-3 rounded-lg bg-[#fce8e6] px-3 py-2 text-xs text-[#a50e0e]">{suggestion.message}</p>}

                <div className="mt-4 space-y-3">
                  <label className="block text-xs text-[#5e5e5e]">
                    <span className="flex justify-between"><span>Friendly</span><span className="font-medium text-[#1f1f1f]">{toneLabel[aiTone]}</span><span>Formal</span></span>
                    <input type="range" min={0} max={TONE_STOPS.length - 1} step={1} value={TONE_STOPS.indexOf(aiTone)} disabled={suggestion.status === "loading"}
                      onChange={(event) => changeSuggestionOptions(TONE_STOPS[Number(event.target.value)], aiLength)} aria-label="Reply tone" className="mt-1 w-full accent-[#5b4bd6]" />
                  </label>
                  <label className="block text-xs text-[#5e5e5e]">
                    <span className="flex justify-between"><span>Short</span><span className="font-medium text-[#1f1f1f]">{lengthLabel[aiLength]}</span><span>Detailed</span></span>
                    <input type="range" min={0} max={LENGTH_STOPS.length - 1} step={1} value={LENGTH_STOPS.indexOf(aiLength)} disabled={suggestion.status === "loading"}
                      onChange={(event) => changeSuggestionOptions(aiTone, LENGTH_STOPS[Number(event.target.value)])} aria-label="Reply length" className="mt-1 w-full accent-[#5b4bd6]" />
                  </label>
                </div>

                {canReplyAll && (
                  <label className="mt-3 flex items-center gap-2 text-xs text-[#5e5e5e]">
                    <input type="checkbox" checked={replyAll} onChange={(event) => setReplyAll(event.target.checked)} className="accent-[#5b4bd6]" />
                    Reply to everyone ({otherRecipients.map((recipient) => formatSender(recipient)).join(", ")})
                  </label>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={regenerateSuggestion} disabled={suggestion.status === "loading" || sendingSuggestion}
                    className="flex h-10 items-center gap-2 rounded-lg border border-[#d9d9d9] bg-white px-3 text-sm font-semibold text-[#1f1f1f] hover:bg-[#f2f2f2] disabled:cursor-not-allowed disabled:opacity-50">
                    <GIcon name="sparkle" className="h-4 w-4" />Regenerate
                  </button>
                  <button type="button" onClick={() => suggestionRef.current?.focus()} disabled={suggestion.status !== "ready"}
                    className="h-10 rounded-lg px-3 text-sm font-semibold text-[#5e5e5e] hover:bg-[#f2f2f2] disabled:cursor-not-allowed disabled:opacity-50">Edit manually</button>
                  <button type="button" onClick={() => void sendSuggestion()} disabled={suggestion.status !== "ready" || !suggestion.draft.trim() || sendingSuggestion}
                    className="ml-auto flex h-10 items-center gap-2 rounded-lg bg-[#5b4bd6] px-4 text-sm font-semibold text-white hover:bg-[#4b3dc0] disabled:cursor-not-allowed disabled:opacity-50">
                    <GIcon name="forward" className="h-4 w-4" />{sendingSuggestion ? "Sending…" : "Send reply"}
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      )}
      </div>

      {/* ---------- Fixed bottom action bar (Reply / Reply all / Forward) ---------- */}
      {!composeMode && !message.draft && (
        <div className="sticky bottom-0 z-20 border-t border-[#f1f1f1] bg-white/95 backdrop-blur-sm lg:static lg:border-0 lg:bg-[#f6f8fc]">
          <div className="flex flex-wrap items-center gap-2 px-4 py-4 sm:gap-3 sm:pl-[72px]">
            <button type="button" onClick={() => openComposer("reply")} className={pillClass}><GIcon name="reply" />Reply</button>
            {canReplyAll && <button type="button" onClick={() => openComposer("replyAll")} className={pillClass}><GIcon name="replyAll" />Reply all</button>}
            <button type="button" onClick={() => openComposer("forward")} className={pillClass}><GIcon name="forward" />Forward</button>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-6 left-6 z-50 flex items-center gap-6 rounded bg-[#1f1f1f] px-4 py-3 text-sm text-[#f2f2f2] shadow-lg">
          {toast}
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="text-[#f2f2f2]/80 hover:text-white"><GIcon name="close" className="h-4 w-4" /></button>
        </div>
      )}

      {viewerIndex !== null && visibleAttachments[viewerIndex] && (
        <AttachmentViewer attachments={visibleAttachments} index={viewerIndex} onIndexChange={setViewerIndex} onClose={() => setViewerIndex(null)} />
      )}
    </section>
  );
}
