"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { draftTextToHtml } from "@/lib/compose-draft";
import { fetchWithRetry } from "@/lib/retry-fetch";
import type { ReplyLength, ReplyTone } from "@/lib/reply-draft";
import { chip, primaryButton } from "./ui";
import { GIcon, MAX_ATTACHMENT_BYTES, ToolbarButton, formatBytes } from "./mail-detail";
import { COMPOSER_FONTS, EDITOR_CONTENT_CLASS, FormatToolbar } from "./format-toolbar";

/** A draft of a new message as returned by GET /api/gmail/compose/draft. */
export type ComposeDraft = { draftId: string; to: string; cc: string; bcc: string; subject: string; html: string; attachments: { filename: string; mimeType: string; size: number; downloadUrl: string }[] };

const sendErrors: Record<string, string> = {
  recipient_missing: "Add at least one recipient.",
  empty_message: "Write a subject or a message before sending.",
  attachments_too_large: `Attachments can be up to ${formatBytes(MAX_ATTACHMENT_BYTES)} in total.`,
  gmail_send_failed: "Gmail could not send the message. Try again.",
};
type Fields = { to: string; cc: string; bcc: string; subject: string; files: File[] };

// The same three tone and length steps as the AI reply panel in the message view.
const AI_TONES: [ReplyTone, string][] = [["friendly", "Casual"], ["professional", "Polite"], ["formal", "Formal"]];
const AI_LENGTHS: [ReplyLength, string][] = [["short", "Short"], ["medium", "Medium"], ["long", "Detailed"]];
// Gemini is often briefly overloaded; the window quietly tries again a few times first.
const AI_ATTEMPTS = 3;
const AI_MAX_WAIT_SECONDS = 8;
const aiErrors: Record<string, string> = {
  ai_rate_limited: "AI is busy right now. Try again in a moment.",
  ai_unavailable: "AI is overloaded right now (Gemini is turning requests away). Try again in a minute.",
  ai_not_configured: "AI drafting is not configured on this server.",
  ai_empty_response: "AI did not return a draft. Try rephrasing your request.",
};

/**
 * Gmail-style floating "New Message" window. It lives beside the mailbox, so it stays
 * open while the user reads other mail, and like Gmail it autosaves to Drafts as the
 * user types, in whatever state the message is (no recipient, a mistyped address).
 * Closing keeps the draft; the bin discards it. It shares the editor toolbar and
 * attachment rules with the reply composer in the message view.
 */
