// /check/?r=host/owner/repo : show the weekly grade if we have one, otherwise run a live check.
import { siteData, attachSearch, esc, url, checkUrl } from "../site.js";
import { renderRecord } from "../render.js";
import { collect } from "../lib/collect.js";
import { parseRepoUrl } from "../lib/util.js";
import { computeGrades } from "../lib/formula.js";
import { RateLimitError } from "../lib/http.js";

const form = document.getElementById("check-form");
const out = document.getElementById("result");
attachSearch(form);

const param = new URLSearchParams(location.search).get("r");
if (param) start(param);

async function start(input) {
  const ref = parseRepoUrl(input);
  form.querySelector("input").value = ref ? ref.id : input;
  if (!ref) {
    out.innerHTML = `<div class="banner">That doesn't look like a repository link. Try something like <code>github.com/owner/project</code>.</div>`;
    return;
  }
  const data = await siteData();
  document.title = `${ref.owner}/${ref.repo} · OSS Fidelity`;
  const cached = (data.scores?.projects || []).find((p) => p.id.toLowerCase() === ref.id.toLowerCase());
  if (cached && (cached.signals || cached.status?.moved_to || cached.pending)) {
    renderRecord(out, cached, data, { source: "weekly", onLive: () => live(ref, data) });
  } else {
    live(ref, data);
  }
}

async function live(ref, data) {
  let calls = 0;
  out.innerHTML = `<p class="skeleton"><span class="spinner"></span>Asking ${esc(ref.host)} about <strong>${esc(ref.owner)}/${esc(ref.repo)}</strong>… <span id="calls">0</span> requests</p>`;
  const counter = () => { const c = document.getElementById("calls"); if (c) c.textContent = String(++calls); };
  try {
    const spdx = (await (await fetch(url("/assets/data/spdx.json"))).json()).licenses;
    const curatedEntry = (data.projects || []).find((p) => parseRepoUrl(p.repo)?.id.toLowerCase() === ref.id.toLowerCase());
    const record = await collect(ref, { mode: "live", proxy: data.proxy || undefined, spdxMap: spdx, curated: curatedEntry?.curated || {}, log: counter });
    record.name = curatedEntry?.name || record.name || ref.repo;
    // Without the proxy, a live check can't run the code-review query. Reuse the weekly
    // result when there is one, so the same project never shows two different letters.
    const weekly = (data.scores?.projects || []).find((p) => p.id.toLowerCase() === ref.id.toLowerCase());
    const weeklyReview = weekly?.signals?.code_review;
    if (record.signals && record.signals.code_review?.value == null && weeklyReview?.value != null) {
      record.signals.code_review = { ...weeklyReview, detail: `${weeklyReview.detail} (from the weekly check, ${new Date(weekly.scored_at).toLocaleDateString()})` };
    }
    record.anti_features = curatedEntry?.anti_features || [];
    record.computed = computeGrades(record, data.weights);
    renderRecord(out, record, data, { source: "live" });
  } catch (e) {
    const cached = (data.scores?.projects || []).find((p) => p.id.toLowerCase() === ref.id.toLowerCase());
    if (e instanceof RateLimitError) {
      const viaProxy = data.proxy && e.host && !/github\.com$/.test(e.host);
      out.innerHTML = `<div class="banner"><strong>${esc(ref.host)} needs a breather.</strong> ${viaProxy ? "Our GitHub connection is busy right now" : "Without an account, GitHub allows about 60 requests an hour per network, which is only a few live checks"}${e.resetAt ? `. It resets at ${esc(e.resetAt.toLocaleTimeString())}` : ""}.
        ${cached ? `<p><a href="${checkUrl(ref.id)}">Show the weekly grade instead</a></p>` : `<p>Meanwhile, <a href="${url("/browse/")}">browse pre-graded projects</a>.</p>`}</div>`;
    } else if (e instanceof TypeError) {
      const listed = (data.projects || []).find((p) => parseRepoUrl(p.repo)?.id.toLowerCase() === ref.id.toLowerCase());
      out.innerHTML = `<div class="banner"><strong>We couldn't reach ${esc(ref.host)} from your browser.</strong> Some forges don't allow requests from other websites.
        ${cached ? `<p><a href="${checkUrl(ref.id)}">Show the weekly grade instead</a></p>`
          : listed ? `<p>${esc(listed.name)} is on our weekly list. Its first grade will appear after the next weekly run.</p>`
          : `<p><a href="${esc(dataSuggest(ref))}">Suggest it for the weekly list</a> and we'll grade it on our side.</p>`}</div>`;
    } else {
      out.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`;
    }
  }
}

function dataSuggest(ref) {
  const repo = document.querySelector('a[href*="/issues/new"]')?.href?.split("/issues/new")[0];
  return `${repo || "#"}/issues/new?title=${encodeURIComponent("Suggest: " + ref.id)}`;
}
