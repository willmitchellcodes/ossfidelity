// Shared helpers for collectors: URL parsing, bots, AI disclosure, licenses.

export const DAY = 86400000;

// ---------- URLs ----------
const KNOWN_FORGEJO = new Set(["codeberg.org", "projects.blender.org", "git.disroot.org", "next.forgejo.org"]);

/** Accepts "https://github.com/o/r", "github.com/o/r", "codeberg.org/o/r.git", etc. */
export function parseRepoUrl(input) {
  if (!input) return null;
  let s = String(input).trim().replace(/^git\+/, "").replace(/\.git$/, "").replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const [owner, repo] = u.pathname.split("/").filter(Boolean);
  if (!owner || !repo) return null;
  let forge = null;
  if (host === "github.com") forge = "github";
  else if (KNOWN_FORGEJO.has(host)) forge = "forgejo";
  else if (host === "gitlab.com" || host.startsWith("gitlab.") || host === "invent.kde.org") forge = "gitlab";
  else forge = "forgejo"; // best guess for unknown self-hosted forges; the collector verifies it
  return { host, owner, repo, forge, id: `${host}/${owner}/${repo}`, url: `https://${host}/${owner}/${repo}` };
}

// ---------- People vs bots ----------
const BOT_RE = /\[bot\]$|^(dependabot|renovate|github-actions|weblate|codecov|pre-commit-ci|allcontributors|imgbot|snyk-bot|greenkeeper|mergify|forgejo-actions|gitea-actions|translate|crowdin|transifex|semantic-release-bot|release-please|llvmbot)\b/i;
export const isBot = (login = "", name = "", type = "") =>
  type === "Bot" || BOT_RE.test(login || "") || BOT_RE.test(name || "");

