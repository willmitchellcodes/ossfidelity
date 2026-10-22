// Tests for the formula, the collectors' pure helpers, and the GitHub proxy. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { generateKeyPairSync, createVerify } from "node:crypto";

import { computeGrades } from "../assets/js/lib/formula.js";
import {
  detectLicenseText, scoreLicense, stableReleases, stableTags, codeReviewFromHistory, followThroughQueries,
} from "../assets/js/lib/util.js";
import { makeClient } from "../assets/js/lib/http.js";
import { CODE_REVIEW_QUERY } from "../assets/js/lib/queries.js";
import worker, { allowedGet, validVariables, corsHeaders, appJwt, pkcs8Der } from "../proxy/worker.js";

const weights = JSON.parse(await readFile(new URL("../_data/weights.json", import.meta.url), "utf8"));
const spdx = JSON.parse(await readFile(new URL("../assets/data/spdx.json", import.meta.url), "utf8")).licenses;

// A record with every signal at a chosen normalized level (uses each signal's own scale).
function record(overrides = {}, license = { kind: "open" }) {
  const raw = {
    bus_factor: 5, active_contributors: 25, backing: 1, license: 1, age: 5, history: 2000,
    recent_commits: 50, longest_gap: 0, follow_through: 1, release_freshness: 0, release_cadence: 6, docs: 1,
    release_integrity: 1, dependency_updates: 1, code_review: 1, security_policy: 1, ci: 1, best_practices: 1,
  };
  const signals = Object.fromEntries(Object.entries({ ...raw, ...overrides }).map(([k, v]) => [k, { value: v }]));
  return { signals, license, status: {} };
}

// ---------- formula ----------

test("a letter always matches the number shown", () => {
  // Security works out to 84.6, which shows as 85, so the letter must be A, not B.
  const g = computeGrades(record({ release_integrity: 0.5, best_practices: 0.5 }), weights).grades.security;
  assert.equal(g.score, 85);
  assert.equal(g.letter, "A");
});

test("no license caps Reliability at F; source-available at D; open is unaffected", () => {
  const none = computeGrades(record({ license: 0 }, { kind: "none" }), weights).grades.reliability;
  assert.ok(none.score <= 39 && none.letter === "F", `got ${none.score} ${none.letter}`);
  assert.ok(none.notes.some((n) => /No license/.test(n)));
  const sa = computeGrades(record({ license: 0.25 }, { kind: "source-available" }), weights).grades.reliability;
  assert.ok(sa.score <= 54 && sa.letter === "D", `got ${sa.score} ${sa.letter}`);
  const open = computeGrades(record(), weights).grades.reliability;
  assert.equal(open.score, 100);
});

test("archived still caps Maintenance at 0", () => {
  const r = record();
  r.status.archived = true;
  assert.equal(computeGrades(r, weights).grades.maintenance.score, 0);
});

test("adding a security practice never lowers Security", () => {
  for (const base of [{ security_policy: 0 }, { security_policy: 0, code_review: 0.2, ci: 0 }, { security_policy: 0, release_integrity: null }]) {
    const before = computeGrades(record(base), weights).grades.security.score;
    const after = computeGrades(record({ ...base, security_policy: 1 }), weights).grades.security.score;
    assert.ok(after >= before, `${before} → ${after}`);
  }
});

// ---------- licenses ----------

const ids = Object.keys(spdx);
const LICENSES = {
  // Joplin: names its license instead of including the text
  joplin: "All code in this repository is licensed under the AGPL-3.0-or-later License **unless a directory contains a LICENSE or LICENSE.md file**, in which case that file applies.",
  // KeePassXC: the short GNU notice with two versions
  keepassxc: "KeePassXC\n\nThis program is free software: you can redistribute it and/or modify\nit under the terms of the GNU General Public License as published by\nthe Free Software Foundation, either version 2 or (at your option)\nversion 3 of the License.",
  // The usual "or any later version" notice
  later: "This library is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation; either version 2.1 of the License, or (at your option) any later version.",
  // Redis: a choice of three licenses, each included in full (titles only here)
  redis: "Starting with Redis 8, contributions are subject to your choice of: (a) the Redis Source Available License v2 (RSALv2); or (b) the Server Side Public License v1 (SSPLv1); or (c) the GNU Affero General Public License v3 (AGPLv3).\n\n" + "x ".repeat(900) + "\n1. Redis Source Available License 2.0 (RSALv2) Agreement\n...\n2. Server Side Public License\nVERSION 1\n...\nGNU AFFERO GENERAL PUBLIC LICENSE, Version 3, 19 November 2007",
  // Terraform: BUSL
  busl: "License text copyright (c) 2020 MariaDB Corporation Ab. \"Business Source License\" is a trademark of MariaDB Corporation Ab.\nParameters\nLicensor: Example",
  // Bitwarden: says which parts are under which license, offers no choice
  bitwarden: "Source code in this repository is covered by one of two licenses: (i) the GNU General Public License (GPL) v3.0 (ii) the Bitwarden License v1.0. The default license throughout the repository is GPL v3.0 unless the header specifies another license.",
  mit: "MIT License\n\nCopyright (c) 2026 Someone\n\nPermission is hereby granted, free of charge, to any person obtaining a copy",
  header: "/* SPDX-License-Identifier: Apache-2.0 OR MIT */",
};

