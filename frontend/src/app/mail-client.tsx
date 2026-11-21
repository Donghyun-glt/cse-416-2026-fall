"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GOOGLE_REAUTH_ATTEMPT_KEY } from "@/lib/google-login";
import { MAIL_THEME_COOKIE, type MailTheme } from "@/lib/mail-theme";
import { AccountMenu } from "./account-menu";
import { GoogleLoginButton } from "./google-login-button";
import { GoogleCalendar } from "./google-calendar";
import { DailyBriefing } from "./daily-briefing";
import { SummaryTodoList } from "./summary-todo-list";
import { ComposeWindow, type ComposeDraft } from "./compose-window";
import { comparePriority, type Priority } from "@/lib/mail-priority";
import { MailDetail, formatSender, initials, type Mail, type SavedDraft } from "./mail-detail";

type MailResponse = { connected?: boolean; pending?: string[]; messages?: Mail[]; error?: string; nextPageToken?: string; resultSizeEstimate?: number };
type UserProfile = { name: string; email: string };
type ProfileResponse = Partial<UserProfile> & { requiresProfileAuthorization?: boolean; requiresMailboxAuthorization?: boolean };
// One entry per screen the browser's Back button should return to.
type HistoryState = { mailflow: true; view: View; mailId: string | null };
type BulkAction = "archive" | "spam" | "notSpam" | "read" | "unread";
type View = "briefing" | "summary" | "calendar" | "inbox" | "all" | "starred" | "sent" | "drafts" | "spam" | "trash";

const priorityDisplay: Record<Priority, { label: string; className: string }> = {
  urgent: { label: "Urgent", className: "bg-mail-danger-tint text-mail-danger" },
  fyi: { label: "FYI", className: "bg-mail-warning-tint text-mail-warning" },
  low: { label: "Low Priority", className: "bg-mail-success-tint text-mail-success" },
};

