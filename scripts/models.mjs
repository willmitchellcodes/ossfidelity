#!/usr/bin/env node
// Weekly: refresh public facts about each open-weight model from the Hugging Face Hub API.
// Writes _data/model_facts.json (license, gated, downloads, last update, parameter count, declared datasets).
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load as loadYaml } from "js-yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { models } = loadYaml(await readFile(join(ROOT, "_data/models.yml"), "utf8"));
const out = { updated: new Date().toISOString(), source: "https://huggingface.co/docs/hub/api", models: {} };
for (const m of models) {
  try {
    const res = await fetch(`https://huggingface.co/api/models/${m.hf}`, { headers: { "User-Agent": "ossfidelity (+https://ossfidelity.com)" }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    const card = j.cardData || {};
    out.models[m.slug] = {
      license: card.license || (j.tags || []).find((t) => t.startsWith("license:"))?.slice(8) || null,
      gated: j.gated || false,                         // false, "auto", or "manual"
      downloads_30d: j.downloads ?? null,              // context only: never scored
      likes: j.likes ?? null,
      last_modified: j.lastModified || null,
      params: j.safetensors?.total ?? null,
      datasets: [].concat(card.datasets || []),
      base_model: [].concat(card.base_model || []),
    };
    console.log(`• ${m.name}: ${out.models[m.slug].license}, gated=${out.models[m.slug].gated}`);
  } catch (e) {
    console.log(`! ${m.name}: ${e.message}`);
  }
}
await writeFile(join(ROOT, "_data/model_facts.json"), JSON.stringify(out, null, 1) + "\n");
