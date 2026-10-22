// Tiny fetch wrapper shared by the browser and Node (Node 18+ has fetch).

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RateLimitError extends Error {
  constructor(host, resetAt) {
    super(`Rate limit reached for ${host}` + (resetAt ? `; resets ${resetAt.toLocaleTimeString()}` : ""));
    this.name = "RateLimitError";
    this.resetAt = resetAt;
  }
}

/**
 * makeClient(base, { headers, minIntervalMs, waitOnLimit, onRequest })
 * Returns api(path, { raw, accept, allow404 }) → JSON, a Response (raw), or null on 404.
 * Retries a 202 (GitHub stats still computing) up to 5 times.
 */
export function makeClient(base, opts = {}) {
  // tries202 / wait202Ms: GitHub answers 202 while it computes repository statistics.
  const { headers = {}, minIntervalMs = 0, waitOnLimit = false, onRequest = () => {}, tries202 = 6, wait202Ms = 1500 } = opts;
  let last = 0;
  let count = 0;
  async function api(path, { raw = false, accept } = {}) {
    const url = path.startsWith("http") ? path : base + path;
    for (let attempt = 0; attempt < Math.max(6, tries202); attempt++) {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      count++;
      onRequest(url);
      const res = await fetch(url, { headers: { ...headers, ...(accept ? { Accept: accept } : {}) }, signal: AbortSignal.timeout(30000) });
      if (res.status === 202) { if (attempt + 1 >= tries202) return null; await sleep(wait202Ms * (attempt + 1)); continue; }
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get("x-ratelimit-remaining");
        const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000 || null;
        const retryAfter = Number(res.headers.get("retry-after")) * 1000 || null;
        if (remaining === "0" || res.status === 429 || retryAfter) {
          const until = retryAfter ? Date.now() + retryAfter : reset;
          if (waitOnLimit && until && until - Date.now() < 65 * 60000) { await sleep(until - Date.now() + 2000); continue; }
          throw new RateLimitError(new URL(url).host, until ? new Date(until) : null);
        }
      }
      if (res.status === 404 || res.status === 409) return null; // 409: empty repository
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return raw ? res : res.json();
    }
    return null; // still computing after retries
  }
  api.count = () => count;
  return api;
}
