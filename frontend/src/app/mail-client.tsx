"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { GOOGLE_REAUTH_ATTEMPT_KEY } from "@/lib/google-login";
import { MAIL_THEME_COOKIE, type MailTheme } from "@/lib/mail-theme";
import { AccountMenu } from "./account-menu";
import { ActionRail, viewIcons, type MailView } from "./action-rail";
import { MobileTabBar } from "./mobile-tab-bar";
import { GoogleLoginButton } from "./google-login-button";
import { GoogleCalendar } from "./google-calendar";
import { DailyBriefing } from "./daily-briefing";
import { SummaryTodoList } from "./summary-todo-list";
import { ComposeWindow, type ComposeDraft } from "./compose-window";
import { comparePriority, type Priority } from "@/lib/mail-priority";
import { MailDetail, formatSender, initials, type Mail, type SavedDraft } from "./mail-detail";
import { SearchBar, matchesSummarySearch } from "./search-bar";
import { Avatar, SectionHead, chip, panel, panelPad, primaryButton, textButton } from "./ui";

type MailResponse = { connected?: boolean; pending?: string[]; messages?: Mail[]; error?: string; nextPageToken?: string; resultSizeEstimate?: number };
type UserProfile = { name: string; email: string; picture?: string };
type ProfileResponse = Partial<UserProfile> & { requiresProfileAuthorization?: boolean; requiresMailboxAuthorization?: boolean };
// One entry per screen the browser's Back button should return to.
type HistoryState = { mailflow: true; view: View; mailId: string | null; search?: string };
type BulkAction = "archive" | "spam" | "notSpam" | "read" | "unread";
type View = MailView;

const viewTitles: Record<View, string> = {
  briefing: "Daily Briefing", summary: "Summary", calendar: "Calendar", inbox: "Inbox", all: "All Emails",
  starred: "Starred", sent: "Sent", drafts: "Drafts", spam: "Spam", trash: "Trash",
};
// Daily Briefing and Calendar are not lists to search through.
const searchableViews = new Set<View>(["summary", "inbox", "starred", "sent", "drafts", "all", "spam", "trash"]);

const priorityDisplay: Record<Priority, { label: string; className: string }> = {
  urgent: { label: "Urgent", className: "bg-mail-danger-tint text-mail-danger" },
  fyi: { label: "FYI", className: "bg-mail-warning-tint text-mail-warning" },
  low: { label: "Low Priority", className: "bg-mail-success-tint text-mail-success" },
};

function PriorityBadge({ priority }: { priority: Priority }) {
  const display = priorityDisplay[priority];
  return <span className={`inline-flex shrink-0 rounded-xl px-2 py-1 text-[10px] font-bold ${display.className}`}>{display.label}</span>;
}

