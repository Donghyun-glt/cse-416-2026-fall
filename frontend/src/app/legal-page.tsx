import Link from "next/link";
import type { ReactNode } from "react";

export const CONTACT_EMAIL = "seunghoon.jang@stonybrook.edu";
export const EFFECTIVE_DATE = "October 26, 2026";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <Link href="/" className="text-sm font-medium text-[#5b46d6] hover:underline">
        ← MailFlow AI
      </Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-black/55">Effective date: {EFFECTIVE_DATE}</p>
      <div className="mt-8 space-y-8 leading-7 text-[15px] [&_a]:text-[#5b46d6] [&_a]:underline [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">
        {children}
      </div>
      <footer className="mt-12 flex gap-4 border-t border-black/10 pt-6 text-sm text-black/55">
        <Link href="/privacy" className="hover:underline">Privacy Policy</Link>
        <Link href="/terms" className="hover:underline">Terms of Service</Link>
      </footer>
    </main>
  );
}
