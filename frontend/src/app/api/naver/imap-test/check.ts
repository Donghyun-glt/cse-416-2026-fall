import { type NextRequest, NextResponse } from "next/server";
import { getGmailSession } from "@/lib/gmail-session";
import { checkImapLogin } from "@/lib/naver-imap-check";

/**
 * Shared handler for the Naver IMAP probe routes (one per deployment region).
 * Body: { address: "name@naver.com", appPassword?: string }
 * Only a signed-in MailFlow user may run it, so it cannot be used by strangers to
 * guess Naver passwords. The password is used for one LOGIN and is never logged or stored.
 */
export async function runImapTest(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  if (!sessionId || !await getGmailSession(sessionId)) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const body = await request.json().catch(() => null) as { address?: unknown; appPassword?: unknown } | null;
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  const password = typeof body?.appPassword === "string" ? body.appPassword.replace(/\s+/g, "") : "";
  if (!/^[^\s@"\\]{1,64}@naver\.com$/i.test(address) || password.length > 64) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const result = await checkImapLogin({ user: address, password: password || undefined });
  return NextResponse.json({ region: process.env.VERCEL_REGION ?? "local", ...result }, { headers: { "Cache-Control": "no-store" } });
}
