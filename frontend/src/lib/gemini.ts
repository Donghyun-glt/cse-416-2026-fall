// Minimal Gemini API client. Uses the REST endpoint directly so no extra
// dependency is needed; the free tier of gemini-3.5-flash-lite is enough for
// development and testing (see .env.example for GEMINI_API_KEY). Override with GEMINI_MODEL.

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiErrorCode = "not_configured" | "rate_limited" | "request_failed" | "empty_response";

// No TS parameter properties here: the test runner loads .ts files with Node's
// strip-only type stripping, which rejects that syntax.
export class GeminiError extends Error {
  readonly status: number;
  readonly code: GeminiErrorCode;
  /** True when the same request may well succeed a little later (Gemini overloaded, empty answer). */
  readonly retryable: boolean;

  constructor(message: string, status: number, code: GeminiErrorCode, retryable = false) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const RETRY_DELAY_MS = 1500;
// Finish reasons that mean the model will not answer this prompt at all, so asking again is pointless.
const REFUSED = new Set(["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"]);

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

export function geminiModel() {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

type GenerateOptions = {
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
  /**
   * Longest wait for one attempt. When Gemini is overloaded it can hold a request for
   * most of a minute before refusing it; ending that attempt early leaves time for the retry.
   */
  attemptTimeoutMs?: number;
  responseJsonSchema?: Record<string, unknown>;
};

type GenerateContentResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string };
};

export async function generateText(prompt: string, options: GenerateOptions = {}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "your-gemini-api-key") {
    throw new GeminiError("GEMINI_API_KEY is not configured.", 500, "not_configured");
  }

  // Gemini sometimes answers 500/503 ("overloaded"), hangs, or returns no text for a
  // request that works a moment later, so one quick retry hides most of those failures.
  // The caller's signal bounds both attempts together.
  try {
    return await attempt(apiKey, prompt, options);
  } catch (error) {
    if (!(error instanceof GeminiError) || !error.retryable || options.signal?.aborted) throw error;
    await wait(RETRY_DELAY_MS, options.signal).catch(() => { throw timedOut(); });
    return attempt(apiKey, prompt, options);
  }
}

function timedOut() {
  return new GeminiError("Gemini did not answer in time (it is probably overloaded).", 504, "request_failed", true);
}

/** One request, ended early by attemptTimeoutMs; running out of time counts as a temporary failure. */
async function attempt(apiKey: string, prompt: string, options: GenerateOptions): Promise<string> {
  const signals = [options.signal, options.attemptTimeoutMs ? AbortSignal.timeout(options.attemptTimeoutMs) : undefined].filter((signal): signal is AbortSignal => Boolean(signal));
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
  try {
    return await requestText(apiKey, prompt, { ...options, signal });
  } catch (error) {
    if (signal?.aborted && !(error instanceof GeminiError)) throw timedOut();
    throw error;
  }
}

async function requestText(apiKey: string, prompt: string, options: GenerateOptions): Promise<string> {
  const response = await fetch(`${API_BASE}/${geminiModel()}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxOutputTokens ?? 1024,
        ...(options.responseJsonSchema ? { responseMimeType: "application/json", responseJsonSchema: options.responseJsonSchema } : {}),
      },
    }),
    signal: options.signal,
  });

  const data = await response.json().catch(() => ({})) as GenerateContentResponse;
  if (response.status === 429) {
    throw new GeminiError("Gemini rate limit reached. Try again in a moment.", 429, "rate_limited");
  }
  if (!response.ok) {
    throw new GeminiError(data.error?.message ?? `Gemini request failed (${response.status}).`, response.status, "request_failed", response.status >= 500);
  }

  const candidate = data.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join("").trim();
  if (!text) {
    const reason = candidate?.finishReason ?? "none";
    throw new GeminiError(`Gemini returned an empty response (finish reason: ${reason}).`, 502, "empty_response", !REFUSED.has(reason));
  }
  return text;
}
