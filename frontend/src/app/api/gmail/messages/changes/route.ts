import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { getGmailSessionWithUser } from "@/lib/gmail-session";

const HISTORY_ID = /^\d{1,20}$/;

/**
 * GET /api/gmail/messages/changes?since=<historyId>
 * Whether anything happened in the mailbox since a list was loaded (mail arrived, was read,
 * starred, moved or deleted, here or in Gmail itself). One small Gmail call instead of
 * reloading the whole list: the browser asks this every 15 s and reloads only on `changed`.
 * `historyId` is the mailbox's position now, for the next question.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const session = sessionId ? await getGmailSessionWithUser(sessionId) : undefined;
  if (!session) return NextResponse.json({ connected: false }, { status: 401 });

  const since = request.nextUrl.searchParams.get("since") ?? "";
  if (!HISTORY_ID.test(since)) return NextResponse.json({ error: "invalid_history_id" }, { status: 400 });

  const auth = createGoogleOAuthClient();
  auth.setCredentials(session.tokens);
  const gmail = google.gmail({ version: "v1", auth });
  try {
    // One record is enough to know that something changed.
    const { data } = await gmail.users.history.list({ userId: "me", startHistoryId: since, maxResults: 1, fields: "history/id,historyId" });
    return NextResponse.json({ changed: (data.history?.length ?? 0) > 0, historyId: data.historyId ?? since }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    // Gmail keeps history for about a week; an older position cannot be compared, so reload.
    if ((error as { code?: unknown })?.code === 404) return NextResponse.json({ changed: true }, { headers: { "Cache-Control": "no-store" } });
    console.error("Gmail history check failed", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "gmail_request_failed" }, { status: 502 });
  }
}
