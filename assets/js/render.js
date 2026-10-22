// Draws a graded record: banners, the three grades with their "Why?", host checks, and context.
import { computeGrades } from "./lib/formula.js";
import { esc, url, checkUrl } from "./site.js";

const pct = (x) => `${Math.round(x * 100)}%`;
const num = (n) => Number(n).toLocaleString("en-US");

export function renderRecord(el, record, data, { source = "weekly", onLive } = {}) {
  const weights = data.weights;
  const hostName = { "github.com": "GitHub", "codeberg.org": "Codeberg", "gitlab.com": "GitLab" }[record.host] || record.host;
  const custom = {};
  let computed = computeGrades(record, weights, custom);

  // Sensitivity check (OECD/JRC practice): would any letter change if every signal counted equally?
  const equalW = {};
  for (const g of weights.grades) {
    const avg = g.signals.reduce((a, s) => a + s.weight, 0) / g.signals.length;
    for (const s of g.signals) equalW[s.id] = avg;
  }
  const equal = computeGrades(record, weights, equalW);
  const flips = weights.grades.filter((g) => equal.grades[g.id].letter !== computed.grades[g.id].letter && computed.grades[g.id].score !== null)
    .map((g) => `${g.label} would be ${equal.grades[g.id].letter} instead of ${computed.grades[g.id].letter}`);

  // "Finished, not abandoned": quiet, but with a recent-ish release and little open backlog (Coelho et al. 2020).
  const sg = record.signals || {};
  const maybeFinished = (m) => m.score !== null && m.score < 55 && sg.release_freshness?.value != null && sg.release_freshness.value <= 730
    && (record.context?.open_issues ?? 0) < 25 && (sg.follow_through?.value == null || sg.follow_through.value >= 0.8);

  // ----- moved / pending: nothing to grade here -----
  if (record.status?.moved_to) {
    const m = record.status.moved_to;
    // We can grade the new home only if it's on GitHub; otherwise link out to it.
    const onGitHub = m.url && /^https?:\/\/github\.com\//i.test(m.url) ? m.url.replace(/^https?:\/\//, "") : null;
    el.innerHTML = `
      <div class="kicker">${esc(hostName)}</div>
      <h1>${esc(record.name)}</h1>
      <div class="banner info"><strong>This project moved${m.named ? ` to ${esc(m.named)}` : ""}.</strong> The repository here says: “${esc(m.text)}”
      ${onGitHub ? `<p><a class="btn" href="${checkUrl(onGitHub)}">Check ${esc(onGitHub)} →</a></p>` : m.url ? `<p><a class="btn ghost" href="${esc(m.url)}">Visit the new home ↗</a> <span class="muted small">We don't grade projects outside GitHub yet.</span></p>` : ""}
      ${m.announcement ? `<p class="small"><a href="${esc(m.announcement)}">Read the announcement</a></p>` : ""}</div>
      <p class="muted">We grade a project where it actually lives. An old copy left behind would look abandoned.</p>`;
    return;
  }
  if (record.pending) {
    el.innerHTML = `<h1>${esc(record.name)}</h1><div class="banner info">Not graded yet. Waiting on ${esc(record.pending)}.</div>`;
    return;
  }

  const lic = record.license || {};
  const licClass = lic.kind === "open" ? "good" : lic.kind === "unrecognized" ? "warn" : "bad";
  const licText = lic.kind === "open" ? `${lic.spdx} · open source` : lic.kind === "unrecognized" ? "License unrecognized" : lic.kind === "source-available" ? `${lic.spdx} · not open source` : "No license";
  const banners = [];
  if (record.status?.archived) banners.push(["bad", "<strong>Archived.</strong> The owners made this repository read-only. Expect no fixes."]);
  if (record.status?.deprecated) banners.push(["bad", "<strong>Marked deprecated.</strong> The README says it's no longer maintained."]);
  if (record.status?.mirror) banners.push(["warn", `<strong>This is a mirror.</strong> Activity happens elsewhere${typeof record.status.mirror === "string" ? `: <a href="${esc(record.status.mirror)}">${esc(record.status.mirror)}</a>` : ""}, so these grades may undercount it.`]);
  if (record.status?.fork) banners.push(["info", `<strong>This is a fork</strong>${typeof record.status.fork === "string" ? ` of <a href="${checkUrl("github.com/" + record.status.fork)}">${esc(record.status.fork)}</a>` : ""}.`]);
  if (lic.kind === "source-available" || lic.kind === "none") banners.push(["bad", `<strong>Not open source.</strong> ${esc(lic.label)}. You may not be allowed to fork, change, or share it.`]);
  for (const c of record.license_changes || []) banners.push(["warn", `<strong>License changed</strong> from ${esc(c.from)} to ${esc(c.to)} (first seen ${esc(c.seen)}).`]);
  for (const a of record.anti_features || []) banners.push(["warn", `<strong>${esc(a.flag)}:</strong> ${esc(a.reason)}`]);
  if (record.stale) banners.push(["warn", `Last week's update failed (${esc(record.error)}). Showing the previous grades.`]);

  el.innerHTML = `
    ${banners.map(([k, h]) => `<div class="banner ${k}">${h}</div>`).join("")}
    <div class="result-head">
      <div>
        <div class="kicker">Hosted on ${esc(hostName)}</div>
        <h1>${esc(record.name)}</h1>
        ${record.description ? `<p class="muted prose">${esc(record.description)}</p>` : ""}
        <div class="meta">
          <a class="chip" href="${esc(record.url)}">${esc(record.id)} ↗</a>
          <span class="chip ${licClass}" title="${esc(lic.label)} (${esc(lic.source)})">${esc(licText)}</span>
        </div>
      </div>
      <div class="fidelity" id="fid"></div>
    </div>
    ${flips.length ? `<p class="banner info small"><strong>Weight-sensitive.</strong> With every signal weighted equally: ${flips.map(esc).join("; ")}. <a href="${url("/method/")}#sensitivity">Why we show this</a></p>` : ""}
    <div class="grades" id="grades">
      ${weights.grades.map((g) => gradeShell(g)).join("")}
    </div>
    <div class="side">
      ${contextCard(record)}
    </div>
    <div class="stamp">
      <span>${source === "live" ? "Live check" : "Weekly check"} · ${esc(new Date(record.scored_at).toLocaleString())}${record.calls ? ` · ${record.calls} API requests` : ""}</span>
      ${onLive ? `<button class="btn ghost" id="live" type="button">Run a live check</button>` : ""}
      <a href="${url("/method/")}">How grades work</a>
    </div>`;

  if (onLive) el.querySelector("#live").addEventListener("click", onLive);
  paint();

  // Sliders re-weight a signal right here, so you can see whose priorities a grade reflects.
  el.querySelectorAll("input[type=range]").forEach((r) =>
    r.addEventListener("input", () => {
      custom[r.dataset.sig] = Number(r.value);
      r.nextElementSibling.textContent = r.value;
      computed = computeGrades(record, weights, custom);
      paint();
    }));
  el.querySelectorAll("[data-reset]").forEach((b) =>
    b.addEventListener("click", () => {
      const g = weights.grades.find((x) => x.id === b.dataset.reset);
      for (const s of g.signals) {
        delete custom[s.id];
        const r = el.querySelector(`input[data-sig="${s.id}"]`);
        r.value = s.weight; r.nextElementSibling.textContent = s.weight;
      }
      computed = computeGrades(record, weights, custom);
      paint();
    }));

  function paint() {
    const f = computed.fidelity;
    el.querySelector("#fid").innerHTML = f
      ? `<span class="letter lg g-${f.letter}" aria-hidden="true">${f.letter}</span><div><div class="num">${f.score}</div><div class="lbl">Fidelity<br>average of the three</div></div><span class="visually-hidden">Fidelity grade ${f.letter}, ${f.score} out of 100</span>`
      : `<span class="letter lg g-?">?</span><div><div class="num">–</div><div class="lbl">Not enough data<br>for an overall grade</div></div>`;
    for (const g of weights.grades) {
      const c = computed.grades[g.id];
      const box = el.querySelector(`[data-grade="${g.id}"]`);
      box.querySelector(".letter").className = `letter g-${c.letter}`;
      box.querySelector(".letter").textContent = c.letter;
      box.querySelector(".score").innerHTML = `${c.score ?? "–"}<small>${c.confidence < 1 ? `${pct(c.confidence)} of weight measured` : "all signals measured"}</small>`;
      const finished = g.id === "maintenance" && maybeFinished(c);
      box.querySelector(".reason").textContent = reason(c) + (finished ? " · may be finished, not abandoned" : "");
      for (const p of c.parts) {
        const row = box.querySelector(`[data-row="${p.id}"]`);
        row.classList.toggle("na", !!p.na);
        row.querySelector(".bar > i").style.width = p.na ? "0" : pct(p.norm);
        row.querySelector(".pts").textContent = p.na ? "–" : `+${p.share.toFixed(1)}`;
        row.querySelector(".detail").textContent = p.detail || "";
      }
      box.querySelector(".notes").innerHTML = c.notes.map((n) => `<div class="banner bad">${esc(n)}</div>`).join("")
        + (finished ? `<div class="banner info">Quiet, but maybe <strong>finished</strong>: it has a release from the last two years and little open backlog. In one study, 41% of maintainers of "inactive" projects said the software was simply done.</div>` : "");
    }
  }
}

function gradeShell(g) {
  return `
  <details class="grade" data-grade="${g.id}">
    <summary>
      <span class="letter" aria-hidden="true">?</span>
      <span><span class="gname">${esc(g.label)}</span><br><span class="reason"></span></span>
      <span class="score"></span>
    </summary>
    <div class="why">
      <p class="muted">${esc(g.question)}</p>
      <div class="notes"></div>
      ${g.signals.map((s) => `
        <div class="sig" data-row="${s.id}">
          <span class="label" title="${esc(s.measure)}">${esc(s.label)}</span>
          <span class="bar" aria-hidden="true"><i></i></span>
          <span class="pts"></span>
          <span class="detail"></span>
          <label class="tune">weight <input type="range" min="0" max="${Math.max(10, s.weight * 2)}" step="0.5" value="${s.weight}" data-sig="${s.id}" aria-label="${esc(s.label)} weight"><output>${s.weight}</output>
            · <a href="${url("/method/")}#${s.id}" title="${esc(s.why)}">why?</a></label>
        </div>`).join("")}
      <div class="foot"><span>Points show each signal's share of this grade. Drag a weight to see how priorities change the result.</span><button class="btn ghost" type="button" data-reset="${g.id}">Reset weights</button></div>
    </div>
  </details>`;
}

function reason(c) {
  if (c.score === null) return "Not enough data to grade";
  const weak = c.parts.filter((p) => !p.na && p.norm < 0.5).sort((a, b) => b.weight * (1 - b.norm) - a.weight * (1 - a.norm));
  const missing = c.parts.filter((p) => p.na).length;
  const base = weak.length ? `Held back by ${weak.slice(0, 2).map((p) => p.label.toLowerCase()).join(" and ")}` : "No weak spots in what we measured";
  return missing ? `${base} · ${missing} not measured` : base;
}

function contextCard(record) {
  const ai = record.ai;
  const items = [];
  if (ai) {
    const tools = Object.entries(ai.tools || {}).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${esc(t)} ${n}`).join(", ");
    items.push(`<li><span class="mark unk">AI</span><span><strong>${ai.disclosed} of the last ${ai.checked} commits disclose AI help</strong>${tools ? ` <span class="muted">(${tools})</span>` : ""}. <span class="muted">This counts disclosed use only and isn't scored either way.</span>${ai.policy ? ` <a href="${esc(ai.policy)}">AI policy</a>` : ""}${ai.agent_files?.length ? ` <span class="muted">· Set up for AI agents: ${ai.agent_files.map(esc).join(", ")}</span>` : ""}</span></li>`);
  }
  if (record.context?.stars !== undefined) items.push(`<li><span class="mark unk">★</span><span><strong>${num(record.context.stars)} stars</strong> <span class="muted">· not scored, because stars are easy to fake.</span></span></li>`);
  if (record.scorecard) items.push(`<li><span class="mark unk">◎</span><span><strong>OpenSSF Scorecard ${record.scorecard.score}/10</strong> <a href="${esc(record.scorecard.url)}">details</a> <span class="muted">· shown for comparison, not mixed in.</span></span></li>`);
  return `<div class="card"><h3>Also worth knowing</h3><ul class="checks">${items.join("") || `<li class="muted">Nothing else to report.</li>`}</ul></div>`;
}