// ---------- AI disclosure (only what is disclosed can be counted) ----------
export const AI_PATTERNS = [
  ["Claude", /co-authored-by:[^\n]*(claude|anthropic\.com)|generated with \[?claude code/i],
  ["GitHub Copilot", /co-authored-by:[^\n]*copilot/i],
  ["Cursor", /co-authored-by:[^\n]*cursor|cursoragent@cursor\.com/i],
  ["Aider", /co-authored-by:[^\n]*aider|\(aider\)/i],
  ["OpenAI Codex", /co-authored-by:[^\n]*(codex|openai\.com)/i],
  ["Gemini / Jules", /co-authored-by:[^\n]*(gemini|jules)/i],
  ["Devin", /co-authored-by:[^\n]*devin/i],
  ["Assisted-by tag", /^assisted-by:/im],
];
export const AI_BOT_RE = /^(copilot-swe-agent|copilot|copilot-pull-request-reviewer|devin-ai-integration|google-labs-jules|chatgpt-codex-connector|claude|cursor|sweep-ai|openhands-agent|codegen-sh|coderabbitai|gemini-code-assist|sourcery-ai|greptile-apps)(\[bot\])?$/i;

/** commits: [{message, authorLogin, authorName}] → disclosure summary */
export function aiDisclosure(commits) {
  const tools = {};
  let disclosed = 0;
  for (const c of commits) {
    let hit = null;
    if (AI_BOT_RE.test(c.authorLogin || "")) hit = "Agent bot account";
    else for (const [tool, re] of AI_PATTERNS) if (re.test(c.message || "") || re.test(c.authorName || "")) { hit = tool; break; }
    if (hit) { disclosed++; tools[hit] = (tools[hit] || 0) + 1; }
  }
  return { checked: commits.length, disclosed, tools };
}

export const AI_POLICY_RE = /\b(LLM|large language model|generative AI|AI[- ]generated|AI[- ]assisted|Copilot|ChatGPT)\b/i;

// ---------- Deprecation phrases (Coelho et al. 2020) ----------
export const DEPRECATED_RE = /\b(no longer (being )?maintained|is (now )?deprecated|this (project|repository|repo) is (unmaintained|deprecated|archived|abandoned)|not (actively )?maintained( anymore)?|unmaintained)\b/i;

// ---------- Licenses ----------
export const SOURCE_AVAILABLE = new Set([
  "BUSL-1.1", "SSPL-1.0", "Elastic-2.0", "FSL-1.0-MIT", "FSL-1.1-MIT", "FSL-1.0-Apache-2.0", "FSL-1.1-Apache-2.0",
  "RSALv2", "Commons-Clause", "PolyForm-Noncommercial-1.0.0", "PolyForm-Small-Business-1.0.0", "PolyForm-Shield-1.0.0",
  "CC-BY-NC-4.0", "CC-BY-NC-SA-4.0", "CC-BY-NC-ND-4.0", "Fair-Source",
]);

// Ordered: the more specific license comes first (AGPL before GPL, BSD-3 before BSD-2).
const LICENSE_TEXT = [
  ["Apache-2.0 WITH LLVM-exception", /LLVM Exceptions to the Apache 2\.0 License/i],
  ["Commons-Clause", /Commons Clause/i],
  ["BUSL-1.1", /Business Source License/i],
  ["RSALv2", /Redis Source Available License/i],
  ["SSPL-1.0", /Server Side Public License/i],
  ["Elastic-2.0", /Elastic License 2\.0/i],
  ["FSL-1.1-MIT", /Functional Source License/i],
  ["PolyForm-Noncommercial-1.0.0", /PolyForm Noncommercial/i],
  ["AGPL-3.0-or-later", /GNU AFFERO GENERAL PUBLIC LICENSE,?\s+Version 3/i],
  ["LGPL-3.0-or-later", /GNU LESSER GENERAL PUBLIC LICENSE,?\s+Version 3/i],
  ["LGPL-2.1-or-later", /GNU LESSER GENERAL PUBLIC LICENSE,?\s+Version 2\.1/i],
  ["LGPL-2.0-or-later", /GNU LIBRARY GENERAL PUBLIC LICENSE,?\s+Version 2/i],
  ["GPL-3.0-or-later", /GNU GENERAL PUBLIC LICENSE,?\s+Version 3/i],
  ["GPL-2.0-or-later", /GNU GENERAL PUBLIC LICENSE,?\s+Version 2/i],
  ["MPL-2.0", /Mozilla Public License,?\s+(Version|v\.?)\s*2\.0/i],
  ["EPL-2.0", /Eclipse Public License\s*-?\s*v?\s*2\.0/i],
  ["Apache-2.0", /Apache License[\s,]+Version 2\.0/i],
  ["BSD-3-Clause", /Neither the name of[\s\S]{0,300}endorse or promote/i],
  ["BSD-2-Clause", /Redistribution and use in source and binary forms/i],
  ["BSL-1.0", /Boost Software License\s*-?\s*Version 1\.0/i],
  ["MIT", /Permission is hereby granted, free of charge/i],
  ["Zlib", /Permission is granted to anyone to use this software for any purpose,? including commercial applications/i],
  ["Artistic-2.0", /The Artistic License 2\.0/i],
  ["CC0-1.0", /CC0 1\.0 Universal/i],
  ["0BSD", /Zero-Clause BSD|for any purpose with or without fee is hereby granted\. THE SOFTWARE IS PROVIDED/i],
  ["ISC", /for any purpose with or without fee is hereby granted, provided that the above copyright notice/i],
  ["Unlicense", /This is free and unencumbered software released into the public domain/i],
];

// Phrases that offer the reader a choice between licenses ("A OR B"). A file that only says
// different parts are under different licenses (Bitwarden's) is not a choice.
// "(at your option) any later version" is the usual GNU wording for one license, not a choice.
const CHOICE_RE = /\b(your choice of|at your (option|choice)(?![^.]{0,40}any later version)|choose (one|either) of|one of the following licen[cs]es|dual[- ]licen[cs]ed|tri[- ]licen[cs]ed)\b/i;
// The short notice many GNU-licensed projects put in LICENSE or COPYING instead of the full text.
const GNU_EITHER_RE = /GNU (?:(Lesser|Library|Affero) )?General Public License,? as published by the Free Software Foundation[,;]? either version (\d(?:\.\d)?) or (?:\(at your option\) )?version (\d(?:\.\d)?)/i;
const GNU_LATER_RE = /GNU (?:(Lesser|Library|Affero) )?General Public License,? as published by the Free Software Foundation[,;]? (?:either )?version (\d(?:\.\d)?)(?: of the License)?,? or \(at your option\) any later version/i;
const HEAD = 1500; // a project's own license statement comes first; third-party notices follow it

const gnuId = (family, v, suffix) => {
  const fam = { lesser: "LGPL", library: "LGPL", affero: "AGPL" }[(family || "").toLowerCase()] || "GPL";
  return `${fam}-${v.includes(".") ? v : v + ".0"}-${suffix}`;
};

/**
 * Best-effort SPDX expression for a license file's text, or null.
 * spdxIds (optional): known SPDX ids, so a file that names its license ("AGPL-3.0-or-later")
 * is recognized even without the full license text.
 */
export function detectLicenseText(text, spdxIds = []) {
  if (!text) return null;
  // An SPDX header counts only at the top of the file and at the start of a line, so an id quoted
  // in a third-party notice further down (Node's LICENSE has dozens) isn't mistaken for the project's.
  const header = /^[\s#*/;<!-]*SPDX-License-Identifier:\s*([^\n*]+?)\s*(?:\*\/|-->|$)/im.exec(text.slice(0, 2000));
  if (header) return header[1].trim();
  const flat = text.replace(/\s+/g, " "); // license files are hard-wrapped at different widths
  const head = flat.slice(0, HEAD);

  // 1. A choice between licenses: every full license text found counts, joined with OR.
  if (CHOICE_RE.test(head)) {
    const found = LICENSE_TEXT.filter(([, re]) => re.test(flat)).map(([id]) => id)
      .filter((id, _, all) => !(id === "BSD-2-Clause" && all.includes("BSD-3-Clause")));
    if (found.length > 1) return found.join(" OR ");
  }
  // 2. The project's own statement at the top of the file.
  let m = GNU_EITHER_RE.exec(head);
  if (m) return `${gnuId(m[1], m[2], "only")} OR ${gnuId(m[1], m[3], "only")}`;
  m = GNU_LATER_RE.exec(head);
  if (m) return gnuId(m[1], m[2], "or-later");
  for (const [id, re] of LICENSE_TEXT) if (re.test(head)) return id;
  const named = spdxIdIn(head, spdxIds);
  if (named) return named;
  // 3. Anywhere in the file, most specific license first.
  for (const [id, re] of LICENSE_TEXT) if (re.test(flat)) return id;
  return null;
}

// A license name counts only right after wording that says the project is under it
// ("licensed under the AGPL-3.0-or-later License"). Many SPDX ids are also product names
// (OpenSSL, curl, Ruby, Vim), so a bare mention like "found in the OpenSSL library" doesn't count.
const idPatterns = new Map();
function spdxIdIn(text, ids) {
  const all = [...new Set([...ids, ...SOURCE_AVAILABLE, ...LICENSE_TEXT.map(([id]) => id).filter((id) => !id.includes(" "))])];
  const key = all.length;
  if (!idPatterns.has(key)) {
    const alts = all.sort((a, b) => b.length - a.length).map((id) => id.replace(/[.+]/g, "\\$&"));
    idPatterns.set(key, new RegExp(`(?:licen[cs]ed under|released under|available under|licen[cs]e:)\\s+(?:the\\s+)?(?:terms of the\\s+)?(${alts.join("|")})(?![\\w.+-])`, "i"));
  }
  const m = idPatterns.get(key).exec(text);
  return m ? all.find((id) => id.toLowerCase() === m[1].toLowerCase()) : null;
}

// Files that set a repo up for AI coding agents. Their presence is disclosed, never scored.
export const AGENT_FILES = /^(AGENTS\.md|CLAUDE\.md|GEMINI\.md|\.cursorrules|\.cursor|\.windsurfrules|\.clinerules|copilot-instructions\.md|\.aider\.conf\.ya?ml)$/i;

export const LICENSE_FILES = /^(LICEN[SC]E|COPYING|UNLICENSE)(\.(md|txt|rst))?$/i;

/** Returns { value 0–1, kind, label } for an SPDX expression. */
export function scoreLicense(spdx, spdxMap) {
  if (!spdx) return { value: 0, kind: "none", label: "No license: all rights reserved" };
  if (spdx === "NOASSERTION" || spdx === "OTHER") return { value: 0.5, kind: "unrecognized", label: "License file found but not recognized" };
  // "A OR B": the best option counts. "A AND B": the most restrictive part counts.
  const orParts = spdx.split(/\s+OR\s+/i).map((alt) => {
    const andParts = alt.replace(/[()]/g, "").split(/\s+AND\s+/i).map((p) => one(p.trim()));
    return andParts.reduce((a, b) => (a.value <= b.value ? a : b));
  });
  const best = orParts.reduce((a, b) => (a.value >= b.value ? a : b));
  return orParts.length > 1 ? { ...best, label: `${best.label} (one of ${orParts.length} license options)` } : best;

  function one(id) {
    const base = id.split(/\s+WITH\s+/i)[0].replace(/\+$/, "");
    if (SOURCE_AVAILABLE.has(base)) return { value: 0.25, kind: "source-available", label: `${id}: source-available, not open source` };
    const f = spdxMap[base] || spdxMap[base + "-only"] || spdxMap[base.replace(/-or-later$/, "-only")];
    if (!f) return { value: 0.5, kind: "unrecognized", label: `${id}: not on the OSI or FSF lists` };
    if (f[0] && f[1]) return { value: 1, kind: "open", label: `${id}: OSI and FSF approved` };
    return { value: 0.9, kind: "open", label: `${id}: ${f[0] ? "OSI" : "FSF"} approved` };
  }
}

// ---------- Files that signal practices ----------
export const SECURITY_FILES = /^SECURITY(\.(md|rst|txt))?$/i;
export const DEP_UPDATE_FILES = /^(dependabot\.ya?ml|renovate\.json5?|\.renovaterc(\.json5?)?)$/i;
export const CI_ROOT = /^(\.github|\.forgejo|\.gitea|\.woodpecker|\.woodpecker\.ya?ml|\.gitlab-ci\.ya?ml|\.travis\.ya?ml|\.circleci|Jenkinsfile|\.buildkite|azure-pipelines\.ya?ml|\.cirrus\.ya?ml|appveyor\.ya?ml|\.builds|\.drone\.ya?ml)$/i;
export const MANIFESTS = /^(package\.json|Cargo\.toml|go\.mod|requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.py|Gemfile|pom\.xml|build\.gradle(\.kts)?|settings\.gradle(\.kts)?|composer\.json|.*\.csproj|.*\.sln|build\.zig\.zon|mix\.exs|pubspec\.yaml|Package\.swift|deno\.jsonc?|flake\.nix|CMakeLists\.txt|meson\.build|vcpkg\.json|conanfile\.(txt|py))$/i;
export const DOC_DIRS = /^(docs?|documentation|website|book|manual|man|site)$/i;
export const README = /^README(\.(md|rst|txt|adoc|org))?$/i;
export const SIG_ASSET = /\.(asc|sig|minisig|sigstore(\.json)?|intoto\.jsonl|pem|p7s)$/i;
export const SUM_ASSET = /(sha256|sha512|sha1|checksums?|SHA\d*SUMS)/i;

/** Weekly human-commit counts (oldest → newest) → longest zero run, in days. */
export function longestGapDays(weekly) {
  let best = 0, run = 0;
  for (const n of weekly) { run = n > 0 ? 0 : run + 1; if (run > best) best = run; }
  return best * 7;
}

/** contributions: [{commits}] (humans, last 12 months) → bus factor */
export function busFactor(counts, total) {
  const sorted = counts.filter((n) => n > 0).sort((a, b) => b - a);
  const half = (total ?? sorted.reduce((a, b) => a + b, 0)) / 2;
  if (half <= 0) return 0;
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) { acc += sorted[i]; if (acc >= half) return i + 1; }
  return sorted.length; // A lower bound: the list was truncated before reaching half.
}

/**
 * Per-person and weekly counts from a plain list of commits (newest first), skipping bots.
 * Used when GitHub's statistics endpoints aren't ready, and by the Forgejo collector.
 * commits: [{ login, name, email, date }]
 */
export function commitListStats(commits, now, since) {
  const people = new Map();
  const weekly = new Array(52).fill(0);
  const dates = [];
  for (const c of commits) {
    if (isBot(c.login, c.name)) continue;
    const t = new Date(c.date);
    if (t < since) continue;
    const key = (c.login || c.email || c.name || "?").toLowerCase();
    people.set(key, (people.get(key) || 0) + 1);
    dates.push(t);
    const wk = 51 - Math.floor((now - t) / (7 * DAY));
    if (wk >= 0 && wk < 52) weekly[wk]++;
  }
  return { people, weekly, dates };
}

/** Longest stretch without a commit, in days, between `since` and `now`. */
export function exactGapDays(dates, since, now) {
  const pts = [since.getTime(), ...dates.map((d) => d.getTime()).sort((a, b) => a - b), now.getTime()];
  let best = 0;
  for (let i = 1; i < pts.length; i++) best = Math.max(best, pts[i] - pts[i - 1]);
  return Math.round(best / DAY);
}

export const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / DAY));
export const yearsBetween = (a, b) => (new Date(b) - new Date(a)) / (365.25 * DAY);

