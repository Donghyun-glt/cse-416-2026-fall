import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getGmailSession } from "@/lib/gmail-session";
import { MailClient } from "./mail-client";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  // The OAuth state cookie must be set on the same host as Google's callback.
  // Next dev also advertises a LAN address, which otherwise breaks the first login.
  if (process.env.NODE_ENV === "development" && process.env.GOOGLE_REDIRECT_URI) {
    const callbackUrl = new URL(process.env.GOOGLE_REDIRECT_URI);
    if (callbackUrl.hostname === "localhost") {
      const requestHost = (await headers()).get("host");
      if (requestHost && requestHost !== callbackUrl.host) redirect(callbackUrl.origin);
    }
  }

  const { error } = await searchParams;
  const sessionId = (await cookies()).get("gmail_session")?.value;
  const connected = Boolean(sessionId && getGmailSession(sessionId));

  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI,
  );
  return <MailClient initialConnected={connected} loginError={error || (googleConfigured ? undefined : "oauth_not_configured")} />;
}
