"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleLoginButton } from "./google-login-button";
import { GoogleCalendar } from "./google-calendar";
import { comparePriority, type Priority } from "@/lib/mail-priority";
import { MailDetail, formatSender, initials, type Mail, type SavedDraft } from "./mail-detail";

type MailResponse = { connected?: boolean; messages?: Mail[]; error?: string; nextPageToken?: string; resultSizeEstimate?: number };
type UserProfile = { name: string; email: string };
type ProfileResponse = Partial<UserProfile> & { requiresProfileAuthorization?: boolean; requiresMailboxAuthorization?: boolean };
// One entry per screen the browser's Back button should return to.
type HistoryState = { mailflow: true; view: View; mailId: string | null };
type BulkAction = "archive" | "spam" | "notSpam" | "read" | "unread";
type View = "briefing" | "calendar" | "inbox" | "all" | "starred" | "sent" | "drafts" | "spam" | "trash";

const priorityDisplay: Record<Priority, { label: string; className: string }> = {
  urgent: { label: "Urgent", className: "bg-[#fce9e9] text-[#a82f35]" },
  fyi: { label: "FYI", className: "bg-[#fbf2dc] text-[#89651f]" },
  low: { label: "Low Priority", className: "bg-[#e8f1ee] text-[#416c60]" },
};

