import { cookies } from "next/headers";
import { getGmailSession } from "@/lib/gmail-session";
import { GoogleLoginCompletion } from "./completion";

export default async function GoogleLoginComplete({ searchParams }: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const sessionId = (await cookies()).get("gmail_session")?.value;
  const connected = Boolean(sessionId && getGmailSession(sessionId));
  return <GoogleLoginCompletion error={error || (connected ? undefined : "invalid_oauth_state")} />;
}