export function ComposeWindow({ initial, onClose, onSent, closeRequest = 0, senderName = "" }: {
  initial?: ComposeDraft | null;
  /** The user's name, for the sign-off of AI-written drafts. */
  senderName?: string;
  onClose: (change: "none" | "saved" | "discarded") => void;
  onSent: () => void;
  /** Bumped by the page to close the window the way its X does (the draft is kept). */
  closeRequest?: number;
}) {
  const [to, setTo] = useState(initial?.to ?? "");
  const [cc, setCc] = useState(initial?.cc ?? "");
  const [bcc, setBcc] = useState(initial?.bcc ?? "");
  const [showCopies, setShowCopies] = useState(Boolean(initial?.cc || initial?.bcc));
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(() => (initial?.html ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  const [files, setFiles] = useState<File[]>([]);
  const [revision, setRevision] = useState(0); // Bumped on every edit, including formatting-only ones.
  const [minimized, setMinimized] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<"" | "saving" | "saved" | "error">("");
  const editorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ----- Write with AI -----
  // The user describes the email; AI fills in the subject and body for them to review.
  // With text already in the editor, the request revises that text instead.
  const [aiOpen, setAiOpen] = useState(false);
  const [aiRequest, setAiRequest] = useState("");
  const [aiTone, setAiTone] = useState<ReplyTone>("professional");
  const [aiLength, setAiLength] = useState<ReplyLength>("medium");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiRetry, setAiRetry] = useState(""); // "AI is busy. Trying again (2 of 3)…" while waiting.
  const aiAbort = useRef<AbortController | null>(null);
  // Closing the window stops a request that is still running or waiting to retry.
  useEffect(() => () => aiAbort.current?.abort(), []);
  const [aiUndo, setAiUndo] = useState<{ subject: string; html: string } | null>(null);

  // ----- Draft autosave -----
  const draftIdRef = useRef(initial?.draftId ?? "");
  const latest = useRef<Fields>({ to, cc, bcc, subject, files });
  useEffect(() => { latest.current = { to, cc, bcc, subject, files }; });
  const savedSignature = useRef<string | null>(null); // null until the window has finished loading its draft.
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const closed = useRef(false);
  const signature = () => {
    const state = latest.current;
    return JSON.stringify([state.to, state.cc, state.bcc, state.subject, editorRef.current?.innerHTML ?? "", state.files.map((file) => [file.name, file.size, file.lastModified])]);
  };
  const form = () => {
    const state = latest.current;
    const data = new FormData();
    data.set("to", state.to); data.set("cc", state.cc); data.set("bcc", state.bcc); data.set("subject", state.subject);
    // Plain text for clients without HTML support; the HTML carries the formatting.
    data.set("body", (editorRef.current?.innerText ?? "").replace(/[ ​]/g, (char) => char === " " ? " " : ""));
    data.set("html", editorRef.current?.innerHTML ?? "");
    if (draftIdRef.current) data.set("draftId", draftIdRef.current);
    for (const file of state.files) data.append("files", file, file.name);
    return data;
  };
  // Saves run one after another so each knows the draft id the previous one created.
  const saveDraft = useCallback(() => {
    saveChain.current = saveChain.current.then(async () => {
      if (closed.current || savedSignature.current === null) return;
      const current = signature();
      if (current === savedSignature.current) return;
      setDraftStatus("saving");
      try {
        const response = await fetch("/api/gmail/compose/draft", { method: "POST", body: form() });
        const result = await response.json().catch(() => ({})) as { draftId?: string };
        if (!response.ok || !result.draftId) throw new Error("draft_not_saved");
        draftIdRef.current = result.draftId;
        savedSignature.current = current;
        setDraftStatus("saved");
      } catch { setDraftStatus("error"); }
    });
    return saveChain.current;
  }, []);

  // Load the draft being reopened: its text, then its attachments. Autosave starts only
  // after that, so a half-loaded window can never overwrite the draft with less.
  useEffect(() => {
    let cancelled = false;
    if (editorRef.current && initial?.html) editorRef.current.innerHTML = initial.html;
    void (async () => {
      if (initial?.attachments.length) {
        const restored = await Promise.all(initial.attachments.map(async (attachment) => {
          const response = await fetch(attachment.downloadUrl);
          if (!response.ok) throw new Error("attachment_not_restored");
          return new File([await response.blob()], attachment.filename, { type: attachment.mimeType });
        })).catch(() => null);
        if (cancelled) return;
        if (restored) { latest.current = { ...latest.current, files: restored }; setFiles(restored); }
        else { setError("This draft's attachments could not be loaded. They stay in the draft until you change it here."); return; } // Autosave stays off.
      }
      savedSignature.current = signature();
    })();
    return () => { cancelled = true; };
  }, [initial]);
  useEffect(() => {
    const timer = window.setTimeout(() => void saveDraft(), 1500);
    return () => window.clearTimeout(timer);
  }, [to, cc, bcc, subject, files, revision, saveDraft]);
  // The window can be replaced by another draft; keep what was typed in this one.
  useEffect(() => () => { if (!closed.current) void saveDraft(); }, [saveDraft]);

  const syncBody = () => { setBody(editorRef.current?.innerText ?? ""); setRevision((value) => value + 1); };
  const writeWithAi = async () => {
    const instructions = aiRequest.trim();
    if (!instructions || aiBusy) return;
    setAiBusy(true);
    setAiError("");
    setAiRetry("");
    const controller = new AbortController();
    aiAbort.current = controller;
    try {
      const response = await fetchWithRetry("/api/gmail/compose/ai-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions, tone: aiTone, length: aiLength, to: [to, cc].filter((value) => value.trim()).join(", "), subject, currentBody: (editorRef.current?.innerText ?? "").replace(/\u200b/g, "").trim(), senderName }),
        signal: controller.signal,
      }, {
        attempts: AI_ATTEMPTS,
        maxWaitSeconds: AI_MAX_WAIT_SECONDS,
        onRetry: (next) => setAiRetry(`AI is busy. Trying again (${next} of ${AI_ATTEMPTS})…`),
      });
      const data = await response.json().catch(() => ({})) as { subject?: string; body?: string; error?: string };
      if (!response.ok || !data.body) throw new Error(aiErrors[data.error ?? ""] ?? "AI could not write a draft. Try again.");
      setAiUndo({ subject, html: editorRef.current?.innerHTML ?? "" });
      if (data.subject) setSubject(data.subject);
      if (editorRef.current) editorRef.current.innerHTML = draftTextToHtml(data.body);
      syncBody();
      setAiRequest(""); // The next request revises this draft ("make it shorter").
    } catch (cause) {
      if (!controller.signal.aborted) setAiError(cause instanceof Error ? cause.message : "AI could not write a draft. Try again.");
    } finally {
      if (aiAbort.current === controller) aiAbort.current = null;
      setAiBusy(false);
      setAiRetry("");
    }
  };
  const cancelAi = () => aiAbort.current?.abort();
  const undoAi = () => {
    if (!aiUndo) return;
    setSubject(aiUndo.subject);
    if (editorRef.current) editorRef.current.innerHTML = aiUndo.html;
    syncBody();
    setAiUndo(null);
  };
  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      if (!next.some((existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) next.push(file);
    }
    const total = next.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_ATTACHMENT_BYTES) setError(`Attachments can be up to ${formatBytes(MAX_ATTACHMENT_BYTES)} in total. These files add up to ${formatBytes(total)}.`);
    else { setError(null); setFiles(next); }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const hasRecipient = Boolean(`${to}${cc}${bcc}`.trim());
  const hasContent = Boolean(subject.trim() || body.replace(/​/g, "").trim() || files.length);
  const canSend = hasRecipient && hasContent && !sending;
  // Save & close, like Gmail's X: the message stays in Drafts.
  const closing = useRef(false);
  const close = async () => {
    if (closing.current) return; // A second click while the draft is being saved does nothing more.
    closing.current = true;
    await saveDraft();
    closed.current = true;
    onClose(draftIdRef.current ? "saved" : "none");
  };
  // The page's Compose button toggles this window: each new request closes it like the X.
  // A window opened after earlier requests ignores them (only changes count).
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  const handledCloseRequest = useRef(closeRequest);
  useEffect(() => {
    if (closeRequest === handledCloseRequest.current) return;
    handledCloseRequest.current = closeRequest;
    void closeRef.current();
  }, [closeRequest]);
  const discard = async () => {
    closed.current = true;
    await saveChain.current;
    if (draftIdRef.current) await fetch(`/api/gmail/compose/draft?draftId=${encodeURIComponent(draftIdRef.current)}`, { method: "DELETE" }).catch(() => null);
    onClose(draftIdRef.current ? "discarded" : "none");
  };
  async function send() {
    if (!canSend) return;
    setSending(true); setError(null);
    try {
      await saveChain.current; // Let a save in flight finish so its draft id is known and gets removed.
      const response = await fetch("/api/gmail/compose", { method: "POST", body: form() });
      const result = await response.json().catch(() => ({})) as { error?: string; invalid?: string[] };
      if (!response.ok) {
        throw new Error(result.error === "invalid_recipient" ? `Check ${result.invalid?.length === 1 ? "this address" : "these addresses"}: ${(result.invalid ?? []).join(", ")}`
          : response.status === 413 ? sendErrors.attachments_too_large : sendErrors[result.error ?? ""] ?? "Message could not be sent.");
      }
      closed.current = true;
      onSent();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Message could not be sent."); }
    finally { setSending(false); }
  }

  const row = "flex items-center gap-2 border-b border-mail-line px-4 text-sm";
  const input = "min-w-0 flex-1 bg-transparent py-2 outline-none placeholder:text-mail-muted";
  return (
    <section aria-label="New message" className={`fixed bottom-0 right-0 z-50 flex w-full flex-col overflow-hidden rounded-t-[17px] border border-mail-line bg-mail-surface shadow-[0_25px_70px_rgba(21,17,26,0.27)] sm:bottom-[92px] sm:right-6 sm:rounded-[17px] ${minimized ? "sm:w-[300px]" : "max-h-[90vh] sm:max-h-[calc(100vh-116px)] sm:w-[620px]"}`}>
      <header className="flex h-12 shrink-0 cursor-pointer items-center gap-1 border-b border-mail-line pl-4 pr-1.5 text-foreground" onClick={() => setMinimized((value) => !value)}>
        <span className="min-w-0 flex-1 truncate"><span className="mr-2 text-[11px] font-extrabold uppercase tracking-[0.12em] text-mail-accent">New message</span><span className="text-[13px] font-bold">{subject.trim()}</span></span>
        <button type="button" onClick={(event) => { event.stopPropagation(); setMinimized((value) => !value); }} aria-label={minimized ? "Expand" : "Minimize"} title={minimized ? "Expand" : "Minimize"} className="flex h-8 w-8 items-center justify-center rounded text-lg leading-none text-mail-secondary hover:bg-mail-hover">{minimized ? "▴" : "–"}</button>
        <button type="button" onClick={(event) => { event.stopPropagation(); void close(); }} aria-label="Save and close" title="Save & close" className="flex h-8 w-8 items-center justify-center rounded text-mail-secondary hover:bg-mail-hover"><GIcon name="close" className="h-4 w-4" /></button>
      </header>
      {/* Hidden, not unmounted, while minimized so the text and formatting survive. */}
      <div className={minimized ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
        <label className={row}><span className="shrink-0 text-mail-secondary">To</span>
          <input value={to} onChange={(event) => setTo(event.target.value)} type="text" inputMode="email" autoFocus={!initial} aria-label="To" placeholder="name@example.com, another@example.com" className={input} />
          {!showCopies && <button type="button" onClick={() => setShowCopies(true)} className="shrink-0 text-xs text-mail-secondary hover:underline">Cc Bcc</button>}
        </label>
        {showCopies && <>
          <label className={row}><span className="shrink-0 text-mail-secondary">Cc</span><input value={cc} onChange={(event) => setCc(event.target.value)} type="text" inputMode="email" aria-label="Cc" className={input} /></label>
          <label className={row}><span className="shrink-0 text-mail-secondary">Bcc</span><input value={bcc} onChange={(event) => setBcc(event.target.value)} type="text" inputMode="email" aria-label="Bcc" className={input} /></label>
        </>}
        <label className={row}><input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={500} aria-label="Subject" placeholder="Subject" className={input} /></label>

        {aiOpen && (
          <div className="border-b border-mail-line bg-gradient-to-b from-mail-accent-tint/70 to-transparent px-4 py-3" role="group" aria-label="Write with AI">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-mail-accent">✦ Write with AI</span>
              <button type="button" onClick={() => { cancelAi(); setAiOpen(false); }} aria-label="Close Write with AI" className="flex h-6 w-6 items-center justify-center rounded-full text-mail-secondary hover:bg-mail-hover"><GIcon name="close" className="h-3.5 w-3.5" /></button>
            </div>
            <textarea value={aiRequest} onChange={(event) => setAiRequest(event.target.value)} rows={2} maxLength={1000} disabled={aiBusy} autoFocus
              onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void writeWithAi(); } }}
              aria-label="What should this email say?"
              placeholder={body.trim() ? "How should AI change this draft? e.g. make it shorter, write it in English" : "What should this email say? e.g. ask Professor Kim to move our meeting to Friday"}
              className="block w-full resize-none rounded-[10px] border border-mail-line bg-mail-surface px-3 py-2 text-[13px] leading-5 text-foreground outline-none placeholder:text-mail-muted focus:border-mail-accent-line focus:ring-2 focus:ring-mail-accent/20 disabled:opacity-60" />
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="flex items-center gap-1" role="radiogroup" aria-label="Tone">
                {AI_TONES.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={aiTone === value} onClick={() => setAiTone(value)} className={`${chip(aiTone === value)} h-7 px-2.5`}>{label}</button>)}
              </span>
              <span className="flex items-center gap-1" role="radiogroup" aria-label="Length">
                {AI_LENGTHS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={aiLength === value} onClick={() => setAiLength(value)} className={`${chip(aiLength === value)} h-7 px-2.5`}>{label}</button>)}
              </span>
              <span className="ml-auto flex items-center gap-2">
                {aiUndo && !aiBusy && <button type="button" onClick={undoAi} className="text-xs font-bold text-mail-secondary underline-offset-2 hover:underline">Undo</button>}
                {aiBusy && <button type="button" onClick={cancelAi} className="text-xs font-bold text-mail-secondary underline-offset-2 hover:underline">Cancel</button>}
                <button type="button" onClick={() => void writeWithAi()} disabled={!aiRequest.trim() || aiBusy} className={`${primaryButton} h-8 px-3 py-0 text-xs`}>
                  {aiBusy ? "Writing…" : body.trim() ? "✦ Revise" : "✦ Write draft"}
                </button>
              </span>
            </div>
            {aiRetry && <p role="status" className="mt-2 text-xs text-mail-accent">{aiRetry}</p>}
            {aiError && <p role="alert" className="mt-2 text-xs text-mail-danger">{aiError}</p>}
            {aiUndo && !aiError && !aiBusy && <p role="status" className="mt-2 text-xs text-mail-muted">AI wrote this draft. Check it before you send.</p>}
          </div>
        )}

        <div ref={editorRef} contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Message body"
          onInput={syncBody}
          onPaste={(event) => {
            // Paste as plain text so foreign styles and markup do not end up in the message.
            event.preventDefault();
            document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
          }}
          onDrop={(event) => { if (event.dataTransfer.files.length > 0) { event.preventDefault(); addFiles(event.dataTransfer.files); } }}
          onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void send(); } }}
          style={{ fontFamily: COMPOSER_FONTS[0][1] }}
          className={`min-h-[200px] flex-1 overflow-y-auto whitespace-pre-wrap break-words px-4 py-3 text-sm leading-6 outline-none ${EDITOR_CONTENT_CLASS}`} />

        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2 px-4 pb-3" aria-label="Attachments">
            {files.map((file) => (
              <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex max-w-[280px] items-center gap-2 rounded bg-mail-muted-surface py-1 pl-2 pr-1 text-xs">
                <GIcon name="attach" className="h-4 w-4 shrink-0 -rotate-45 text-mail-secondary" />
                <span className="truncate font-medium text-mail-link">{file.name}</span>
                <span className="shrink-0 text-mail-secondary">({formatBytes(file.size)})</span>
                <button type="button" onClick={() => setFiles((current) => current.filter((item) => item !== file))} aria-label={`Remove ${file.name}`} title="Remove" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-mail-secondary hover:bg-mail-muted-surface"><GIcon name="close" className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
        {error && <p role="alert" className="mx-4 mb-3 rounded bg-mail-danger-tint px-3 py-2 text-xs text-mail-danger">{error}</p>}

        <FormatToolbar editorRef={editorRef} onChange={syncBody} className="mx-4 mb-2" />

        <div className="flex items-center gap-3 px-4 pb-3 pt-1">
          <button type="button" onClick={() => void send()} disabled={!canSend} className={`${primaryButton} h-9 px-6 py-0`}>{sending ? "Sending…" : "Send"}</button>
          <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => addFiles(event.target.files)} />
          <ToolbarButton icon="attach" label="Attach files" onClick={() => fileInputRef.current?.click()} />
          <button type="button" onClick={() => setAiOpen((open) => !open)} aria-expanded={aiOpen} title="Write with AI"
            className={`flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-extrabold transition ${aiOpen ? "bg-mail-accent-tint text-mail-accent" : "text-mail-accent hover:bg-mail-accent-tint"}`}>
            <GIcon name="sparkle" className="h-4 w-4" /><span className="hidden sm:inline">Write with AI</span>
          </button>
          <span className={`text-xs ${draftStatus === "error" ? "text-mail-danger" : "text-mail-secondary"}`} role="status">
            {draftStatus === "saving" ? "Saving draft…" : draftStatus === "saved" ? "Saved to Drafts" : draftStatus === "error" ? "Draft not saved. Retrying when you type." : ""}
          </span>
          <span className="ml-auto" />
          <ToolbarButton icon="trash" label="Discard draft" onClick={() => void discard()} />
        </div>
      </div>
    </section>
  );
}