test("license detector recognizes short notices, SPDX names, and choices", () => {
  assert.equal(detectLicenseText(LICENSES.joplin, ids), "AGPL-3.0-or-later");
  assert.equal(detectLicenseText(LICENSES.keepassxc, ids), "GPL-2.0-only OR GPL-3.0-only");
  assert.equal(detectLicenseText(LICENSES.later, ids), "LGPL-2.1-or-later");
  assert.equal(detectLicenseText(LICENSES.redis, ids), "RSALv2 OR SSPL-1.0 OR AGPL-3.0-or-later");
  assert.equal(detectLicenseText(LICENSES.busl, ids), "BUSL-1.1");
  assert.equal(detectLicenseText(LICENSES.bitwarden, ids), null);
  assert.equal(detectLicenseText(LICENSES.mit, ids), "MIT");
  assert.equal(detectLicenseText(LICENSES.header, ids), "Apache-2.0 OR MIT");
});

test("a choice that includes an open license scores as open", () => {
  const r = scoreLicense("RSALv2 OR SSPL-1.0 OR AGPL-3.0-or-later", spdx);
  assert.equal(r.value, 1);
  assert.equal(r.kind, "open");
  assert.match(r.label, /one of 3 license options/);
  assert.equal(scoreLicense("GPL-2.0-only OR GPL-3.0-only", spdx).kind, "open");
  assert.equal(scoreLicense("BUSL-1.1", spdx).kind, "source-available");
});

// ---------- releases ----------

test("release candidates never stand in for a stable release", () => {
  const rels = [
    { tag_name: "v0.40.9-rc1", prerelease: true, published_at: "2026-10-22" },
    { tag_name: "v0.40.8", prerelease: false, published_at: "2026-10-15" },
    { tag_name: "v0.41.0", draft: true, published_at: "2026-10-23" },
  ];
  const s = stableReleases(rels);
  assert.equal(s.kind, "release");
  assert.deepEqual(s.list.map((r) => r.tag_name), ["v0.40.8"]);
  const only = stableReleases([{ tag_name: "v0.1.0-beta", prerelease: true }]);
  assert.equal(only.kind, "prerelease");
  assert.equal(only.list.length, 1);
});

test("prerelease tag names are recognized", () => {
  const names = (list) => stableTags(list.map((name) => ({ name }))).map((t) => t.name);
  assert.deepEqual(names(["v0.40.9-rc1", "33.0.0-rc3", "v7.1.0-beta.7", "v1.12.33-rc.0", "2.8.0", "llvmorg-23.1.4", "desktop-v2026.10.0"]), ["2.8.0", "llvmorg-23.1.4", "desktop-v2026.10.0"]);
  assert.deepEqual(names(["v1.0.0-rc1"]), ["v1.0.0-rc1"]); // nothing stable: keep what there is
});

// ---------- code review ----------

const commit = (author, pr) => ({ author: { name: author, user: { login: author } }, associatedPullRequests: { nodes: pr ? [pr] : [] } });
const pr = (author, { mergedBy, approvals = [], merged = true } = {}) => ({
  merged, author: { login: author, __typename: "User" },
  mergedBy: mergedBy && { login: mergedBy, __typename: /\[bot\]|queue/.test(mergedBy) ? "Bot" : "User" },
  reviews: { nodes: approvals.map((a) => ({ author: { login: a, __typename: /coderabbit|copilot/.test(a) ? "Bot" : "User" } })) },
});

