// OSS Fidelity's GitHub proxy (Cloudflare Worker).
//
// Visitors' browsers can make about 60 GitHub requests an hour per network, which a room on
// shared Wi-Fi uses up in a few live checks. This Worker answers the same read-only requests
// with a GitHub App's token (5,000 an hour) and caches the answers, so repeat checks are free.
//
// What it will do: GET the public repository endpoints the site's collector uses, repo-scoped
// issue search, repository search, and POST the one GraphQL query in assets/js/lib/queries.js.
// What it won't do: anything else. It writes no logs and sets no cookies.
//
// Settings (see proxy/README.md):
//   GITHUB_APP_CLIENT_ID     the App's client ID (a plain variable)
//   GITHUB_APP_PRIVATE_KEY   the App's private key, pasted as downloaded (a secret)
//   GITHUB_APP_INSTALLATION_ID  optional; found automatically when there is one installation
//   ALLOWED_ORIGINS          comma-separated site addresses allowed to call the proxy
//   RATE_LIMITER             optional Cloudflare rate-limit binding (per visitor)

import { ALLOWED_QUERIES } from "../assets/js/lib/queries.js";

const GITHUB = "https://api.github.com";
const FRESH_SECONDS = 3600; // serve a cached answer for an hour, then revalidate it with its ETag
const MISS_SECONDS = 600;   // remember "not found" for 10 minutes
const MEMORY_BYTES = 32 * 1024 * 1024; // in-memory cache budget per Worker instance (limit is ~128 MB)
const PER_VISITOR_PER_MINUTE = 600; // generous: a whole classroom can share one address
const SEARCHES_PER_VISITOR_PER_MINUTE = 20; // GitHub allows the App only 30 searches a minute in total

const OWNER = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})";
const REPO = "[A-Za-z0-9._-]{1,100}";
// Second-level endpoints the collector reads. Downloads (tarball, zipball) are deliberately absent.
const REPO_PATH = new RegExp(`^/repos/${OWNER}/${REPO}(?:/(?:contents|stats|commits|releases|tags|readme|license|community)(?:/[^?#]*)?)?$`);

// ---------------------------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request.headers.get("Origin"), env);
    if (!cors) return reply(403, { message: "This proxy only answers OSS Fidelity's own pages." });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (!(await allowVisitor(request, env, "all", PER_VISITOR_PER_MINUTE))) {
      return reply(429, { message: "Too many requests from your network. Try again in a minute." }, { ...cors, "Retry-After": "60" });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/{2,}/g, "/");
    try {
      if (request.method === "GET" && allowedGet(path, url.searchParams)) {
        return await cachedGet(`${GITHUB}${path}${url.search}`, request.headers.get("Accept"), env, ctx, cors, url.origin, request);
      }
      if (request.method === "POST" && path === "/graphql") {
        const body = await request.json().catch(() => null);
        if (!body || !ALLOWED_QUERIES.has(body.query) || !validVariables(body.variables)) {
          return reply(403, { message: "Only OSS Fidelity's own queries are forwarded." }, cors);
        }
        return await cachedGraphQL(body, env, ctx, cors, url.origin);
      }
      return reply(request.method === "GET" || request.method === "POST" ? 403 : 405, { message: "Not something this proxy forwards." }, cors);
    } catch (e) {
      return reply(502, { message: "The proxy couldn't reach GitHub." }, cors);
    }
  },
};

// ---------- what is allowed ----------

export function allowedGet(path, params) {
  if (REPO_PATH.test(path)) return true;
  const q = params.get("q") || "";
  if (path === "/search/issues") return new RegExp(`(^|\\s)repo:${OWNER}/${REPO}(\\s|$)`).test(q);
  if (path === "/search/repositories") return q.length > 0 && q.length <= 256;
  return false;
}

export function validVariables(v) {
  return !!v && typeof v === "object" && Object.keys(v).length === 2
    && new RegExp(`^${OWNER}$`).test(v.o || "") && new RegExp(`^${REPO}$`).test(v.r || "");
}

export function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, X-GitHub-Api-Version",
    "Access-Control-Expose-Headers": "Link, ETag, Retry-After, X-RateLimit-Remaining, X-RateLimit-Reset",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// Per-visitor limits. The overall limit uses Cloudflare's rate-limit binding when configured
