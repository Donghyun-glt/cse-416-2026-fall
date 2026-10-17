"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleLoginButton } from "./google-login-button";
import { comparePriority, type Priority } from "@/lib/mail-priority";

type Mail = { id: string; subject: string; from: string; date: string; snippet: string; html: string; unread: boolean; starred: boolean; draft: boolean; priority: Priority };
type MailResponse = { connected?: boolean; messages?: Mail[]; error?: string; nextPageToken?: string; resultSizeEstimate?: number; sortingPending?: boolean };
type UserProfile = { name: string; email: string };
type ProfileResponse = Partial<UserProfile> & { requiresProfileAuthorization?: boolean; requiresMailboxAuthorization?: boolean };
type View = "briefing" | "all" | "starred" | "drafts" | "trash";

const priorityDisplay: Record<Priority, { label: string; className: string }> = {
  urgent: { label: "Urgent", className: "bg-[#fce9e9] text-[#a82f35]" },
  fyi: { label: "FYI", className: "bg-[#fbf2dc] text-[#89651f]" },
  low: { label: "Low Priority", className: "bg-[#e8f1ee] text-[#416c60]" },
};

function PriorityBadge({ priority }: { priority: Priority }) {
  const display = priorityDisplay[priority];
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${display.className}`}>{display.label}</span>;
}

function Icon({ name, className = "h-5 w-5" }: { name: "mail" | "sun" | "inbox" | "calendar" | "trash" | "back" | "star" | "draft"; className?: string }) {
  const paths = {
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41" /></>,
    inbox: <><path d="M4 5h16l2 8v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6l2-8Z" /><path d="M2 13h5l2 3h6l2-3h5" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15M10 10v7M14 10v7" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
    draft: <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{paths[name]}</svg>;
}

function formatSender(from: string) {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return match ? match[1].trim() || match[2].trim() : from.trim();
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "M";
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

function EmailBody({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(180);
  const syncHeight = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (doc) setHeight(Math.max(180, doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0));
  }, []);
  const handleLoad = useCallback(() => {
    syncHeight();
    const body = frameRef.current?.contentDocument?.body;
    if (!body) return;
    observerRef.current?.disconnect();
    observerRef.current = new ResizeObserver(syncHeight);
    observerRef.current.observe(body);
  }, [syncHeight]);
  useEffect(() => () => observerRef.current?.disconnect(), []);
  return <iframe ref={frameRef} srcDoc={html} onLoad={handleLoad} title="메일 본문" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="w-full border-0 bg-white" style={{ height }} />;
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

function MailDetail({ message, deleting, error, onBack, onDelete, onPriorityChange }: { message: Mail; deleting: boolean; error: string | null; onBack: () => void; onDelete?: () => void; onPriorityChange: (priority: Priority) => void }) {
  const sender = formatSender(message.from);
  const date = new Date(message.date);
  const fullTime = Number.isNaN(date.getTime())
    ? message.date
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);

  return (
    <section className="min-h-screen bg-white">
      <div className="sticky top-0 z-10 flex h-[72px] items-center gap-2 border-b border-[#e7e5df] bg-white/95 px-5 backdrop-blur md:px-8">
        <button type="button" onClick={onBack} aria-label="Back to email list" className="flex h-11 w-11 items-center justify-center rounded-full text-[#5f5c55] transition hover:bg-[#f1f0ec]"><Icon name="back" className="h-6 w-6" /></button>
        {onDelete && <button type="button" onClick={onDelete} disabled={deleting} aria-label="Move to trash" className="flex h-11 w-11 items-center justify-center rounded-full text-[#5f5c55] transition hover:bg-[#f1f0ec] disabled:opacity-40"><Icon name="trash" className="h-5 w-5" /></button>}
        {deleting && <span className="ml-2 text-xs text-[#8f8b82]">Moving to trash…</span>}
      </div>
      <article className="mx-auto max-w-[1050px] px-5 py-8 md:px-10 md:py-12">
        {error && <p className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        <h1 className="text-2xl font-semibold leading-tight tracking-[-0.025em] text-[#282722] md:text-[34px]">{message.subject}</h1>
        {!message.draft && <label className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#68645d]">Priority
          <select value={message.priority} onChange={(event) => onPriorityChange(event.target.value as Priority)} className="rounded-lg border border-[#dedbd4] bg-white px-3 py-2 text-sm text-[#302f2a]">
            <option value="urgent">Urgent</option><option value="fyi">FYI</option><option value="low">Low Priority</option>
          </select>
        </label>}
        <div className="mt-8 flex items-start gap-4 border-b border-[#eceae5] pb-6">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#5944d8] text-sm font-extrabold text-white">{initials(sender)}</span>
          <div className="min-w-0 flex-1"><p className="font-bold text-[#302f2a]">{sender}</p><p className="mt-1 break-all text-sm text-[#87837a]">{message.from}</p></div>
          <time className="shrink-0 pt-1 text-xs text-[#8f8b82] md:text-sm">{fullTime}</time>
        </div>
        <div className="mx-auto mt-8 max-w-[900px] overflow-hidden rounded-xl bg-white"><EmailBody html={message.html} /></div>
      </article>
    </section>
  );
}

export function MailClient({ initialConnected, loginError }: { initialConnected: boolean; loginError?: string }) {
  const [messages, setMessages] = useState<Mail[]>([]);
  const [connected, setConnected] = useState(initialConnected);
  const [loading, setLoading] = useState(initialConnected);
  const [error, setError] = useState<string | null>(null);
  const [selectedMail, setSelectedMail] = useState<Mail | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkRestoring, setBulkRestoring] = useState(false);
  const [view, setView] = useState<View>("briefing");
  const [profile, setProfile] = useState<UserProfile>({ name: "", email: "" });
  const [allPageTokens, setAllPageTokens] = useState([""]);
  const [allPageIndex, setAllPageIndex] = useState(0);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [sortingPending, setSortingPending] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const requestRef = useRef<AbortController | null>(null);

  const loadMessages = useCallback(async (targetView: View, showLoading = false, pageToken = "") => {
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
      const response = await fetch(`/api/gmail/messages${query}`, { cache: "no-store", signal: controller.signal });
      const data = (await response.json()) as MailResponse;
      if (response.status === 401) {
        setConnected(false);
        setMessages([]);
        return;
      }
      if (!response.ok) throw new Error(data.error ?? "메일을 불러오지 못했습니다.");
      const nextMessages = data.messages ?? [];
      setConnected(true);
      setMessages(nextMessages);
      if (targetView === "all") setSortingPending(Boolean(data.sortingPending));
      else setSortingPending(false);
      if (showLoading) {
        setSelectedIds(new Set());
      } else {
        const availableIds = new Set(nextMessages.map((message) => message.id));
        setSelectedIds((current) => new Set([...current].filter((id) => availableIds.has(id))));
        setSelectedMail((current) => {
          if (!current) return null;
          const synced = nextMessages.find((message) => message.id === current.id);
          return synced ? { ...synced, html: current.html } : current;
        });
      }
      if (targetView !== "briefing") {
        setNextPageToken(data.nextPageToken ?? null);
      }
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [allPageIndex]);

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
    if (!connected) return;
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
  const changeView = (next: View) => {
    setView(next);
    setSortingPending(false);
    setSelectedMail(null);
    setSelectedIds(new Set());
    if (next !== "briefing") {
      setAllPageTokens([""]);
      setAllPageIndex(0);
      setNextPageToken(null);
    }
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
  const openMessage = (message: Mail) => {
    const readMessage = { ...message, unread: false };
    setSelectedMail(readMessage);
    setMessages((current) => current.map((item) => item.id === message.id ? readMessage : item));
    if (!message.unread) return;

    void fetch(`/api/gmail/messages/${encodeURIComponent(message.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read" }),
    }).then((response) => {
      if (!response.ok) throw new Error("메일을 읽음 처리하지 못했습니다.");
    }).catch((readError: unknown) => {
      setError(readError instanceof Error ? readError.message : "메일을 읽음 처리하지 못했습니다.");
    });
  };
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
    try {
      const response = await fetch(`/api/gmail/messages/${encodeURIComponent(message.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "star", starred }),
      });
      if (!response.ok) throw new Error("별표 상태를 저장하지 못했습니다.");
      if (view === "starred" && !starred) {
        setMessages((current) => current.filter((item) => item.id !== message.id));
      }
    } catch (starError) {
      setMessages((current) => current.map((item) => item.id === message.id ? { ...item, starred: message.starred } : item));
      setError(starError instanceof Error ? starError.message : "별표 상태를 저장하지 못했습니다.");
    }
  };
  const changePriority = async (priority: Priority) => {
    if (!selectedMail || selectedMail.priority === priority) return;
    const previous = selectedMail;
    setSelectedMail({ ...previous, priority });
    setMessages((current) => current.map((message) => message.id === previous.id ? { ...message, priority } : message).sort(comparePriority));
    setError(null);
    try {
      const response = await fetch(`/api/gmail/messages/${encodeURIComponent(previous.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "priority", priority }),
      });
      if (!response.ok) throw new Error("Priority could not be saved.");
      if (view === "all") void loadMessages("all", false);
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
      if (!response.ok) throw new Error("메일을 휴지통으로 이동하지 못했습니다.");
      setMessages((current) => current.filter((message) => message.id !== selectedMail.id));
      setSelectedMail(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "메일을 휴지통으로 이동하지 못했습니다.");
    } finally {
      setDeleting(false);
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
      if (failedIds.length > 0) throw new Error(`${failedIds.length}개의 메일을 휴지통으로 이동하지 못했습니다.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "선택한 메일을 휴지통으로 이동하지 못했습니다.");
    } finally {
      setBulkDeleting(false);
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
      if (failedIds.length > 0) throw new Error(`${failedIds.length}개의 메일을 All Emails로 이동하지 못했습니다.`);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "선택한 메일을 All Emails로 이동하지 못했습니다.");
    } finally {
      setBulkRestoring(false);
    }
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
            <span className="hidden items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold text-[#aaa69c] lg:flex"><Icon name="calendar" />Calendar</span>
            <button type="button" onClick={() => changeView("all")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "all" ? "bg-[#eeecfb] text-[#5742d5]" : "text-[#747168] hover:bg-[#f6f5f1]"}`}><Icon name="inbox" /><span className="hidden sm:inline">All Emails</span></button>
            <button type="button" onClick={() => changeView("starred")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "starred" ? "bg-[#eeecfb] text-[#5742d5]" : "text-[#747168] hover:bg-[#f6f5f1]"}`}><Icon name="star" /><span className="hidden sm:inline">Starred</span></button>
            <button type="button" onClick={() => changeView("drafts")} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition lg:w-full ${view === "drafts" ? "bg-[#eeecfb] text-[#5742d5]" : "text-[#747168] hover:bg-[#f6f5f1]"}`}><Icon name="draft" /><span className="hidden sm:inline">Drafts</span></button>
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
            message={selectedMail}
            deleting={deleting}
            error={error}
            onBack={() => setSelectedMail(null)}
            onDelete={view === "trash" ? undefined : () => void moveSelectedMailToTrash()}
            onPriorityChange={(priority) => void changePriority(priority)}
          />
        ) : (
          <>
        <header className="border-b border-[#e4e2dd] bg-white px-6 py-5 md:px-9"><div className="mx-auto max-w-[1200px]"><h1 className="text-2xl font-extrabold tracking-[-0.03em]">{view === "briefing" ? `${greeting()}${profile.name ? `, ${profile.name}` : ""}` : view === "starred" ? "Starred" : view === "drafts" ? "Drafts" : view === "trash" ? "Trash" : "All Emails"}</h1>{view === "briefing" && <p className="mt-1 text-sm text-[#9a968c]">{fullDate} · You have {messages.length} new email{messages.length === 1 ? "" : "s"} today</p>}</div></header>

        <div className="mx-auto max-w-[1200px] space-y-5 px-5 py-6 md:px-9">
          {view === "briefing" && <TodayCard />}
          <section>
            <div className="mb-3">{view === "briefing" && <h2 className="text-base font-extrabold">Today&apos;s emails</h2>}<p className="mt-0.5 text-xs text-[#9a968c]">{loading ? "Syncing your inbox…" : view === "briefing" ? `${messages.length} message${messages.length === 1 ? "" : "s"} · Updates automatically` : `Page ${allPageIndex + 1} · ${messages.length} message${messages.length === 1 ? "" : "s"}`}</p></div>
            {view === "all" && sortingPending && <p className="mb-3 rounded-xl bg-[#eeecfb] px-4 py-3 text-sm text-[#5742d5]">Showing recent mail while priorities are being sorted across your mailbox.</p>}
            {view === "briefing" && <div className="mb-4 flex flex-wrap gap-2" aria-label="Today's priority counts">
              {(["urgent", "fyi", "low"] as const).map((priority) => <span key={priority} className={`rounded-full px-3 py-1.5 text-xs font-bold ${priorityDisplay[priority].className}`}>{messages.filter((message) => message.priority === priority).length} {priorityDisplay[priority].label}</span>)}
            </div>}
            {error && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
            {view === "trash" && <p className="mb-3 rounded-xl bg-[#ececea] px-4 py-3 text-center text-sm text-[#6f6b64]">Messages in Trash are automatically deleted after 30 days.</p>}
            {view !== "briefing" && <div className="sticky top-0 z-20 mb-3 flex h-12 items-center justify-between rounded-xl border border-[#e1ded8] bg-white/95 px-4 shadow-[0_3px_12px_rgba(31,31,27,0.08)] backdrop-blur">
              <div className="flex items-center gap-2"><label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-[#77736b]"><input type="checkbox" checked={messages.length > 0 && messages.every((message) => selectedIds.has(message.id))} onChange={toggleAllSelections} aria-label="Select all messages on this page" className="h-4 w-4 cursor-pointer accent-[#5944d8]" /><span className="hidden sm:inline">Select</span></label>{selectedIds.size > 0 && (view === "trash" ? <button type="button" onClick={() => void moveSelectedMailsToAllEmails()} disabled={bulkRestoring} aria-label="Move selected messages to All Emails" className="ml-2 flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-bold text-[#655f58] transition hover:bg-[#f0eee9] disabled:opacity-40"><Icon name="inbox" className="h-4 w-4" /><span>{bulkRestoring ? "Moving…" : `Move to All Emails (${selectedIds.size})`}</span></button> : <button type="button" onClick={() => void moveSelectedMailsToTrash()} disabled={bulkDeleting} aria-label="Move selected messages to trash" className="ml-2 flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-bold text-[#655f58] transition hover:bg-[#f0eee9] disabled:opacity-40"><Icon name="trash" className="h-4 w-4" /><span>{bulkDeleting ? "Moving…" : `Delete (${selectedIds.size})`}</span></button>)}</div>
              <div className="flex items-center gap-1"><button type="button" onClick={goToPreviousPage} disabled={allPageIndex === 0} aria-label="Previous page" className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-[#656159] transition hover:bg-[#f0eee9] disabled:cursor-not-allowed disabled:opacity-30">‹</button><button type="button" onClick={goToNextPage} disabled={!nextPageToken} aria-label="Next page" className="flex h-9 w-9 items-center justify-center rounded-full text-xl text-[#656159] transition hover:bg-[#f0eee9] disabled:cursor-not-allowed disabled:opacity-30">›</button></div>
            </div>}
            <div className="overflow-hidden rounded-2xl border border-[#e1ded8] bg-white shadow-[0_2px_8px_rgba(31,31,27,0.04)]">
              {loading ? <div className="p-8 text-center text-sm text-[#98948a]">Loading messages…</div> : messages.length === 0 ? <div className="p-10 text-center"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#eeecfb] text-[#5944d8]"><Icon name="inbox" /></div><p className="mt-4 font-bold">You&apos;re all caught up</p><p className="mt-1 text-sm text-[#99958c]">{view === "briefing" ? "No inbox messages have arrived since midnight." : "There are no inbox messages to show."}</p></div> : messages.map((message, index) => {
                const sender = formatSender(message.from);
                const color = ["#b64b3b", "#4674a0", "#7751b2", "#4b806a", "#8f7a44"][index % 5];
                const rowTone = !message.unread ? "bg-[#f1f1ef] hover:bg-[#eaeae7]" : "bg-white hover:bg-[#faf9f6]";
                const startsGroup = index === 0 || messages[index - 1].priority !== message.priority;
                return <article key={message.id} className={index ? "border-t border-[#deddd9]" : ""}>
                  {startsGroup && view !== "drafts" && <h3 className={`px-5 py-2 text-xs font-extrabold uppercase tracking-wide ${priorityDisplay[message.priority].className}`}>{priorityDisplay[message.priority].label}</h3>}
                  <div className={`flex items-center gap-2 px-4 py-3 transition md:px-5 ${rowTone}`}>
                    {view !== "briefing" && <><input type="checkbox" checked={selectedIds.has(message.id)} onChange={() => toggleSelection(message.id)} aria-label={`Select ${message.subject}`} className="h-4 w-4 shrink-0 cursor-pointer accent-[#5944d8]" />{view === "trash" ? <span className="flex h-8 w-8 shrink-0 items-center justify-center text-[#77736b]"><Icon name="trash" className="h-4 w-4" /></span> : <button type="button" onClick={() => void toggleStar(message)} aria-label={message.starred ? "Remove favorite" : "Add favorite"} aria-pressed={message.starred} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-2xl leading-none transition hover:bg-black/5 ${message.starred ? "text-[#e7b928]" : "text-[#aaa79f]"}`}>{message.starred ? "★" : "☆"}</button>}</>}
                    <button type="button" onClick={() => openMessage(message)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white" style={{ backgroundColor: color }}>{initials(sender)}</span><span className="min-w-0 flex-1"><span className={`block truncate text-sm ${message.unread ? "font-extrabold" : "font-medium"}`}>{sender} <span className={message.unread ? "font-bold" : "font-medium"}>— {message.subject}</span></span>{message.snippet && <span className="mt-1 block truncate text-sm text-[#8e8b83]">{message.snippet}</span>}</span>{!message.draft && <PriorityBadge priority={message.priority} />}<time className="shrink-0 self-start pt-1 text-xs text-[#96938b]">{formatTime(message.date)}</time></button>
                  </div>
                </article>;
              })}
            </div>
          </section>
        </div>
          </>
        )}
      </div>
    </main>
  );
}
