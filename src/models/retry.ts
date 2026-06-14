// Retry with linear backoff. Retries network/429/5xx errors; rethrows other
// 4xx client errors immediately. AIML rate limits are undocumented, so all
// adapters wrap their calls with this.
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      if (typeof status === 'number' && status !== 429 && status < 500) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250 * (i + 1)));
    }
  }
  throw lastErr;
}