// (recommended: it holds across Worker instances); otherwise, and for searches, a simple counter
// inside this instance. The address is only used as a counter key, never stored or logged.
// The Origin check stops other websites, not scripts, so these limits are what protect the budget.
// If it's used up anyway, the site falls back to GitHub directly (see assets/js/lib/http.js).
const visitors = new Map();
async function allowVisitor(request, env, bucket, limit) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (bucket === "all" && env.RATE_LIMITER) return (await env.RATE_LIMITER.limit({ key: ip })).success;
  const key = `${bucket}:${ip}`;
  const minute = Math.floor(Date.now() / 60000);
  const v = visitors.get(key);
  if (!v || v.minute !== minute) {
    if (visitors.size > 20000) visitors.clear();
    visitors.set(key, { minute, n: 1 });
    return true;
  }
  return ++v.n <= limit;
}

// ---------- caching ----------
// Two layers: Cloudflare's shared cache (works when the Worker has a custom domain) and a small
// in-memory cache (works everywhere, per instance). Stale entries are revalidated with their
// ETag; GitHub doesn't count a 304 answer against the rate limit.

const memory = new Map();
let memoryBytes = 0;
function remember(key, entry) {
  const old = memory.get(key);
  if (old) { memoryBytes -= old.body.length; memory.delete(key); }
  memory.set(key, entry);
  memoryBytes += entry.body.length;
  for (const [k, e] of memory) { // oldest first
    if (memoryBytes <= MEMORY_BYTES) break;
    memory.delete(k);
    memoryBytes -= e.body.length;
  }
}

async function cachedGet(upstream, accept, env, ctx, cors, origin, request) {
  const acceptHeader = accept && /^application\/vnd\.github[\w.+-]*$/.test(accept) ? accept : "application/vnd.github+json";
  const key = `${upstream}#${acceptHeader}`;
  const hit = await lookup(key, origin);
  if (hit && hit.expires > Date.now()) return toResponse(hit, cors);
  // Searches have their own small budget at GitHub, so uncached ones get a tighter limit here.
  if (/^https:\/\/api\.github\.com\/search\//.test(upstream) && !(await allowVisitor(request, env, "search", SEARCHES_PER_VISITOR_PER_MINUTE))) {
    if (hit) return toResponse(hit, cors);
    return reply(429, { message: "Too many searches from your network. Try again in a minute." }, { ...cors, "Retry-After": "60" });
  }

  const headers = { Accept: acceptHeader, "X-GitHub-Api-Version": "2022-11-28", Authorization: `Bearer ${await installationToken(env)}`, "User-Agent": "ossfidelity-proxy" };
  if (hit?.etag) headers["If-None-Match"] = hit.etag;
  const res = await fetch(upstream, { headers });
  if (res.status === 304 && hit) {
    const renewed = { ...hit, expires: Date.now() + FRESH_SECONDS * 1000 };
    store(key, renewed, ctx, origin);
    return toResponse(renewed, cors);
  }
  if (hit && (res.status >= 500 || res.status === 403 || res.status === 429)) return toResponse(hit, cors); // stale beats an error
  const entry = await toEntry(res);
  if (res.status === 200 || res.status === 404) store(key, entry, ctx, origin); // 202 = still computing: don't keep
  return toResponse(entry, cors);
}

async function cachedGraphQL(body, env, ctx, cors, origin) {
  const key = `${GITHUB}/graphql#${body.variables.o.toLowerCase()}/${body.variables.r.toLowerCase()}#${await digest(body.query)}`;
  const hit = await lookup(key, origin);
  if (hit && hit.expires > Date.now()) return toResponse(hit, cors);
  const res = await fetch(`${GITHUB}/graphql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await installationToken(env)}`, "Content-Type": "application/json", "User-Agent": "ossfidelity-proxy" },
    body: JSON.stringify({ query: body.query, variables: body.variables }),
  });
  if (hit && res.status !== 200) return toResponse(hit, cors);
  const entry = await toEntry(res);
  if (res.status === 200 && !/"errors"\s*:/.test(entry.body)) store(key, entry, ctx, origin);
  return toResponse(entry, cors);
}

