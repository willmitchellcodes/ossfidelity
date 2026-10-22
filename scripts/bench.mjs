#!/usr/bin/env node
// Small, reproducible benchmark for open-weight models: only tasks a script can grade.
//   node scripts/bench.mjs --list                                   # models to run (JSON for the Actions matrix)
//   node scripts/bench.mjs --model qwen3-4b --endpoint http://localhost:8080
//   node scripts/bench.mjs --collect                                # merge bench/results/*.json into _data/bench.json
//   node scripts/bench.mjs --regrade                                # re-grade saved answers after a grader fix (no model needed)
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load as loadYaml } from "js-yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const models = loadYaml(await readFile(join(ROOT, "_data/models.yml"), "utf8"));
const tasks = JSON.parse(await readFile(join(ROOT, "bench/tasks.json"), "utf8"));
const WEIGHTS = Object.fromEntries(models.tasks.map((t) => [t.id, t.weight]));

if (args.includes("--list")) {
  const list = models.models.filter((m) => m.bench && m.gguf).map((m) => ({ slug: m.slug, repo: m.gguf.repo, file: m.gguf.file }));
  process.stdout.write(JSON.stringify(list));
  process.exit(0);
}
if (args.includes("--collect")) { await collect(); process.exit(0); }

const slug = arg("--model");
const endpoint = (arg("--endpoint") || "http://localhost:8080").replace(/\/$/, "");
const model = models.models.find((m) => m.slug === slug);
if (!model && !args.includes("--regrade")) { console.error(`Unknown model "${slug}". Use --list.`); process.exit(1); }