// ---------- Releases ----------
// Tags that name a test build rather than a release people should install.
export const PRERELEASE_TAG = /(^|[-._+])(rc|alpha|beta|pre|preview|dev|nightly|canary|snapshot)\d*([-._+]|\d|$)/i;

/** Published releases → the ones that count. Prereleases count only when there is nothing else. */
export function stableReleases(releases) {
  const published = releases.filter((r) => !r.draft);
  const stable = published.filter((r) => !r.prerelease);
  return stable.length ? { list: stable, kind: "release" } : { list: published, kind: "prerelease" };
}

/** Tag names → the ones that look like real releases (all of them if none do). */
export function stableTags(tags) {
  const stable = tags.filter((t) => !PRERELEASE_TAG.test(t.name));
  return stable.length ? stable : tags;
}

// ---------- Code review (OpenSSF Scorecard's method) ----------
const isAutomation = (who) => !who?.login || who.__typename === "Bot" || isBot(who.login) || AI_BOT_RE.test(who.login);

/**
 * commits: history nodes from CODE_REVIEW_QUERY (newest first).
 * A human change counts as reviewed when its merged pull request was approved, or merged,
 * by a person other than its author. Bots and AI reviewers don't count as people. A change
 * with no merged pull request was pushed straight to the branch, so it counts as unreviewed.
 */
