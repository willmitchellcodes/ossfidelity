#!/usr/bin/env node
// Weekly scorer: reads _data/projects.yml, collects signals, and writes _data/scores.json.
// Usage:
//   GITHUB_TOKEN=... node scripts/score.mjs                 # every curated project
//   node scripts/score.mjs --only github.com/llvm/llvm-project
//   node scripts/score.mjs --mode live                       # cheaper, token-free run
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load as loadYaml } from "js-yaml";
import { collect } from "../assets/js/lib/collect.js";
import { parseRepoUrl } from "../assets/js/lib/util.js";
import { computeGrades } from "../assets/js/lib/formula.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const only = args.flatMap((a, i) => (a === "--only" ? [args[i + 1]] : []));
const mode = args.includes("--mode") ? args[args.indexOf("--mode") + 1] : "full";
const token = process.env.SCORER_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
const now = new Date();

const weights = JSON.parse(await readFile(join(ROOT, "_data/weights.json"), "utf8"));
const spdx = JSON.parse(await readFile(join(ROOT, "assets/data/spdx.json"), "utf8")).licenses;
const projects = loadYaml(await readFile(join(ROOT, "_data/projects.yml"), "utf8"));
let prev = { projects: [] };
try { prev = JSON.parse(await readFile(join(ROOT, "_data/scores.json"), "utf8")); } catch {}
const prevById = new Map(prev.projects.map((p) => [p.id, p]));

const results = new Map(prev.projects.map((p) => [p.id, p]));

// Warm-up: GitHub computes commit statistics on first request (answering 202 until ready).
// Ask for every repository up front so the numbers are ready by the time we score it.
if (mode === "full") {
  const headers = { Accept: "application/vnd.github+json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  for (const p of projects) {
    const ref = parseRepoUrl(p.repo);
    if (!ref || ref.forge !== "github" || p.pending || (only.length && !only.includes(ref.id))) continue;
    for (const ep of ["contributors", "commit_activity"])
      await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}/stats/${ep}`, { headers, signal: AbortSignal.timeout(20000) }).catch(() => {});
  }
  console.log("Warmed up GitHub statistics; waiting 20 s for them to compute…");
  await new Promise((r) => setTimeout(r, 20000));
}

for (const p of projects) {
  const ref = parseRepoUrl(p.repo);
  if (!ref) { console.warn(`! bad repo link: ${p.repo}`); continue; }
  if (only.length && !only.includes(ref.id)) continue;
  const base = { id: ref.id, forge: ref.forge, host: ref.host, url: ref.url, name: p.name, category: p.category, blurb: p.blurb || "", anti_features: p.anti_features || [] };
  if (p.pending) { results.set(ref.id, { ...prevById.get(ref.id), ...base, pending: p.pending }); console.log(`- ${p.name}: pending (${p.pending})`); continue; }
  process.stdout.write(`• ${p.name} (${ref.id}) … `);
  try {
    const rec = await collect(ref, {
      token,
      mode, now, spdxMap: spdx, curated: p.curated || {},
    });
    Object.assign(rec, base);
    const old = prevById.get(ref.id);
    // Relicense watch: record any change of license between runs.
    rec.license_changes = old?.license_changes || [];
    // Only real license ids count. A better detection (NOASSERTION → MIT) is not a relicense.
    const real = (x) => x && !["NOASSERTION", "OTHER"].includes(x);
    if (real(old?.license?.spdx) && real(rec.license?.spdx) && old.license.spdx !== rec.license.spdx)
      rec.license_changes.push({ from: old.license.spdx, to: rec.license.spdx, seen: now.toISOString().slice(0, 10) });
    rec.computed = computeGrades(rec, weights);
    results.set(ref.id, rec);
    const g = rec.computed.grades;
    console.log(rec.status?.moved_to ? "moved" : `R ${g.reliability.score} · M ${g.maintenance.score} · S ${g.security.score} · Fidelity ${rec.computed.fidelity?.score ?? "?"} (${rec.calls} calls)`);
  } catch (e) {
    console.log(`failed: ${e.message}`);
    const old = prevById.get(ref.id);
    results.set(ref.id, { ...(old || base), ...base, stale: true, error: e.message });
  }
}

// Keep only projects still on the curated list.
const keep = new Set(projects.map((p) => parseRepoUrl(p.repo)?.id));
const out = {
  generated_at: now.toISOString(),
  weights_version: weights.version,
  projects: [...results.values()].filter((p) => keep.has(p.id)).sort((a, b) => (b.computed?.fidelity?.score ?? -1) - (a.computed?.fidelity?.score ?? -1)),
};
await writeFile(join(ROOT, "_data/scores.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`Wrote ${out.projects.length} projects to _data/scores.json`);
