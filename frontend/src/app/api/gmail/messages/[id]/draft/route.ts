import { type NextRequest } from "next/server";
import type { gmail_v1 } from "googleapis";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { getGmailSession } from "@/lib/gmail-session";
import { parseGmailMessage } from "@/lib/gmail-message";
import { buildOutgoingMessage, DRAFT_SOURCE_HEADER, readDraftContent, readOutgoingRequest } from "@/lib/outgoing-mail";

async function authorizedGmail(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? await getGmailSession(sessionId) : undefined;
  if (!tokens) return null;
  const oauth2Client = createGoogleOAuthClient();
  oauth2Client.setCredentials(tokens);
  return google.gmail({ version: "v1", auth: oauth2Client });
}

function notFound(error: unknown) {
  return (error as { code?: unknown }).code === 404;
}

type GmailMessage = gmail_v1.Schema$Message;

function header(message: GmailMessage, name: string) {
  const wanted = name.toLowerCase();
  return (message.payload?.headers ?? []).find((item) => item.name?.toLowerCase() === wanted)?.value?.trim() ?? "";
}

function userAttachments(message: GmailMessage) {
  return parseGmailMessage(message).attachments
    .filter((attachment) => !attachment.inline)
    .map(({ filename, mimeType, size, downloadUrl }) => ({ filename, mimeType, size, downloadUrl }));
}

/**
 * GET /api/gmail/messages/[id]/draft
 * Finds the saved draft that belongs with a message so the composer can be
 * reopened where the user left off. [id] may be either side of the pair:
 * - a received message: returns the reply draft written for it, if any;
 * - a draft message: returns its content and the message it answers.
 * Returns: { sourceId: string | null, draft: { draftId, messageId, action, to,
 *   html, text, attachments } | null }
 */
export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/api/gmail/messages/[id]/draft">,
) {
  const gmail = await authorizedGmail(request);
  if (!gmail) return Response.json({ connected: false }, { status: 401 });

  try {
    const { id } = await params;
    const [listed, target] = await Promise.all([
      gmail.users.drafts.list({ userId: "me", maxResults: 100 }),
      gmail.users.messages.get({ userId: "me", id, format: "full" }),
    ]);
    const entries = (listed.data.drafts ?? []).flatMap((entry) =>
      entry.id && entry.message?.id ? [{ draftId: entry.id, messageId: entry.message.id, threadId: entry.message.threadId ?? "" }] : []);

    const describe = async (draftId: string, draftMessage: GmailMessage, source: GmailMessage | null) => {
      const content = readDraftContent(draftMessage);
      let attachments = userAttachments(draftMessage);
      if (content.action === "forward" && source) {
        // A forward draft also carries the original's attachments; those are
        // re-attached automatically, so only files the user added are returned.
        const inherited = userAttachments(source);
        attachments = attachments.filter((file) => !inherited.some((original) => original.filename === file.filename && original.size === file.size));
      }
      return { draftId, messageId: draftMessage.id ?? "", action: content.action, to: content.to, html: content.html, text: content.text, attachments };
    };

    if (target.data.labelIds?.includes("DRAFT")) {
      const entry = entries.find((item) => item.messageId === id);
      if (!entry) return Response.json({ sourceId: null, draft: null });
      let sourceId = header(target.data, DRAFT_SOURCE_HEADER);
      if (!sourceId) {
        // Drafts written in Gmail itself only say which Message-ID they answer.
        const inReplyTo = header(target.data, "In-Reply-To").replace(/[<>]/g, "");
        if (inReplyTo) {
          const found = await gmail.users.messages.list({ userId: "me", q: `rfc822msgid:${inReplyTo}`, maxResults: 5 });
          sourceId = (found.data.messages ?? []).find((message) => message.id && message.id !== id)?.id ?? "";
        }
      }
      if (!sourceId) return Response.json({ sourceId: null, draft: null });
      const source = await gmail.users.messages.get({ userId: "me", id: sourceId, format: "full" }).then((result) => result.data).catch(() => null);
      if (!source) return Response.json({ sourceId: null, draft: null });
      return Response.json({ sourceId, draft: await describe(entry.draftId, target.data, source) });
    }

    // A reply draft lives in the same thread as the message it answers.
    const messageId = header(target.data, "Message-ID");
    for (const entry of entries.filter((item) => item.threadId && item.threadId === target.data.threadId)) {
      const draftMessage = (await gmail.users.messages.get({ userId: "me", id: entry.messageId, format: "full" })).data;
      const source = header(draftMessage, DRAFT_SOURCE_HEADER);
      const answers = source ? source === id : Boolean(messageId) && header(draftMessage, "In-Reply-To") === messageId;
      if (answers) return Response.json({ sourceId: id, draft: await describe(entry.draftId, draftMessage, target.data) });
    }
    return Response.json({ sourceId: id, draft: null });
  } catch (error) {
    if (notFound(error)) return Response.json({ error: "message_not_found" }, { status: 404 });
    console.error("Gmail draft lookup failed", error);
    return Response.json({ error: "gmail_draft_failed" }, { status: 502 });
  }
}

/**
 * POST /api/gmail/messages/[id]/draft
 * Saves what is in the composer as a Gmail draft, the way Gmail autosaves a
 * reply. Takes the same form data as /send. Without draftId a draft is
 * created; with draftId that draft is replaced.
 * Returns: { draftId: string }
 */
export async function POST(
  request: NextRequest,
  { params }: RouteContext<"/api/gmail/messages/[id]/draft">,
) {
  const gmail = await authorizedGmail(request);
  if (!gmail) return Response.json({ connected: false }, { status: 401 });

  const parsed = await readOutgoingRequest(request);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.status });

  try {
    const { id } = await params;
    const message = await buildOutgoingMessage(gmail, id, parsed.input, parsed.uploads, { draft: true });
    if ("error" in message) return Response.json({ error: message.error }, { status: message.status });

    const requestBody = { message: message.threadId ? { raw: message.raw, threadId: message.threadId } : { raw: message.raw } };
    const draftId = typeof parsed.input.draftId === "string" ? parsed.input.draftId : "";
    if (draftId) {
      try {
        const updated = await gmail.users.drafts.update({ userId: "me", id: draftId, requestBody });
        return Response.json({ draftId: updated.data.id ?? draftId });
      } catch (updateError) {
        // The draft was deleted elsewhere (for example in Gmail); start a new one.
        if (!notFound(updateError)) throw updateError;
      }
    }
    const created = await gmail.users.drafts.create({ userId: "me", requestBody });
    return Response.json({ draftId: created.data.id ?? "" });
  } catch (error) {
    console.error("Gmail draft save failed", error);
    return Response.json({ error: "gmail_draft_failed" }, { status: 502 });
  }
}

/**
 * DELETE /api/gmail/messages/[id]/draft?draftId=...
 * Discards an autosaved draft. Deleting a draft that is already gone succeeds.
 */
export async function DELETE(request: NextRequest) {
  const gmail = await authorizedGmail(request);
  if (!gmail) return Response.json({ connected: false }, { status: 401 });

  const draftId = request.nextUrl.searchParams.get("draftId") ?? "";
  if (!draftId) return Response.json({ error: "draft_id_missing" }, { status: 400 });

  try {
    await gmail.users.drafts.delete({ userId: "me", id: draftId });
  } catch (error) {
    if (!notFound(error)) {
      console.error("Gmail draft delete failed", error);
      return Response.json({ error: "gmail_draft_failed" }, { status: 502 });
    }
  }
  return Response.json({ discarded: true });
}
