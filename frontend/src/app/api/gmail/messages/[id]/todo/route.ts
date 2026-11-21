import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { attachGmailSessionToUser, getGmailSessionWithUser } from "@/lib/gmail-session";
import { getTodoItem, resolveTodoReason, setTodoStatus, upsertUser } from "@/lib/mailflow-db";

/**
 * PUT /api/gmail/messages/[id]/todo
 * The user's own handling of a Summary item. Body is one of:
 *   { status: "open" | "done" | "not_relevant" }  mark it (open also adds a message by hand)
 *   { resolved: "reply" }                          the reply was sent; done if nothing else is left
 * Returns: { todo } as it now stands. Scoped to the signed-in user.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const session = sessionId ? await getGmailSessionWithUser(sessionId) : undefined;
  if (!sessionId || !session) return NextResponse.json({ connected: false }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null) as { status?: unknown; resolved?: unknown } | null;
  const status = body?.status;
  const validStatus = status === "open" || status === "done" || status === "not_relevant";
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id) || (!validStatus && body?.resolved !== "reply")) return NextResponse.json({ error: "invalid_todo" }, { status: 400 });
  try {
    let userId = session.userId;
    if (userId === null) {
      const auth = createGoogleOAuthClient(); auth.setCredentials(session.tokens);
      const profile = await google.gmail({ version: "v1", auth }).users.getProfile({ userId: "me" });
      userId = await upsertUser(profile.data.emailAddress ?? "");
      await attachGmailSessionToUser(sessionId, userId);
    }
    if (validStatus) await setTodoStatus(userId, id, status);
    else await resolveTodoReason(userId, id, "reply");
    return NextResponse.json({ todo: await getTodoItem(userId, id) });
  } catch (error) {
    console.error("Summary to-do could not be updated", error);
    return NextResponse.json({ error: "todo_failed" }, { status: 502 });
  }
}
