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
const AI_BOT_RE = /^(copilot-swe-agent|copilot|devin-ai-integration|google-labs-jules|chatgpt-codex-connector|claude|cursor|sweep-ai|openhands-agent|codegen-sh)(\[bot\])?$/i;

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
  ["SSPL-1.0", /Server Side Public License/i],
  ["Elastic-2.0", /Elastic License 2\.0/i],
  ["FSL-1.1-MIT", /Functional Source License/i],
  ["PolyForm-Noncommercial-1.0.0", /PolyForm Noncommercial/i],
  ["AGPL-3.0-or-later", /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/i],
  ["LGPL-3.0-or-later", /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3/i],
  ["LGPL-2.1-or-later", /GNU LESSER GENERAL PUBLIC LICENSE\s+Version 2\.1/i],
  ["GPL-3.0-or-later", /GNU GENERAL PUBLIC LICENSE\s+Version 3/i],
  ["GPL-2.0-or-later", /GNU GENERAL PUBLIC LICENSE\s+Version 2/i],
  ["MPL-2.0", /Mozilla Public License,?\s+(Version|v\.?)\s*2\.0/i],
  ["EPL-2.0", /Eclipse Public License\s*-?\s*v?\s*2\.0/i],
  ["Apache-2.0", /Apache License[\s,]+Version 2\.0/i],
  ["BSD-3-Clause", /Neither the name of[\s\S]{0,300}endorse or promote/i],
  ["BSD-2-Clause", /Redistribution and use in source and binary forms/i],
  ["MIT", /Permission is hereby granted, free of charge/i],
  ["0BSD", /Zero-Clause BSD|for any purpose with or without fee is hereby granted\. THE SOFTWARE IS PROVIDED/i],
  ["ISC", /for any purpose with or without fee is hereby granted, provided that the above copyright notice/i],
  ["Unlicense", /This is free and unencumbered software released into the public domain/i],
];

export function detectLicenseText(text) {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " "); // license files are hard-wrapped at different widths
  for (const [id, re] of LICENSE_TEXT) if (re.test(flat)) return id;
  return null;
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
  return orParts.reduce((a, b) => (a.value >= b.value ? a : b));

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

export const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / DAY));
export const yearsBetween = (a, b) => (new Date(b) - new Date(a)) / (365.25 * DAY);
