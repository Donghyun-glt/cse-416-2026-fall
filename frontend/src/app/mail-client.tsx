"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Mail = {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  html: string;
};

type MailResponse = {
  connected?: boolean;
  messages?: Mail[];
  error?: string;
};

// `from` arrives as `"Investing.com" <newsletter@investingmail.com>`; the list
// shows the display name like Gmail does, falling back to the address.
function formatSender(from: string) {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (!match) return from.trim();

  const [, name, address] = match;
  return name.trim() || address.trim();
}

function formatShortDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";

  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric",
  }).format(parsed);
}

// The email keeps its own markup and CSS, so it renders in an iframe: that
// isolates the template's global styles from the app's layout, and the sandbox
// (no `allow-scripts`) keeps anything in the message from executing. Links
// still open in a new tab via the document's <base target="_blank">.
function EmailBody({ html }: { html: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(160);

  const syncHeight = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;

    const next = Math.max(
      doc.documentElement?.scrollHeight ?? 0,
      doc.body?.scrollHeight ?? 0,
    );
    if (next > 0) setHeight(next);
  }, []);

  // Images and fonts settle after load, so keep following the body's size
  // instead of measuring once.
  const handleLoad = useCallback(() => {
    syncHeight();

    const body = frameRef.current?.contentDocument?.body;
    if (!body) return;

    observerRef.current?.disconnect();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(body);
    observerRef.current = observer;
  }, [syncHeight]);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  return (
    <iframe
      ref={frameRef}
      srcDoc={html}
      onLoad={handleLoad}
      title="메일 본문"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="w-full border-0 bg-transparent"
      style={{ height }}
    />
  );
}

export function MailClient({ initialConnected }: { initialConnected: boolean }) {
  const [messages, setMessages] = useState<Mail[]>([]);
  const [connected, setConnected] = useState(initialConnected);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/gmail/messages", { cache: "no-store" });
      const data = (await response.json()) as MailResponse;

      if (response.status === 401) {
        setConnected(false);
        setMessages([]);
        return;
      }

      if (!response.ok) throw new Error(data.error ?? "메일을 불러오지 못했습니다.");

      setConnected(true);
      setMessages(data.messages ?? []);
      setOpenId(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "알 수 없는 오류가 발생했습니다.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return <p className="text-sm text-slate-500">최근 메일을 불러오는 중...</p>;
  }

  if (!connected) {
    return (
      <div className="rounded-3xl border border-white/80 bg-white/88 p-8 shadow-sm backdrop-blur-md">
        <p className="mb-5 max-w-xl text-slate-600">
          Google 권한 동의 후 받은편지함의 최근 메일 10개를 안전하게 불러옵니다.
        </p>
        <a
          href="/api/google/connect"
          className="inline-flex rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white transition hover:bg-blue-700"
        >
          Gmail 연결하기
        </a>
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-emerald-700">Gmail 연결됨</p>
        <button
          type="button"
          onClick={() => void loadMessages()}
          className="rounded-xl border border-white/80 bg-white/88 px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur-md transition hover:bg-white"
        >
          {messages.length === 0 ? "최근 메일 불러오기" : "새로고침"}
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-red-100/80 bg-red-50/88 p-4 text-sm text-red-700 backdrop-blur-md">{error}</p>
      )}

      {messages.length === 0 ? (
        <p className="rounded-2xl border border-white/80 bg-white/88 p-6 text-slate-500 backdrop-blur-md">
          받은편지함에 표시할 메일이 없습니다.
        </p>
      ) : (
        <div className="divide-y divide-slate-200/70 overflow-hidden rounded-2xl border border-white/80 bg-white/88 shadow-sm backdrop-blur-md">
          {messages.map((message) => {
            const isOpen = message.id === openId;

            return (
              <article key={message.id}>
                <h2>
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : message.id)}
                    aria-expanded={isOpen}
                    aria-controls={`mail-body-${message.id}`}
                    className={`flex w-full items-baseline gap-3 px-5 py-4 text-left transition hover:bg-white/70 ${
                      isOpen ? "bg-white/60" : ""
                    }`}
                  >
                    <span className="w-32 shrink-0 truncate text-sm font-semibold text-slate-900 sm:w-44">
                      {formatSender(message.from)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <span className="font-medium text-slate-900">{message.subject}</span>
                      {!isOpen && message.snippet && (
                        <span className="text-slate-500"> — {message.snippet}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {formatShortDate(message.date)}
                    </span>
                  </button>
                </h2>

                {isOpen && (
                  <div id={`mail-body-${message.id}`}>
                    <p className="px-5 pb-3 text-xs text-slate-500">
                      {message.from}
                      {message.date && ` · ${message.date}`}
                    </p>
                    <EmailBody html={message.html} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