test("code review follows Scorecard: direct pushes and bot reviewers don't count", () => {
  const r = codeReviewFromHistory([
    commit("ana", null),                                                        // pushed straight to main
    commit("ana", pr("ana", { mergedBy: "ana" })),                              // merged own PR, no review
    commit("ana", pr("ana", { mergedBy: "github-merge-queue[bot]" })),          // merge queue only
    commit("ana", pr("ana", { mergedBy: "ana", approvals: ["coderabbitai"] })), // AI approval only
    commit("ana", pr("ana", { mergedBy: "ana", approvals: ["bo"] })),           // a person approved
    commit("ana", pr("ana", { mergedBy: "bo" })),                               // a person merged
    commit("ana", pr("ana", { mergedBy: "github-merge-queue[bot]", approvals: ["bo"] })), // queue after approval
    commit("dependabot[bot]", pr("dependabot[bot]", { mergedBy: "ana" })),      // bot change: not counted
  ]);
  assert.deepEqual(r, { human: 7, reviewed: 3, direct: 1, bots: 1 });
});

test("the GraphQL query the proxy allows is the one the collector sends", () => {
  assert.ok(validVariables({ o: "llvm", r: "llvm-project" }));
  assert.ok(!validVariables({ o: "llvm", r: "x", extra: 1 }));
  assert.ok(!validVariables({ o: "bad owner", r: "x" }));
  assert.match(CODE_REVIEW_QUERY, /history\(first:30\)/);
});

test("follow-through leaves out bot pull requests and stale-bot closures", () => {
  const q = followThroughQueries("2025-10-22");
  for (const s of Object.values(q)) assert.match(s, /-author:app\/dependabot/);
  assert.match(q.issuesClosed, /-label:stale/);
  assert.doesNotMatch(q.issuesOpened, /label/);
});

// ---------- HTTP client: proxy fallback ----------

test("requests fall back to GitHub when the proxy can't be reached", async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    seen.push(url);
    if (url.startsWith("https://proxy.example")) throw new TypeError("network down");
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const api = makeClient("https://proxy.example", { fallbackBase: "https://api.github.com" });
    assert.deepEqual(await api("/repos/a/b"), { ok: true });
    assert.deepEqual(await api("/repos/a/b/tags"), { ok: true });
    assert.deepEqual(seen, ["https://proxy.example/repos/a/b", "https://api.github.com/repos/a/b", "https://api.github.com/repos/a/b/tags"]);
  } finally { globalThis.fetch = realFetch; }
});

// ---------- proxy ----------

test("proxy forwards only the site's read-only requests", () => {
  const ok = (p, q = "") => allowedGet(p, new URLSearchParams(q));
  assert.ok(ok("/repos/llvm/llvm-project"));
  assert.ok(ok("/repos/llvm/.github/contents"));
  assert.ok(ok("/repos/llvm/llvm-project/contents/LICENSE.TXT"));
  assert.ok(ok("/repos/llvm/llvm-project/stats/contributors"));
  assert.ok(ok("/search/issues", "q=repo:llvm/llvm-project is:issue"));
  assert.ok(ok("/search/repositories", "q=password manager"));
  assert.ok(!ok("/repos/llvm/llvm-project/tarball/main"));
  assert.ok(!ok("/repos/llvm/llvm-project/collaborators"));
  assert.ok(!ok("/user"));
  assert.ok(!ok("/search/issues", "q=is:issue author:someone"));
  assert.ok(!ok("/search/code", "q=password"));
});

test("proxy answers only the site's own origins", () => {
  const env = { ALLOWED_ORIGINS: "https://ossfidelity.com, https://willmitchellcodes.github.io" };
  assert.equal(corsHeaders("https://ossfidelity.com", env)["Access-Control-Allow-Origin"], "https://ossfidelity.com");
  assert.match(corsHeaders("https://ossfidelity.com", env)["Access-Control-Expose-Headers"], /Link/);
  assert.equal(corsHeaders("https://evil.example", env), null);
  assert.equal(corsHeaders(null, env), null);
});

