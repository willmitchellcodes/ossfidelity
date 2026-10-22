// GitHub collector: public REST API, with an optional token.
// mode "live" (browser, no token): the cheapest set of calls.
// mode "full" (weekly Action, with token): adds README and CONTRIBUTING checks.
// Code review needs GraphQL, so it runs whenever there is a token or a proxy that holds one.
// proxy: base URL of OSS Fidelity's GitHub proxy (proxy/worker.js). Requests go there first
// and fall back to api.github.com if it can't be reached.

import { makeClient, RateLimitError, sleep } from "../http.js";
import {
  DAY, isBot, aiDisclosure, AI_POLICY_RE, DEPRECATED_RE, detectLicenseText, scoreLicense, LICENSE_FILES,
  SECURITY_FILES, DEP_UPDATE_FILES, CI_ROOT, MANIFESTS, DOC_DIRS, README, SIG_ASSET, SUM_ASSET, AGENT_FILES,
  longestGapDays, busFactor, daysBetween, yearsBetween, commitListStats, exactGapDays,
  stableReleases, stableTags, codeReviewFromHistory, followThroughQueries, followThroughPlainQueries,
} from "../util.js";
import { CODE_REVIEW_QUERY } from "../queries.js";

const RAW = "application/vnd.github.raw+json";

