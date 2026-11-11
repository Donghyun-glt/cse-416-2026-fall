import { type NextRequest } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { getGmailSession } from "@/lib/gmail-session";
import { buildOutgoingMessage, readOutgoingRequest } from "@/lib/outgoing-mail";

/**
 * POST /api/gmail/messages/[id]/send
 * JSON body: { action, body, to? } sends plain text.
 * multipart/form-data: action, body (plain text), html? (formatted version),
 * to?, files* (new attachments, 4 MB total), draftId? sends formatted mail
 * with files. When draftId is given, that autosaved draft is removed once the
 * message has been sent.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteContext<"/api/gmail/messages/[id]/send">,
) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? await getGmailSession(sessionId) : undefined;
  if (!tokens) return Response.json({ connected: false }, { status: 401 });

  const parsed = await readOutgoingRequest(request);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.status });

  try {
    const { id } = await params;
    const oauth2Client = createGoogleOAuthClient();
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const message = await buildOutgoingMessage(gmail, id, parsed.input, parsed.uploads);
    if ("error" in message) return Response.json({ error: message.error }, { status: message.status });

    await gmail.users.messages.send({
      userId: "me",
      requestBody: message.threadId ? { raw: message.raw, threadId: message.threadId } : { raw: message.raw },
    });

    const draftId = typeof parsed.input.draftId === "string" ? parsed.input.draftId : "";
    if (draftId) {
      // The message is already sent; a leftover draft is only clutter, so a
      // failure here must not turn the response into an error.
      await gmail.users.drafts.delete({ userId: "me", id: draftId }).catch((draftError: unknown) => {
        console.error("Sent message, but its draft could not be removed", draftError);
      });
    }
    return Response.json({ sent: true });
  } catch (error) {
    console.error("Gmail send request failed", error);
    return Response.json({ error: "gmail_send_failed" }, { status: 502 });
  }
}
