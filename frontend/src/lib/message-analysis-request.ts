// Browser side of POST /api/gmail/messages/[id]/calendar-suggestions, shared by the
// Daily Briefing cards, the Summary tab and the opened message's insights panel.
import { fetchWithRetry } from "./retry-fetch";

/**
 * Asks the server to analyse one message (or read back its stored analysis).
 * When the server answers with Retry-After (AI rate limit, or Gemini briefly
 * unavailable) it waits that long and asks again, up to three attempts in all.
 * Returns the last response; the caller reads its body.
 */
export function requestMessageAnalysis(messageId: string, signal?: AbortSignal): Promise<Response> {
  return fetchWithRetry(`/api/gmail/messages/${encodeURIComponent(messageId)}/calendar-suggestions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
    signal,
  }, { attempts: 3, maxWaitSeconds: 30 });
}