const KEPT_HEADERS = ["content-type", "etag", "link", "retry-after", "x-ratelimit-remaining", "x-ratelimit-reset"];
async function toEntry(res) {
  const headers = {};
  for (const h of KEPT_HEADERS) { const v = res.headers.get(h); if (v) headers[h] = v; }
  const ttl = res.status === 404 ? MISS_SECONDS : FRESH_SECONDS;
  return { status: res.status, headers, body: await res.text(), etag: res.headers.get("etag"), expires: Date.now() + ttl * 1000 };
}

function toResponse(entry, cors) {
  return new Response(entry.body, { status: entry.status, headers: { ...entry.headers, ...cors, "Cache-Control": "private, max-age=300" } });
}

async function lookup(key, origin) {
  const m = memory.get(key);
  if (m) return m;
  try {
    const res = await caches.default.match(cacheUrl(key, origin));
    if (!res) return null;
    const entry = await res.json();
    remember(key, entry);
    return entry;
  } catch { return null; }
}

function store(key, entry, ctx, origin) {
  remember(key, entry);
  try {
    // Kept for a day, so an expired entry can still be revalidated cheaply with its ETag.
    const res = new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=86400" } });
    ctx?.waitUntil?.(caches.default.put(cacheUrl(key, origin), res));
  } catch { /* no shared cache here (e.g. a workers.dev address); memory still works */ }
}

const cacheUrl = (key, origin) => `${origin}/__cache/${encodeURIComponent(key)}`;

async function digest(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- GitHub App authentication ----------
// A short-lived JWT signed with the App's key buys an installation token that lasts an hour.

let token = null; // { value, expires }
let installationId = null;

export async function installationToken(env, fetcher = fetch) {
  if (token && token.expires - Date.now() > 5 * 60000) return token.value;
  const jwt = await appJwt(env);
  const headers = { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "User-Agent": "ossfidelity-proxy" };
  installationId ??= env.GITHUB_APP_INSTALLATION_ID || null;
  if (!installationId) {
    const list = await (await fetcher(`${GITHUB}/app/installations`, { headers })).json();
    if (!Array.isArray(list) || !list.length) throw new Error("The GitHub App isn't installed anywhere yet.");
    installationId = list[0].id;
  }
  const res = await fetcher(`${GITHUB}/app/installations/${installationId}/access_tokens`, { method: "POST", headers });
  if (!res.ok) throw new Error(`GitHub refused an installation token (HTTP ${res.status}).`);
  const j = await res.json();
  token = { value: j.token, expires: Date.parse(j.expires_at) };
  return token.value;
}

export async function appJwt(env, now = Math.floor(Date.now() / 1000)) {
  const enc = (obj) => base64url(new TextEncoder().encode(JSON.stringify(obj)));
  // iat 60 s in the past for clock drift; exp within GitHub's 10-minute maximum.
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_CLIENT_ID })}`;
  const key = await crypto.subtle.importKey("pkcs8", pkcs8Der(env.GITHUB_APP_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(sig))}`;
}

// GitHub hands out keys as PKCS#1 ("BEGIN RSA PRIVATE KEY"); Web Crypto only reads PKCS#8.
// Wrapping PKCS#1 in a PKCS#8 envelope is a fixed header plus two lengths, so do it here
// rather than asking for an openssl step.
export function pkcs8Der(pem) {
  const text = String(pem || "").replace(/\\n/g, "\n");
  const pkcs1 = /BEGIN RSA PRIVATE KEY/.test(text);
  const der = Uint8Array.from(atob(text.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  if (!pkcs1) return der;
  const rsaAlgorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const body = [0x02, 0x01, 0x00, ...rsaAlgorithm, 0x04, ...derLength(der.length), ...der];
  return Uint8Array.from([0x30, ...derLength(body.length), ...body]);
}

function derLength(n) {
  if (n < 0x80) return [n];
  const bytes = [];
  for (let x = n; x > 0; x >>= 8) bytes.unshift(x & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function reply(status, json, headers = {}) {
  return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json", ...headers } });
}
