import { cookies } from "next/headers";
import { getGmailSession } from "@/lib/gmail-session";
import { Calendar } from "./calendar";
import { MailClient } from "./mail-client";

export default async function Home() {
  const sessionId = (await cookies()).get("gmail_session")?.value;
  const connected = Boolean(sessionId && getGmailSession(sessionId));

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50 px-5 py-14 text-slate-950 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-10">
          <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-blue-600">
            MailFlow AI
          </p>
          <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
            Gmail 가져오기 테스트
          </h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
            테스트 계정으로 Google OAuth에 연결하고 최근 받은 메일의 실제 본문을 확인합니다.
          </p>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[640px_minmax(0,1fr)]">
          {/* Sticky on desktop: the mail list scrolls far past the calendar. */}
          <div className="lg:sticky lg:top-8">
            <Calendar />
          </div>

          <MailClient initialConnected={connected} />
        </div>
      </div>
    </main>
  );
}
