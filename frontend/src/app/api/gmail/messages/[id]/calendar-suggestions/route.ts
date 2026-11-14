import { type NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createHash } from "node:crypto";
import { createGoogleOAuthClient } from "@/lib/google";
import { attachGmailSessionToUser, getGmailSessionWithUser } from "@/lib/gmail-session";
import { parseGmailMessage } from "@/lib/gmail-message";
import { emailBodyToText } from "@/lib/reply-draft";
import { generateText, GeminiError, geminiModel } from "@/lib/gemini";
import { ANALYSIS_VERSION, analysisPrompt, analysisSchema, validateMailAnalysis, type AnalysisContext } from "@/lib/mail-analysis";
import { recordPriority, upsertUser } from "@/lib/mailflow-db";

// Small, short-lived, account-scoped cache. No email body or analysis is written
// to the database. Revalidate dates/urgency at each read, even for cached output.
const cache = new Map<string, { raw: unknown; expires: number }>();
const pending = new Map<string, Promise<unknown>>();
async function analyze(source: string, context: AnalysisContext, key: string) {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.raw;
  if (pending.has(key)) return pending.get(key)!;
  const work = (async () => {
    const response = await generateText(analysisPrompt(source, context), { temperature: 0, maxOutputTokens: 6500, responseJsonSchema: analysisSchema, signal: AbortSignal.timeout(45000) });
    const raw: unknown = JSON.parse(response);
    validateMailAnalysis(raw, source, context); // Never cache malformed responses.
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { raw, expires: Date.now() + 10 * 60_000 });
    return raw;
  })();
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const session = sessionId ? await getGmailSessionWithUser(sessionId) : undefined;
  if (!session) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const { id } = await params;
  const options = await request.json().catch(() => ({})) as { timeZone?: unknown };
  let timeZone: string | undefined;
  if (typeof options.timeZone === "string" && options.timeZone.length < 100) {
    try { new Intl.DateTimeFormat("en", { timeZone: options.timeZone }); timeZone = options.timeZone; } catch { /* Reference dates fall back to UTC with a review warning. */ }
  }
  try {
    const auth = createGoogleOAuthClient(); auth.setCredentials(session.tokens);
    const gmail = google.gmail({ version: "v1", auth });
    const original = (await gmail.users.messages.get({ userId: "me", id, format: "full" })).data;
    if (original.labelIds?.some((label) => ["SPAM", "TRASH", "SENT", "DRAFT"].includes(label))) return NextResponse.json({ candidates: [], note: "This message is not eligible for automatic content analysis." });
    let superseded = false;
    if (original.threadId) {
      const thread = (await gmail.users.threads.get({ userId: "me", id: original.threadId, format: "metadata", metadataHeaders: ["Date"] })).data;
      const latest = thread.messages?.filter((message) => !message.labelIds?.includes("DRAFT")).sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0)).at(-1);
      superseded = Boolean(latest && latest.id !== id);
    }
    const mail = parseGmailMessage(original);
    // Preserve tables, preparation sections, and forwarded context. The model
    // must distinguish the latest instructions from quoted historical material.
    const body = emailBodyToText(mail.html);
    const fullSource = `${mail.subject}\n\n${body}`;
    const source = fullSource.slice(0, 40000);
    const profile = (await gmail.users.getProfile({ userId: "me" })).data;
    const recipient = profile.emailAddress ?? "";
    const sentAt = Number.isFinite(Date.parse(mail.date)) ? mail.date : new Date(Number(original.internalDate)).toISOString();
    const context: AnalysisContext = { sentAt, now: new Date().toISOString(), recipient, from: mail.from, to: mail.to, cc: mail.cc, timeZone, superseded, truncated: fullSource.length > source.length, automated: Boolean(mail.unsubscribeUrl) || /no-?reply|notification/i.test(mail.from) };
    const key = createHash("sha256").update(JSON.stringify([ANALYSIS_VERSION, geminiModel(), recipient, id, source, sentAt, timeZone, superseded])).digest("hex");
    const raw = await analyze(source, context, key);
    const analysis = validateMailAnalysis(raw, source, context);
    // Classification failure/storage failure must not turn into a false "no event".
    // An automatic result can never overwrite a manual priority, including races.
    let priority = analysis.priority;
    let prioritySaved = false;
    try {
      const userId = session.userId ?? await upsertUser(recipient);
      if (session.userId === null && sessionId) await attachGmailSessionToUser(sessionId, userId);
      const storedReason = analysis.priority === "urgent" ? "Full-body analysis found a personal action with a near-term date or active blocker"
        : analysis.importance === "high" ? "Full-body analysis found a consequential personal action or important information"
        : analysis.importance === "low" ? "Full-body analysis found optional or unrelated content without a personal obligation"
        : "Full-body analysis found informational content or insufficient evidence for urgency";
      priority = await recordPriority({ userId, gmailMessageId: id, priority: analysis.priority, source: "automatic", reason: storedReason, signals: analysis.signals }) ?? analysis.priority;
      prioritySaved = true;
    } catch { console.error("Content analysis priority could not be saved"); }
    return NextResponse.json({ analysis, candidates: analysis.candidates, priority, prioritySaved, version: ANALYSIS_VERSION }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GeminiError) return NextResponse.json({ error: error.code }, { status: error.code === "rate_limited" ? 429 : 503 });
    console.error("Email content analysis failed");
    return NextResponse.json({ error: "analysis_failed" }, { status: 502 });
  }
}
