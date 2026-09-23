import type { gmail_v1 } from "googleapis";

// Emails are rendered as-is, so the payload is much larger than a text
// conversion. Cap each message so a 10-message response stays reasonable.
const MAX_HTML_LENGTH = 200_000;

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

// Outlook/MSO conditional comments (e.g. `<!--[if !mso]><!-->...<!--<![endif]-->`)
// are sometimes left dangling in Gmail's extracted text, since they rely on
// quirky, non-standard comment parsing that a plain regex-based stripper like
// the one below doesn't fully close. Remove them explicitly before anything else.
function stripCommentArtifacts(value: string) {
  return value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!--\[if[^\]]*\]>/gi, "")
    .replace(/<!\[endif\]-->/gi, "")
    .replace(/<!-->/g, "");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
  reg: "®",
  trade: "™",
  // Zero-width/formatting entities used purely as filler (see
  // stripInvisibleChars below) - decode to nothing rather than a real char.
  shy: "",
  zwnj: "",
  zwj: "",
};

function decodeEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(
      /&([a-z]+);/gi,
      (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match,
    );
}

// Marketing newsletters commonly pad the inbox preview text with long runs of
// invisible/zero-width characters (soft hyphen, zero-width space/joiner, the
// combining grapheme joiner, BOM, word joiner) so only the intended preheader
// shows in the inbox list. In a text rendering they become stray glyphs.
const INVISIBLE_CHARS = /[­​‌‍⁠﻿͏]/g;

function stripInvisibleChars(value: string) {
  return value.replace(INVISIBLE_CHARS, "");
}

// Gmail's "text/plain" part is sometimes generated from the HTML template and
// can still contain leftover markup/comment artifacts. Only used when a
// message has no HTML part at all.
function cleanPlainText(text: string) {
  return stripInvisibleChars(
    decodeEntities(stripCommentArtifacts(text).replace(/<[^>]+>/g, "")),
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The body is rendered inside an iframe sandboxed without `allow-scripts`, so
// nothing here can execute. These removals are defense in depth, and they drop
// the tags that would otherwise pull in outside documents or override the
// wrapper document's own <base>.
function sanitizeEmailHtml(html: string) {
  return (
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<(iframe|object|embed|applet)[\s\S]*?<\/\1>/gi, "")
      .replace(/<title[\s\S]*?<\/title>/gi, "")
      .replace(/<\/?(script|iframe|object|embed|applet|base|meta|link|form)\b[^>]*>/gi, "")
      // Unwrap the message's own document shell so it nests cleanly in the
      // wrapper below. Only the tags go - the <style> rules inside <head> are
      // what make the message look like the original, so they stay.
      .replace(/<!doctype[^>]*>/gi, "")
      .replace(/<\/?(html|head|body)\b[^>]*>/gi, "")
      .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/javascript:/gi, "blocked:")
  );
}

// A complete document for the iframe's srcdoc. The email keeps its own <style>
// rules (that is what makes it look like the original), so this only supplies
// the defaults Gmail also applies: a readable base font, constrained images so
// wide templates cannot blow out the column, and links opening in a new tab.
function buildEmailDocument(bodyHtml: string) {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base target="_blank">
<style>
  :root { color-scheme: light; }
  /* Transparent so the translucent card behind the iframe shows through.
     Messages that set their own bgcolor still paint it, as they do in Gmail. */
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      "Apple SD Gothic Neo", "Malgun Gothic", "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #202124;
    overflow-x: auto;
    word-break: break-word;
  }
  img { max-width: 100%; height: auto; border: 0; }
  a { color: #1a73e8; }
</style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

export function parseGmailMessage(message: gmail_v1.Schema$Message) {
  const headers = new Map(
    (message.payload?.headers ?? []).map((header) => [
      header.name?.toLowerCase() ?? "",
      header.value ?? "",
    ]),
  );

  // Prefer the HTML part: it is what Gmail itself renders, and what carries the
  // layout. The plain-text part is only a fallback for text-only messages, and
  // gets wrapped so every message renders through the same path.
  const htmlBody = findBodyByMimeType(message.payload, "text/html");
  const plainBody = findBodyByMimeType(message.payload, "text/plain");

  const content = htmlBody
    ? sanitizeEmailHtml(htmlBody).slice(0, MAX_HTML_LENGTH)
    : `<pre style="white-space: pre-wrap; font: inherit; margin: 0;">${escapeHtml(
        cleanPlainText(plainBody ?? message.snippet ?? ""),
      )}</pre>`;

  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    subject: headers.get("subject") || "(제목 없음)",
    from: headers.get("from") || "알 수 없는 발신자",
    date: headers.get("date") || "",
    snippet: message.snippet ?? "",
    html: buildEmailDocument(content),
  };
}
