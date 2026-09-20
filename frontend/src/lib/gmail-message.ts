import type { gmail_v1 } from "googleapis";

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function findBodyByMimeType(
  part: gmail_v1.Schema$MessagePart | undefined,
  mimeType: "text/plain" | "text/html",
): string | null {
  if (!part) return null;

  if (part.mimeType === mimeType && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }

  for (const child of part.parts ?? []) {
    const body = findBodyByMimeType(child, mimeType);
    if (body) return body;
  }

  return null;
}

function htmlToText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseGmailMessage(message: gmail_v1.Schema$Message) {
  const headers = new Map(
    (message.payload?.headers ?? []).map((header) => [
      header.name?.toLowerCase() ?? "",
      header.value ?? "",
    ]),
  );

  const plainBody = findBodyByMimeType(message.payload, "text/plain");
  const htmlBody = findBodyByMimeType(message.payload, "text/html");
  const body = plainBody ?? (htmlBody ? htmlToText(htmlBody) : message.snippet ?? "");

  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    subject: headers.get("subject") || "(제목 없음)",
    from: headers.get("from") || "알 수 없는 발신자",
    date: headers.get("date") || "",
    snippet: message.snippet ?? "",
    body: body.slice(0, 5000),
  };
}

