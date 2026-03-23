/**
 * Retry with exponential backoff for GitLab / Discord API calls.
 * Respects Retry-After header on 429 responses.
 */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface RetryOptions {
  maxRetries?: number;    // default 3
  baseDelayMs?: number;   // default 800ms
}

/**
 * Wraps a fetch-style async call with retry logic.
 * Retries on 429 (rate limit) and 5xx errors; stops immediately on 4xx client errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay  = opts.baseDelayMs ?? 800;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries) break;

      const msg = String(err);

      // Hard client error (40x except 429) — don't retry
      if (/GitLab API 4[0-9]{2}/.test(msg) && !msg.includes("429")) break;

      // Respect Retry-After if embedded in error message
      const retryAfterMatch = /Retry-After:\s*(\d+)/i.exec(msg);
      const delay = retryAfterMatch
        ? parseInt(retryAfterMatch[1]!) * 1000
        : baseDelay * Math.pow(2, attempt);

      await sleep(Math.min(delay, 10_000)); // cap at 10s
    }
  }

  throw lastError;
}
