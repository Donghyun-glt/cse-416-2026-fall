import { cookies } from "next/headers";
import { getGmailSession } from "@/lib/gmail-session";
import { MailClient } from "./mail-client";

export default async function Home() {
  const sessionId = (await cookies()).get("gmail_session")?.value;
  const connected = Boolean(sessionId && getGmailSession(sessionId));

  return <MailClient initialConnected={connected} />;
}
