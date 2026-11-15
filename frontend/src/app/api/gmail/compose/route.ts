import { type NextRequest } from "next/server";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { getGmailSession } from "@/lib/gmail-session";
import { buildNewMessage, readOutgoingRequest } from "@/lib/outgoing-mail";

/**
 * POST /api/gmail/compose
 * Sends a new message written in the Compose window.
 * multipart/form-data (or JSON without files): to, cc?, bcc?, subject?, body
 * (plain text), html? (formatted version), files* (attachments, 4 MB total).
 * draftId? names the autosaved draft of this message, removed once it is sent.
 * Sending happens only on this explicit request from the signed-in user.
 */
export async function POST(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? await getGmailSession(sessionId) : undefined;
  if (!tokens) return Response.json({ connected: false }, { status: 401 });

  const parsed = await readOutgoingRequest(request);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.status });
  const message = buildNewMessage(parsed.input, parsed.uploads);
  if ("error" in message) return Response.json({ error: message.error, invalid: message.invalid }, { status: message.status });

  try {
    const oauth2Client = createGoogleOAuthClient();
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    await gmail.users.messages.send({ userId: "me", requestBody: { raw: message.raw } });
    const draftId = typeof parsed.input.draftId === "string" ? parsed.input.draftId : "";
    if (draftId) {
      // The message is already sent; a leftover draft must not turn that into an error.
      await gmail.users.drafts.delete({ userId: "me", id: draftId }).catch((draftError: unknown) => {
        console.error("Sent message, but its draft could not be removed", draftError);
      });
    }
    return Response.json({ sent: true });
  } catch (error) {
    console.error("Gmail compose send failed", error);
    return Response.json({ error: "gmail_send_failed" }, { status: 502 });
  }
}
