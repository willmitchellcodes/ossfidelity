// Tiny fetch wrapper shared by the browser and Node (Node 18+ has fetch).

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RateLimitError extends Error {
  constructor(host, resetAt) {
    super(`Rate limit reached for ${host}` + (resetAt ? `; resets ${resetAt.toLocaleTimeString()}` : ""));
    this.name = "RateLimitError";
    this.host = host;
    this.resetAt = resetAt;
  }
}

/**
 * makeClient(base, { headers, minIntervalMs, waitOnLimit, onRequest, tries202, wait202Ms, fallbackBase })
 * Returns api(path, { raw, accept, method, body }) → JSON, a Response (raw), or null on 404.
 * GitHub answers 202 while it computes repository statistics; those are retried.
 * fallbackBase: if `base` (OSS Fidelity's proxy) can't be reached, GET requests switch to this
 * address for the rest of the run. POST requests (GraphQL) need the proxy's token, so they don't.
 */
export async function isSecondaryLimit(res) {
  try {
    const j = await res.clone().json();
    return /secondary rate limit|abuse detection/i.test(j?.message || "");
  } catch { return false; }
}

export function makeClient(base, opts = {}) {
  const { headers = {}, minIntervalMs = 0, waitOnLimit = false, onRequest = () => {}, tries202 = 6, wait202Ms = 1500, fallbackBase = null } = opts;
  let last = 0;
  let count = 0;
  let secondaryWaits = 0;
  let active = base;
  const PROXY_DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524, 530]);

  async function send(path, init, method) {
    const url = path.startsWith("http") ? path : active + path;
    try {
      const res = await fetch(url, init);
      const proxied = fallbackBase && active !== fallbackBase && method === "GET";
      // Proxy down, or out of budget (busy, or someone is overusing it): use GitHub directly instead,
      // which still gives each visitor their own 60 requests an hour.
      const outOfBudget = res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
      if (proxied && (PROXY_DOWN.has(res.status) || outOfBudget)) throw new TypeError("proxy unavailable");
      return res;
    } catch (e) {
      if (!(e instanceof TypeError) || !fallbackBase || active === fallbackBase || method !== "GET" || path.startsWith("http")) throw e;
      active = fallbackBase; // the proxy is down or blocked: go to GitHub directly from now on
      return fetch(fallbackBase + path, init);
    }
  }

  async function api(path, { raw = false, accept, method = "GET", body } = {}) {
    for (let attempt = 0; attempt < Math.max(6, tries202); attempt++) {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      count++;
      onRequest(path);
      const init = {
        method,
        headers: { ...headers, ...(accept ? { Accept: accept } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      };
      const res = await send(path, init, method);
      if (res.status === 202) { if (attempt + 1 >= tries202) return null; await sleep(wait202Ms * (attempt + 1)); continue; }
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers.get("x-ratelimit-remaining");
        const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000 || null;
        const retryAfter = Number(res.headers.get("retry-after")) * 1000 || null;
        if (remaining === "0" || res.status === 429 || retryAfter) {
          const until = retryAfter ? Date.now() + retryAfter : reset;
          if (waitOnLimit && until && until - Date.now() < 65 * 60000) { await sleep(until - Date.now() + 2000); continue; }
          throw new RateLimitError(new URL(res.url || active).host, until ? new Date(until) : null);
        }
        // GitHub's secondary limits (too much at once, or searches that cost it a lot of work) answer
        // 403 with a message and often no headers. Back off a minute, then two, then three.
        if (await isSecondaryLimit(res)) {
          if (waitOnLimit && secondaryWaits < 3) { secondaryWaits++; await sleep(60000 * secondaryWaits); continue; }
          throw new RateLimitError(new URL(res.url || active).host, new Date(Date.now() + 60000));
        }
      }
      if (res.status === 404 || res.status === 409) return null; // 409: empty repository
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      return raw ? res : res.json();
    }
    return null; // still computing after retries
  }
  api.count = () => count;
  api.secondaryWaits = () => secondaryWaits;
  api.base = () => active;
  return api;
}
