// Browser-side retry for requests the server may answer with Retry-After: the AI rate
// limit (429) or Gemini being briefly overloaded (503).

function wait(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

export type RetryOptions = {
  /** Attempts in all, the first one included. */
  attempts: number;
  /** Longest wait between attempts, whatever Retry-After asks for. */
  maxWaitSeconds: number;
  /** Called before each wait, with the number of the attempt about to be made. */
  onRetry?: (nextAttempt: number, waitSeconds: number) => void;
};

/**
 * fetch that tries again when the server answers with a Retry-After header, waiting that
 * long (capped) between attempts. Stops at once when `init.signal` is aborted.
 * Returns the last response; the caller reads its body. `init.body` must be reusable
 * (a string), since it is sent again.
 */
export async function fetchWithRetry(input: string, init: RequestInit, { attempts, maxWaitSeconds, onRetry }: RetryOptions): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(input, init);
    const retryAfter = Number(response.headers.get("Retry-After"));
    if (response.ok || attempt >= attempts || !(retryAfter > 0)) return response;
    await response.body?.cancel().catch(() => {});
    const seconds = Math.min(retryAfter, maxWaitSeconds);
    onRetry?.(attempt + 1, seconds);
    await wait(seconds * 1000, init.signal);
  }
}
