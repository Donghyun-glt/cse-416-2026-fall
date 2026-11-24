import { type NextRequest, NextResponse } from "next/server";
import { getGmailSession } from "@/lib/gmail-session";
import { GeminiError, generateText, geminiModel } from "@/lib/gemini";
import { buildComposePrompt, composeDraftSchema, parseComposeDraftRequest, parseComposeDraftResponse } from "@/lib/compose-draft";

/**
 * POST /api/gmail/compose/ai-draft
 * Body: { instructions: string, tone?, length?, to?, subject?, currentBody?, senderName? }
 *   tone: "professional" | "friendly" | "concise" | "formal"; length: "short" | "medium" | "long".
 *   With currentBody the model revises that text instead of starting over.
 * Returns: { subject: string, body: string, model: string }
 *
 * Only writes text for the Compose window. Nothing is saved or sent here: the draft
 * appears in the editor for the user to review, and sending is still their own click.
 */
export async function POST(request: NextRequest) {
  const sessionId = request.cookies.get("gmail_session")?.value;
  const tokens = sessionId ? await getGmailSession(sessionId) : undefined;
  if (!sessionId || !tokens) return NextResponse.json({ connected: false }, { status: 401 });

  const draftRequest = parseComposeDraftRequest(await request.json().catch(() => null));
  if (!draftRequest) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  try {
    const raw = await generateText(buildComposePrompt(draftRequest), {
      temperature: 0.6,
      maxOutputTokens: 2048,
      responseJsonSchema: composeDraftSchema,
      // 30 s in all; one attempt may use 20 s so a request Gemini holds while overloaded can be retried.
      signal: AbortSignal.timeout(30_000),
      attemptTimeoutMs: 20_000,
    });
    const draft = parseComposeDraftResponse(raw);
    if (!draft) return NextResponse.json({ error: "ai_empty_response" }, { status: 502 });
    return NextResponse.json({ ...draft, model: geminiModel() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof GeminiError) {
      console.error("Gemini compose draft failed", error.code, error.status, error.message);
      if (error.code === "rate_limited") return NextResponse.json({ error: "ai_rate_limited" }, { status: 429, headers: { "Retry-After": "15" } });
      if (error.code === "not_configured") return NextResponse.json({ error: "ai_not_configured" }, { status: 503 });
      if (error.retryable) return NextResponse.json({ error: "ai_unavailable" }, { status: 503, headers: { "Retry-After": "5" } });
      return NextResponse.json({ error: "ai_request_failed" }, { status: 502 });
    }
    console.error("Compose AI draft failed", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return NextResponse.json({ error: "ai_request_failed" }, { status: 502 });
  }
}