function PriorityBadge({ priority }: { priority: Priority }) {
  const display = priorityDisplay[priority];
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${display.className}`}>{display.label}</span>;
}

function Icon({ name, className = "h-5 w-5" }: { name: "mail" | "sun" | "inbox" | "allMail" | "spam" | "archive" | "calendar" | "trash" | "back" | "star" | "sent" | "draft" | "reply" | "forward" | "paperclip" | "download"; className?: string }) {
  const paths = {
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" /></>,
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
    <section className="overflow-hidden rounded-2xl border border-[#e3e1dc] bg-white shadow-[0_2px_8px_rgba(31,31,27,0.04)]">
      <div className="grid min-h-48 md:grid-cols-[255px_1fr]">
        <div className="flex flex-col items-center justify-center bg-[#eeecfb] px-8 py-7 text-[#5642d6]">
          <p className="text-sm font-extrabold uppercase tracking-[0.08em]">{weekday}</p>
          <p className="mt-1 text-7xl font-bold leading-none tracking-[-0.06em]">{now.getDate()}</p>
          <p className="mt-3 text-sm font-bold">{monthYear}</p>
        </div>
        <div className="flex flex-col justify-center px-8 py-8">
          <div className="flex items-center gap-3 border-b border-[#ebe9e3] pb-5"><Icon name="calendar" className="h-6 w-6 text-[#6049df]" /><h2 className="text-lg font-bold">Today</h2></div>
          <p className="pt-5 text-sm leading-6 text-[#89867d]">Your daily briefing includes every inbox message received since midnight. New mail will appear automatically while this page is open.</p>
        </div>
      </div>
    </section>
  );
}

export function MailClient({ initialConnected, loginError }: { initialConnected: boolean; loginError?: string }) {
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
  const [profile, setProfile] = useState<UserProfile>({ name: "", email: "" });
  const [allPageTokens, setAllPageTokens] = useState([""]);
  const [allPageIndex, setAllPageIndex] = useState(0);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [resultSizeEstimate, setResultSizeEstimate] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const requestRef = useRef<AbortController | null>(null);
  const bodyCacheRef = useRef(new Map<string, Pick<Mail, "html" | "attachments">>());
  const analyzedMessageId = selectedMail?.id;
  const applyAnalyzedPriority = useCallback((priority: Priority) => {
    if (!analyzedMessageId) return;
    setMessages((current) => current.map((message) => message.id === analyzedMessageId ? { ...message, priority } : message));
    setSelectedMail((current) => current?.id === analyzedMessageId ? { ...current, priority } : current);
  }, [analyzedMessageId]);

  const loadMessages = useCallback(async (targetView: View, showLoading = false, pageToken = "") => {
    if (targetView === "calendar") return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const query = targetView === "briefing"
        ? `?after=${startOfToday()}`
        : targetView === "all"
          ? `?mode=all&page=${allPageIndex}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
          : `?mode=${targetView}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const filterQuery = targetView === "briefing" ? "" : `${onlyAttachments ? "&attachment=1" : ""}${onlyUnread ? "&unread=1" : ""}`;
      const response = await fetch(`/api/gmail/messages${query}${filterQuery}`, { cache: "no-store", signal: controller.signal });
      const data = (await response.json()) as MailResponse;
      if (response.status === 401) {
        setConnected(false);
        setMessages([]);
        return;
      }
      if (!response.ok) throw new Error(data.error ?? "Could not load messages.");
      const nextMessages = data.messages ?? [];
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
      if (targetView !== "briefing") {
        setNextPageToken(data.nextPageToken ?? null);
        setResultSizeEstimate(data.resultSizeEstimate ?? 0);
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

      const reauthKey = "mailflow-profile-reauth-attempted";
      if (data.requiresProfileAuthorization || data.requiresMailboxAuthorization) {
        if (!window.sessionStorage.getItem(reauthKey)) {
          window.sessionStorage.setItem(reauthKey, "true");
          window.location.assign(new URL("/api/google/connect", window.location.origin));
        }
      } else {
        window.sessionStorage.removeItem(reauthKey);
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
    const interval = window.setInterval(syncCurrentMailbox, 15_000);
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
    } catch {
      // Fall through to the read-only view.
    }
    recordHistory(view, draftMessage.id, Boolean(selectedMail));
    setOpenDraft(null);
    showMessage(draftMessage);
  };

  // Kept in a ref so the popstate listener below always runs the latest version.
  const historyHandlerRef = useRef<(state: HistoryState) => void>(() => {});
  useEffect(() => {
    historyHandlerRef.current = (state) => {
      if (state.view !== viewRef.current) {
        applyView(state.view);
        return;
      }
      const target = state.mailId ? messagesRef.current.find((message) => message.id === state.mailId) : undefined;
      setOpenDraft(null);
      if (target && !target.draft) showMessage(target);
      else setSelectedMail(null);
    };
  });

  // Mark the starting screen, then follow the browser's Back/Forward buttons.
  useEffect(() => {
    if (!(window.history.state as HistoryState | null)?.mailflow) {
      window.history.replaceState({ mailflow: true, view: viewRef.current, mailId: null } satisfies HistoryState, "");
    }
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as HistoryState | null;
      if (!state?.mailflow) return;
      historyHandlerRef.current(state);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
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
        : action === "archive" && view === "all"
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

  const selectedPosition = {
    index: selectedMail ? messages.findIndex((message) => message.id === selectedMail.id) : -1,
    offset: view === "briefing" ? 0 : allPageIndex * 50,
  };

  if (!connected) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f7f4] p-6">
        <div className="w-full max-w-md rounded-3xl border border-[#e5e2dc] bg-white p-10 text-center shadow-[0_18px_50px_rgba(34,32,28,0.08)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5944d8] text-white"><Icon name="mail" className="h-7 w-7" /></div>
          <h1 className="mt-6 text-3xl font-extrabold tracking-tight">Welcome to MailFlow AI</h1>
          <p className="mt-3 text-sm leading-6 text-[#858178]">Connect Gmail to open your daily briefing and see new messages from today.</p>
          <GoogleLoginButton initialError={loginError} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f7f4] text-[#282722]">
      <aside className="border-b border-[#e5e2dc] bg-white lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex lg:w-[220px] lg:flex-col lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between px-5 py-4 lg:block lg:px-5 lg:py-6">
          <div className="flex items-center gap-2.5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#5944d8] text-white"><Icon name="mail" className="h-[18px] w-[18px]" /></span><span className="text-lg font-extrabold tracking-tight">MailFlow AI</span></div>
          <nav className="flex gap-1 lg:mt-9 lg:block lg:space-y-1.5" aria-label="Mailbox">
            <button type="button" onClick={() => changeView("briefing")} className={`flex items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "briefing" ? "bg-[#eeecfb] text-[#5742d5]" : "text-[#747168] hover:bg-[#f6f5f1]"}`}><Icon name="sun" /><span className="hidden sm:inline">Daily Briefing</span></button>
            <button type="button" onClick={() => changeView("calendar")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "calendar" ? "bg-[#eeecfb] text-[#5742d5]" : "text-[#747168] hover:bg-[#f6f5f1]"}`}><Icon name="calendar" /><span className="hidden sm:inline">Calendar</span></button>
            <button type="button" onClick={() => changeView("inbox")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "inbox" ? "bg-[#eeecfb] text-[#5742d5]" : "text-[#747168] hover:bg-[#f6f5f1]"}`}><Icon name="inbox" /><span className="hidden sm:inline">Inbox</span></button>
            <button type="button" onClick={() => changeView("starred")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "starred" ? "bg-[#eeecfb] text-[#5742d5]" : "text-[#747168] hover:bg-[#f6f5f1]"}`}><Icon name="star" /><span className="hidden sm:inline">Starred</span></button>
            <button type="button" onClick={() => changeView("sent")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "sent" ? "bg-[#eeecfb] text-[#5742d5]" : "text-[#747168] hover:bg-[#f6f5f1]"}`}><Icon name="sent" /><span className="hidden sm:inline">Sent</span></button>
            <button type="button" onClick={() => changeView("drafts")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "drafts" ? "bg-[#eeecfb] text-[#5742d5]" : "text-[#747168] hover:bg-[#f6f5f1]"}`}><Icon name="draft" /><span className="hidden sm:inline">Drafts</span></button>
            <button type="button" onClick={() => changeView("all")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "all" ? "bg-[#eeecfb] text-[#5742d5]" : "text-[#747168] hover:bg-[#f6f5f1]"}`}><Icon name="allMail" /><span className="hidden sm:inline">All Emails</span></button>
            <button type="button" onClick={() => changeView("spam")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "spam" ? "bg-[#eeecfb] text-[#5742d5]" : "text-[#747168] hover:bg-[#f6f5f1]"}`}><Icon name="spam" /><span className="hidden sm:inline">Spam</span></button>
            <button type="button" onClick={() => changeView("trash")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "trash" ? "bg-[#eeecfb] text-[#5742d5]" : "text-[#747168] hover:bg-[#f6f5f1]"}`}><Icon name="trash" /><span className="hidden sm:inline">Trash</span></button>
          </nav>
        </div>
        <div className="mt-auto hidden border-t border-[#ebe9e3] px-5 py-5 lg:flex lg:items-center lg:gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ded9fa] text-xs font-extrabold text-[#5944d8]">{profile.name ? initials(profile.name) : "G"}</span>
          <span className="min-w-0"><span className="block truncate text-sm font-bold">{profile.name || "Gmail user"}</span><span className="mt-1 block truncate text-xs text-[#9a968c]">{profile.email || "Connected account"}</span></span>
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
            total={view === "briefing" ? messages.length : Math.max(resultSizeEstimate, selectedPosition.offset + messages.length)}
            onBack={closeMail}
            initialDraft={openDraft?.forId === selectedMail.id ? openDraft.draft : null}
            onDraftChange={(hasDraft) => {
              const id = selectedMail.id;
              setMessages((current) => current.map((message) => message.id === id ? { ...message, hasDraft } : message));
            }}
            onNewer={selectedPosition.index > 0 ? () => openMessage(messages[selectedPosition.index - 1]) : undefined}
            onOlder={selectedPosition.index >= 0 && selectedPosition.index < messages.length - 1 ? () => openMessage(messages[selectedPosition.index + 1]) : undefined}
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
        <header className="border-b border-[#e4e2dd] bg-white px-6 py-5 md:px-9"><div className="mx-auto max-w-[1200px]"><h1 className="text-2xl font-extrabold tracking-[-0.03em]">{view === "briefing" ? `${greeting()}${profile.name ? `, ${profile.name}` : ""}` : view === "calendar" ? "Calendar" : view === "starred" ? "Starred" : view === "sent" ? "Sent" : view === "drafts" ? "Drafts" : view === "trash" ? "Trash" : view === "inbox" ? "Inbox" : view === "spam" ? "Spam" : "All Emails"}</h1>{view === "briefing" && <p className="mt-1 text-sm text-[#9a968c]">{fullDate} · You have {messages.length} new email{messages.length === 1 ? "" : "s"} today</p>}</div></header>

        <div className="mx-auto max-w-[1200px] space-y-5 px-5 py-6 md:px-9">
          {view === "calendar" ? <GoogleCalendar /> : <>
          {view === "briefing" && <TodayCard />}
          <section>
            <div className="mb-3">{view === "briefing" && <h2 className="text-base font-extrabold">Today&apos;s emails</h2>}<p className="mt-0.5 text-xs text-[#9a968c]">{loading ? "Syncing your inbox…" : view === "briefing" ? `${messages.length} message${messages.length === 1 ? "" : "s"} · Updates automatically` : `Page ${allPageIndex + 1} · ${messages.length} message${messages.length === 1 ? "" : "s"}`}</p></div>
            {view === "briefing" && <div className="mb-4 flex flex-wrap gap-2" aria-label="Today's priority counts">
              {(["urgent", "fyi", "low"] as const).map((priority) => <span key={priority} className={`rounded-full px-3 py-1.5 text-xs font-bold ${priorityDisplay[priority].className}`}>{messages.filter((message) => message.priority === priority).length} {priorityDisplay[priority].label}</span>)}
            </div>}
            {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
            {(view === "trash" || view === "spam") && <p className="mb-3 rounded-xl bg-[#ececea] px-4 py-3 text-center text-sm text-[#6f6b64]">Messages in {view === "trash" ? "Trash" : "Spam"} are automatically deleted after 30 days.</p>}
            {view !== "briefing" && <div className="mb-3 flex flex-wrap items-center gap-2" aria-label="Filters">
              {([["attachment", "Has attachment", onlyAttachments], ["unread", "Is unread", onlyUnread]] as const).map(([filter, label, active]) => (
                <button key={filter} type="button" onClick={() => toggleFilter(filter)} aria-pressed={active}
                  className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition ${active ? "border-[#5944d8] bg-[#eeecfb] text-[#5742d5]" : "border-[#d9d6cf] bg-white text-[#655f58] hover:bg-[#f6f5f1]"}`}>
                  {filter === "attachment" && <Icon name="paperclip" className="h-3.5 w-3.5" />}{label}{active && <span aria-hidden="true">×</span>}
                </button>
              ))}
            </div>}
            {view !== "briefing" && <div className="sticky top-0 z-20 mb-3 flex h-12 items-center justify-between rounded-xl border border-[#e1ded8] bg-white/95 px-4 shadow-[0_3px_12px_rgba(31,31,27,0.08)] backdrop-blur">
              <div className="flex items-center gap-2"><label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#77736b]"><input type="checkbox" checked={messages.length > 0 && messages.every((message) => selectedIds.has(message.id))} onChange={toggleAllSelections} aria-label="Select all messages on this page" className="h-4 w-4 cursor-pointer accent-[#5944d8]" /><span className="hidden sm:inline">Select</span></label>{selectedIds.size > 0 && (() => {
                const busy = Boolean(bulkAction) || bulkDeleting || bulkRestoring;
                const anyUnread = messages.some((message) => selectedIds.has(message.id) && message.unread);
                const bulkButton = (icon: Parameters<typeof Icon>[0]["name"], label: string, onClick: () => void, working = false) => (
                  <button key={label} type="button" onClick={onClick} disabled={busy} aria-label={`${label} (${selectedIds.size} selected)`} title={label}
                    className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-xs font-bold text-[#655f58] transition hover:bg-[#f0eee9] disabled:cursor-not-allowed disabled:opacity-40">
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
                return <span className="ml-2 flex items-center gap-0.5"><span className="mr-1 whitespace-nowrap text-xs font-semibold text-[#5944d8]">{selectedIds.size} selected</span>{actions}</span>;
              })()}</div>
              <div className="flex items-center gap-1"><button type="button" onClick={goToPreviousPage} disabled={allPageIndex === 0} aria-label="Previous page" className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-[#656159] transition hover:bg-[#f0eee9] disabled:cursor-not-allowed disabled:opacity-30">‹</button><button type="button" onClick={goToNextPage} disabled={!nextPageToken} aria-label="Next page" className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-[#656159] transition hover:bg-[#f0eee9] disabled:cursor-not-allowed disabled:opacity-30">›</button></div>
            </div>}
            <div className="overflow-hidden rounded-2xl border border-[#e1ded8] bg-white shadow-[0_2px_8px_rgba(31,31,27,0.04)]">
              {loading ? <div className="p-8 text-center text-sm text-[#98948a]">Loading messages…</div> : messages.length === 0 ? <div className="p-10 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#eeecfb] text-[#5944d8]"><Icon name="inbox" /></div><p className="mt-4 font-bold">You&apos;re all caught up</p><p className="mt-1 text-sm text-[#99958c]">{view === "briefing" ? "No inbox messages have arrived since midnight." : view === "sent" ? "You haven't sent any messages yet." : view === "spam" ? "Nothing in Spam." : onlyAttachments || onlyUnread ? "No messages match these filters." : view === "inbox" ? "Your inbox is empty. Archived mail is in All Emails." : "There are no messages to show."}</p></div> : messages.map((message, index) => {
                const sender = view === "sent" ? `To: ${formatSender(message.to.split(",")[0] || "") || "(no recipient)"}` : formatSender(message.from);
                const color = ["#b64b3b", "#4674a0", "#7751b2", "#4b806a", "#8f7a44"][index % 5];
                const rowTone = !message.unread ? "bg-[#f1f1ef] hover:bg-[#eaeae7]" : "bg-white hover:bg-[#faf9f6]";
                const startsGroup = index === 0 || messages[index - 1].priority !== message.priority;
                return <article key={message.id} className={`select-none ${index ? "border-t border-[#deddd9]" : ""}`} onMouseDown={(event) => { if (event.detail > 1) event.preventDefault(); }}>
                  {startsGroup && view === "briefing" && <h3 className={`px-5 py-2 text-xs font-extrabold uppercase tracking-wide ${priorityDisplay[message.priority].className}`}>{priorityDisplay[message.priority].label}</h3>}
                  <div className={`flex items-center gap-2 px-4 py-3 transition md:px-5 ${rowTone}`}>
                    {view !== "briefing" && <><input type="checkbox" checked={selectedIds.has(message.id)} onChange={() => toggleSelection(message.id)} aria-label={`Select ${message.subject}`} className="h-4 w-4 shrink-0 cursor-pointer accent-[#5944d8]" />{view === "trash" ? <span className="flex h-8 w-8 shrink-0 items-center justify-center text-[#77736b]"><Icon name="trash" className="h-4 w-4" /></span> : <button type="button" onClick={() => void toggleStar(message)} aria-label={message.starred ? "Remove favorite" : "Add favorite"} aria-pressed={message.starred} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-2xl leading-none transition hover:bg-black/5 ${message.starred ? "text-[#e7b928]" : "text-[#aaa79f]"}`}>{message.starred ? "★" : "☆"}</button>}</>}
                    <button type="button" onClick={() => openMessage(message)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white" style={{ backgroundColor: color }}>{initials(sender)}</span><span className="min-w-0 flex-1"><span className={`block truncate text-sm ${message.unread ? "font-extrabold" : "font-medium"}`}>{sender}{message.hasDraft && <>, <span className="font-medium text-[#c5221f]">Draft</span></>} <span className={message.unread ? "font-bold" : "font-medium"}>— {message.subject}</span></span>{message.snippet && <span className="mt-1 block truncate text-sm text-[#8e8b83]">{message.snippet}</span>}</span>{message.attachments.some((attachment) => !attachment.inline) && <span title="Has attachment" className="shrink-0 text-[#77736b]"><Icon name="paperclip" className="h-4 w-4" /></span>}{!message.draft && <PriorityBadge priority={message.priority} />}<time className="shrink-0 self-start pt-1 text-xs text-[#96938b]">{formatTime(message.date)}</time></button>
                  </div>
                </article>;
              })}
            </div>
          </section>
          </>}
        </div>
          </>
        )}
      </div>
    </main>
  );
}
