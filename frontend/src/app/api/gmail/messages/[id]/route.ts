import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { getGmailSession, saveGmailSession } from "@/lib/gmail-session";
import { ensurePriorityLabels, setPriority } from "@/lib/gmail-priority";
import { invalidatePriorityIndex, removeFromPriorityIndex, updatePriorityIndex } from "@/lib/priority-index";
import { isPriority } from "@/lib/mail-priority";

async function getAuthorizedGmail(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? getGmailSession(sessionId) : undefined;
  if (!sessionId || !tokens) return null;

  const oauth2Client = createGoogleOAuthClient();
  oauth2Client.setCredentials(tokens);
  oauth2Client.on("tokens", (newTokens) => {
    saveGmailSession(sessionId, { ...tokens, ...newTokens });
  });
  return google.gmail({ version: "v1", auth: oauth2Client });
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
      action?: "read" | "star" | "restore" | "priority";
      starred?: boolean;
      priority?: unknown;
    };
    if (body.action === "priority") {
      if (!isPriority(body.priority)) return NextResponse.json({ error: "invalid_priority" }, { status: 400 });
      const labels = await ensurePriorityLabels(gmail);
      await setPriority(gmail, id, body.priority, labels);
      const sessionId = request.cookies.get("gmail_session")?.value;
      if (sessionId) updatePriorityIndex(sessionId, id, body.priority);
      return NextResponse.json({ priority: body.priority });
    }
    if (body.action === "restore") {
      await gmail.users.messages.untrash({ userId: "me", id });
      const sessionId = request.cookies.get("gmail_session")?.value;
      if (sessionId) invalidatePriorityIndex(sessionId);
      return NextResponse.json({ restored: true });
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
    const sessionId = request.cookies.get("gmail_session")?.value;
    if (sessionId) removeFromPriorityIndex(sessionId, id);
    return NextResponse.json({ trashed: true });
  } catch (gmailError) {
    console.error("Gmail trash request failed", gmailError);
    return NextResponse.json({ error: "gmail_trash_failed" }, { status: 502 });
  }
}
