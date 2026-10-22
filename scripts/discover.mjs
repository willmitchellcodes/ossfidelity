#!/usr/bin/env node
// Monthly: look for well-kept open source projects by category and open ONE issue listing
// candidates for a human to review. Nothing is added to the site automatically.
// Stars are used only to find candidates, never to grade them.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load as loadYaml } from "js-yaml";
import { parseRepoUrl, scoreLicense } from "../assets/js/lib/util.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY || "willmitchellcodes/ossfidelity";
const dryRun = process.argv.includes("--dry-run");
const headers = { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };

const CATEGORIES = {
  "local-ai": ["topic:local-llm", "topic:llm-inference topic:offline"],
  communication: ["topic:end-to-end-encryption topic:messenger", "topic:matrix-client"],
  art: ["topic:digital-painting", "topic:video-editor", "topic:image-editor", "topic:audio-editor"],
  notes: ["topic:note-taking", "topic:personal-knowledge-management"],
  office: ["topic:office-suite", "topic:spreadsheet"],
  everyday: ["topic:password-manager", "topic:privacy topic:android"],
  coding: ["topic:code-editor", "topic:compiler"],
};
const spdx = JSON.parse(await readFile(join(ROOT, "assets/data/spdx.json"), "utf8")).licenses;
const listed = new Set(loadYaml(await readFile(join(ROOT, "_data/projects.yml"), "utf8")).map((p) => parseRepoUrl(p.repo)?.id.toLowerCase()));
const since = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);

const found = {};
for (const [cat, queries] of Object.entries(CATEGORIES)) {
  found[cat] = [];
  for (const q of queries) {
    const query = `${q} stars:>=1500 pushed:>=${since} archived:false fork:false`;
    const res = await fetch(`https://api.github.com/search/repositories?per_page=10&sort=stars&q=${encodeURIComponent(query)}`, { headers });
    if (!res.ok) { console.log(`! ${cat} "${q}": HTTP ${res.status}`); continue; }
    for (const r of (await res.json()).items || []) {
      const id = `github.com/${r.full_name}`.toLowerCase();
      if (listed.has(id) || found[cat].some((x) => x.id === id)) continue;
      const lic = scoreLicense(r.license?.spdx_id || null, spdx);
      if (lic.kind === "none" || lic.kind === "source-available") continue; // skip "all rights reserved" and source-available
      const license = lic.kind === "open" ? r.license.spdx_id : "license unrecognized: check it";
      found[cat].push({ id, name: r.full_name, url: r.html_url, desc: (r.description || "").slice(0, 120), license, pushed: r.pushed_at.slice(0, 10) });
    }
    await new Promise((r) => setTimeout(r, token ? 2500 : 7000)); // search API: 30/min with a token, 10/min without
  }
  found[cat] = found[cat].slice(0, 6);
}

const month = new Date().toISOString().slice(0, 7);
let body = `Candidates for the Browse page, found by searching GitHub topics. To add one, copy its link into \`_data/projects.yml\` with a category and a one-line blurb; the next scoring run grades it.\n\n`
  + `Filters: an open source license (or one GitHub couldn't recognize, flagged to check), pushed in the last 6 months, not archived or a fork. Stars were only used to find candidates; they're never part of a grade.\n`;
for (const [cat, items] of Object.entries(found)) {
  body += `\n### ${cat}\n` + (items.length ? items.map((i) => `- [ ] [${i.name}](${i.url}) · ${i.license} · last push ${i.pushed}${i.desc ? ` · ${i.desc.replace(/[\r\n|]/g, " ")}` : ""}`).join("\n") : "_Nothing new this month._") + "\n";
}
if (dryRun || !token) { console.log(body); process.exit(0); }
const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
  method: "POST", headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ title: `Project suggestions for ${month}`, body }),
});
console.log(res.ok ? `Opened issue: ${(await res.json()).html_url}` : `Couldn't open issue: HTTP ${res.status} ${await res.text()}`);