export async function collectGitHub(ref, { token, proxy, mode = "live", now = new Date(), spdxMap = {}, curated = {}, log = () => {} } = {}) {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  // The weekly job can afford to wait for GitHub to finish computing statistics.
  const api = makeClient(proxy || "https://api.github.com", { headers, waitOnLimit: mode === "full", onRequest: log,
    tries202: mode === "full" ? 4 : 3, wait202Ms: mode === "full" ? 2500 : 1500,
    fallbackBase: proxy ? "https://api.github.com" : null });
  const R = `/repos/${ref.owner}/${ref.repo}`;
  const since = new Date(now - 365 * DAY);
  const sinceISO = since.toISOString();
  const sinceDay = sinceISO.slice(0, 10);
  const signals = {};
  const notes = [];

  // 1. Repository metadata
  const meta = await api(R);
  if (!meta) throw new Error("Repository not found (or private).");
  const record = baseRecord(ref, meta, now, mode);
  const movedTo = findMove(meta.description, meta.homepage, ref);
  record.status = {
    archived: !!meta.archived,
    fork: meta.fork ? meta.parent?.full_name || true : false,
    mirror: meta.mirror_url || null,
    moved_to: movedTo,
    deprecated: false,
  };
  if (movedTo) return record; // The project's real home is elsewhere, so we grade that instead.

  // 2. Files at the root and in .github
  const root = (await api(`${R}/contents`)) || [];
  const names = new Set(root.map((f) => f.name));
  const dirs = new Set(root.filter((f) => f.type === "dir").map((f) => f.name));
  const dotgh = dirs.has(".github") ? ((await api(`${R}/contents/.github`)) || []).map((f) => f.name) : [];

  // 3. License (curated value, then the API, then the text of the license file)
  let spdx = curated.license || meta.license?.spdx_id || null;
  let licenseSource = curated.license ? "verified by hand" : "GitHub license detection";
  if (!curated.license && (!spdx || spdx === "NOASSERTION" || spdx === "OTHER")) {
    const lf = root.find((f) => f.type === "file" && LICENSE_FILES.test(f.name));
    if (lf) {
      const res = await api(`${R}/contents/${encodeURIComponent(lf.name)}`, { raw: true, accept: RAW });
      const detected = detectLicenseText(res ? await res.text() : "", Object.keys(spdxMap));
      if (detected) { spdx = detected; licenseSource = `detected from ${lf.name}`; }
      else spdx = spdx || "NOASSERTION";
    }
  }
  const lic = scoreLicense(spdx, spdxMap);
  record.license = { spdx, kind: lic.kind, label: lic.label, source: licenseSource };
  signals.license = { value: lic.value, detail: `${lic.label} (${licenseSource})` };

  // 4. Commit history: per-contributor weekly stats plus weekly totals
  const contrib = await api(`${R}/stats/contributors`);
  const activity = await api(`${R}/stats/commit_activity`);
  const cutoffSec = since.getTime() / 1000;
  let humanWeekly = null;
  if (Array.isArray(activity) && activity.length) {
    humanWeekly = activity.map((w) => w.total);
    if (Array.isArray(contrib)) {
      // Subtract bot commits week by week so bots never count as activity.
      const botByWeek = new Map();
      for (const c of contrib) if (isBot(c.author?.login, "", c.author?.type))
        for (const w of c.weeks) botByWeek.set(w.w, (botByWeek.get(w.w) || 0) + w.c);
      humanWeekly = activity.map((w) => Math.max(0, w.total - (botByWeek.get(w.week) || 0)));
    }
  }
  if (Array.isArray(contrib)) {
    const humans = contrib.filter((c) => !isBot(c.author?.login, "", c.author?.type));
    const yearCounts = humans.map((c) => c.weeks.filter((w) => w.w >= cutoffSec).reduce((a, w) => a + w.c, 0));
    const active = yearCounts.filter((n) => n > 0).length;
    const yearTotal = humanWeekly ? humanWeekly.reduce((a, b) => a + b, 0) : undefined;
    const truncated = contrib.length >= 100;
    const bf = busFactor(yearCounts, yearTotal);
    signals.bus_factor = { value: bf, detail: `${bf}${truncated && bf >= active ? "+" : ""} ${bf === 1 ? "person wrote" : "people wrote"} half of ${fmt(yearTotal ?? sum(yearCounts))} human commits this year` };
    signals.active_contributors = { value: active, detail: `${active}${truncated ? "+" : ""} people committed in the last 12 months` };
  }
  if (humanWeekly) {
    const recent = humanWeekly.slice(-13).reduce((a, b) => a + b, 0);
    const gap = longestGapDays(humanWeekly);
    signals.recent_commits = { value: recent, detail: `${fmt(recent)} human commits in the last 90 days` };
    signals.longest_gap = { value: gap, detail: gap ? `Longest quiet stretch: about ${gap} days` : "Commits every week this year" };
  }
  // Fallback: GitHub hadn't finished computing statistics, so count a year of commits directly.
  if (!Array.isArray(contrib) || !humanWeekly) {
    const maxPages = mode === "full" ? 50 : 3;
    const list = [];
    let truncated = false;
    for (let page = 1; page <= maxPages; page++) {
      const batch = await api(`${R}/commits?since=${sinceISO}&per_page=100&page=${page}`);
      if (!batch || !batch.length) break;
      for (const c of batch) list.push({ login: c.author?.login || "", name: c.commit?.author?.name || "", email: c.commit?.author?.email || "", date: c.commit?.author?.date });
      if (batch.length < 100) break;
      if (page === maxPages) truncated = true;
    }
    const { people, dates } = commitListStats(list, now, since);
    const total = [...people.values()].reduce((a, b) => a + b, 0);
    const plus = truncated ? "+" : "";
    const via = " (counted from the commit list)";
    if (!Array.isArray(contrib)) {
      const bf = busFactor([...people.values()], total);
      signals.bus_factor = { value: bf, detail: `${bf} ${bf === 1 ? "person wrote" : "people wrote"} half of ${fmt(total)}${plus} human commits this year${via}` };
      signals.active_contributors = { value: people.size, detail: `${people.size}${plus} people committed in the last 12 months${via}` };
    }
    if (!humanWeekly) {
      const recent = dates.filter((d) => now - d <= 90 * DAY).length;
      signals.recent_commits = { value: recent, detail: `${fmt(recent)}${truncated && recent === total ? "+" : ""} human commits in the last 90 days${via}` };
      const gap = exactGapDays(dates, truncated ? new Date(Math.min(...dates.map(Number))) : since, now);
      signals.longest_gap = { value: gap, detail: (gap ? `Longest quiet stretch: ${gap} days` : "Commits throughout the year") + via };
    }
  }

  // 5. Total commits and the first commit's date (Link header trick)
  const firstPage = await api(`${R}/commits?per_page=1`, { raw: true });
  if (firstPage) {
    const lastLink = /<([^>]+)>;\s*rel="last"/.exec(firstPage.headers.get("link") || "");
    const total = lastLink ? Number(new URL(lastLink[1]).searchParams.get("page")) : 1;
    signals.history = { value: total, detail: `${fmt(total)} commits in total` };
    let firstDate = meta.created_at;
    if (lastLink) {
      // GitHub's Link header points at /repositories/{id}/...; ask for the same page under /repos/
      // so it stays within the paths the proxy forwards (and shares its cache).
      const oldest = await api(`${R}/commits?per_page=1&page=${total}`);
      firstDate = oldest?.[0]?.commit?.author?.date || firstDate;
    } else {
      const only = await firstPage.json();
      firstDate = only?.[0]?.commit?.author?.date || firstDate;
    }
    const yrs = yearsBetween(firstDate, now);
    signals.age = { value: yrs, detail: `First commit ${firstDate.slice(0, 10)} (${yrs.toFixed(1)} years ago)` };
  }

  // 6. Follow-through: issues and pull requests opened vs closed, last 12 months (search API).
  // Bot pull requests and stale-bot closures are left out (see followThroughQueries). Search is
  // GitHub's most limited API, so a search problem leaves this one signal unmeasured, never the
  // whole project: filtered counts first, plain counts if GitHub refuses the filters, else nothing.
  const count = async (s) => {
    if (mode === "full") await sleep(2500); // at most ~24 searches a minute, under GitHub's 30
    return (await api(`/search/issues?per_page=1&q=${encodeURIComponent(`repo:${ref.owner}/${ref.repo} ${s}`)}`))?.total_count ?? null;
  };
  const four = async (qs) => [await count(qs.issuesOpened), await count(qs.issuesClosed), await count(qs.prsOpened), await count(qs.prsClosed)];
  try {
    let note = "bots and stale-bot closures left out";
    let counts;
    try { counts = await four(followThroughQueries(sinceDay)); } catch (e) {
      if (e instanceof RateLimitError) throw e;
      note = "bots included: GitHub refused the bot filters this time";
      counts = await four(followThroughPlainQueries(sinceDay));
    }
    const [io, ic, po, pc] = counts;
    const opened = (io || 0) + (po || 0), closed = (ic || 0) + (pc || 0);
    signals.follow_through = opened
      ? { value: Math.min(1, closed / opened), detail: `${fmt(closed)} closed vs ${fmt(opened)} opened (issues ${fmt(ic)}/${fmt(io)}, pull requests ${fmt(pc)}/${fmt(po)}; ${note})` }
      : { value: null, detail: "No issues or pull requests opened in the last year" };
  } catch (e) {
    signals.follow_through = { value: null, detail: e instanceof RateLimitError ? "GitHub's search limit was reached, so this wasn't measured this time" : "GitHub's search didn't answer, so this wasn't measured this time" };
  }

  // 7. Releases, with tags as a fallback
  // Prereleases (release candidates, betas, nightlies) only count when there is nothing else,
  // so a fresh rc doesn't stand in for the release people actually install.
  const { list: rels, kind: relKind } = stableReleases((await api(`${R}/releases?per_page=100`)) || []);
  let latestDate = null, latestName = null, assets = [], count12 = 0, kind = relKind;
  if (rels.length) {
    rels.sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
    latestDate = rels[0].published_at; latestName = rels[0].tag_name; assets = rels[0].assets.map((a) => a.name);
    count12 = rels.filter((r) => new Date(r.published_at) >= since).length;
  } else {
    const tags = (await api(`${R}/tags?per_page=100`)) || [];
    if (tags.length) {
      kind = "tag";
      const top = stableTags(tags).slice().sort((a, b) => cmpVersion(b.name, a.name)).slice(0, mode === "full" ? 6 : 1);
      const dated = [];
      for (const t of top) { const c = await api(`${R}/commits/${t.commit.sha}`); if (c) dated.push({ name: t.name, date: c.commit.committer.date }); }
      dated.sort((a, b) => new Date(b.date) - new Date(a.date));
      if (dated.length) { latestDate = dated[0].date; latestName = dated[0].name; }
      count12 = mode === "full" ? dated.filter((d) => new Date(d.date) >= since).length : null;
    }
  }
  addReleaseSignals(signals, { latestDate, latestName, assets, count12, kind, now, curated });

  // 8. Documentation
  const readme = [...names].find((n) => README.test(n));
  const docDir = [...dirs].find((d) => DOC_DIRS.test(d));
  const site = !!(meta.homepage && meta.homepage.trim()) || !!docDir || meta.has_pages;
  let docsFresh = false;
  for (const p of [docDir, readme].filter(Boolean)) {
    const c = await api(`${R}/commits?per_page=1&since=${sinceISO}&path=${encodeURIComponent(p)}`);
    if (c && c.length) { docsFresh = true; break; }
  }
  signals.docs = {
    value: (readme ? 1 : 0) / 3 + (site ? 1 : 0) / 3 + (docsFresh ? 1 : 0) / 3,
    detail: [readme ? "README ✓" : "no README", site ? "docs site/folder ✓" : "no docs site", docsFresh ? "updated this year ✓" : "not updated this year"].join(" · "),
  };

  // 9. Security practices
  let secPolicy = [...names].some((n) => SECURITY_FILES.test(n)) || dotgh.some((n) => SECURITY_FILES.test(n));
  let secWhere = secPolicy ? "in the repository" : "";
  if (!secPolicy && docDir) {
    const d = (await api(`${R}/contents/${docDir}`)) || [];
    if (d.some((f) => SECURITY_FILES.test(f.name))) { secPolicy = true; secWhere = `in ${docDir}/`; }
  }
  if (!secPolicy) {
    const org = (await api(`/repos/${ref.owner}/.github/contents`)) || [];
    if (org.some((f) => SECURITY_FILES.test(f.name))) { secPolicy = true; secWhere = `organization-wide (${ref.owner}/.github)`; }
  }
  if (curated.security_policy) { secPolicy = true; secWhere = `verified by hand: ${curated.security_policy}`; }
  signals.security_policy = { value: secPolicy ? 1 : 0, detail: secPolicy ? `Security policy found ${secWhere}` : "No SECURITY file found" };

  const depTool = dotgh.some((n) => DEP_UPDATE_FILES.test(n)) || [...names].some((n) => DEP_UPDATE_FILES.test(n));
  const hasWorkflows = dotgh.includes("workflows");
  const hasManifest = [...names].some((n) => MANIFESTS.test(n)) || hasWorkflows;
  signals.dependency_updates = depTool
    ? { value: 1, detail: "Dependabot or Renovate configured" }
    : hasManifest ? { value: 0, detail: "Has dependencies but no Dependabot or Renovate config found" } : { value: null, detail: "No dependency files found at the top level (check skipped)" };

  const otherCI = [...names].filter((n) => CI_ROOT.test(n) && n !== ".github");
  signals.ci = (hasWorkflows || otherCI.length)
    ? { value: 1, detail: `CI found: ${[hasWorkflows ? "GitHub Actions" : null, ...otherCI].filter(Boolean).join(", ")}` }
    : { value: 0, detail: "No CI configuration found" };

  signals.best_practices = await bestPractices(ref.url);
  if (curated.best_practices !== undefined) signals.best_practices = { value: curated.best_practices, detail: "Verified by hand" };

  // 10. AI disclosure over a fixed 90-day window, so busy and quiet projects are compared over
  // the same stretch of time (the latest 100 commits span hours for some projects, months for others).
  const aiSince = new Date(now - 90 * DAY).toISOString();
  const aiPages = mode === "full" ? 10 : 1;
  const recentCommits = [];
  let aiTruncated = false;
  for (let page = 1; page <= aiPages; page++) {
    const batch = (await api(`${R}/commits?since=${aiSince}&per_page=100&page=${page}`)) || [];
    recentCommits.push(...batch);
    if (batch.length < 100) break;
    if (page === aiPages) aiTruncated = true;
  }
  record.ai = aiDisclosure(recentCommits.map((c) => ({ message: c.commit.message, authorLogin: c.author?.login, authorName: c.commit.author?.name })));
  record.ai.window_days = 90;
  record.ai.truncated = aiTruncated;
  record.ai.agent_files = [...names, ...dotgh].filter((n) => AGENT_FILES.test(n));
  if (mode === "full") {
    const contributing = root.find((f) => /^CONTRIBUTING/i.test(f.name)) || null;
    const aiPolicyFile = root.find((f) => /^(AI|LLM)[-_ ]?(POLICY|USAGE|CONTRIBUTIONS?)/i.test(f.name));
    if (aiPolicyFile) record.ai.policy = `${ref.url}/blob/${meta.default_branch}/${aiPolicyFile.name}`;
    else if (contributing) {
      const t = await (await api(`${R}/contents/${contributing.name}`, { raw: true, accept: RAW }))?.text();
      if (t && AI_POLICY_RE.test(t)) record.ai.policy = `${ref.url}/blob/${meta.default_branch}/${contributing.name}`;
    }
    if (readme) {
      const t = await (await api(`${R}/readme`, { raw: true, accept: RAW }))?.text();
      if (t && DEPRECATED_RE.test(t.slice(0, 1500))) record.status.deprecated = true;
    }
  }
  signals.code_review = token || proxy
    ? await codeReview(api, ref)
    : { value: null, detail: "Checked in the weekly run only (live checks need the site's GitHub proxy)" };

  // 11. Backing
  signals.backing = backingSignal(curated, meta.owner?.type === "Organization", meta.owner?.login);

  // Context: shown but never scored
  record.context = { stars: meta.stargazers_count, forks: meta.forks_count, open_issues: meta.open_issues_count };
  record.scorecard = await scorecard(ref);
  record.signals = signals;
  record.notes = notes;
  record.calls = api.count();
  return record;
}

