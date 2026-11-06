import { type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import type { gmail_v1 } from "googleapis";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { getGmailSession } from "@/lib/gmail-session";

function headersOf(message: gmail_v1.Schema$Message) {
  return new Map(
    (message.payload?.headers ?? []).map((header) => [
      header.name?.toLowerCase() ?? "",
      header.value ?? "",
    ]),
  );
}

function decodeBody(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function plainBody(part: gmail_v1.Schema$MessagePart | undefined): string | null {
  if (!part) return null;
  if (part.mimeType === "text/plain" && part.body?.data) return decodeBody(part.body.data);
  for (const child of part.parts ?? []) {
    const body = plainBody(child);
    if (body) return body;
  }
  return null;
}

function cleanHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodedHeader(value: string) {
  const clean = cleanHeader(value);
  return /^[\x20-\x7E]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function emailAddress(value: string) {
  const match = cleanHeader(value).match(/<([^<>\s]+@[^<>\s]+)>|([^\s,<>]+@[^\s,<>]+)/);
  return match?.[1] ?? match?.[2] ?? "";
}

function forwardAddresses(value: string) {
  const addresses = cleanHeader(value)
    .split(",")
    .map((address) => emailAddress(address))
    .filter(Boolean);
  return addresses.length > 0 ? addresses.join(", ") : "";
}

function prefixedSubject(subject: string, prefix: "Re:" | "Fwd:") {
  const clean = cleanHeader(subject || "(no subject)");
  return new RegExp(`^${prefix.slice(0, -1)}:`, "i").test(clean) ? clean : `${prefix} ${clean}`;
}

function quote(value: string) {
  return value.replace(/\r\n/g, "\n").split("\n").map((line) => `> ${line}`).join("\r\n");
}

function base64Lines(value: Buffer | string) {
  const encoded = Buffer.isBuffer(value)
    ? value.toString("base64")
    : Buffer.from(value, "utf8").toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

type OutgoingAttachment = { filename: string; mimeType: string; data: Buffer };

function attachmentParts(part: gmail_v1.Schema$MessagePart | undefined, result: gmail_v1.Schema$MessagePart[] = []) {
  if (!part) return result;
  const headers = new Map((part.headers ?? []).map((header) => [header.name?.toLowerCase() ?? "", header.value ?? ""]));
  const disposition = (headers.get("content-disposition") ?? "").toLowerCase();
  if (part.filename && !disposition.startsWith("inline") && (part.body?.attachmentId || part.body?.data)) {
    result.push(part);
  }
  for (const child of part.parts ?? []) attachmentParts(child, result);
  return result;
}

function rawMessage(headers: Record<string, string>, body: string, attachments: OutgoingAttachment[] = []) {
  const lines = Object.entries(headers)
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => `${name}: ${value}`);
  lines.push("MIME-Version: 1.0");

  if (attachments.length === 0) {
    lines.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Lines(body));
  } else {
    const boundary = `mailflow_${randomBytes(16).toString("hex")}`;
    lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`);
    lines.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", base64Lines(body));
    for (const attachment of attachments) {
      const filename = cleanHeader(attachment.filename).replace(/["\\]/g, "_") || "attachment";
      const encodedFilename = encodeURIComponent(filename);
      lines.push(
        `--${boundary}`,
        `Content-Type: ${attachment.mimeType || "application/octet-stream"}; name*=UTF-8''${encodedFilename}`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename*=UTF-8''${encodedFilename}`,
        "",
        base64Lines(attachment.data),
      );
    }
    lines.push(`--${boundary}--`);
  }
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export async function POST(
  request: NextRequest,
  { params }: RouteContext<"/api/gmail/messages/[id]/send">,
) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? await getGmailSession(sessionId) : undefined;
  if (!tokens) return Response.json({ connected: false }, { status: 401 });

  const input = await request.json().catch(() => ({})) as {
    action?: "reply" | "forward";
    to?: string;
    body?: string;
  };
  const body = input.body?.trim() ?? "";
  if (!body || (input.action !== "reply" && input.action !== "forward")) {
    return Response.json({ error: "invalid_message" }, { status: 400 });
  }

  try {
    const { id } = await params;
    const oauth2Client = createGoogleOAuthClient();
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const original = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const originalHeaders = headersOf(original.data);
    const subject = originalHeaders.get("subject") ?? "(no subject)";
    const from = originalHeaders.get("from") ?? "";
    const date = originalHeaders.get("date") ?? "";
    const messageId = cleanHeader(originalHeaders.get("message-id") ?? "");
    const references = cleanHeader(originalHeaders.get("references") ?? "");
    const originalText = plainBody(original.data.payload) ?? original.data.snippet ?? "";

    if (input.action === "reply") {
      const to = emailAddress(originalHeaders.get("reply-to") || from);
      if (!to) return Response.json({ error: "reply_address_missing" }, { status: 400 });
      const raw = rawMessage({
        To: to,
        Subject: encodedHeader(prefixedSubject(subject, "Re:")),
        "In-Reply-To": messageId,
        References: cleanHeader(`${references} ${messageId}`),
      }, `${body}\r\n\r\nOn ${date}, ${cleanHeader(from)} wrote:\r\n${quote(originalText)}`);
      await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw, threadId: original.data.threadId ?? undefined },
      });
    } else {
      const to = forwardAddresses(input.to ?? "");
      if (!to) return Response.json({ error: "forward_address_missing" }, { status: 400 });
      const attachments = await Promise.all(attachmentParts(original.data.payload).map(async (part) => {
        const encoded = part.body?.attachmentId
          ? (await gmail.users.messages.attachments.get({
              userId: "me",
              messageId: id,
              id: part.body.attachmentId,
            })).data.data
          : part.body?.data;
        return {
          filename: part.filename || "attachment",
          mimeType: part.mimeType || "application/octet-stream",
          data: Buffer.from(encoded ?? "", "base64url"),
        };
      }));
      const raw = rawMessage({
        To: to,
        Subject: encodedHeader(prefixedSubject(subject, "Fwd:")),
      }, `${body}\r\n\r\n---------- Forwarded message ---------\r\nFrom: ${cleanHeader(from)}\r\nDate: ${cleanHeader(date)}\r\nSubject: ${cleanHeader(subject)}\r\n\r\n${originalText}`, attachments);
      await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    }

    return Response.json({ sent: true });
  } catch (error) {
    console.error("Gmail send request failed", error);
    return Response.json({ error: "gmail_send_failed" }, { status: 502 });
  }
}