function PriorityBadge({ priority }: { priority: Priority }) {
  const display = priorityDisplay[priority];
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${display.className}`}>{display.label}</span>;
}

function Icon({ name, className = "h-5 w-5" }: { name: "mail" | "sun" | "summary" | "inbox" | "allMail" | "spam" | "archive" | "calendar" | "trash" | "back" | "star" | "sent" | "draft" | "reply" | "forward" | "paperclip" | "download"; className?: string }) {
  const paths = {
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" /></>,
    summary: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8m-8 4h8m-8 4h4" /></>,
    inbox: <><path d="M4 5h16l2 8v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l2-8Z" /><path d="M2 13h5l2 3h6l2-3h5" /></>,
    allMail: <><rect x="2" y="8" width="16" height="12" rx="2" /><path d="m2 10 8 5 8-5" /><path d="M6 4h14a2 2 0 0 1 2 2v10" /></>,
    spam: <><path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3L8.3 3Z" /><path d="M12 8v5M12 16.5v.01" /></>,
    archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M12 12v5M9.5 14.5 12 17l2.5-2.5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
    sent: <><path d="m3 11 18-8-8 18-2-8z" /><path d="m11 13 10-10" /></>,
    draft: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /></>,
    reply: <><path d="m9 17-5-5 5-5" /><path d="M4 12h9a7 7 0 0 1 7 7" /></>,
    forward: <><path d="m15 17 5-5-5-5" /><path d="M20 12h-9a7 7 0 0 0-7 7" /></>,
    paperclip: <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.7 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9" />,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{paths[name]}</svg>;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (date.toDateString() !== new Date().toDateString()) return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function TodayCard() {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(now);
  const monthYear = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(now);
  return (
    <section className="overflow-hidden rounded-2xl border border-mail-line bg-mail-surface shadow-[0_2px_8px_rgba(31,31,27,0.04)]">
      <div className="grid min-h-48 md:grid-cols-[255px_1fr]">
        <div className="flex flex-col items-center justify-center bg-mail-accent-tint px-8 py-7 text-mail-accent">
          <p className="text-sm font-extrabold uppercase tracking-[0.08em]">{weekday}</p>
          <p className="mt-1 text-7xl font-bold leading-none tracking-[-0.06em]">{now.getDate()}</p>
          <p className="mt-3 text-sm font-bold">{monthYear}</p>
        </div>
        <div className="flex flex-col justify-center px-8 py-8">
          <div className="flex items-center gap-3 border-b border-mail-line pb-5"><Icon name="calendar" className="h-6 w-6 text-mail-accent" /><h2 className="text-lg font-bold">Today</h2></div>
          <p className="pt-5 text-sm leading-6 text-mail-muted">Your daily briefing includes every inbox message received since midnight. New mail will appear automatically while this page is open.</p>
        </div>
      </div>
    </section>
  );
}

export function MailClient({ initialConnected, initialTheme, loginError }: {
  initialConnected: boolean;
  initialTheme: MailTheme;
  loginError?: string;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [summaryPending, setSummaryPending] = useState<string[]>([]);
  const [messages, setMessages] = useState<Mail[]>([]);
  const [connected, setConnected] = useState(initialConnected);
  const [loading, setLoading] = useState(initialConnected);
  const [error, setError] = useState<string | null>(null);
  const [selectedMail, setSelectedMail] = useState<Mail | null>(null);
  const [openDraft, setOpenDraft] = useState<{ forId: string; draft: SavedDraft } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkRestoring, setBulkRestoring] = useState(false);
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);
  const [onlyAttachments, setOnlyAttachments] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [view, setView] = useState<View>("briefing");
  const [compose, setCompose] = useState<{ key: number; initial: ComposeDraft | null } | null>(null);
  const [notice, setNotice] = useState("");
  const [profile, setProfile] = useState<UserProfile>({ name: "", email: "" });
  const [allPageTokens, setAllPageTokens] = useState([""]);
  const [allPageIndex, setAllPageIndex] = useState(0);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [resultSizeEstimate, setResultSizeEstimate] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const requestRef = useRef<AbortController | null>(null);
  const bodyCacheRef = useRef(new Map<string, Pick<Mail, "html" | "attachments">>());
  const historyHandlerRef = useRef<(state: HistoryState, loadedMessages?: Mail[]) => void>(() => {});
  const pendingHistoryRef = useRef<HistoryState | null>(null);
  const analyzedMessageId = selectedMail?.id;
  const applyAnalyzedPriority = useCallback((priority: Priority) => {
    if (!analyzedMessageId) return;
    setMessages((current) => current.map((message) => message.id === analyzedMessageId ? { ...message, priority } : message));
    setSelectedMail((current) => current?.id === analyzedMessageId ? { ...current, priority } : current);
  }, [analyzedMessageId]);

  // Briefing cards analyse every message of the day; move a card when its stored priority changes.
  const applyBriefingPriority = useCallback((id: string, priority: Priority) => {
    setMessages((current) => current.some((message) => message.id === id && message.priority !== priority)
      ? current.map((message) => message.id === id ? { ...message, priority } : message).sort(comparePriority) : current);
  }, []);

  const loadMessages = useCallback(async (targetView: View, showLoading = false, pageToken = "") => {
    if (targetView === "calendar") return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const isPaged = targetView !== "briefing" && targetView !== "summary";
      const query = targetView === "summary"
        ? "?mode=summary"
        : targetView === "briefing"
          ? `?after=${startOfToday()}`
          : targetView === "all"
            ? `?mode=all&page=${allPageIndex}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
            : `?mode=${targetView}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const filterQuery = isPaged ? `${onlyAttachments ? "&attachment=1" : ""}${onlyUnread ? "&unread=1" : ""}` : "";
      const response = await fetch(`/api/gmail/messages${query}${filterQuery}`, { cache: "no-store", signal: controller.signal });
      const data = (await response.json()) as MailResponse;
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        setConnected(false);
        setMessages([]);
        return;
      }
      if (!response.ok) throw new Error(data.error ?? "Could not load messages.");
      const nextMessages = data.messages ?? [];
      if (targetView === "summary") setSummaryPending(data.pending ?? []);
      setConnected(true);
      setMessages(nextMessages);
      if (showLoading) {
        setSelectedIds(new Set());
      } else {
        const availableIds = new Set(nextMessages.map((message) => message.id));
        setSelectedIds((current) => new Set([...current].filter((id) => availableIds.has(id))));
        setSelectedMail((current) => {
          if (!current) return null;
          const synced = nextMessages.find((message) => message.id === current.id);
          return synced ? { ...synced, html: current.html, attachments: current.attachments, partial: current.partial, hasDraft: current.hasDraft } : current;
        });
      }
      if (isPaged) {
        setNextPageToken(data.nextPageToken ?? null);
        setResultSizeEstimate(data.resultSizeEstimate ?? 0);
      }
      const pendingHistory = pendingHistoryRef.current;
      if (pendingHistory?.view === targetView) {
        pendingHistoryRef.current = null;
        historyHandlerRef.current(pendingHistory, nextMessages);
      }
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "An unknown error occurred.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [allPageIndex, onlyAttachments, onlyUnread]);

  const loadProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/google/profile", { cache: "no-store" });
      if (response.status === 401) {
        setConnected(false);
        return;
      }
      if (!response.ok) return;
      const data = (await response.json()) as ProfileResponse;
      setProfile({ name: data.name ?? "", email: data.email ?? "" });

      if (data.requiresProfileAuthorization || data.requiresMailboxAuthorization) {
        if (!window.sessionStorage.getItem(GOOGLE_REAUTH_ATTEMPT_KEY)) {
          window.sessionStorage.setItem(GOOGLE_REAUTH_ATTEMPT_KEY, "true");
          window.location.assign(new URL("/api/google/connect", window.location.origin));
        }
      } else {
        window.sessionStorage.removeItem(GOOGLE_REAUTH_ATTEMPT_KEY);
      }
    } catch {
      // Mail loading should continue even if optional profile data is unavailable.
    }
  }, []);

  useEffect(() => {
    if (!initialConnected) return;
    const timeout = window.setTimeout(
      () => void loadMessages(view, true, view === "briefing" ? "" : allPageTokens[allPageIndex]),
      0,
    );
    return () => window.clearTimeout(timeout);
  }, [allPageIndex, allPageTokens, initialConnected, loadMessages, view]);

  useEffect(() => {
    if (!initialConnected) return;
    const timeout = window.setTimeout(() => void loadProfile(), 0);
    return () => window.clearTimeout(timeout);
  }, [initialConnected, loadProfile]);

  useEffect(() => () => requestRef.current?.abort(), []);

  useEffect(() => {
    if (!connected || view === "calendar") return;
    const pageToken = view === "briefing" ? "" : allPageTokens[allPageIndex];
    const syncCurrentMailbox = () => {
      if (requestRef.current) return;
      void loadMessages(view, false, pageToken);
    };
    const interval = window.setInterval(syncCurrentMailbox, view === "summary" ? 60_000 : 15_000);
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") syncCurrentMailbox(); };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", refreshWhenVisible); };
  }, [allPageIndex, allPageTokens, connected, loadMessages, view]);

  const fullDate = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  // ----- Browser history -----
  // MailFlow is a single page, so without history entries the browser's Back
  // button would leave the app. Each mailbox change and each opened message
  // adds an entry; Back/Forward then restore that screen.
  const viewRef = useRef(view);
  const messagesRef = useRef(messages);
  useEffect(() => { viewRef.current = view; messagesRef.current = messages; }, [messages, view]);
  const recordHistory = (nextView: View, mailId: string | null, replace = false) => {
    const state: HistoryState = { mailflow: true, view: nextView, mailId };
    if (replace) window.history.replaceState(state, "");
    else window.history.pushState(state, "");
  };

  const applyView = (next: View) => {
    pendingHistoryRef.current = null;
    if (next !== view && (next === "summary" || view === "summary")) {
      requestRef.current?.abort();
      setMessages([]);
      setError(null);
      setLoading(next !== "calendar");
    }
    setView(next);
    setSelectedMail(null);
    setSelectedIds(new Set());
    setOnlyAttachments(false);
    setOnlyUnread(false);
    if (next !== "briefing") {
      setAllPageTokens([""]);
      setAllPageIndex(0);
      setNextPageToken(null);
    }
  };
  const changeView = (next: View) => {
    // Clicking the mailbox that is already showing just refreshes it.
    if (next !== view || selectedMail) recordHistory(next, null);
    applyView(next);
  };
  // Leave an opened message. Going through history keeps Back/Forward in step
  // with what is on screen; the popstate handler below does the state change.
  const closeMail = () => {
    const state = window.history.state as HistoryState | null;
    if (state?.mailflow && state.mailId) window.history.back();
    else setSelectedMail(null);
  };
  // Filters change which messages Gmail returns, so paging starts over.
  const toggleFilter = (filter: "attachment" | "unread") => {
    if (filter === "attachment") setOnlyAttachments((current) => !current);
    else setOnlyUnread((current) => !current);
    setSelectedIds(new Set());
    setAllPageTokens([""]);
    setAllPageIndex(0);
    setNextPageToken(null);
  };
  const goToNextPage = () => {
    if (!nextPageToken) return;
    setAllPageTokens((tokens) => [...tokens.slice(0, allPageIndex + 1), nextPageToken]);
    setAllPageIndex((index) => index + 1);
    setSelectedMail(null);
    setSelectedIds(new Set());
  };
  const goToPreviousPage = () => {
    if (allPageIndex === 0) return;
    setAllPageIndex((index) => index - 1);
    setSelectedMail(null);
    setSelectedIds(new Set());
  };
  const showMessage = (message: Mail) => {
    // Lists carry headers and snippet only. Show those immediately, then load
    // the body; bodies already opened in this session come from the cache.
    const body = bodyCacheRef.current.get(message.id);
    const readMessage = body ? { ...message, ...body, unread: false, partial: false } : { ...message, unread: false };
    setSelectedMail(readMessage);
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, unread: false } : item));
    if (readMessage.partial) {
      void fetch(`/api/gmail/messages/${encodeURIComponent(message.id)}`, { cache: "no-store" })
        .then(async (response) => {
          const data = await response.json().catch(() => ({})) as { message?: Mail };
          if (!response.ok || !data.message) throw new Error("Could not load the message.");
          const loaded = { html: data.message.html, attachments: data.message.attachments };
          bodyCacheRef.current.set(message.id, loaded);
          setSelectedMail((current) => current?.id === message.id ? { ...current, ...loaded, partial: false } : current);
        })
        .catch((bodyError: unknown) => {
          setError(bodyError instanceof Error ? bodyError.message : "Could not load the message.");
        });
    }
    if (!message.unread) return;

    void fetch(`/api/gmail/messages/${encodeURIComponent(message.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read" }),
    }).then((response) => {
      if (!response.ok) throw new Error("Could not mark the message as read.");
    }).catch((readError: unknown) => {
      setError(readError instanceof Error ? readError.message : "Could not mark the message as read.");
    });
  };
  const openMessage = (message: Mail) => {
    if (message.draft) {
      void openDraftCard(message);
      return;
    }
    // Moving between messages (newer/older) replaces the entry, so one Back returns to the list.
    recordHistory(view, message.id, Boolean(selectedMail));
    setOpenDraft(null);
    showMessage(message);
  };
  // A card in Drafts opens the message it answers, with the composer restored,
  // like Gmail. Drafts that answer nothing MailFlow can find open read-only.
  const openDraftCard = async (draftMessage: Mail) => {
    setError(null);
    try {
      const response = await fetch(`/api/gmail/messages/${encodeURIComponent(draftMessage.id)}/draft`, { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as { sourceId?: string | null; draft?: SavedDraft | null };
      if (response.ok && data.sourceId && data.draft) {
        const sourceResponse = await fetch(`/api/gmail/messages/${encodeURIComponent(data.sourceId)}`, { cache: "no-store" });
        const sourceData = await sourceResponse.json().catch(() => ({})) as { message?: Mail };
        if (sourceResponse.ok && sourceData.message) {
          const source = { ...sourceData.message, partial: false, hasDraft: true };
          bodyCacheRef.current.set(source.id, { html: source.html, attachments: source.attachments });
          recordHistory(view, source.id, Boolean(selectedMail));
          setOpenDraft({ forId: source.id, draft: data.draft });
          setSelectedMail(source);
          return;
        }
      }
      // A draft that answers no message is a new message: reopen it in the Compose window.
      const composeResponse = await fetch(`/api/gmail/compose/draft?messageId=${encodeURIComponent(draftMessage.id)}`, { cache: "no-store" });
      const composeData = await composeResponse.json().catch(() => ({})) as { draft?: ComposeDraft | null };
      if (composeResponse.ok && composeData.draft) {
        setCompose({ key: Date.now(), initial: composeData.draft });
        return;
      }
    } catch {
      // Fall through to the read-only view.
    }
    recordHistory(view, draftMessage.id, Boolean(selectedMail));
    setOpenDraft(null);
    showMessage(draftMessage);
  };

  // Kept in a ref so the popstate listener below always runs the latest version.
  useEffect(() => {
    historyHandlerRef.current = (state, loadedMessages) => {
      if (!loadedMessages && state.view !== viewRef.current) {
        applyView(state.view);
        if (state.mailId) pendingHistoryRef.current = state;
        return;
      }
      pendingHistoryRef.current = null;
      const target = state.mailId ? (loadedMessages ?? messagesRef.current).find((message) => message.id === state.mailId) : undefined;
      setOpenDraft(null);
      if (target && !target.draft) showMessage(target);
      else setSelectedMail(null);
    };
  });

  // Mark the starting screen, then follow the browser's Back/Forward buttons.
  useEffect(() => {
    const entry = window.history.state as HistoryState | null;
    let restoreTimer: number | undefined;
    if (!entry?.mailflow) {
      window.history.replaceState({ mailflow: true, view: viewRef.current, mailId: null } satisfies HistoryState, "");
    } else if (entry.view !== viewRef.current) {
      // The router may remount the page while restoring a history entry.
      restoreTimer = window.setTimeout(() => historyHandlerRef.current(entry), 0);
    } else if (entry.mailId) {
      pendingHistoryRef.current = entry;
    }
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as HistoryState | null;
      if (!state?.mailflow) return;
      historyHandlerRef.current(state);
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.clearTimeout(restoreTimer);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  const toggleSelection = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAllSelections = () => {
    setSelectedIds((current) =>
      messages.length > 0 && messages.every((message) => current.has(message.id))
        ? new Set()
        : new Set(messages.map((message) => message.id)),
    );
  };
  const toggleStar = async (message: Mail) => {
    const starred = !message.starred;
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, starred } : item));
    setSelectedMail((current) => current?.id === message.id ? { ...current, starred } : current);
    try {
      const response = await fetch(`/api/gmail/messages/${encodeURIComponent(message.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "star", starred }),
      });
      if (!response.ok) throw new Error("Could not update the star.");
      if (view === "starred" && !starred) {
        setMessages((current) => current.filter((item) => item.id !== message.id));
      }
    } catch (starError) {
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, starred: message.starred } : item));
      setSelectedMail((current) => current?.id === message.id ? { ...current, starred: message.starred } : current);
      setError(starError instanceof Error ? starError.message : "Could not update the star.");
    }
  };
  const changePriority = async (priority: Priority) => {
    if (!selectedMail || selectedMail.priority === priority) return;
    const previous = selectedMail;
    setSelectedMail({ ...previous, priority });
    setMessages((current) => {
      const updated = current.map((message) => message.id === previous.id ? { ...message, priority } : message);
      return view === "briefing" ? updated.sort(comparePriority) : updated;
    });
    setError(null);
    try {
      const response = await fetch(`/api/gmail/messages/${encodeURIComponent(previous.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "priority", priority }),
      });
      if (!response.ok) throw new Error("Priority could not be saved.");
    } catch (changeError) {
      setSelectedMail((current) => current?.id === previous.id ? { ...current, priority: previous.priority } : current);
      setMessages((current) => current.map((message) => message.id === previous.id ? { ...message, priority: previous.priority } : message));
      setError(changeError instanceof Error ? changeError.message : "Priority could not be saved.");
    }
  };
  const moveSelectedMailToTrash = async () => {
    if (!selectedMail || deleting) return;
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/gmail/messages/${encodeURIComponent(selectedMail.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not move the message to Trash.");
      setMessages((current) => current.filter((message) => message.id !== selectedMail.id));
      closeMail();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not move the message to Trash.");
    } finally {
      setDeleting(false);
    }
  };
  // Gmail-style single-message actions: apply, drop from the list when the
  // message no longer belongs to the current view, and go back to the list.
  const applyMessageAction = async (action: "unread" | "archive" | "spam" | "notSpam") => {
    if (!selectedMail) return;
    const target = selectedMail;
    setError(null);
    try {
      const response = await fetch(`/api/gmail/messages/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error("The action could not be completed.");
      setMessages((current) => action === "unread"
        ? current.map((message) => message.id === target.id ? { ...message, unread: true } : message)
        : action === "archive" && (view === "all" || view === "summary")
          ? current
          : current.filter((message) => message.id !== target.id));
      closeMail();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The action could not be completed.");
    }
  };
  const moveSelectedMailsToTrash = async () => {
    if (selectedIds.size === 0 || bulkDeleting || view === "trash") return;
    const ids = [...selectedIds];
    setBulkDeleting(true);
    setError(null);
    try {
      const results = await Promise.all(ids.map(async (id) => {
        const response = await fetch(`/api/gmail/messages/${encodeURIComponent(id)}`, { method: "DELETE" });
        return { id, ok: response.ok };
      }));
      const movedIds = new Set(results.filter((result) => result.ok).map((result) => result.id));
      const failedIds = results.filter((result) => !result.ok).map((result) => result.id);
      setMessages((current) => current.filter((message) => !movedIds.has(message.id)));
      setSelectedIds(new Set(failedIds));
      if (failedIds.length > 0) throw new Error(`${failedIds.length} messages could not be moved to Trash.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not move the selected messages to Trash.");
    } finally {
      setBulkDeleting(false);
    }
  };
  // Gmail-style actions on the checked rows. A message leaves the list only
  // when the action takes it out of the mailbox being shown.
  const applyBulkAction = async (action: BulkAction) => {
    if (selectedIds.size === 0 || bulkAction) return;
    const ids = [...selectedIds];
    setBulkAction(action);
    setError(null);
    try {
      const results = await Promise.all(ids.map(async (id) => {
        const response = await fetch(`/api/gmail/messages/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        return { id, ok: response.ok };
      }));
      const doneIds = new Set(results.filter((result) => result.ok).map((result) => result.id));
      const failedIds = results.filter((result) => !result.ok).map((result) => result.id);
      const leavesView = action === "spam" || action === "notSpam" || (action === "archive" && view === "inbox") || (action === "read" && onlyUnread);
      setMessages((current) => leavesView
        ? current.filter((message) => !doneIds.has(message.id))
        : action === "read" || action === "unread"
          ? current.map((message) => doneIds.has(message.id) ? { ...message, unread: action === "unread" } : message)
          : current);
      setSelectedIds(new Set(failedIds));
      if (failedIds.length > 0) throw new Error(`The action could not be applied to ${failedIds.length} message${failedIds.length === 1 ? "" : "s"}.`);
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : "The action could not be applied to the selected messages.");
    } finally {
      setBulkAction(null);
    }
  };
  const moveSelectedMailsToAllEmails = async () => {
    if (selectedIds.size === 0 || bulkRestoring || view !== "trash") return;
    const ids = [...selectedIds];
    setBulkRestoring(true);
    setError(null);
    try {
      const results = await Promise.all(ids.map(async (id) => {
        const response = await fetch(`/api/gmail/messages/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore" }),
        });
        return { id, ok: response.ok };
      }));
      const restoredIds = new Set(results.filter((result) => result.ok).map((result) => result.id));
      const failedIds = results.filter((result) => !result.ok).map((result) => result.id);
      setMessages((current) => current.filter((message) => !restoredIds.has(message.id)));
      setSelectedIds(new Set(failedIds));
      if (failedIds.length > 0) throw new Error(`${failedIds.length} messages could not be moved to All Emails.`);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Could not move the selected messages to All Emails.");
    } finally {
      setBulkRestoring(false);
    }
  };

  const displayedMessages = messages;
  const singleList = view === "briefing" || view === "summary";
  const selectedPosition = {
    index: selectedMail ? displayedMessages.findIndex((message) => message.id === selectedMail.id) : -1,
    offset: singleList ? 0 : allPageIndex * 50,
  };

  function changeTheme(nextTheme: MailTheme) {
    setTheme(nextTheme);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${MAIL_THEME_COOKIE}=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }

  if (!connected) {
    return (
      <main data-mail-theme={theme} className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-md rounded-3xl border border-mail-line bg-mail-surface p-10 text-center shadow-[0_18px_50px_rgba(34,32,28,0.08)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5944d8] text-white"><Icon name="mail" className="h-7 w-7" /></div>
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight">Welcome to MailFlow AI</h1>
          <p className="mt-3 text-sm leading-6 text-mail-muted">Connect Gmail to open your daily briefing and see new messages from today.</p>
          <GoogleLoginButton initialError={loginError} />
        </div>
      </main>
    );
  }

  return (
    <main data-mail-theme={theme} className="min-h-screen bg-background text-foreground">
      <aside className="relative z-30 border-b border-mail-line bg-mail-surface lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-[220px] lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap items-center justify-between gap-y-3 px-4 py-4 lg:block lg:min-h-0 lg:overflow-y-auto lg:px-5 lg:py-6">
          <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#5944d8] text-white"><Icon name="mail" className="h-[18px] w-[18px]" /></span><span className="text-lg font-extrabold tracking-tight">MailFlow AI</span></div>
          <button type="button" onClick={() => setCompose((current) => current ?? { key: Date.now(), initial: null })} aria-label="Compose" className="flex h-10 shrink-0 items-center gap-2.5 rounded-2xl bg-mail-accent-highlight px-3 text-sm font-extrabold text-mail-accent transition hover:bg-mail-accent-tint hover:shadow-[0_2px_8px_rgba(89,68,216,0.25)] lg:mt-7 lg:h-12 lg:px-5">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
            <span className="hidden sm:inline">Compose</span>
          </button>
          <nav className="flex w-full gap-1 overflow-x-auto p-1 [scrollbar-color:var(--mail-line-strong)_transparent] [scrollbar-width:thin] lg:mt-5 lg:block lg:space-y-1.5 lg:overflow-visible lg:p-0" aria-label="Mailbox">
            <button type="button" onClick={() => changeView("briefing")} className={`flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "briefing" ? "bg-mail-accent-tint text-mail-accent" : "text-mail-muted hover:bg-mail-muted-surface"}`}><Icon name="sun" /><span className="hidden sm:inline">Daily Briefing</span></button>
            <button type="button" onClick={() => changeView("summary")} aria-current={view === "summary" ? "page" : undefined} className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "summary" ? "bg-mail-accent-tint text-mail-accent" : "text-mail-muted hover:bg-mail-muted-surface"}`}><Icon name="summary" /><span>Summary</span></button>
            <button type="button" onClick={() => changeView("calendar")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "calendar" ? "bg-mail-accent-tint text-mail-accent" : "text-mail-muted hover:bg-mail-muted-surface"}`}><Icon name="calendar" /><span className="hidden sm:inline">Calendar</span></button>
            <button type="button" onClick={() => changeView("inbox")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "inbox" ? "bg-mail-accent-tint text-mail-accent" : "text-mail-muted hover:bg-mail-muted-surface"}`}><Icon name="inbox" /><span className="hidden sm:inline">Inbox</span></button>
            <button type="button" onClick={() => changeView("starred")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "starred" ? "bg-mail-accent-tint text-mail-accent" : "text-mail-muted hover:bg-mail-muted-surface"}`}><Icon name="star" /><span className="hidden sm:inline">Starred</span></button>
            <button type="button" onClick={() => changeView("sent")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "sent" ? "bg-mail-accent-tint text-mail-accent" : "text-mail-muted hover:bg-mail-muted-surface"}`}><Icon name="sent" /><span className="hidden sm:inline">Sent</span></button>
            <button type="button" onClick={() => changeView("drafts")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "drafts" ? "bg-mail-accent-tint text-mail-accent" : "text-mail-muted hover:bg-mail-muted-surface"}`}><Icon name="draft" /><span className="hidden sm:inline">Drafts</span></button>
            <button type="button" onClick={() => changeView("all")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "all" ? "bg-mail-accent-tint text-mail-accent" : "text-mail-muted hover:bg-mail-muted-surface"}`}><Icon name="allMail" /><span className="hidden sm:inline">All Emails</span></button>
            <button type="button" onClick={() => changeView("spam")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "spam" ? "bg-mail-accent-tint text-mail-accent" : "text-mail-muted hover:bg-mail-muted-surface"}`}><Icon name="spam" /><span className="hidden sm:inline">Spam</span></button>
            <button type="button" onClick={() => changeView("trash")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "trash" ? "bg-mail-accent-tint text-mail-accent" : "text-mail-muted hover:bg-mail-muted-surface"}`}><Icon name="trash" /><span className="hidden sm:inline">Trash</span></button>
          </nav>
        </div>
        <div className="mt-auto shrink-0 border-t border-mail-line px-4 py-2 lg:px-3 lg:py-3">
          <AccountMenu profile={profile} theme={theme} onThemeChange={changeTheme} />
        </div>
      </aside>

      <div className="min-w-0 lg:ml-[220px]">
        {selectedMail ? (
          <MailDetail
            key={selectedMail.id}
            message={selectedMail}
            myEmail={profile.email}
            deleting={deleting}
            error={error}
            position={selectedPosition.index >= 0 ? selectedPosition.offset + selectedPosition.index + 1 : 0}
            total={singleList ? displayedMessages.length : Math.max(resultSizeEstimate, selectedPosition.offset + displayedMessages.length)}
            onBack={closeMail}
            backLabel={view === "summary" ? "Back to Summary" : undefined}
            initialDraft={openDraft?.forId === selectedMail.id ? openDraft.draft : null}
            onDraftChange={(hasDraft) => {
              const id = selectedMail.id;
              setMessages((current) => current.map((message) => message.id === id ? { ...message, hasDraft } : message));
            }}
            onNewer={selectedPosition.index > 0 ? () => openMessage(displayedMessages[selectedPosition.index - 1]) : undefined}
            onOlder={selectedPosition.index >= 0 && selectedPosition.index < displayedMessages.length - 1 ? () => openMessage(displayedMessages[selectedPosition.index + 1]) : undefined}
            onDelete={view === "trash" ? undefined : () => void moveSelectedMailToTrash()}
            onArchive={view === "trash" || view === "spam" || view === "sent" || selectedMail.draft ? undefined : () => void applyMessageAction("archive")}
            onSpam={view === "trash" || view === "spam" || view === "sent" || selectedMail.draft ? undefined : () => void applyMessageAction("spam")}
            onNotSpam={view === "spam" ? () => void applyMessageAction("notSpam") : undefined}
            onMarkUnread={selectedMail.draft ? undefined : () => void applyMessageAction("unread")}
            onPriorityChange={(priority) => void changePriority(priority)}
            onAnalyzedPriority={applyAnalyzedPriority}
            onStar={() => void toggleStar(selectedMail)}
          />
        ) : (
          <>
        <header className="border-b border-mail-line bg-mail-surface px-6 py-5 md:px-9"><div className="mx-auto max-w-[1200px]"><h1 className="text-2xl font-extrabold tracking-[-0.03em]">{view === "briefing" ? `${greeting()}${profile.name ? `, ${profile.name}` : ""}` : view === "summary" ? "Summary" : view === "calendar" ? "Calendar" : view === "starred" ? "Starred" : view === "sent" ? "Sent" : view === "drafts" ? "Drafts" : view === "trash" ? "Trash" : view === "inbox" ? "Inbox" : view === "spam" ? "Spam" : "All Emails"}</h1>{view === "briefing" && <p className="mt-1 text-sm text-mail-muted">{fullDate} · You have {messages.length} new email{messages.length === 1 ? "" : "s"} today</p>}{view === "summary" && <p className="mt-1 text-sm text-mail-muted">What still needs something from you.</p>}</div></header>

        <div className="mx-auto max-w-[1200px] space-y-5 px-5 py-6 md:px-9">
          {view === "calendar" ? <GoogleCalendar /> : view === "summary" ? (
            <SummaryTodoList messages={displayedMessages} pending={summaryPending} loading={loading} error={error} onOpen={openMessage} onRefresh={() => void loadMessages("summary")} />
          ) : <>
          {view === "briefing" && <TodayCard />}
          <section>
            <div className="mb-3">{view === "briefing" && <h2 className="text-base font-extrabold">Today&apos;s emails</h2>}<p className="mt-0.5 text-xs text-mail-muted">{loading ? "Syncing your inbox…" : view === "briefing" ? `${messages.length} message${messages.length === 1 ? "" : "s"} · Updates automatically` : `Page ${allPageIndex + 1} · ${messages.length} message${messages.length === 1 ? "" : "s"}`}</p></div>
            {error && <p className="mb-3 rounded-xl border border-mail-danger-line bg-mail-danger-tint p-4 text-sm text-mail-danger">{error}</p>}
            {(view === "trash" || view === "spam") && <p className="mb-3 rounded-xl bg-mail-muted-surface px-4 py-3 text-center text-sm text-mail-muted">Messages in {view === "trash" ? "Trash" : "Spam"} are automatically deleted after 30 days.</p>}
            {view !== "briefing" && <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Filters">
              {([["attachment", "Has attachment", onlyAttachments], ["unread", "Is unread", onlyUnread]] as const).map(([filter, label, active]) => (
                <button key={filter} type="button" onClick={() => toggleFilter(filter)} aria-pressed={active}
                  className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition ${active ? "border-mail-accent bg-mail-accent-tint text-mail-accent" : "border-mail-line bg-mail-surface text-mail-secondary hover:bg-mail-muted-surface"}`}>
                  {filter === "attachment" && <Icon name="paperclip" className="h-3.5 w-3.5" />}{label}{active && <span aria-hidden="true">×</span>}
                </button>
              ))}
            </div>}
            {view !== "briefing" && <div className="sticky top-0 z-20 mb-3 flex h-12 items-center justify-between rounded-xl border border-mail-line bg-mail-surface/95 px-4 shadow-[0_3px_12px_rgba(31,31,27,0.08)] backdrop-blur">
              <div className="flex items-center gap-2"><label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-mail-muted"><input type="checkbox" checked={messages.length > 0 && messages.every((message) => selectedIds.has(message.id))} onChange={toggleAllSelections} aria-label="Select all messages on this page" className="h-4 w-4 cursor-pointer accent-[#5944d8]" /><span className="hidden sm:inline">Select</span></label>{selectedIds.size > 0 && (() => {
                const busy = Boolean(bulkAction) || bulkDeleting || bulkRestoring;
                const anyUnread = messages.some((message) => selectedIds.has(message.id) && message.unread);
                const bulkButton = (icon: Parameters<typeof Icon>[0]["name"], label: string, onClick: () => void, working = false) => (
                  <button key={label} type="button" onClick={onClick} disabled={busy} aria-label={`${label} (${selectedIds.size} selected)`} title={label}
                    className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-xs font-bold text-mail-secondary transition hover:bg-mail-muted-surface disabled:cursor-not-allowed disabled:opacity-40">
                    <Icon name={icon} className="h-4 w-4" /><span className="hidden md:inline">{working ? "Working…" : label}</span>
                  </button>
                );
                const archive = bulkButton("archive", "Archive", () => void applyBulkAction("archive"), bulkAction === "archive");
                const spam = bulkButton("spam", "Report spam", () => void applyBulkAction("spam"), bulkAction === "spam");
                const trash = bulkButton("trash", view === "drafts" ? "Discard drafts" : "Delete", () => void moveSelectedMailsToTrash(), bulkDeleting);
                const readState = anyUnread
                  ? bulkButton("mail", "Mark as read", () => void applyBulkAction("read"), bulkAction === "read")
                  : bulkButton("mail", "Mark as unread", () => void applyBulkAction("unread"), bulkAction === "unread");
                // Each mailbox offers only the actions that make sense there, like Gmail.
                const actions = view === "trash"
                  ? [bulkButton("inbox", "Restore", () => void moveSelectedMailsToAllEmails(), bulkRestoring)]
                  : view === "spam"
                    ? [bulkButton("inbox", "Not spam", () => void applyBulkAction("notSpam"), bulkAction === "notSpam"), trash, readState]
                    : view === "drafts"
                      ? [trash]
                      : view === "sent"
                        ? [trash, readState]
                        : [archive, spam, trash, readState];
                return <span className="ml-2 flex items-center gap-0.5"><span className="mr-1 whitespace-nowrap text-xs font-semibold text-mail-accent">{selectedIds.size} selected</span>{actions}</span>;
              })()}</div>
              <div className="flex items-center gap-1"><button type="button" onClick={goToPreviousPage} disabled={allPageIndex === 0} aria-label="Previous page" className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-mail-secondary transition hover:bg-mail-muted-surface disabled:cursor-not-allowed disabled:opacity-30">‹</button><button type="button" onClick={goToNextPage} disabled={!nextPageToken} aria-label="Next page" className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-mail-secondary transition hover:bg-mail-muted-surface disabled:cursor-not-allowed disabled:opacity-30">›</button></div>
            </div>}
            {view === "briefing" && !loading && messages.length > 0
              ? <DailyBriefing messages={messages} onOpen={openMessage} onPriority={applyBriefingPriority} />
              : <div className="overflow-hidden rounded-2xl border border-mail-line bg-mail-surface shadow-[0_2px_8px_rgba(31,31,27,0.04)]">
              {loading ? <div className="p-8 text-center text-sm text-mail-muted">Loading messages…</div> : messages.length === 0 ? <div className="p-10 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-mail-accent-tint text-mail-accent"><Icon name="inbox" /></div><p className="mt-4 font-bold">You&apos;re all caught up</p><p className="mt-1 text-sm text-mail-muted">{view === "briefing" ? "No inbox messages have arrived since midnight." : view === "sent" ? "You haven't sent any messages yet." : view === "spam" ? "Nothing in Spam." : onlyAttachments || onlyUnread ? "No messages match these filters." : view === "inbox" ? "Your inbox is empty. Archived mail is in All Emails." : "There are no messages to show."}</p></div> : messages.map((message, index) => {
                const sender = view === "sent" ? `To: ${formatSender(message.to.split(",")[0] || "") || "(no recipient)"}` : formatSender(message.from);
                const color = ["#b64b3b", "#4674a0", "#7751b2", "#4b806a", "#8f7a44"][index % 5];
                const rowTone = !message.unread ? "bg-mail-read-surface text-mail-read-text hover:bg-mail-hover" : "bg-mail-surface hover:bg-mail-muted-surface";
                const startsGroup = index === 0 || messages[index - 1].priority !== message.priority;
                return <article key={message.id} className={`select-none ${index ? "border-t border-mail-line" : ""}`} onMouseDown={(event) => { if (event.detail > 1) event.preventDefault(); }}>
                  {startsGroup && view === "briefing" && <h3 className={`px-5 py-2 text-xs font-extrabold uppercase tracking-wide ${priorityDisplay[message.priority].className}`}>{priorityDisplay[message.priority].label}</h3>}
                  <div className={`flex items-center gap-2 px-4 py-3 transition md:px-5 ${rowTone}`}>
                    {view !== "briefing" && <><input type="checkbox" checked={selectedIds.has(message.id)} onChange={() => toggleSelection(message.id)} aria-label={`Select ${message.subject}`} className="h-4 w-4 shrink-0 cursor-pointer accent-[#5944d8]" />{view === "trash" ? <span className="flex h-8 w-8 shrink-0 items-center justify-center text-mail-muted"><Icon name="trash" className="h-4 w-4" /></span> : <button type="button" onClick={() => void toggleStar(message)} aria-label={message.starred ? "Remove favorite" : "Add favorite"} aria-pressed={message.starred} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-2xl leading-none transition hover:bg-black/5 ${message.starred ? "text-[#e7b928]" : "text-mail-muted"}`}>{message.starred ? "★" : "☆"}</button>}</>}
                    <button type="button" onClick={() => openMessage(message)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white" style={{ backgroundColor: color }}>{initials(sender)}</span><span className="min-w-0 flex-1"><span className={`block truncate text-sm ${message.unread ? "font-extrabold" : "font-medium"}`}>{sender}{message.hasDraft && <>, <span className="font-medium text-mail-danger">Draft</span></>} <span className={message.unread ? "font-bold" : "font-medium"}>— {message.subject}</span></span>{message.snippet && <span className="mt-1 block truncate text-sm text-mail-muted">{message.snippet}</span>}</span>{message.attachments.some((attachment) => !attachment.inline) && <span title="Has attachment" className="shrink-0 text-mail-muted"><Icon name="paperclip" className="h-4 w-4" /></span>}{!message.draft && <PriorityBadge priority={message.priority} />}<time className="shrink-0 self-start pt-1 text-xs text-mail-muted">{formatTime(message.date)}</time></button>
                  </div>
                </article>;
              })}
            </div>}
          </section>
          </>}
        </div>
          </>
        )}
      </div>
      {compose && <ComposeWindow key={compose.key} initial={compose.initial}
        onClose={(change) => {
          setCompose(null);
          if (change === "none") return;
          setNotice(change === "saved" ? "Draft saved" : "Draft discarded");
          window.setTimeout(() => setNotice(""), 4000);
          if (view === "drafts") void loadMessages("drafts", false, allPageTokens[allPageIndex]);
        }}
        onSent={() => {
          setCompose(null);
          setNotice("Message sent");
          window.setTimeout(() => setNotice(""), 4000);
          if (view === "sent" || view === "drafts") void loadMessages(view, false, allPageTokens[allPageIndex]);
        }} />}
      {notice && <p role="status" className="fixed bottom-6 left-6 z-50 rounded-lg bg-[#1f1f1f] px-4 py-3 text-sm text-white shadow-lg">{notice}</p>}
    </main>
  );
}
