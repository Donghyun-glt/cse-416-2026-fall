import { type NextRequest, NextResponse } from "next/server";
import type { gmail_v1 } from "googleapis";
import { google } from "googleapis";
import { createGoogleOAuthClient } from "@/lib/google";
import { attachGmailSessionToUser, getGmailSession } from "@/lib/gmail-session";
import { GeminiError, generateText, geminiModel } from "@/lib/gemini";
import { getStoredReplyDraft, saveReplyDraft, upsertUser } from "@/lib/mailflow-db";
import { buildReplyPrompt, cleanDraft, displayNameFor, parseReplyDraftOptions } from "@/lib/reply-draft";

function headersOf(message: gmail_v1.Schema$Message) {
  return new Map(
    (message.payload?.headers ?? []).map((header) => [
      header.name?.toLowerCase() ?? "",
      header.value ?? "",
    ]),
  );
}

function findBody(part: gmail_v1.Schema$MessagePart | undefined, mimeType: string): string | null {
  if (!part) return null;
  if (part.mimeType === mimeType && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const child of part.parts ?? []) {
    const body = findBody(child, mimeType);
    if (body) return body;
  }
  return null;
}

/**
 * POST /api/gmail/messages/[id]/reply-draft
 * Body: {
 *   tone?: "professional" | "friendly" | "concise" | "formal",
 *   length?: "short" | "medium" | "long",
 *   instructions?: string,
 *   regenerate?: boolean   // skip the cache and ask the model again
 * }
 * Returns: { draft: string, model: string, cached: boolean, generatedAt: string }
 *
 * Drafts are cached in reply_drafts per (user, message, tone, length,
 * instructions), so opening the same message again costs no LLM call.
 * Nothing is sent; sending still goes through /send after the user approves.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? await getGmailSession(sessionId) : undefined;
  if (!sessionId || !tokens) return NextResponse.json({ connected: false }, { status: 401 });

  const input = await request.json().catch(() => ({})) as { regenerate?: unknown };
  const options = parseReplyDraftOptions(input);
  if (!options) return NextResponse.json({ error: "invalid_options" }, { status: 400 });
  const regenerate = input.regenerate === true;
  const instructions = options.instructions ?? "";

  const { id } = await params;
  const oauth2Client = createGoogleOAuthClient();
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  let userId: number;
  let myEmail: string;
  try {
    const profile = await gmail.users.getProfile({ userId: "me" });
    myEmail = profile.data.emailAddress ?? "";
    userId = await upsertUser(myEmail);
    await attachGmailSessionToUser(sessionId, userId);
  } catch (error) {
    console.error("Reply draft: could not resolve user", error);
    return NextResponse.json({ error: "gmail_fetch_failed" }, { status: 502 });
  }

  const cacheKey = { userId, gmailMessageId: id, tone: options.tone, length: options.length, instructions };
  if (!regenerate) {
    const stored = await getStoredReplyDraft(cacheKey).catch((error) => {
      console.error("Reply draft cache read failed", error);
      return null;
    });
    if (stored) return NextResponse.json({ draft: stored.draft, model: stored.model, cached: true, generatedAt: stored.generatedAt });
  }

  let prompt: string;
  try {
    const original = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const headers = headersOf(original.data);
    const body = findBody(original.data.payload, "text/plain")
      ?? findBody(original.data.payload, "text/html")
      ?? original.data.snippet
      ?? "";
    prompt = buildReplyPrompt({
      subject: headers.get("subject") ?? "(no subject)",
      from: headers.get("from") ?? "",
      to: headers.get("to") ?? "",
      date: headers.get("date") ?? "",
      body,
      me: myEmail || undefined,
      meName: displayNameFor(`${headers.get("to") ?? ""},${headers.get("cc") ?? ""}`, myEmail),
    }, options);
  } catch (error) {
    console.error("Gmail fetch for reply draft failed", error);
    return NextResponse.json({ error: "gmail_fetch_failed" }, { status: 502 });
  }

  try {
    const draft = cleanDraft(await generateText(prompt, { signal: AbortSignal.timeout(30_000) }));
    const model = geminiModel();
    await saveReplyDraft({ ...cacheKey, draft, model }).catch((error) => {
      console.error("Reply draft cache write failed", error);
    });
    return NextResponse.json({ draft, model, cached: false, generatedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof GeminiError) {
      console.error("Gemini reply draft failed", error.code, error.message);
      const status = error.code === "rate_limited" ? 429 : error.code === "not_configured" ? 503 : 502;
      return NextResponse.json({ error: `ai_${error.code}`, detail: `${error.message} (model: ${geminiModel()})` }, { status });
    }
    console.error("Gemini reply draft failed", error);
    return NextResponse.json({ error: "ai_request_failed" }, { status: 502 });
  }
}