export function codeReviewFromHistory(commits) {
  let human = 0, reviewed = 0, direct = 0, bots = 0;
  for (const c of commits || []) {
    if (isBot(c.author?.user?.login || "", c.author?.name || "")) { bots++; continue; }
    human++;
    const pr = (c.associatedPullRequests?.nodes || []).find((p) => p.merged);
    if (!pr) { direct++; continue; }
    const author = pr.author?.login;
    const other = (who) => !isAutomation(who) && who.login !== author;
    if ((pr.reviews?.nodes || []).some((r) => other(r.author)) || other(pr.mergedBy)) reviewed++;
  }
  return { human, reviewed, direct, bots };
}

// ---------- Follow-through search terms ----------
// Bot pull requests (often closed automatically when superseded) and closures by stale bots
// say nothing about whether people get answers, so both are left out.
export const NOT_BOTS = "-author:app/dependabot -author:app/renovate -author:app/github-actions";
export const NOT_STALE = '-label:stale -label:"lifecycle/stale"';
export function followThroughQueries(sinceDay) {
  return {
    issuesOpened: `is:issue created:>=${sinceDay} ${NOT_BOTS}`,
    issuesClosed: `is:issue closed:>=${sinceDay} ${NOT_BOTS} ${NOT_STALE}`,
    prsOpened: `is:pr created:>=${sinceDay} ${NOT_BOTS}`,
    prsClosed: `is:pr closed:>=${sinceDay} ${NOT_BOTS} ${NOT_STALE}`,
  };
}
/** The same four counts without the bot filters, used if GitHub refuses the filtered ones. */
export function followThroughPlainQueries(sinceDay) {
  return {
    issuesOpened: `is:issue created:>=${sinceDay}`,
    issuesClosed: `is:issue closed:>=${sinceDay}`,
    prsOpened: `is:pr created:>=${sinceDay}`,
    prsClosed: `is:pr closed:>=${sinceDay}`,
  };
}
