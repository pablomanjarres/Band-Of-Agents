// Retry with exponential backoff + jitter. Retries network / 429 / 5xx errors;
// rethrows other 4xx client errors immediately. A fan-out review fires many model
// calls at once, so a Vertex 429 (RESOURCE_EXHAUSTED) needs real headroom: 429
// gets a larger base and more total wait than a transient 5xx, and the jitter
// keeps the concurrent callers from retrying in lockstep (which just re-bursts).
export async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const code = errStatus(err);
      // Non-retryable client errors (4xx other than 429) fail fast.
      if (typeof code === 'number' && code !== 429 && code < 500) throw err;
      if (i === attempts - 1) break;
      const base = code === 429 ? 1500 : 400;
      const delay = Math.min(base * 2 ** i, 16000) + Math.floor(Math.random() * 400);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}

// Normalize an error to its HTTP-ish status. The @google/genai SDK nests the code
// under .error.code (e.g. { error: { code: 429, status: 'RESOURCE_EXHAUSTED' } });
// other SDKs surface .status or .code as a number or a numeric string.
function errStatus(err: unknown): number | undefined {
  const e = err as { status?: unknown; code?: unknown; error?: { code?: unknown } } | null;
  for (const v of [e?.status, e?.code, e?.error?.code]) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim());
  }
  return undefined;
}