function Icon({ name, className = "h-5 w-5" }: { name: "mail" | "inbox" | "spam" | "archive" | "trash" | "paperclip"; className?: string }) {
  const paths = {
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    inbox: <><path d="M4 5h16l2 8v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l2-8Z" /><path d="M2 13h5l2 3h6l2-3h5" /></>,
    spam: <><path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3L8.3 3Z" /><path d="M12 8v5M12 16.5v.01" /></>,
    archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M12 12v5M9.5 14.5 12 17l2.5-2.5" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>,
    paperclip: <path d="m21.4 11.6-8.9 8.9a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.7 9.6a2 2 0 0 1-2.8-2.8l8.9-8.9" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{paths[name]}</svg>;
}

/** The MailFlow mark: an envelope whose flap is a soft "flow" curve, with a spark for AI. */
function BrandMark({ className = "h-7 w-7 rounded-[9px]" }: { className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-[#8b7bff] via-[#6a55e6] to-[#4a36c4] text-white shadow-[0_4px_12px_rgba(89,68,216,0.32),inset_0_1px_0_rgba(255,255,255,0.35)] ${className}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-[64%] w-[64%]">
        <rect x="2.75" y="7" width="15.5" height="11.5" rx="3" />
        <path d="M3.6 9.3c2.3 2 4.3 3 6.15 3s3.85-1 6.15-3" />
        <path d="M19.5 1.8l.85 2.35 2.35.85-2.35.85-.85 2.35-.85-2.35-2.35-.85 2.35-.85z" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

/** Mark + "MailFlow AI" wordmark; "AI" is a lighter suffix of the same name, not a badge. */
function Wordmark({ large = false }: { large?: boolean }) {
  return (
    <span className={`flex items-center ${large ? "justify-center gap-3" : "gap-2.5"}`}>
      <BrandMark className={large ? "h-12 w-12 rounded-[15px]" : undefined} />
      <span className={`font-bold tracking-[-0.03em] text-foreground ${large ? "text-[26px]" : "text-[17px]"}`}>
        Mail<span className="text-mail-accent">Flow</span><span className="ml-[0.28em] font-medium text-mail-muted">AI</span>
      </span>
    </span>
  );
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

/** The four numbers at the top of the Daily Briefing. */
function MetricGrid({ messages, loading }: { messages: Mail[]; loading: boolean }) {
  const count = (priority: Priority) => messages.filter((message) => message.priority === priority).length;
  const metrics = [
    { label: "New emails", value: messages.length, note: "Since midnight" },
    { label: "Urgent", value: count("urgent"), note: "Needs attention" },
    { label: "FYI", value: count("fyi"), note: "Stay informed" },
    { label: "Low priority", value: count("low"), note: "Read later" },
  ];
  return (
    <div className="grid grid-cols-2 gap-[15px] lg:grid-cols-4">
      {metrics.map((metric) => (
        <div key={metric.label} className={`${panel} p-[15px] sm:p-[22px]`}>
          <span className="block text-[11px] font-bold uppercase tracking-[0.06em] text-mail-muted">{metric.label}</span>
          <b className="mb-1 mt-[9px] block text-[35px] leading-tight tracking-[-0.05em]">{loading ? "–" : metric.value}</b>
          <small className="block text-[11px] font-medium text-mail-muted">{metric.note}</small>
        </div>
      ))}
    </div>
  );
}

/** "Your day": what the briefing covers, with the way to the calendar. */
function TodayPanel({ onOpenCalendar }: { onOpenCalendar: () => void }) {
  const today = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  return (
    <section className={`${panel} ${panelPad}`}>
      <SectionHead eyebrow="Your day" title={today} className="mb-0"
        actions={<button type="button" onClick={onOpenCalendar} className={textButton}>View full calendar →</button>} />
      <div className="mt-[18px] flex items-center gap-5 border-t border-mail-line pt-[13px] text-[13px]">
        <strong className="w-[65px] shrink-0 text-mail-accent">Today</strong>
        <span className="min-w-0"><b className="block">Every inbox message received since midnight</b><small className="mt-[3px] block text-mail-muted">New mail appears here automatically while this page is open.</small></span>
      </div>
    </section>
  );
}

function ErrorBanner({ children }: { children: ReactNode }) {
  return <p role="alert" className="rounded-[10px] border border-mail-danger-line bg-mail-danger-tint px-4 py-3 text-[13px] text-mail-danger">{children}</p>;
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
  // searchInput is what is typed; searchQuery is the search applied to the list.
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<View>("briefing");
  // Summary filters its loaded to-dos on screen; only mailbox views ask Gmail to search.
  const mailboxSearch = view === "summary" ? "" : searchQuery;
  const [compose, setCompose] = useState<{ key: number; initial: ComposeDraft | null } | null>(null);
  const [composeCloseRequest, setComposeCloseRequest] = useState(0);
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
      const filterQuery = isPaged ? `${onlyAttachments ? "&attachment=1" : ""}${onlyUnread ? "&unread=1" : ""}${mailboxSearch ? `&q=${encodeURIComponent(mailboxSearch)}` : ""}` : "";
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
  }, [allPageIndex, mailboxSearch, onlyAttachments, onlyUnread]);

  const loadProfile = useCallback(async () => {
    try {
      const response = await fetch("/api/google/profile", { cache: "no-store" });
      if (response.status === 401) {
        setConnected(false);
        return;
      }
      if (!response.ok) return;
      const data = (await response.json()) as ProfileResponse;
      setProfile({ name: data.name ?? "", email: data.email ?? "", picture: data.picture ?? "" });

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
  const searchRef = useRef(searchQuery);
  useEffect(() => { viewRef.current = view; messagesRef.current = messages; searchRef.current = searchQuery; }, [messages, searchQuery, view]);
  const recordHistory = (nextView: View, mailId: string | null, replace = false, search = searchQuery) => {
    const state: HistoryState = { mailflow: true, view: nextView, mailId, search };
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
    // Like Gmail, a search belongs to the mailbox it was made in.
    setSearchInput("");
    setSearchQuery("");
    if (next !== "briefing") {
      setAllPageTokens([""]);
      setAllPageIndex(0);
      setNextPageToken(null);
    }
  };
  const changeView = (next: View) => {
    // Clicking the mailbox that is already showing just refreshes it (and ends a search).
    if (next !== view || selectedMail || searchQuery) recordHistory(next, null, false, "");
    applyView(next);
  };
  // A new search changes which messages Gmail returns, so paging starts over.
  const applySearch = (search: string) => {
    setSearchInput(search);
    setSearchQuery(search);
    setSelectedIds(new Set());
    setAllPageTokens([""]);
    setAllPageIndex(0);
    setNextPageToken(null);
  };
  const submitSearch = () => {
    const next = searchInput.trim();
    if (next === searchQuery) return;
    recordHistory(view, null, false, next);
    applySearch(next);
  };
  const clearSearch = () => {
    setSearchInput("");
    if (!searchQuery) return;
    recordHistory(view, null, false, "");
    applySearch("");
  };
  const changeSearchInput = (text: string) => {
    setSearchInput(text);
    // Summary narrows its to-dos while the user types; it has no Gmail request to wait for.
    if (view === "summary") setSearchQuery(text.trim());
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
        if (state.search) applySearch(state.search);
        if (state.mailId) pendingHistoryRef.current = state;
        return;
      }
      const search = state.search ?? "";
      if (!loadedMessages && search !== searchRef.current) {
        applySearch(search);
        if (state.view !== "summary") {
          // Gmail runs the search again; a message in this entry opens once the results arrive.
          pendingHistoryRef.current = state.mailId ? state : null;
          setSelectedMail(null);
          return;
        }
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

  const displayedMessages = view === "summary" && searchQuery
    ? messages.filter((message) => matchesSummarySearch(message, searchQuery))
    : messages;
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
      <main data-mail-theme={theme} className="mail-canvas flex min-h-screen items-center justify-center p-6 text-foreground">
        <div className={`${panel} w-full max-w-md p-10 text-center`}>
          <Wordmark large />
          <h1 className="mt-6 text-[30px] leading-tight tracking-[-0.04em]">Welcome to MailFlow AI</h1>
          <p className="mt-3 text-sm leading-6 text-mail-muted">Connect Gmail to open your daily briefing and see new messages from today.</p>
          <GoogleLoginButton initialError={loginError} />
        </div>
      </main>
    );
  }

  const openCompose = () => setCompose((current) => current ?? { key: Date.now(), initial: null });
  // The dock's Compose button opens the window, and closes it again (saving the draft, like its X).
  const toggleCompose = () => { if (compose) setComposeCloseRequest((count) => count + 1); else openCompose(); };
  const pageTitle = selectedMail ? "Email details" : view === "briefing" ? `${greeting()}${profile.name ? `, ${profile.name}` : ""}` : viewTitles[view];
  // Only the Daily Briefing has a line under its title: today's date and mail count (information,
  // not a description). Other pages show the title alone, in a header that is shorter by that line.
  const pageDescription = !selectedMail && view === "briefing" ? `${fullDate} · You have ${messages.length} new email${messages.length === 1 ? "" : "s"} today` : "";
  const searchBar = searchableViews.has(view) && <SearchBar value={searchInput} active={Boolean(searchQuery)}
    placeholder={view === "summary" ? "Search to-dos" : `Search ${viewTitles[view]} by sender, subject or message`}
    onChange={changeSearchInput} onSubmit={submitSearch} onClear={clearSearch} />;
  const listDetail = loading ? "Syncing your inbox…" : `${mailboxSearch ? `Results for “${mailboxSearch}” · ` : ""}Page ${allPageIndex + 1} · ${messages.length} message${messages.length === 1 ? "" : "s"}`;
  const emptyMessage = mailboxSearch ? `No messages in ${viewTitles[view]} match “${mailboxSearch}”${onlyAttachments || onlyUnread ? " with these filters" : ""}.`
    : view === "briefing" ? "No inbox messages have arrived since midnight." : view === "sent" ? "You haven't sent any messages yet." : view === "spam" ? "Nothing in Spam."
      : onlyAttachments || onlyUnread ? "No messages match these filters." : view === "inbox" ? "Your inbox is empty. Archived mail is in All Emails." : "There are no messages to show.";
  const emptyState = (
    <div className="px-6 py-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-mail-accent-tint text-mail-accent"><Icon name="inbox" /></div>
      <p className="mt-4 font-bold">{mailboxSearch ? "No results" : "You're all caught up"}</p>
      <p className="mt-1 text-sm text-mail-muted">{emptyMessage}</p>
    </div>
  );

  return (
    <main data-mail-theme={theme} className="mail-canvas min-h-screen text-foreground">
      <ActionRail view={view} onSelect={changeView} onCompose={toggleCompose} composeOpen={Boolean(compose)} />
      {/* Phones: tab bar along the bottom and a compose button above it (both out of the way while a message or the composer is open). */}
      <MobileTabBar view={view} onSelect={changeView} hidden={Boolean(selectedMail)} />
      {!selectedMail && !compose && (
        <button type="button" data-mobile-compose onClick={toggleCompose} aria-label="Compose"
          className="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] right-4 z-40 grid size-14 place-items-center rounded-[18px] bg-gradient-to-br from-[#8b7bff] via-[#6a55e6] to-[#4a36c4] text-white shadow-[0_10px_26px_rgba(89,68,216,0.45),inset_0_1px_0_rgba(255,255,255,0.35)] transition-transform active:scale-95 sm:hidden">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-6" aria-hidden="true">{viewIcons.compose}</svg>
        </button>
      )}

      {/* Phones get a 56 px bar (mark, title, account) that stays at the top; an open message has its own bar instead. */}
      <header className={`relative z-30 border-b border-mail-line/80 bg-mail-header backdrop-blur-sm max-sm:sticky max-sm:top-0 max-sm:pt-[env(safe-area-inset-top)] ${selectedMail ? "max-sm:hidden" : ""}`}>
        <div className={`flex items-center justify-between gap-4 px-[clamp(18px,5vw,80px)] py-[25px] max-sm:min-h-14 max-sm:gap-3 max-sm:py-2 sm:py-[31px] ${pageDescription ? "min-h-[116px] sm:min-h-[132px]" : "min-h-[91px] sm:min-h-[107px]"}`}>
          <div className="flex min-w-0 items-center gap-2.5 sm:block">
            <BrandMark className="h-8 w-8 rounded-[10px] sm:hidden" />
            <div className="min-w-0">
              <div className="mb-3 max-sm:hidden"><Wordmark /></div>
              <h1 className="truncate text-[23px] leading-tight tracking-[-0.04em] max-sm:text-[19px] sm:text-[30px]">
                <span className="sm:hidden">{viewTitles[view]}</span><span className="max-sm:hidden">{pageTitle}</span>
              </h1>
              {pageDescription && <p className="mt-[5px] text-sm text-mail-muted max-sm:hidden">{pageDescription}</p>}
            </div>
          </div>
          <AccountMenu profile={profile} theme={theme} onThemeChange={changeTheme} />
        </div>
      </header>

      {/* Bottom padding keeps the last row clear of the dock (phones: the tab bar and the compose button). */}
      <div className="px-[clamp(14px,5vw,80px)] pb-24 pt-[26px] max-sm:pb-[calc(150px+env(safe-area-inset-bottom))] max-sm:pt-4 sm:pb-[120px]">
        {selectedMail ? (
          <MailDetail
            key={selectedMail.id}
            message={selectedMail}
            myEmail={profile.email}
            deleting={deleting}
            error={error}
            position={selectedPosition.index >= 0 ? selectedPosition.offset + selectedPosition.index + 1 : 0}
            // Gmail's size estimate for a search can be far off, so a search counts only what is loaded.
            total={singleList || mailboxSearch ? selectedPosition.offset + displayedMessages.length : Math.max(resultSizeEstimate, selectedPosition.offset + displayedMessages.length)}
            onBack={closeMail}
            backLabel={view === "summary" ? "Back to Summary" : view === "briefing" ? "Back to briefing" : searchQuery ? "Back to results" : `Back to ${viewTitles[view]}`}
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
        ) : view === "calendar" ? <GoogleCalendar /> : view === "summary" ? (
          <SummaryTodoList messages={displayedMessages} searchQuery={searchQuery} search={searchBar} pending={summaryPending} loading={loading} error={error} onOpen={openMessage} onRefresh={() => void loadMessages("summary")} />
        ) : view === "briefing" ? (
          <div className="space-y-[17px]">
            {/* On phones the greeting moves out of the slim header to the top of the page. */}
            <div className="sm:hidden">
              <p className="text-[22px] leading-tight tracking-[-0.03em]">{greeting()}{profile.name ? `, ${profile.name.split(/\s+/)[0]}` : ""}</p>
              <p className="mt-1 text-[13px] text-mail-muted">{pageDescription}</p>
            </div>
            {/* Phones skip these: the priority tabs carry the counts, the greeting the date, the tab bar the calendar. */}
            <div className="space-y-[17px] max-sm:hidden">
              <MetricGrid messages={messages} loading={loading} />
              <TodayPanel onOpenCalendar={() => changeView("calendar")} />
            </div>
            <SectionHead eyebrow="Prioritized inbox" title="Today's emails" className="pt-3 max-sm:hidden"
              detail={loading ? "Syncing your inbox…" : `${messages.length} message${messages.length === 1 ? "" : "s"} · Updates automatically`} />
            {error && <ErrorBanner>{error}</ErrorBanner>}
            {loading ? <div className={`${panel} p-8 text-center text-sm text-mail-muted`}>Loading messages…</div>
              : messages.length === 0 ? <div className={panel}>{emptyState}</div>
              : <DailyBriefing messages={messages} onOpen={openMessage} onPriority={applyBriefingPriority} />}
          </div>
        ) : (
          <section>
            {/* Phones show the mailbox name in the top bar and compose from the floating button. */}
            <SectionHead className="mb-[18px] max-sm:hidden" eyebrow={viewTitles[view]} title={mailboxSearch ? "Search results" : "Messages"}
              detail={listDetail}
              actions={<button type="button" onClick={openCompose} className={primaryButton}>+ Compose</button>} />
            {searchBar}
            <div className="my-4 flex flex-wrap gap-[7px]" aria-label="Filters">
              {([["attachment", "Has attachment", onlyAttachments], ["unread", "Is unread", onlyUnread]] as const).map(([filter, label, active]) => (
                <button key={filter} type="button" onClick={() => toggleFilter(filter)} aria-pressed={active} className={chip(active)}>
                  {filter === "attachment" && <Icon name="paperclip" className="h-3.5 w-3.5" />}{label}{active && <span aria-hidden="true">×</span>}
                </button>
              ))}
            </div>
            {(loading || mailboxSearch) && <p className="-mt-1 mb-3 text-xs text-mail-muted sm:hidden">{listDetail}</p>}
            {(view === "trash" || view === "spam") && <p className="mb-4 rounded-[10px] bg-mail-muted-surface px-4 py-3 text-center text-[13px] text-mail-muted">Messages in {view === "trash" ? "Trash" : "Spam"} are automatically deleted after 30 days.</p>}
            {error && <div className="mb-4"><ErrorBanner>{error}</ErrorBanner></div>}
            {(() => {
              // Actions for the checked rows: in the toolbar on wider screens, in a bar over the page on phones.
              const busy = Boolean(bulkAction) || bulkDeleting || bulkRestoring;
              const anyUnread = messages.some((message) => selectedIds.has(message.id) && message.unread);
              const allChecked = messages.length > 0 && messages.every((message) => selectedIds.has(message.id));
              const actionsFor = (phone: boolean) => {
                const bulkButton = (icon: Parameters<typeof Icon>[0]["name"], label: string, onClick: () => void, working = false) => (
                  <button key={label} type="button" onClick={onClick} disabled={busy} aria-label={`${label} (${selectedIds.size} selected)`} title={label}
                    className={phone
                      ? "grid size-10 place-items-center rounded-full text-mail-secondary transition hover:bg-mail-muted-surface disabled:cursor-not-allowed disabled:opacity-40"
                      : "flex h-9 items-center gap-2 rounded-[10px] px-2.5 text-xs font-bold text-mail-secondary transition hover:bg-mail-muted-surface disabled:cursor-not-allowed disabled:opacity-40"}>
                    <Icon name={icon} className={phone ? "h-5 w-5" : "h-4 w-4"} />{!phone && <span className="hidden md:inline">{working ? "Working…" : label}</span>}
                  </button>
                );
                const archive = bulkButton("archive", "Archive", () => void applyBulkAction("archive"), bulkAction === "archive");
                const spam = bulkButton("spam", "Report spam", () => void applyBulkAction("spam"), bulkAction === "spam");
                const trash = bulkButton("trash", view === "drafts" ? "Discard drafts" : "Delete", () => void moveSelectedMailsToTrash(), bulkDeleting);
                const readState = anyUnread
                  ? bulkButton("mail", "Mark as read", () => void applyBulkAction("read"), bulkAction === "read")
                  : bulkButton("mail", "Mark as unread", () => void applyBulkAction("unread"), bulkAction === "unread");
                // Each mailbox offers only the actions that make sense there, like Gmail.
                return view === "trash"
                  ? [bulkButton("inbox", "Restore", () => void moveSelectedMailsToAllEmails(), bulkRestoring)]
                  : view === "spam"
                    ? [bulkButton("inbox", "Not spam", () => void applyBulkAction("notSpam"), bulkAction === "notSpam"), trash, readState]
                    : view === "drafts"
                      ? [trash]
                      : view === "sent"
                        ? [trash, readState]
                        : [archive, spam, trash, readState];
              };
              return <>
                <div className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-mail-line bg-background/85 px-2 backdrop-blur-md max-sm:hidden">
                  <div className="flex items-center gap-2"><label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-mail-muted"><input type="checkbox" checked={allChecked} onChange={toggleAllSelections} aria-label="Select all messages on this page" className="h-4 w-4 cursor-pointer accent-[#5944d8]" /><span className="hidden sm:inline">Select</span></label>
                    {selectedIds.size > 0 && <span className="ml-2 flex items-center gap-0.5"><span className="mr-1 whitespace-nowrap text-xs font-semibold text-mail-accent">{selectedIds.size} selected</span>{actionsFor(false)}</span>}</div>
                  <div className="flex items-center gap-1"><button type="button" onClick={goToPreviousPage} disabled={allPageIndex === 0} aria-label="Previous page" className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-mail-secondary transition hover:bg-mail-muted-surface disabled:cursor-not-allowed disabled:opacity-30">‹</button><button type="button" onClick={goToNextPage} disabled={!nextPageToken} aria-label="Next page" className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-mail-secondary transition hover:bg-mail-muted-surface disabled:cursor-not-allowed disabled:opacity-30">›</button></div>
                </div>
                {selectedIds.size > 0 && (
                  <div role="toolbar" aria-label="Selected messages" className="fixed inset-x-0 top-0 z-50 flex h-[calc(56px+env(safe-area-inset-top))] items-center gap-1 border-b border-mail-line bg-mail-surface px-2 pt-[env(safe-area-inset-top)] shadow-[0_6px_20px_rgba(39,37,32,0.12)] sm:hidden">
                    <button type="button" onClick={() => setSelectedIds(new Set())} aria-label="Clear selection" className="grid size-10 place-items-center rounded-full text-mail-secondary hover:bg-mail-muted-surface">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="size-5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                    </button>
                    <span className="min-w-6 text-[15px] font-extrabold">{selectedIds.size}</span>
                    <button type="button" onClick={toggleAllSelections} className="ml-1 rounded-full px-2.5 py-1.5 text-xs font-bold text-mail-accent hover:bg-mail-accent-tint">{allChecked ? "Select none" : "Select all"}</button>
                    <span className="ml-auto flex items-center">{actionsFor(true)}</span>
                  </div>
                )}
              </>;
            })()}
            {loading ? <div className="p-8 text-center text-sm text-mail-muted">Loading messages…</div> : messages.length === 0 ? emptyState : <div>{messages.map((message) => {
              // In Sent the row names the recipient instead of the sender.
              const contact = view === "sent" ? message.to.split(",")[0] || "" : message.from;
              const person = formatSender(contact);
              const sender = view === "sent" ? `To: ${person || "(no recipient)"}` : person;
              const seed = contact.match(/<([^>]+)>/)?.[1] ?? contact;
              const selected = selectedIds.has(message.id);
              const hasAttachment = message.attachments.some((attachment) => !attachment.inline);
              return <article key={message.id} className={`select-none border-b border-mail-line last:border-b-0 ${selected ? "max-sm:bg-mail-accent-tint/50" : ""}`} onMouseDown={(event) => { if (event.detail > 1) event.preventDefault(); }}>
                <div className="flex items-center gap-1.5 rounded-xl px-2 py-[13px] transition hover:bg-mail-surface max-sm:gap-3 max-sm:px-1 max-sm:py-3 sm:gap-2">
                  <input type="checkbox" checked={selected} onChange={() => toggleSelection(message.id)} aria-label={`Select ${message.subject}`} className="h-4 w-4 shrink-0 cursor-pointer accent-[#5944d8] max-sm:hidden" />
                  {/* Phones: tapping the avatar selects the row (a checkbox is too small for a finger). */}
                  <button type="button" onClick={() => toggleSelection(message.id)} aria-pressed={selected} aria-label={`Select ${message.subject}`} className="shrink-0 self-start sm:hidden">
                    {selected
                      ? <span className="grid h-[38px] w-[38px] place-items-center rounded-full bg-[#5944d8] text-white"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="size-5" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7" /></svg></span>
                      : <Avatar label={initials(person || "?")} seed={seed} />}
                  </button>
                  {view === "trash"
                    ? <span className="flex h-8 w-8 shrink-0 items-center justify-center text-mail-muted max-sm:order-last"><Icon name="trash" className="h-4 w-4" /></span>
                    : <button type="button" onClick={() => void toggleStar(message)} aria-label={message.starred ? "Remove favorite" : "Add favorite"} aria-pressed={message.starred} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xl leading-none transition hover:bg-mail-hover max-sm:order-last max-sm:-mr-1 max-sm:h-10 max-sm:w-10 ${message.starred ? "text-[#e7b928]" : "text-mail-muted"}`}>{message.starred ? "★" : "☆"}</button>}
                  <button type="button" onClick={() => openMessage(message)} className="flex min-w-0 flex-1 items-center gap-3 text-left sm:gap-[15px]">
                    <Avatar label={initials(person || "?")} seed={seed} className="h-[38px] w-[38px] text-[11px] max-sm:hidden" />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-[5px]">
                        <b className={`truncate text-[13px] max-sm:text-sm ${message.unread ? "font-extrabold" : "font-semibold text-mail-secondary"}`}>{sender}</b>
                        {message.unread && <><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-mail-accent" aria-hidden="true" /><span className="sr-only">Unread</span></>}
                        {message.hasDraft && <span className="shrink-0 text-xs font-semibold text-mail-danger">Draft</span>}
                        <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-[11px] text-mail-muted sm:hidden">
                          {hasAttachment && <Icon name="paperclip" className="h-3.5 w-3.5" />}{formatTime(message.date)}
                        </span>
                      </span>
                      <strong className={`mt-1 block truncate text-[13px] ${message.unread ? "font-bold" : "font-medium"}`}>{message.subject || "(no subject)"}</strong>
                      {message.snippet && <small className="mt-1 block truncate text-xs text-mail-muted">{message.snippet}</small>}
                    </span>
                    <span className="grid shrink-0 justify-items-end gap-3 text-right max-sm:hidden">
                      <span className="flex items-center gap-1.5">
                        {hasAttachment && <span title="Has attachment" className="text-mail-muted"><Icon name="paperclip" className="h-3.5 w-3.5" /></span>}
                        <time className="text-[11px] text-mail-muted">{formatTime(message.date)}</time>
                      </span>
                      {!message.draft && <span className="hidden sm:block"><PriorityBadge priority={message.priority} /></span>}
                    </span>
                  </button>
                </div>
              </article>;
            })}</div>}
            {/* Phones page through the list here instead of in the toolbar. */}
            {!loading && (allPageIndex > 0 || nextPageToken) && (
              <div className="mt-4 flex items-center justify-between sm:hidden">
                <button type="button" onClick={goToPreviousPage} disabled={allPageIndex === 0} className={`${chip(false)} h-10 px-4 disabled:opacity-40`}>‹ Newer</button>
                <span className="text-xs text-mail-muted">Page {allPageIndex + 1}</span>
                <button type="button" onClick={goToNextPage} disabled={!nextPageToken} className={`${chip(false)} h-10 px-4 disabled:opacity-40`}>Older ›</button>
              </div>
            )}
          </section>
        )}
      </div>
      {compose && <ComposeWindow key={compose.key} initial={compose.initial} closeRequest={composeCloseRequest} senderName={profile.name}
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
      {notice && <p role="status" className="fixed bottom-20 left-4 z-50 max-sm:bottom-[calc(84px+env(safe-area-inset-bottom))] rounded-[10px] border border-mail-line bg-mail-success-tint px-4 py-3 text-[13px] font-semibold text-mail-success shadow-[0_8px_24px_rgba(39,37,32,0.12)] sm:bottom-[100px] sm:left-6">{notice}</p>}
    </main>
  );
}
