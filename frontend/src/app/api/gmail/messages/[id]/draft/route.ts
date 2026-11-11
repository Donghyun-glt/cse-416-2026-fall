import { type NextRequest } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { getGmailSession } from "@/lib/gmail-session";
import { buildOutgoingMessage, readOutgoingRequest } from "@/lib/outgoing-mail";

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
