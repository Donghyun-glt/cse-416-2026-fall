// Minimal Gemini API client. Uses the REST endpoint directly so no extra
// dependency is needed; the free tier of gemini-2.5-flash-lite is enough for
// development and testing (see .env.example for GEMINI_API_KEY).

const DEFAULT_MODEL = "gemini-2.5-flash-lite";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiErrorCode = "not_configured" | "rate_limited" | "request_failed" | "empty_response";

// No TS parameter properties here: the test runner loads .ts files with Node's
// strip-only type stripping, which rejects that syntax.
export class GeminiError extends Error {
  readonly status: number;
  readonly code: GeminiErrorCode;

  constructor(message: string, status: number, code: GeminiErrorCode) {
    super(message);
    this.name = "GeminiError";
    this.status = status;
    this.code = code;
  }
}

export function geminiModel() {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

type GenerateOptions = {
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
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

  const response = await fetch(`${API_BASE}/${geminiModel()}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxOutputTokens ?? 1024,
      },
    }),
    signal: options.signal,
  });

  const data = await response.json().catch(() => ({})) as GenerateContentResponse;
  if (response.status === 429) {
    throw new GeminiError("Gemini rate limit reached. Try again in a moment.", 429, "rate_limited");
  }
  if (!response.ok) {
    throw new GeminiError(data.error?.message ?? `Gemini request failed (${response.status}).`, response.status, "request_failed");
  }

  const text = (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("").trim();
  if (!text) throw new GeminiError("Gemini returned an empty response.", 502, "empty_response");
  return text;
}