test("proxy signs a valid GitHub App JWT from a key in GitHub's PKCS#1 format", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  assert.match(privateKey, /BEGIN RSA PRIVATE KEY/);
  const jwt = await appJwt({ GITHUB_APP_CLIENT_ID: "Iv23liTEST", GITHUB_APP_PRIVATE_KEY: privateKey }, 1_800_000_000);
  const [h, p, sig] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(p, "base64url"));
  assert.deepEqual(claims, { iat: 1_800_000_000 - 60, exp: 1_800_000_000 + 540, iss: "Iv23liTEST" });
  assert.equal(JSON.parse(Buffer.from(h, "base64url")).alg, "RS256");
  const v = createVerify("RSA-SHA256");
  v.update(`${h}.${p}`);
  assert.ok(v.verify(publicKey, Buffer.from(sig, "base64url")), "signature verifies with the App's public key");
  // A key pasted with literal "\n" sequences (as some secret stores do) still works.
  assert.ok(pkcs8Der(privateKey.replace(/\n/g, "\\n")).length > 1000);
});

test("proxy end to end: origin check, allowlist, auth, headers, cache", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const env = { ALLOWED_ORIGINS: "https://ossfidelity.com", GITHUB_APP_CLIENT_ID: "Iv23liTEST", GITHUB_APP_PRIVATE_KEY: privateKey, GITHUB_APP_INSTALLATION_ID: "42" };
  const calls = [];
  const realFetch = globalThis.fetch, realCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, auth: init.headers?.Authorization });
    if (url.endsWith("/app/installations/42/access_tokens")) return Response.json({ token: "ghs_test", expires_at: new Date(Date.now() + 3600e3).toISOString() }, { status: 201 });
    if (url.startsWith("https://api.github.com/repos/llvm/llvm-project")) return new Response("[]", { status: 200, headers: { "content-type": "application/json", link: '<https://api.github.com/x?page=9>; rel="last"', etag: '"abc"' } });
    if (url === "https://api.github.com/graphql") return Response.json({ data: { repository: null } });
    return new Response("not mocked", { status: 500 });
  };
  const req = (path, init = {}) => worker.fetch(new Request(`https://proxy.example${path}`, { ...init, headers: { Origin: "https://ossfidelity.com", ...(init.headers || {}) } }), env, { waitUntil() {} });
  try {
    assert.equal((await worker.fetch(new Request("https://proxy.example/repos/a/b", { headers: { Origin: "https://evil.example" } }), env, {})).status, 403);
    assert.equal((await req("/repos/a/b", { method: "OPTIONS" })).status, 204);
    assert.equal((await req("/user")).status, 403);
    assert.equal((await req("/graphql", { method: "POST", body: JSON.stringify({ query: "{ viewer { login } }", variables: { o: "a", r: "b" } }) })).status, 403);

    const res = await req("/repos/llvm/llvm-project/commits?per_page=1");
    assert.equal(res.status, 200);
    assert.match(res.headers.get("link"), /rel="last"/);
    assert.equal(res.headers.get("access-control-allow-origin"), "https://ossfidelity.com");
    const upstream = calls.find((c) => c.url.includes("/repos/llvm/llvm-project/commits"));
    assert.equal(upstream.auth, "Bearer ghs_test");

    const before = calls.length;
    await req("/repos/llvm/llvm-project/commits?per_page=1");
    assert.equal(calls.length, before, "second identical request is served from cache");

    const gql = await req("/graphql", { method: "POST", body: JSON.stringify({ query: CODE_REVIEW_QUERY, variables: { o: "llvm", r: "llvm-project" } }) });
    assert.equal(gql.status, 200);
  } finally { globalThis.fetch = realFetch; globalThis.caches = realCaches; }
});

// ---------- GraphQL against GitHub's published schema ----------

test("every GraphQL query is valid against GitHub's schema", async () => {
  const { buildSchema, parse, validate } = await import("graphql");
  const sdl = await readFile(new URL("../node_modules/@octokit/graphql-schema/schema.graphql", import.meta.url), "utf8");
  // The published schema trips graphql-js's own lint (a duplicate enterprise field, deprecations).
  const schema = buildSchema(sdl, { assumeValidSDL: true, assumeValid: true });
  const { ALLOWED_QUERIES } = await import("../assets/js/lib/queries.js");
  for (const q of ALLOWED_QUERIES) assert.deepEqual(validate(schema, parse(q)).map((e) => e.message), []);
  assert.ok(validate(schema, parse('query{repository(owner:"a",name:"b"){notAField}}')).length, "the check catches mistakes");
});