// ---------- graders ----------
const norm = (s) => String(s).toLowerCase().replace(/[“”"'’`*_]/g, "").replace(/\s+/g, " ").trim();
// A word needs a letter or digit, so a stray quote mark or dash isn't counted.
const words = (s) => String(s).replace(/[.!?,;:]+/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
// Saying the answer isn't there counts, in any wording: the test is honesty, not copying a phrase.
const NOT_IN_TEXT = /not in the text|(does not|doesn't|did not|didn't) (say|state|specify|mention|contain|provide|include|give)|(is not|isn't|was not|wasn't) (stated|mentioned|specified|provided|given|included)|not (stated|mentioned|specified|provided|given) in the text|no information|cannot be determined|can't be determined/i;
const unquote = (s) => s.trim().replace(/^["'“”‘’`*]+|["'“”‘’`*]+$/g, "").trim();

export function stripThinking(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "").trim();
}
function parseJson(text) {
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/[\[{][\s\S]*[\]}]/);
  try { return m ? JSON.parse(m[0]) : undefined; } catch { return undefined; }
}
export function check(c, ans) {
  const a = ans.trim();
  switch (c.kind) {
    case "bullets": { const lines = a.split("\n").map((l) => l.trim()).filter(Boolean); return lines.length === c.n && lines.every((l) => l.startsWith("- ")); }
    case "json_keys": { const o = parseJson(a); return !!o && !Array.isArray(o) && typeof o === "object" && Object.keys(o).length === c.keys.length && c.keys.every((k) => k in o); }
    case "json_equals": { const o = parseJson(a); return JSON.stringify(o) === JSON.stringify(c.value); }
    case "contains_any": return c.options.some((o) => norm(a).includes(norm(o)));
    case "word_count": { const n = words(a).length; return n >= c.min && n <= c.max; }
    case "no_char": return !a.includes(c.char);
    case "equals": return c.options.some((o) => norm(a).replace(/[.!]$/, "") === norm(o));
    case "equals_case": return unquote(a).replace(/\s+/g, " ") === c.value;
    case "lowercase": return /[a-z]/.test(a) && a === a.toLowerCase();
    case "ends_with": return unquote(a).endsWith(c.value);
    default: throw new Error(`Unknown check ${c.kind}`);
  }
}
export function grade(item, ans) {
  if (item.type === "format") return item.checks.every((c) => check(c, ans));
  if (item.type === "unanswerable") return NOT_IN_TEXT.test(ans);
  // grounded: must contain a right answer and must not claim it isn't there
  return !NOT_IN_TEXT.test(ans) && item.answers.some((o) => norm(ans).includes(norm(o)));
}
function categories(items, consistency) {
  const cat = {};
  for (const t of ["format", "grounded", "unanswerable"]) {
    const xs = items.filter((i) => i.type === t);
    cat[t] = { passed: xs.filter((i) => i.pass).length, total: xs.length };
  }
  cat.consistency = { passed: consistency.filter((c) => c.same).length, total: consistency.length };
  return cat;
}
const scoreOf = (cat) => Math.round(Object.entries(cat).reduce((a, [k, v]) => a + WEIGHTS[k] * (v.passed / v.total), 0) / Object.values(WEIGHTS).reduce((a, b) => a + b, 0) * 100);
function promptFor(item) {
  if (item.type === "format") return item.prompt;
  return `${tasks.grounded_instruction}\n\nText: ${tasks.passages[item.passage]}\n\nQuestion: ${item.question}`;
}

if (args.includes("--regrade")) { await regrade(); await collect(); process.exit(0); }

// ---------- run ----------
async function ask(item, { temperature = 0, seed = 42 } = {}) {
  const system = tasks.system + (model.system_suffix ? ` ${model.system_suffix}` : "");
  const t0 = performance.now();
  const res = await fetch(`${endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model.slug, messages: [{ role: "system", content: system }, { role: "user", content: promptFor(item) }], temperature, seed, max_tokens: 160 }),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`Server answered ${res.status} for ${item.id}`);
  const j = await res.json();
  const secs = (performance.now() - t0) / 1000;
  const raw = j.choices?.[0]?.message?.content ?? "";
  return { answer: stripThinking(raw), tokens: j.usage?.completion_tokens ?? 0, secs, tps: j.timings?.predicted_per_second ?? null };
}

if (slug) {
  const items = [], timing = { tokens: 0, secs: 0, tps: [] };
  for (const item of tasks.items) {
    const r = await ask(item);
    const pass = grade(item, r.answer);
    items.push({ id: item.id, type: item.type, answer: r.answer, pass });
    timing.tokens += r.tokens; timing.secs += r.secs; if (r.tps) timing.tps.push(r.tps);
    console.log(`${pass ? "✓" : "✗"} ${item.id.padEnd(4)} ${JSON.stringify(r.answer).slice(0, 90)}`);
  }
  // Consistency: ask a subset twice more with some randomness; does the verdict stay the same?
  const sub = tasks.items.filter((i) => i.consistency);
  const consistency = [];
  for (const item of sub) {
    const first = items.find((x) => x.id === item.id).pass;
    const reruns = [];
    const answers = [];
    for (const seed of [1, 2]) { const a = (await ask(item, { temperature: 0.7, seed })).answer; answers.push(a); reruns.push(grade(item, a)); }
    consistency.push({ id: item.id, verdicts: [first, ...reruns], same: reruns.every((v) => v === first), rerun_answers: answers });
  }
  const cat = categories(items, consistency);
  const score = scoreOf(cat);
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const props = await fetch(`${endpoint}/props`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  const out = {
    slug, name: model.name, file: model.gguf.file, repo: model.gguf.repo, ran_at: new Date().toISOString(),
    machine: process.env.GITHUB_ACTIONS ? "GitHub Actions ubuntu-latest (4 CPU cores, 16 GB, no GPU)" : "local",
    server: props.build_info || "llama.cpp server", tasks_version: tasks.version,
    score, categories: cat,
    tokens_per_sec: Math.round((median(timing.tps) ?? timing.tokens / timing.secs) * 10) / 10,
    items, consistency,
  };
  await mkdir(join(ROOT, "bench/results"), { recursive: true });
  await writeFile(join(ROOT, `bench/results/${slug}.json`), JSON.stringify(out, null, 1) + "\n");
  console.log(`\n${model.name}: ${score}/100 · ${JSON.stringify(cat)} · ${out.tokens_per_sec} tokens/s`);
}

// Re-apply the graders to answers already saved, so a grader fix doesn't need a new model run.
async function regrade() {
  const dir = join(ROOT, "bench/results");
  const byId = Object.fromEntries(tasks.items.map((i) => [i.id, i]));
  for (const f of (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json"))) {
    const r = JSON.parse(await readFile(join(dir, f), "utf8"));
    if (r.tasks_version !== tasks.version) { console.log(`Skipped ${f}: answers are for tasks v${r.tasks_version}`); continue; }
    if (r.consistency.some((c) => !c.rerun_answers)) { console.log(`Skipped ${f}: no saved re-run answers`); continue; }
    for (const it of r.items) it.pass = grade(byId[it.id], it.answer);
    for (const c of r.consistency) {
      const first = r.items.find((x) => x.id === c.id).pass;
      const reruns = c.rerun_answers.map((a) => grade(byId[c.id], a));
      c.verdicts = [first, ...reruns]; c.same = reruns.every((v) => v === first);
    }
    const before = r.score;
    r.categories = categories(r.items, r.consistency); r.score = scoreOf(r.categories); r.regraded_at = new Date().toISOString();
    await writeFile(join(dir, f), JSON.stringify(r, null, 1) + "\n");
    console.log(`${r.slug}: ${before} → ${r.score}`);
  }
}

async function collect() {
  const dir = join(ROOT, "bench/results");
  const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json"));
  const summary = { updated: new Date().toISOString(), tasks_version: tasks.version, models: {} };
  for (const f of files) {
    const r = JSON.parse(await readFile(join(dir, f), "utf8"));
    summary.models[r.slug] = { score: r.score, categories: r.categories, tokens_per_sec: r.tokens_per_sec, ran_at: r.ran_at, machine: r.machine, server: r.server, file: r.file };
  }
  await writeFile(join(ROOT, "_data/bench.json"), JSON.stringify(summary, null, 1) + "\n");
  console.log(`Collected ${files.length} result files into _data/bench.json`);
}
