import { type NextRequest } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { getGmailSession } from "@/lib/gmail-session";
import { parseGmailMessage } from "@/lib/gmail-message";
import { buildNewMessage, readNewDraft, readOutgoingRequest } from "@/lib/outgoing-mail";

// Drafts of new messages, kept in Gmail's own Drafts the way Gmail autosaves them.

async function authorizedGmail(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? await getGmailSession(sessionId) : undefined;
  if (!tokens) return null;
  const oauth2Client = createGoogleOAuthClient();
  oauth2Client.setCredentials(tokens);
  return google.gmail({ version: "v1", auth: oauth2Client });
}
const notFound = (error: unknown) => (error as { code?: unknown }).code === 404;

/**
 * GET /api/gmail/compose/draft?messageId=...
 * Opens a draft from the Drafts list in the Compose window.
 * Returns: { draft: { draftId, to, cc, bcc, subject, html, attachments } | null }
 */
export async function GET(request: NextRequest) {
  const gmail = await authorizedGmail(request);
  if (!gmail) return Response.json({ connected: false }, { status: 401 });
  const messageId = request.nextUrl.searchParams.get("messageId") ?? "";
  if (!messageId) return Response.json({ error: "message_id_missing" }, { status: 400 });
  try {
    const [listed, message] = await Promise.all([
      gmail.users.drafts.list({ userId: "me", maxResults: 100 }),
      gmail.users.messages.get({ userId: "me", id: messageId, format: "full" }),
    ]);
    const entry = (listed.data.drafts ?? []).find((item) => item.message?.id === messageId);
    if (!entry?.id || !message.data.labelIds?.includes("DRAFT")) return Response.json({ draft: null });
    const attachments = parseGmailMessage(message.data).attachments.filter((attachment) => !attachment.inline)
      .map(({ filename, mimeType, size, downloadUrl }) => ({ filename, mimeType, size, downloadUrl }));
    return Response.json({ draft: { draftId: entry.id, ...readNewDraft(message.data), attachments } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (notFound(error)) return Response.json({ draft: null });
    console.error("Gmail compose draft lookup failed", error);
    return Response.json({ error: "gmail_draft_failed" }, { status: 502 });
  }
}

/**
 * POST /api/gmail/compose/draft
 * Saves the Compose window as a Gmail draft, whatever state it is in (a draft may
 * have no recipient or a mistyped one). Same form data as /api/gmail/compose.
 * Without draftId a draft is created; with draftId that draft is replaced.
 * Returns: { draftId, messageId }
 */
export async function POST(request: NextRequest) {
  const gmail = await authorizedGmail(request);
  if (!gmail) return Response.json({ connected: false }, { status: 401 });
  const parsed = await readOutgoingRequest(request);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.status });
  const message = buildNewMessage(parsed.input, parsed.uploads, { draft: true });
  if ("error" in message) return Response.json({ error: message.error }, { status: message.status });
  try {
    const requestBody = { message: { raw: message.raw } };
    const draftId = typeof parsed.input.draftId === "string" ? parsed.input.draftId : "";
    if (draftId) {
      try {
        const updated = await gmail.users.drafts.update({ userId: "me", id: draftId, requestBody });
        return Response.json({ draftId: updated.data.id ?? draftId, messageId: updated.data.message?.id ?? "" });
      } catch (updateError) {
        // The draft was deleted elsewhere (for example in Gmail); start a new one.
        if (!notFound(updateError)) throw updateError;
      }
    }
    const created = await gmail.users.drafts.create({ userId: "me", requestBody });
    return Response.json({ draftId: created.data.id ?? "", messageId: created.data.message?.id ?? "" });
  } catch (error) {
    console.error("Gmail compose draft save failed", error);
    return Response.json({ error: "gmail_draft_failed" }, { status: 502 });
  }
}

/**
 * DELETE /api/gmail/compose/draft?draftId=...
 * Discards the draft. Deleting a draft that is already gone succeeds.
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
      console.error("Gmail compose draft delete failed", error);
      return Response.json({ error: "gmail_draft_failed" }, { status: 502 });
    }
  }
  return Response.json({ discarded: true });
}
