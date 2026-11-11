import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { attachGmailSessionToUser, getGmailSession, getGmailSessionWithUser } from "@/lib/gmail-session";
import { parseGmailMessage } from "@/lib/gmail-message";
import { getOrAssignPriority, setPriority } from "@/lib/gmail-priority";
import { upsertUser } from "@/lib/mailflow-db";
import { isPriority, type Priority } from "@/lib/mail-priority";

async function getAuthorizedGmail(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? await getGmailSession(sessionId) : undefined;
  if (!sessionId || !tokens) return null;

  const oauth2Client = createGoogleOAuthClient();
  oauth2Client.setCredentials(tokens);
  return google.gmail({ version: "v1", auth: oauth2Client });
}

/**
 * GET /api/gmail/messages/[id]
 * Full message for the detail view: sanitized HTML body and attachments.
 * List responses carry headers and snippet only, so the client calls this
 * when a message is opened.
 */
export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/api/gmail/messages/[id]">,
) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const session = sessionId ? await getGmailSessionWithUser(sessionId) : undefined;
  if (!sessionId || !session) return NextResponse.json({ connected: false }, { status: 401 });

  try {
    const { id } = await params;
    const oauth2Client = createGoogleOAuthClient();
    oauth2Client.setCredentials(session.tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const result = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const message = parseGmailMessage(result.data);
    let priority: Priority = "fyi";
    if (!message.draft) {
      let userId = session.userId;
      if (userId === null) {
        const gmailProfile = await gmail.users.getProfile({ userId: "me" });
        userId = await upsertUser(gmailProfile.data.emailAddress ?? "");
        await attachGmailSessionToUser(sessionId, userId);
      }
      priority = await getOrAssignPriority(result.data, userId);
    }
    return NextResponse.json({ message: { ...message, priority } });
  } catch (gmailError) {
    const status = (gmailError as { code?: unknown }).code === 404 ? 404 : 502;
    console.error("Gmail message request failed", gmailError);
    return NextResponse.json({ error: status === 404 ? "message_not_found" : "gmail_request_failed" }, { status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteContext<"/api/gmail/messages/[id]">,
) {
  const gmail = await getAuthorizedGmail(request);
  if (!gmail) return NextResponse.json({ connected: false }, { status: 401 });

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as {
      action?: "read" | "unread" | "star" | "restore" | "priority" | "archive" | "spam" | "notSpam";
      starred?: boolean;
      priority?: unknown;
    };
    if (body.action === "priority") {
      if (!isPriority(body.priority)) return NextResponse.json({ error: "invalid_priority" }, { status: 400 });
      const gmailProfile = await gmail.users.getProfile({ userId: "me" });
      const userId = await upsertUser(gmailProfile.data.emailAddress ?? "");
      const sessionId = request.cookies.get("gmail_session")?.value;
      if (sessionId) await attachGmailSessionToUser(sessionId, userId);
      await setPriority(id, body.priority, userId);
      return NextResponse.json({ priority: body.priority });
    }
    if (body.action === "restore") {
      await gmail.users.messages.untrash({ userId: "me", id });
      return NextResponse.json({ restored: true });
    }
    if (body.action === "unread" || body.action === "archive" || body.action === "spam" || body.action === "notSpam") {
      const requestBody = body.action === "unread"
        ? { addLabelIds: ["UNREAD"] }
        : body.action === "archive"
          ? { removeLabelIds: ["INBOX"] }
          : body.action === "notSpam"
            ? { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] }
            : { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] };
      await gmail.users.messages.modify({ userId: "me", id, requestBody });
      return NextResponse.json({ ok: true, action: body.action });
    }
    const isStarAction = body.action === "star";
    await gmail.users.messages.modify({
      userId: "me",
      id,
      requestBody: isStarAction
        ? body.starred
          ? { addLabelIds: ["STARRED"] }
          : { removeLabelIds: ["STARRED"] }
        : { removeLabelIds: ["UNREAD"] },
    });
    return NextResponse.json(
      isStarAction ? { starred: Boolean(body.starred) } : { unread: false },
    );
  } catch (gmailError) {
    console.error("Gmail mark-as-read request failed", gmailError);
    return NextResponse.json({ error: "gmail_modify_failed" }, { status: 502 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteContext<"/api/gmail/messages/[id]">,
) {
  const gmail = await getAuthorizedGmail(request);
  if (!gmail) return NextResponse.json({ connected: false }, { status: 401 });

  try {
    const { id } = await params;
    await gmail.users.messages.trash({ userId: "me", id });
    return NextResponse.json({ trashed: true });
  } catch (gmailError) {
    console.error("Gmail trash request failed", gmailError);
    return NextResponse.json({ error: "gmail_trash_failed" }, { status: 502 });
  }
}
