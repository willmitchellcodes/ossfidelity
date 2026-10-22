// Shared browser helpers: site data, links, escaping, and the search box.
import { parseRepoUrl } from "./lib/util.js";

export const BASE = document.body.dataset.base || "";
export const url = (p) => BASE + p;
export const checkUrl = (id) => `${url("/check/")}?r=${encodeURIComponent(id)}`;

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let dataPromise;
export function siteData() {
  dataPromise ??= fetch(url("/assets/data/site.json")).then((r) => r.json());
  return dataPromise;
}

// ---------- search box ----------
export function attachSearch(form, { onPick } = {}) {
  const input = form.querySelector("input");
  const list = form.querySelector(".suggest");
  let items = [], active = -1, timer, lastRemote = 0, seq = 0;

  const open = (html) => { list.innerHTML = html; list.hidden = !html; input.setAttribute("aria-expanded", String(!!html)); };
  const go = (id) => (onPick ? onPick(id) : (location.href = checkUrl(id)));

  async function update() {
    const q = input.value.trim();
    const mine = ++seq;
    if (!q) return open("");
    const data = await siteData();
    const ref = parseRepoUrl(q);
    const looksLikeLink = /[./]/.test(q) && q.includes("/") && ref;
    items = [];
    if (looksLikeLink) items.push({ id: ref.id, label: `Check ${ref.id}`, src: "link", group: "Link" });
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const pool = data.scores?.projects || [];
    const listed = new Map(pool.map((p) => [p.url, p]));
    for (const p of data.projects || []) if (!listed.has(p.repo)) listed.set(p.repo, { ...p, url: p.repo, id: parseRepoUrl(p.repo)?.id });
    for (const p of listed.values()) {
      const hay = `${p.name} ${p.blurb || ""} ${p.category || ""} ${p.id}`.toLowerCase();
      if (words.every((w) => hay.includes(w))) items.push({ id: p.id, label: p.name, src: p.computed?.fidelity ? `Fidelity ${p.computed.fidelity.letter}` : "graded weekly", group: "Graded projects" });
    }
    render();
    // Remote search: GitHub (10 searches/min without an account), at most every 3 s.
    if (!looksLikeLink && q.length >= 3 && Date.now() - lastRemote > 3000) {
      lastRemote = Date.now();
      const gh = await fetch(`https://api.github.com/search/repositories?per_page=5&q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : { items: [] })).then((j) => j.items || []).catch(() => []);
      if (mine !== seq) return;
      for (const r of gh) items.push({ id: `github.com/${r.full_name}`, label: r.full_name, src: "GitHub", group: "Search GitHub" });
      render();
    }
  }

  function render() {
    if (!items.length) return open("");
    let html = "", group = "";
    items.slice(0, 12).forEach((it, i) => {
      if (it.group !== group) { group = it.group; html += `<li class="group" role="presentation">${esc(group)}</li>`; }
      html += `<li role="presentation"><a role="option" id="opt-${i}" href="${checkUrl(it.id)}" aria-selected="${i === active}"><span>${esc(it.label)}</span><span class="src">${esc(it.src)}</span></a></li>`;
    });
    open(html);
  }

  input.addEventListener("input", () => { active = -1; clearTimeout(timer); timer = setTimeout(update, 220); });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.min(items.length, 12);
      render();
      input.setAttribute("aria-activedescendant", `opt-${active}`);
    } else if (e.key === "Escape") open("");
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    if (active >= 0 && items[active]) return go(items[active].id);
    const ref = parseRepoUrl(q);
    if (ref && q.includes("/")) return go(ref.id);
    await update();
    const first = items.find((i) => i.group === "Graded projects") || items[0];
    if (first) go(first.id);
  });
  document.addEventListener("click", (e) => { if (!form.contains(e.target)) open(""); });
}
