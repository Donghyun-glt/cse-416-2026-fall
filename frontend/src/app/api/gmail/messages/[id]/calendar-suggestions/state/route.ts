import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { attachGmailSessionToUser, getGmailSessionWithUser } from "@/lib/gmail-session";
import { saveCalendarEventState, upsertUser } from "@/lib/mailflow-db";

/**
 * PUT /api/gmail/messages/[id]/calendar-suggestions/state
 * Body: { key, status: "pending" | "saved" | "dismissed", details }
 * Remembers what the user last did with one suggested event: the details as they
 * edited them, and whether they added or dismissed it. Scoped to the signed-in
 * user. This never creates a calendar event; /api/calendar/events does, on approval.
 */
const limits: Record<string, number> = { title: 200, date: 32, start: 32, end: 32, zone: 100, location: 500, description: 8000 };

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const session = sessionId ? await getGmailSessionWithUser(sessionId) : undefined;
  if (!sessionId || !session) return NextResponse.json({ connected: false }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as { key?: unknown; status?: unknown; details?: unknown } | null;
  const status = body?.status;
  const input = (body?.details && typeof body.details === "object" ? body.details : {}) as Record<string, unknown>;
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id) || typeof body?.key !== "string" || !body.key || body.key.length > 500
      || (status !== "pending" && status !== "saved" && status !== "dismissed")) {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  }
  const details: Record<string, unknown> = {};
  for (const [field, max] of Object.entries(limits)) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length > max) return NextResponse.json({ error: "invalid_state" }, { status: 400 });
    details[field] = value;
  }
  if (input.allDay !== undefined) {
    if (typeof input.allDay !== "boolean") return NextResponse.json({ error: "invalid_state" }, { status: 400 });
    details.allDay = input.allDay;
  }
  try {
    let userId = session.userId;
    if (userId === null) {
      const auth = createGoogleOAuthClient(); auth.setCredentials(session.tokens);
      const profile = await google.gmail({ version: "v1", auth }).users.getProfile({ userId: "me" });
      userId = await upsertUser(profile.data.emailAddress ?? "");
      await attachGmailSessionToUser(sessionId, userId);
    }
    await saveCalendarEventState({ userId, gmailMessageId: id, candidateKey: body.key, status, details });
    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error("Calendar event state could not be saved", error);
    return NextResponse.json({ error: "event_state_failed" }, { status: 502 });
  }
}
