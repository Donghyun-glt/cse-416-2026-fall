import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { attachGmailSessionToUser, getGmailSessionWithUser } from "@/lib/gmail-session";
import { deleteReplyPanelState, getReplyPanelState, saveReplyPanelState, upsertUser } from "@/lib/mailflow-db";
import { isReplyLength, isReplyTone } from "@/lib/reply-draft";

/**
 * /api/gmail/messages/[id]/reply-state
 * The reply panel as the user last left it for this message.
 *   GET    -> { state: { draft, tone, length, instructions } | null }
 *   PUT    body { draft, tone, length, instructions } -> { saved: true }
 *   DELETE -> { deleted: true }   (after sending, or when the draft was cleared)
 * Rows are scoped to the signed-in user; nothing here calls the LLM or sends mail.
 */
type Params = { params: Promise<{ id: string }> };
const MAX_DRAFT_CHARS = 20000;

async function resolve(request: NextRequest, { params }: Params, createUser: boolean) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const session = sessionId ? await getGmailSessionWithUser(sessionId) : undefined;
  if (!sessionId || !session) return { error: NextResponse.json({ connected: false }, { status: 401 }) };
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(id)) return { error: NextResponse.json({ error: "invalid_message" }, { status: 400 }) };
  let userId = session.userId;
  if (userId === null && createUser) {
    // Sessions created before the first AI draft are not linked to a user yet.
    const auth = createGoogleOAuthClient(); auth.setCredentials(session.tokens);
    const profile = await google.gmail({ version: "v1", auth }).users.getProfile({ userId: "me" });
    userId = await upsertUser(profile.data.emailAddress ?? "");
    await attachGmailSessionToUser(sessionId, userId);
  }
  return { id, userId };
}

export async function GET(request: NextRequest, context: Params) {
  try {
    const target = await resolve(request, context, false);
    if (target.error) return target.error;
    const state = target.userId === null ? null : await getReplyPanelState(target.userId, target.id);
    return NextResponse.json({ state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Reply state could not be read", error);
    return NextResponse.json({ error: "reply_state_failed" }, { status: 502 });
  }
}

export async function PUT(request: NextRequest, context: Params) {
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const draft = typeof body?.draft === "string" ? body.draft : "";
  const instructions = typeof body?.instructions === "string" ? body.instructions.trim() : "";
  if (!draft.trim() || draft.length > MAX_DRAFT_CHARS || instructions.length > 500 || !isReplyTone(body?.tone) || !isReplyLength(body?.length)) {
    return NextResponse.json({ error: "invalid_state" }, { status: 400 });
  }
  try {
    const target = await resolve(request, context, true);
    if (target.error) return target.error;
    await saveReplyPanelState({ userId: target.userId!, gmailMessageId: target.id, draft, tone: body.tone, length: body.length, instructions });
    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error("Reply state could not be saved", error);
    return NextResponse.json({ error: "reply_state_failed" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest, context: Params) {
  try {
    const target = await resolve(request, context, false);
    if (target.error) return target.error;
    if (target.userId !== null) await deleteReplyPanelState(target.userId, target.id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Reply state could not be removed", error);
    return NextResponse.json({ error: "reply_state_failed" }, { status: 502 });
  }
}
