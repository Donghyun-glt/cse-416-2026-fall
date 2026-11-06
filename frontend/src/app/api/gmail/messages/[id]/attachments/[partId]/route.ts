import { type NextRequest } from "next/server";
import type { gmail_v1 } from "googleapis";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { getGmailSession } from "@/lib/gmail-session";

function findPart(
  part: gmail_v1.Schema$MessagePart | undefined,
  partId: string,
): gmail_v1.Schema$MessagePart | null {
  if (!part) return null;
  if (part.partId === partId) return part;
  for (const child of part.parts ?? []) {
    const match = findPart(child, partId);
    if (match) return match;
  }
  return null;
}

function safeFilename(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "attachment";
}

function contentDisposition(filename: string, download: boolean) {
  const fallback = safeFilename(filename).replace(/[^\x20-\x7E]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(
  request: NextRequest,
  { params }: RouteContext<"/api/gmail/messages/[id]/attachments/[partId]">,
) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? await getGmailSession(sessionId) : undefined;
  if (!tokens) return Response.json({ connected: false }, { status: 401 });

  try {
    const { id, partId } = await params;
    const oauth2Client = createGoogleOAuthClient();
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const message = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const part = findPart(message.data.payload, partId);
    if (!part || (!part.body?.attachmentId && !part.body?.data)) {
      return Response.json({ error: "attachment_not_found" }, { status: 404 });
    }

    const encoded = part.body.attachmentId
      ? (await gmail.users.messages.attachments.get({
          userId: "me",
          messageId: id,
          id: part.body.attachmentId,
        })).data.data
      : part.body.data;

    if (!encoded) return Response.json({ error: "attachment_empty" }, { status: 404 });

    const bytes = Buffer.from(encoded, "base64url");
    const filename = safeFilename(part.filename || `attachment-${partId}`);
    const mimeType = part.mimeType || "application/octet-stream";
    const safeInlineType = /^(image\/(?:png|jpeg|gif|webp)|application\/pdf)$/i.test(mimeType);
    const wantsDownload = request.nextUrl.searchParams.get("download") === "1" || !safeInlineType;

    return new Response(bytes, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": contentDisposition(filename, wantsDownload),
        "Content-Length": String(bytes.byteLength),
        "Content-Type": mimeType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Gmail attachment request failed", error);
    return Response.json({ error: "attachment_request_failed" }, { status: 502 });
  }
}
