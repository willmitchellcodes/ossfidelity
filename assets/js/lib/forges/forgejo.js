// Forgejo / Gitea collector (Codeberg and self-hosted forges such as projects.blender.org).
// It uses the same signals and formula as GitHub. Forgejo has no contributor-stats
// endpoint, so we page through the last year of commits ourselves.

import { makeClient } from "../http.js";
import {
  DAY, isBot, aiDisclosure, AI_POLICY_RE, DEPRECATED_RE, detectLicenseText, scoreLicense, LICENSE_FILES,
  SECURITY_FILES, DEP_UPDATE_FILES, CI_ROOT, MANIFESTS, DOC_DIRS, README, AGENT_FILES,
  busFactor, yearsBetween,
} from "../util.js";
import { baseRecord, findMove, addReleaseSignals, backingSignal, bestPractices, cmpVersion, fmt } from "./github.js";

export async function collectForgejo(ref, { token, mode = "live", now = new Date(), spdxMap = {}, curated = {}, log = () => {} } = {}) {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `token ${token}`;
  if (typeof window === "undefined") headers["User-Agent"] = "ossfidelity-scorer (+https://ossfidelity.com)";
  // Be polite: Codeberg asks for fair use, so the weekly job waits about a second between requests.
  const api = makeClient(`https://${ref.host}/api/v1`, { headers, minIntervalMs: mode === "full" ? 900 : 0, waitOnLimit: mode === "full", onRequest: log });
  const R = `/repos/${ref.owner}/${ref.repo}`;
  const since = new Date(now - 365 * DAY);
  const sinceISO = since.toISOString();
  const signals = {};
  const maxPages = mode === "full" ? 200 : 8;

  const meta = await api(R);
  if (!meta) throw new Error("Repository not found (or this host isn't a Forgejo/Gitea forge).");
  const record = baseRecord(ref, meta, now, mode);
  const movedTo = findMove(meta.description, meta.website, ref);
  record.status = {
    archived: !!meta.archived,
    fork: meta.fork ? meta.parent?.full_name || true : false,
    mirror: meta.mirror ? meta.original_url || true : null,
    moved_to: movedTo,
    deprecated: false,
  };
  if (movedTo) return record;

  const listing = async (path) => ((await api(`${R}/contents${path ? "/" + path : ""}`)) || []);
  const root = await listing("");
  const names = new Set(root.map((f) => f.name));
  const dirs = new Set(root.filter((f) => f.type === "dir").map((f) => f.name));
  const sub = {};
  for (const d of [".forgejo", ".gitea", ".github"]) if (dirs.has(d)) sub[d] = (await listing(d)).map((f) => f.name);
  const raw = async (path) => { const r = await api(`${R}/raw/${encodeURIComponent(path)}`, { raw: true }); return r ? r.text() : ""; };

  // License: hand-verified value, then the API's field (newer Forgejo), then the license file text
  let spdx = curated.license || (Array.isArray(meta.licenses) && meta.licenses.length ? meta.licenses.join(" AND ") : null);
  let licenseSource = curated.license ? "verified by hand" : spdx ? "forge license detection" : "";
  if (!spdx) {
    const lf = root.find((f) => f.type === "file" && LICENSE_FILES.test(f.name));
    if (lf) { spdx = detectLicenseText(await raw(lf.name)) || "NOASSERTION"; licenseSource = `detected from ${lf.name}`; }
  }
  const lic = scoreLicense(spdx, spdxMap);
  record.license = { spdx, kind: lic.kind, label: lic.label, source: licenseSource };
  signals.license = { value: lic.value, detail: `${lic.label}${licenseSource ? ` (${licenseSource})` : ""}` };

  // Commits over the last year (paged), then the total count and first commit
  const commitsPath = `${R}/commits?sha=${encodeURIComponent(meta.default_branch)}&stat=false&verification=false&files=false`;
  const yearCommits = [];
  let truncated = false;
  for (let page = 1; page <= maxPages; page++) {
    const res = await api(`${commitsPath}&since=${sinceISO}&limit=50&page=${page}`, { raw: true });
    if (!res) break;
    const batch = await res.json();
    yearCommits.push(...batch);
    if (batch.length < 50) break;
    if (page === maxPages) truncated = true;
  }
  const people = new Map();
  const humanDates = [];
  for (const c of yearCommits) {
    const login = c.author?.login || "", name = c.commit?.author?.name || "", email = c.commit?.author?.email || "";
    if (isBot(login, name)) continue;
    const key = (login || email || name).toLowerCase();
    people.set(key, (people.get(key) || 0) + 1);
    humanDates.push(new Date(c.commit?.author?.date || c.created));
  }
  const yearTotal = [...people.values()].reduce((a, b) => a + b, 0);
  const bf = busFactor([...people.values()], yearTotal);
  const plus = truncated ? "+" : "";
  signals.bus_factor = { value: bf, detail: `${bf} ${bf === 1 ? "person wrote" : "people wrote"} half of ${fmt(yearTotal)}${plus} human commits this year` };
  signals.active_contributors = { value: people.size, detail: `${people.size}${plus} people committed in the last 12 months` };
  const recent = humanDates.filter((d) => now - d <= 90 * DAY).length;
  signals.recent_commits = { value: recent, detail: `${fmt(recent)}${truncated && recent === yearTotal ? "+" : ""} human commits in the last 90 days` };
  const gap = exactGapDays(humanDates, since, now);
  signals.longest_gap = truncated ? { value: null, detail: "Too many commits to page through in a live check" } : { value: gap, detail: gap ? `Longest quiet stretch: ${gap} days` : "Commits throughout the year" };

  const first = await api(`${commitsPath}&limit=1`, { raw: true });
  if (first) {
    const total = Number(first.headers.get("x-total-count")) || (await first.json()).length;
    signals.history = { value: total, detail: `${fmt(total)} commits in total` };
    let firstDate = meta.created_at;
    if (total > 1) {
      const oldest = await api(`${commitsPath}&limit=1&page=${total}`);
      firstDate = oldest?.[0]?.commit?.author?.date || firstDate;
    }
    const yrs = yearsBetween(firstDate, now);
    signals.age = { value: yrs, detail: `First commit ${String(firstDate).slice(0, 10)} (${yrs.toFixed(1)} years ago)` };
  }

  // Follow-through: issues and pull requests updated in the window, counted by created and closed dates
  const tally = async (type) => {
    let opened = 0, closed = 0, partial = false;
    for (let page = 1; page <= maxPages; page++) {
      const batch = await api(`${R}/issues?state=all&type=${type}&since=${sinceISO}&limit=50&page=${page}`);
      if (!batch || !batch.length) break;
      for (const i of batch) {
        if (new Date(i.created_at) >= since) opened++;
        if (i.closed_at && new Date(i.closed_at) >= since) closed++;
      }
      if (batch.length < 50) break;
      if (page === maxPages) partial = true;
    }
    return { opened, closed, partial };
  };
  const iss = meta.has_issues === false ? { opened: 0, closed: 0 } : await tally("issues");
  const prs = meta.has_pull_requests === false ? { opened: 0, closed: 0 } : await tally("pulls");
  const opened = iss.opened + prs.opened, closed = iss.closed + prs.closed;
  signals.follow_through = opened
    ? { value: Math.min(1, closed / opened), detail: `${fmt(closed)} closed vs ${fmt(opened)} opened (issues ${fmt(iss.closed)}/${fmt(iss.opened)}, pull requests ${fmt(prs.closed)}/${fmt(prs.opened)})${iss.partial || prs.partial ? ", sampled" : ""}` }
    : { value: null, detail: "No issues or pull requests opened in the last year" };

  // Releases, with tags as a fallback (Forgejo tags include their commit date)
  const rels = ((await api(`${R}/releases?draft=false&limit=50`)) || []).filter((r) => !r.draft);
  let latestDate = null, latestName = null, assets = [], count12 = 0, kind = "release";
  if (rels.length) {
    rels.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    latestDate = rels[0].published_at; latestName = rels[0].tag_name; assets = (rels[0].assets || []).map((a) => a.name);
    count12 = rels.filter((r) => new Date(r.published_at) >= since).length;
  } else {
    const tags = (await api(`${R}/tags?limit=50`)) || [];
    if (tags.length) {
      kind = "tag";
      const dated = tags.map((t) => ({ name: t.name, date: t.commit?.created })).filter((t) => t.date)
        .sort((a, b) => new Date(b.date) - new Date(a.date) || cmpVersion(b.name, a.name));
      if (dated.length) { latestDate = dated[0].date; latestName = dated[0].name; count12 = dated.filter((d) => new Date(d.date) >= since).length; }
    }
  }
  addReleaseSignals(signals, { latestDate, latestName, assets, count12, kind, now, curated });

  // Documentation
  const readme = [...names].find((n) => README.test(n));
  const docDir = [...dirs].find((d) => DOC_DIRS.test(d));
  const site = !!(meta.website && meta.website.trim()) || !!docDir;
  let docsFresh = false;
  for (const p of [docDir, readme].filter(Boolean)) {
    const c = await api(`${commitsPath}&path=${encodeURIComponent(p)}&since=${sinceISO}&limit=1`);
    if (c && c.length) { docsFresh = true; break; }
  }
  signals.docs = {
    value: (readme ? 1 : 0) / 3 + (site ? 1 : 0) / 3 + (docsFresh ? 1 : 0) / 3,
    detail: [readme ? "README ✓" : "no README", site ? "docs site/folder ✓" : "no docs site", docsFresh ? "updated this year ✓" : "not updated this year"].join(" · "),
  };

  // Security practices
  const subNames = Object.values(sub).flat();
  let secPolicy = [...names, ...subNames].some((n) => SECURITY_FILES.test(n));
  let secWhere = secPolicy ? "in the repository" : "";
  if (!secPolicy && docDir && (await listing(docDir)).some((f) => SECURITY_FILES.test(f.name))) { secPolicy = true; secWhere = `in ${docDir}/`; }
  if (curated.security_policy) { secPolicy = true; secWhere = `verified by hand: ${curated.security_policy}`; }
  signals.security_policy = { value: secPolicy ? 1 : 0, detail: secPolicy ? `Security policy found ${secWhere}` : "No SECURITY file found" };

  const depTool = [...names, ...subNames].some((n) => DEP_UPDATE_FILES.test(n));
  const ciDirs = Object.entries(sub).filter(([, files]) => files.includes("workflows")).map(([d]) => d);
  const otherCI = [...names].filter((n) => CI_ROOT.test(n) && ![".github", ".forgejo", ".gitea"].includes(n));
  const hasManifest = [...names].some((n) => MANIFESTS.test(n)) || ciDirs.length > 0;
  signals.dependency_updates = depTool
    ? { value: 1, detail: "Renovate (or Dependabot) configured" }
    : hasManifest ? { value: 0, detail: "Has dependencies but no Renovate config found" } : { value: null, detail: "No dependency files found at the top level (check skipped)" };
  signals.ci = (ciDirs.length || otherCI.length)
    ? { value: 1, detail: `CI found: ${[...ciDirs.map((d) => `${d}/workflows`), ...otherCI].join(", ")}` }
    : { value: 0, detail: "No CI configuration found" };
  signals.best_practices = curated.best_practices !== undefined ? { value: curated.best_practices, detail: "Verified by hand" } : await bestPractices(ref.url);

  // AI disclosure, policy, deprecation, code review
  record.ai = aiDisclosure(yearCommits.slice(0, 100).map((c) => ({ message: c.commit?.message, authorLogin: c.author?.login, authorName: c.commit?.author?.name })));
  record.ai.agent_files = [...names, ...subNames].filter((n) => AGENT_FILES.test(n));
  if (mode === "full") {
    const aiPolicyFile = root.find((f) => /^(AI|LLM)[-_ ]?(POLICY|USAGE|CONTRIBUTIONS?)/i.test(f.name));
    const contributing = root.find((f) => /^CONTRIBUTING/i.test(f.name));
    if (aiPolicyFile) record.ai.policy = `${ref.url}/src/branch/${meta.default_branch}/${aiPolicyFile.name}`;
    else if (contributing && AI_POLICY_RE.test(await raw(contributing.name))) record.ai.policy = `${ref.url}/src/branch/${meta.default_branch}/${contributing.name}`;
    if (readme && DEPRECATED_RE.test((await raw(readme)).slice(0, 1500))) record.status.deprecated = true;
    signals.code_review = await codeReview(api, R);
  } else {
    signals.code_review = { value: null, detail: "Checked weekly only (needs too many API calls for a live check)" };
  }

  // Backing: Forgejo returns 200 for /orgs/{name} only when the owner is an organization
  const isOrg = !!(await api(`/orgs/${ref.owner}`));
  signals.backing = backingSignal(curated, isOrg, ref.owner);

  record.context = { stars: meta.stars_count, forks: meta.forks_count, open_issues: meta.open_issues_count };
  record.scorecard = null; // OpenSSF Scorecard doesn't cover Forgejo forges
  record.signals = signals;
  record.notes = [];
  record.calls = api.count();
  return record;
}

function exactGapDays(dates, since, now) {
  const pts = [since.getTime(), ...dates.map((d) => d.getTime()).sort((a, b) => a - b), now.getTime()];
  let best = 0;
  for (let i = 1; i < pts.length; i++) best = Math.max(best, pts[i] - pts[i - 1]);
  return Math.round(best / DAY);
}

async function codeReview(api, R) {
  const closed = (await api(`${R}/pulls?state=closed&sort=recentupdate&limit=50`)) || [];
  const merged = closed.filter((p) => p.merged).slice(0, 20);
  if (!merged.length) return { value: null, detail: "No merged pull requests to check" };
  let ok = 0;
  for (const p of merged) {
    const author = p.user?.login;
    if (p.merged_by?.login && p.merged_by.login !== author) { ok++; continue; }
    const reviews = (await api(`${R}/pulls/${p.number}/reviews`)) || [];
    if (reviews.some((r) => r.state === "APPROVED" && r.user?.login !== author)) ok++;
  }
  return { value: ok / merged.length, detail: `${ok} of the last ${merged.length} merged pull requests were reviewed or merged by someone else` };
}
