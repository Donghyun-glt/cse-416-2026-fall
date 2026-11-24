import { type NextRequest, NextResponse } from "next/server";
import { getGmailSessionWithUser } from "@/lib/gmail-session";
import { getCalendarEventStatesForMessages, getMessageInsights } from "@/lib/mailflow-db";

// Gmail message ids are short hex strings; anything else is not a message of this user.
const MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_IDS = 200;

/**
 * POST /api/gmail/messages/insights  { ids: string[] }
 * The stored analyses of many messages at once, for the Daily Briefing cards: summary,
 * suggested events and what the user did with each event. Read-only: no Gmail call, no
 * AI call, no priority change. Messages not analysed yet are left out of `insights`; the
 * client has those analysed one by one through /[id]/calendar-suggestions.
 */
export async function POST(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const session = sessionId ? await getGmailSessionWithUser(sessionId) : undefined;
  if (!session) return NextResponse.json({ error: "signed_out" }, { status: 401 });

  const body = await request.json().catch(() => null) as { ids?: unknown } | null;
  if (!Array.isArray(body?.ids) || body.ids.length > MAX_IDS || !body.ids.every((id) => typeof id === "string" && MESSAGE_ID.test(id))) {
    return NextResponse.json({ error: "invalid_ids" }, { status: 400 });
  }
  const ids = [...new Set(body.ids as string[])];
  // A session not yet linked to a MailFlow user has nothing stored.
  if (session.userId === null || ids.length === 0) return NextResponse.json({ insights: {} }, { headers: { "Cache-Control": "no-store" } });

  try {
    const [analyses, eventStates] = await Promise.all([
      getMessageInsights(session.userId, ids),
      getCalendarEventStatesForMessages(session.userId, ids),
    ]);
    const insights = Object.fromEntries([...analyses].map(([id, stored]) => {
      const analysis = stored as { summary?: unknown; reason?: unknown; candidates?: unknown };
      return [id, {
        // Only what a card shows; the full analysis stays on the server.
        analysis: { summary: typeof analysis.summary === "string" ? analysis.summary : "", reason: typeof analysis.reason === "string" ? analysis.reason : "" },
        candidates: Array.isArray(analysis.candidates) ? analysis.candidates : [],
        eventStates: eventStates.get(id) ?? {},
      }];
    }));
    return NextResponse.json({ insights }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Stored message insights could not be read", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "insights_unavailable" }, { status: 502 });
  }
}
