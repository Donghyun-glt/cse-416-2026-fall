"use client";

import { useCallback, useState } from "react";

type Mail = {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  body: string;
};

type MailResponse = {
  connected?: boolean;
  messages?: Mail[];
  error?: string;
};

export function MailClient({ initialConnected }: { initialConnected: boolean }) {
  const [messages, setMessages] = useState<Mail[]>([]);
  const [connected, setConnected] = useState(initialConnected);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
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
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          {messages.length === 0 ? "최근 메일 불러오기" : "새로고침"}
        </button>
      </div>

      {error && (
        <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>
      )}

      {messages.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-6 text-slate-500">
          받은편지함에 표시할 메일이 없습니다.
        </p>
      ) : (
        <div className="space-y-4">
          {messages.map((message) => (
            <article
              key={message.id}
              className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
            >
              <p className="mb-1 text-sm font-medium text-blue-700">{message.from}</p>
              <h2 className="text-lg font-bold text-slate-900">{message.subject}</h2>
              {message.date && (
                <p className="mt-1 text-xs text-slate-400">{message.date}</p>
              )}
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                {message.body || message.snippet}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
