import { type NextRequest } from "next/server";
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

function rawMessage(headers: Record<string, string>, body: string) {
  const lines = Object.entries(headers)
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => `${name}: ${value}`);
  lines.push("MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "");
  lines.push(Buffer.from(body, "utf8").toString("base64"));
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
      const raw = rawMessage({
        To: to,
        Subject: encodedHeader(prefixedSubject(subject, "Fwd:")),
      }, `${body}\r\n\r\n---------- Forwarded message ---------\r\nFrom: ${cleanHeader(from)}\r\nDate: ${cleanHeader(date)}\r\nSubject: ${cleanHeader(subject)}\r\n\r\n${originalText}`);
      await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    }

    return Response.json({ sent: true });
  } catch (error) {
    console.error("Gmail send request failed", error);
    return Response.json({ error: "gmail_send_failed" }, { status: 502 });
  }
}
