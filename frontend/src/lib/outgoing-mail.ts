import { randomBytes } from "node:crypto";
import type { gmail_v1 } from "googleapis";

// Everything needed to turn what the composer submits into a MIME message.
// Shared by the send route and the draft route so a saved draft is exactly
// the message that would have been sent.

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

// Vercel caps request bodies at 4.5 MB, and Gmail's simple send endpoint has a
// similar ceiling, so new attachments are limited to 4 MB in total.
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char] ?? char));
}

function textToHtml(value: string) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

/**
 * The composer only produces simple formatting (fonts, sizes, bold, lists).
 * Anything that could run code or load remote content is removed before the
 * HTML is put into an outgoing message.
 */
function sanitizeComposedHtml(value: string) {
  return value
    .slice(0, 200_000)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|svg|math|form|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<\/?(?:script|style|iframe|object|embed|svg|math|form|template|noscript|link|meta|base|input|button|textarea|select|img|video|audio|source)\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+(?:href|src|action|formaction|xlink:href)\s*=\s*(?:"\s*(?:javascript|data|vbscript):[^"]*"|'\s*(?:javascript|data|vbscript):[^']*'|(?:javascript|data|vbscript):[^\s>]+)/gi, "")
    // Inside style attributes only, so ordinary text that mentions url( is untouched.
    .replace(/(\sstyle\s*=\s*)("[^"]*"|'[^']*')/gi, (_match, prefix: string, styles: string) => `${prefix}${styles.replace(/expression\s*\(|url\s*\(|@import/gi, "")}`);
}

type MimePart = { headers: string[]; body: string };

function mimeBoundary() {
  return `mailflow_${randomBytes(16).toString("hex")}`;
}

function multipart(subtype: "alternative" | "mixed", parts: MimePart[]): MimePart {
  const boundary = mimeBoundary();
  const lines: string[] = [];
  for (const part of parts) lines.push(`--${boundary}`, ...part.headers, "", part.body);
  lines.push(`--${boundary}--`);
  return { headers: [`Content-Type: multipart/${subtype}; boundary="${boundary}"`], body: lines.join("\r\n") };
}

function textPart(subtype: "plain" | "html", value: string): MimePart {
  return { headers: [`Content-Type: text/${subtype}; charset=UTF-8`, "Content-Transfer-Encoding: base64"], body: base64Lines(value) };
}

function attachmentPart(attachment: OutgoingAttachment): MimePart {
  const filename = cleanHeader(attachment.filename).replace(/["\\]/g, "_") || "attachment";
  const encodedFilename = encodeURIComponent(filename);
  const mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(attachment.mimeType) ? attachment.mimeType : "application/octet-stream";
  return {
    headers: [
      `Content-Type: ${mimeType}; name*=UTF-8''${encodedFilename}`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename*=UTF-8''${encodedFilename}`,
    ],
    body: base64Lines(attachment.data),
  };
}

/**
 * Builds the message the way Gmail does: a plain-text and an HTML version of
 * the body (multipart/alternative) when there is formatting, wrapped in
 * multipart/mixed when there are attachments.
 */
function rawMessage(headers: Record<string, string>, content: { text: string; html?: string }, attachments: OutgoingAttachment[] = []) {
  const bodyPart = content.html
    ? multipart("alternative", [textPart("plain", content.text), textPart("html", content.html)])
    : textPart("plain", content.text);
  const root = attachments.length > 0 ? multipart("mixed", [bodyPart, ...attachments.map(attachmentPart)]) : bodyPart;
  const lines = Object.entries(headers)
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => `${name}: ${value}`);
  lines.push("MIME-Version: 1.0", ...root.headers, "", root.body);
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export const DRAFT_SOURCE_HEADER = "X-MailFlow-Source";
export const DRAFT_ACTION_HEADER = "X-MailFlow-Action";
const QUOTE_START = '<br><div class="gmail_quote">';
const BODY_OPEN = '<div dir="ltr">';

function bodyOf(part: gmail_v1.Schema$MessagePart | undefined, mimeType: string): string | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data && !part.filename) return decodeBody(part.body.data);
  for (const child of part.parts ?? []) {
    const body = bodyOf(child, mimeType);
    if (body) return body;
  }
  return null;
}

export type DraftContent = { action: "reply" | "replyAll" | "forward"; to: string; html: string; text: string; madeByMailFlow: boolean };

/**
 * Recovers what the user wrote from a saved draft, leaving out the quoted
 * original (it is added again when the draft is saved or sent).
 */
export function readDraftContent(message: gmail_v1.Schema$Message): DraftContent {
  const headers = headersOf(message);
  const marker = headers.get(DRAFT_ACTION_HEADER.toLowerCase()) ?? "";
  const madeByMailFlow = Boolean(headers.get(DRAFT_SOURCE_HEADER.toLowerCase()));
  const action = marker === "reply" || marker === "replyAll" || marker === "forward"
    ? marker
    : /^\s*fwd?:/i.test(headers.get("subject") ?? "") ? "forward" : headers.get("cc") ? "replyAll" : "reply";

  const plain = bodyOf(message.payload, "text/plain") ?? "";
  const text = plain.split(/\r?\n\r?\n(?=On [^\r\n]* wrote:|-{5,} ?Forwarded message ?-{5,})/)[0].trim();

  let html = bodyOf(message.payload, "text/html") ?? "";
  if (html) {
    const ownQuote = html.indexOf(QUOTE_START);
    const anyQuote = html.search(/<div class="gmail_quote/i);
    if (madeByMailFlow && ownQuote >= 0 && html.startsWith(BODY_OPEN)) {
      // MailFlow wrote this wrapper itself, so it can be removed exactly.
      html = html.slice(BODY_OPEN.length, ownQuote).replace(/<\/div>$/, "");
    } else if (anyQuote >= 0) {
      html = html.slice(0, anyQuote).replace(/(?:<br\s*\/?>\s*)+$/i, "");
    }
    html = sanitizeComposedHtml(html);
  } else {
    html = textToHtml(text);
  }
  return { action, to: action === "forward" ? cleanHeader(headers.get("to") ?? "") : "", html, text: text || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), madeByMailFlow };
}

export type OutgoingInput = { action?: string; to?: string; body?: string; html?: string; draftId?: string };
type OutgoingFailure = { error: string; status: number };

/** Reads either request format: JSON (plain text) or form data (formatting and files). */
export async function readOutgoingRequest(request: Request): Promise<{ input: OutgoingInput; uploads: OutgoingAttachment[] } | OutgoingFailure> {
  const input: OutgoingInput = {};
  const uploads: OutgoingAttachment[] = [];
  if ((request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    if (!form) return { error: "invalid_message", status: 400 };
    for (const key of ["action", "to", "body", "html", "draftId"] as const) {
      const value = form.get(key);
      if (typeof value === "string") input[key] = value;
    }
    let totalBytes = 0;
    for (const entry of form.getAll("files")) {
      if (typeof entry === "string") continue;
      totalBytes += entry.size;
      if (totalBytes > MAX_ATTACHMENT_BYTES) return { error: "attachments_too_large", status: 413 };
      uploads.push({ filename: entry.name || "attachment", mimeType: entry.type || "application/octet-stream", data: Buffer.from(await entry.arrayBuffer()) });
    }
  } else {
    Object.assign(input, await request.json().catch(() => ({})));
  }
  return { input, uploads };
}

/**
 * Builds the reply, reply-all, or forward for the message `id`.
 * A draft may still be missing its forward recipient; a message being sent may not.
 */
export async function buildOutgoingMessage(
  gmail: gmail_v1.Gmail,
  id: string,
  input: OutgoingInput,
  uploads: OutgoingAttachment[],
  options: { draft?: boolean } = {},
): Promise<{ raw: string; threadId?: string } | OutgoingFailure> {
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const composedHtml = typeof input.html === "string" && input.html.trim() ? sanitizeComposedHtml(input.html) : "";
  if (!body || (input.action !== "reply" && input.action !== "replyAll" && input.action !== "forward")) {
    return { error: "invalid_message", status: 400 };
  }

  const original = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  const originalHeaders = headersOf(original.data);
  const subject = originalHeaders.get("subject") ?? "(no subject)";
  const from = originalHeaders.get("from") ?? "";
  const date = originalHeaders.get("date") ?? "";
  const messageId = cleanHeader(originalHeaders.get("message-id") ?? "");
  const references = cleanHeader(originalHeaders.get("references") ?? "");
  const originalText = plainBody(original.data.payload) ?? original.data.snippet ?? "";
  const threadId = original.data.threadId ?? undefined;
  // Drafts remember which message they answer and how, so MailFlow can reopen
  // them in the composer. Sent mail is rebuilt without these headers.
  const draftMarkers: Record<string, string> = options.draft
    ? { [DRAFT_SOURCE_HEADER]: cleanHeader(id), [DRAFT_ACTION_HEADER]: input.action }
    : {};

  if (input.action === "reply" || input.action === "replyAll") {
    const to = emailAddress(originalHeaders.get("reply-to") || from);
    if (!to) return { error: "reply_address_missing", status: 400 };
    let cc = "";
    if (input.action === "replyAll") {
      const me = ((await gmail.users.getProfile({ userId: "me" })).data.emailAddress ?? "").toLowerCase();
      const others = forwardAddresses(`${originalHeaders.get("to") ?? ""},${originalHeaders.get("cc") ?? ""}`)
        .split(", ")
        .filter((address) => address && address.toLowerCase() !== me && address.toLowerCase() !== to.toLowerCase());
      cc = [...new Set(others)].join(", ");
    }
    const raw = rawMessage({
      ...draftMarkers,
      To: to,
      Cc: cc,
      Subject: encodedHeader(prefixedSubject(subject, "Re:")),
      "In-Reply-To": messageId,
      References: cleanHeader(`${references} ${messageId}`),
    }, {
      text: `${body}\r\n\r\nOn ${date}, ${cleanHeader(from)} wrote:\r\n${quote(originalText)}`,
      html: composedHtml
        ? `<div dir="ltr">${composedHtml}</div><br><div class="gmail_quote"><div dir="ltr">On ${escapeHtml(date)}, ${escapeHtml(cleanHeader(from))} wrote:<br></div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${textToHtml(originalText)}</blockquote></div>`
        : undefined,
    }, uploads);
    return { raw, threadId };
  }

  const to = forwardAddresses(input.to ?? "");
  if (!to && !options.draft) return { error: "forward_address_missing", status: 400 };
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
    ...draftMarkers,
    To: to,
    Subject: encodedHeader(prefixedSubject(subject, "Fwd:")),
  }, {
    text: `${body}\r\n\r\n---------- Forwarded message ---------\r\nFrom: ${cleanHeader(from)}\r\nDate: ${cleanHeader(date)}\r\nSubject: ${cleanHeader(subject)}\r\n\r\n${originalText}`,
    html: composedHtml
      ? `<div dir="ltr">${composedHtml}</div><br><div class="gmail_quote"><div dir="ltr">---------- Forwarded message ---------<br>From: ${escapeHtml(cleanHeader(from))}<br>Date: ${escapeHtml(cleanHeader(date))}<br>Subject: ${escapeHtml(cleanHeader(subject))}<br><br></div>${textToHtml(originalText)}</div>`
      : undefined,
  }, [...attachments, ...uploads]);
  // A forward starts a new conversation, so it is not tied to the original thread.
  return { raw };
}