// ---------- shared pieces (also used by the Forgejo collector) ----------

export function baseRecord(ref, meta, now, mode) {
  return {
    id: ref.id, forge: ref.forge, host: ref.host, owner: ref.owner, repo: ref.repo, url: ref.url,
    name: meta.name, description: meta.description || "", homepage: meta.homepage || meta.website || "",
    scored_at: now.toISOString(), mode,
  };
}

export function findMove(description = "", homepage = "", ref = {}) {
  const d = description || "";
  if (!/\b(moved|migrated|relocated)\b|\bnew home\b/i.test(d)) return null;
  const named = /codeberg/i.test(d) ? "Codeberg" : /gitlab/i.test(d) ? "GitLab" : /sourcehut|sr\.ht/i.test(d) ? "SourceHut" : null;
  const inText = (d.match(/https?:\/\/\S+/) || [])[0];
  // "Moved to Codeberg" usually keeps the same owner/name, so suggest that address.
  const guess = named === "Codeberg" && ref.owner ? `https://codeberg.org/${ref.owner}/${ref.repo}` : null;
  return { text: d, url: inText || guess || homepage || null, named, announcement: homepage || null };
}

export function addReleaseSignals(signals, { latestDate, latestName, assets, count12, kind, now, curated }) {
  if (latestDate) {
    const days = daysBetween(latestDate, now);
    signals.release_freshness = { value: days, detail: `Latest ${kind} ${latestName}: ${latestDate.slice(0, 10)} (${days} days ago)` };
    signals.release_cadence = count12 === null
      ? { value: null, detail: "Tag dates checked weekly only" }
      : { value: count12, detail: `${count12} ${kind}${count12 === 1 ? "" : "s"} in the last 12 months` };
    const sig = assets.some((a) => SIG_ASSET.test(a)), sums = assets.some((a) => SUM_ASSET.test(a));
    signals.release_integrity = sig ? { value: 1, detail: "Signature files attached to the latest release" }
      : sums ? { value: 0.5, detail: "Checksums attached, no signatures" }
      : { value: 0, detail: kind === "tag" ? "Tags only, with no signed files attached on the forge" : "No signatures or checksums attached" };
  } else {
    signals.release_freshness = { value: 99999, detail: "No public releases or tags" };
    signals.release_cadence = { value: 0, detail: "No public releases" };
    signals.release_integrity = { value: null, detail: "No releases to check" };
  }
  if (curated.signed_releases) signals.release_integrity = { value: 1, detail: `Verified by hand: ${curated.signed_releases}` };
}

