// Prompt construction for AI-generated reply drafts. Kept free of I/O so it
// can be unit-tested without network access.

export const REPLY_TONES = ["professional", "friendly", "concise", "formal"] as const;
export const REPLY_LENGTHS = ["short", "medium", "long"] as const;
export type ReplyTone = (typeof REPLY_TONES)[number];
export type ReplyLength = (typeof REPLY_LENGTHS)[number];

export type ReplyDraftOptions = {
  tone: ReplyTone;
  length: ReplyLength;
  /** Optional free-form guidance from the user, e.g. "accept the meeting but ask to move it to Friday". */
  instructions?: string;
};

export type ReplyDraftContext = {
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
  /** Email address of the person replying, if known. */
  me?: string;
  /** Display name of the person replying (used for the sign-off), if known. */
  meName?: string;
};

/** Finds the display name that goes with `address` in a To/Cc header such as `"Alex Kim" <alex@x.com>, Bob <bob@y.com>`. */
export function displayNameFor(header: string, address: string) {
  if (!address) return undefined;
  const wanted = address.trim().toLowerCase();
  for (const entry of header.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
    const match = entry.trim().match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
    if (match && match[2].trim().toLowerCase() === wanted) {
      const name = match[1].trim();
      return name && !name.includes("@") ? name : undefined;
    }
  }
  return undefined;
}

/** First name of a sender header like `Jason Park <jason@x.com>`; falls back to the mailbox local part. */
export function senderFirstName(from: string) {
  const name = from.match(/^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/)?.[1]?.trim() || from.replace(/<.*/, "").trim();
  if (name && !name.includes("@")) return name.split(/\s+/)[0];
  return from.match(/([^<\s@]+)@/)?.[1] ?? "";
}

const MAX_BODY_CHARS = 6000;

export function isReplyTone(value: unknown): value is ReplyTone {
  return REPLY_TONES.includes(value as ReplyTone);
}

export function isReplyLength(value: unknown): value is ReplyLength {
  return REPLY_LENGTHS.includes(value as ReplyLength);
}

export function parseReplyDraftOptions(input: unknown): ReplyDraftOptions | null {
  const record = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const tone = record.tone ?? "professional";
  const length = record.length ?? "medium";
  if (!isReplyTone(tone) || !isReplyLength(length)) return null;
  const instructions = typeof record.instructions === "string" ? record.instructions.trim().slice(0, 500) : "";
  return { tone, length, instructions: instructions || undefined };
}

/** Converts an email body (HTML or plain text) into readable plain text for the prompt. */
export function emailBodyToText(body: string) {
  const text = /<[a-z][\s\S]*>/i.test(body)
    ? body
        .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|table|ul|ol)>/gi, "\n\n")
        .replace(/<\/(td|th)>/gi, " ")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
    : body;
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const toneGuide: Record<ReplyTone, string> = {
  professional: "professional and courteous, like a thoughtful colleague",
  friendly: "warm and friendly, conversational but still respectful",
  concise: "direct and to the point, no filler",
  formal: "formal and polished, suitable for official or external correspondence",
};

const lengthGuide: Record<ReplyLength, string> = {
  short: "2-3 sentences",
  medium: "one or two short paragraphs (roughly 4-8 sentences)",
  long: "several paragraphs that address every point raised",
};

export function buildReplyPrompt(context: ReplyDraftContext, options: ReplyDraftOptions) {
  const body = emailBodyToText(context.body);
  const truncated = body.length > MAX_BODY_CHARS;
  const firstName = senderFirstName(context.from);
  const lines = [
    "You are drafting an email reply that the user will review, edit, and send as their own. Write it in the user's voice (first person).",
    "Output ONLY the reply body as plain text: no subject line, no quoted original, no markdown, no explanations, no alternatives.",
    "Write in the same language as the original email (Korean email -> Korean reply, with appropriate honorifics).",
    `Tone: ${toneGuide[options.tone]}.`,
    `Length: ${lengthGuide[options.length]}.`,
    "Address every question or request in the original directly. Be specific to its content; avoid generic filler such as \"I hope this email finds you well\".",
    "Never invent facts, dates, decisions, or attachments the user did not provide. If the original asks for something only the user can decide and no instruction covers it, acknowledge it and say you will follow up, rather than guessing.",
    "Never use placeholders like [Your Name], [Date], or <insert ...>.",
    firstName
      ? `Start with a short greeting to ${firstName} (e.g. "Hi ${firstName},").`
      : "Start with a short greeting to the sender.",
    context.meName
      ? `End with a brief sign-off followed by the name "${context.meName.split(/\s+/)[0]}" on its own line.`
      : "End with a brief sign-off line such as \"Best,\" or \"Thanks,\" and nothing after it (the user will add their name).",
  ];
  if (context.me) lines.push(`The user's email address is ${context.me}.`);
  if (options.instructions) lines.push(`What the user wants this reply to say or do (follow this closely): ${options.instructions}`);
  lines.push(
    "",
    "Original email:",
    `From: ${context.from}`,
    `To: ${context.to}`,
    `Date: ${context.date}`,
    `Subject: ${context.subject}`,
    "",
    truncated ? `${body.slice(0, MAX_BODY_CHARS)}\n[... message truncated ...]` : body,
  );
  return lines.join("\n");
}

/** Strips wrappers a model sometimes adds (code fences, "Subject:" lines) from a generated draft. */
export function cleanDraft(text: string) {
  return text
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/, "")
    .replace(/^subject:.*\n+/i, "")
    .trim();
}