export function backingSignal(curated, isOrg, owner) {
  if (curated.backing) return { value: 1, detail: `${curated.backing} (foundation or nonprofit, verified by hand)` };
  return isOrg ? { value: 0.6, detail: `Owned by the organization "${owner}"` } : { value: 0.3, detail: `Owned by the personal account "${owner}"` };
}

export async function bestPractices(url) {
  try {
    const res = await fetch(`https://www.bestpractices.dev/projects.json?url=${encodeURIComponent(url)}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error();
    const list = await res.json();
    const p = (Array.isArray(list) ? list : []).find((x) => (x.repo_url || "").replace(/\/$/, "").toLowerCase() === url.toLowerCase());
    if (!p) return { value: 0, detail: "No OpenSSF Best Practices badge found" };
    const lvl = p.badge_level || "in_progress";
    const v = lvl === "gold" || lvl === "silver" ? 1 : lvl === "passing" ? 0.5 : 0;
    return { value: v, detail: `Best Practices badge: ${lvl}`, url: `https://www.bestpractices.dev/projects/${p.id}` };
  } catch {
    return { value: null, detail: "Couldn't reach bestpractices.dev" };
  }
}

// Scorecard moved its API to api.scorecard.dev; the old hostname is kept as a fallback.
const SCORECARD_HOSTS = ["https://api.scorecard.dev", "https://api.securityscorecards.dev"];
async function scorecard(ref) {
  for (const host of SCORECARD_HOSTS) {
    try {
      const res = await fetch(`${host}/projects/github.com/${ref.owner}/${ref.repo}`, { signal: AbortSignal.timeout(15000) });
      if (res.status === 404) return null; // not in Scorecard's weekly scan
      if (!res.ok) continue;
      const j = await res.json();
      return { score: j.score, date: j.date, url: `https://scorecard.dev/viewer/?uri=github.com/${ref.owner}/${ref.repo}` };
    } catch { /* try the next host */ }
  }
  return null;
}

// Latest 30 changes on the default branch, checked the way OpenSSF Scorecard does it.
async function codeReview(api, ref) {
  let j;
  try {
    j = await api("/graphql", { method: "POST", body: { query: CODE_REVIEW_QUERY, variables: { o: ref.owner, r: ref.repo } } });
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    return { value: null, detail: "Code review check failed" };
  }
  const branch = j?.data?.repository?.defaultBranchRef;
  const nodes = branch?.target?.history?.nodes;
  if (!Array.isArray(nodes)) return { value: null, detail: "Code review check failed" };
  const r = codeReviewFromHistory(nodes);
  if (!r.human) return { value: null, detail: r.bots ? "Only bot changes recently, so nothing to check" : "No changes to check" };
  return {
    value: r.reviewed / r.human,
    detail: `${r.reviewed} of the last ${r.human} human changes on ${branch.name} were approved or merged by someone else`
      + (r.direct ? ` · ${r.direct} pushed straight to the branch` : ""),
  };
}

export function cmpVersion(a, b) {
  const pa = (a.match(/\d+/g) || []).map(Number), pb = (b.match(/\d+/g) || []).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] ?? -1) - (pb[i] ?? -1); if (d) return d; }
  return 0;
}

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const fmt = (n) => (n === null || n === undefined ? "?" : Number(n).toLocaleString("en-US"));
