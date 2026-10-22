# Site plan and decision log

**Purpose:** paste a link or search for a project, and get three grades with plain-English reasons.
**Stack:** Jekyll on GitHub Pages (deployed by Actions), vanilla JS modules, weekly scoring Action, custom domain ossfidelity.com.

## Pages

| Page | Status |
|---|---|
| Home `/`: search or paste, demo links, "what we never score" | Built |
| Check `/check/?r=host/owner/repo`: three grades, Fidelity, "Why?" breakdown, weight sliders, host checks, AI disclosure | Built |
| Browse `/browse/`: weekly leaderboard with category and host filters | Built |
| Models `/models/`: openness (OSI's three parts) with evidence from each model card, laptop fit, sign-up flags, verified-task benchmark | Built; openness checked against model cards Oct 21; benchmark runs monthly |
| AI privacy `/ai-privacy/`: 7-question matrix with sources and red flags | Built; all 63 cells verified Oct 21, 2026 |
| Method `/method/`: every formula, weight, reason, source, and the calibration table | Built |

## Calibration (Oct 21, 2026)

| Project | Expected | Result |
|---|---|---|
| github.com/llvm/llvm-project | Top | A 99 (R 100 · M 97 · S 100) |
| github.com/msu/pika-orm | Medium to low | D 44 (R 55 · M 76 · S 0) |
| github.com/ziglang/zig | n/a | Detected as "moved to Codeberg"; links out to the new home |

## Decision log

| # | Decision | Status |
|---|---|---|
| D1 | Three grades plus **Fidelity** = their plain average (named for the domain) | Built. Will to confirm the overall number |
| D2 | License is a Reliability signal (15%) **and** a badge; non-open projects get a banner and are kept off Browse | Built |
| D3 | Stars and downloads are never scored | Built |
| D4 | AI-assisted commits are disclosed, not scored; agent setup files (AGENTS.md…) are shown too | Decided by Will |
| D5 | Proprietary-parts flags use F-Droid anti-features, hand-checked, curated projects only | Built (Bitwarden flagged) |
| D6 | Undisclosed privacy answers score 0; unverified cells are never scored | Built |
| D7 | Weekly cache first, live check second (60 requests/hour limit) | Built |
| D8 | One scoring module shared by the browser and the Action | Built |
| D9 | Letter + number grades | Decided by Will |
| D10 | The 7 privacy questions apply to services and apps, not to model weights | Built |
| D11 | New Browse entries are added by PR or issue, never automatically | Built |
| D12 | No analytics or cookies; fonts self-hosted; strict CSP | Built |
| D13 | Deck palette, Inter + JetBrains Mono | Decided by Will |
| D14 | GitLab (KDE, GNOME, Inkscape) | Next. Couldn't test from the sandbox |
| D15 | **Host checks** (nonprofit, no AI training, open platform, scraper defense) are shown separately, never mixed into grades; uptime isn't scored | Built. GitHub only for now; confirm it stays out of Fidelity |
| D16 | AI privacy: no single grade. Show "protections on by default x/7" and "with settings y/7", plus red flags (problems no setting fixes) | Built (replaces the equal-weight letter grade with a cap at 40) |
| D17 | Hand-verified facts in projects.yml must cite a source (LLVM license, Zig signatures, foundations) | Built |
| D18 | Relicense watch compares real SPDX ids only between weekly runs | Built |
| D19 | The site's own license | **Ask Will** |
| D21 | Model benchmark: 30 script-graded questions on invented facts (rules, sticks to source, admits "not in the text", consistency), llama.cpp on GitHub's free CPU runner; gpt-oss-20b skipped as too big | Built |
| D22 | Discovery opens a monthly issue of candidates; never auto-adds | Built |
| D23 | Result pages flag weight-sensitive letters (equal-weight re-run) and label quiet projects "may be finished" | Built |
| D24 | Signal-style blind spot: Security only sees GitHub-visible practices; documented on Method | Relabeled as "Visible security" (D27) |
| D25 | Host card removed from result pages ("Hosted on GitHub" now sits in the page kicker); every expandable card shows a chevron | Asked by Will (Oct 21) |
| D26 | License caps (non-compensatory): no license caps Reliability at 39 (F), source-available at 54 (D). A choice that includes an open license ("RSALv2 OR SSPL OR AGPL") counts as open | Built (outside review, Oct 21) |
| D27 | Security grade renamed **Visible security**; the question says practices kept elsewhere don't show | Built (outside review) |
| D28 | Code review checks the latest 30 default-branch changes, Scorecard's method: direct pushes count as unreviewed, bots and AI reviewers don't count. Follow-through leaves out bot PRs and stale-bot closures. Prereleases count only when there's no stable release. AI disclosure uses a fixed 90-day window | Built (outside review) |
| D29 | Letters come from the rounded number shown (Jan's "85" was showing a B) | Built |
| D30 | **GitHub App** for the weekly job, and an optional **Cloudflare Worker proxy** for live checks and search: read-only allowlist, only queries in `queries.js`, cached, no logs. The site falls back to GitHub directly when it's unset or down | Built; **Will** creates the App and deploys the Worker (`proxy/README.md`) |
| D31 | Joplin flagged NonFreeAdd: Joplin Server is under a non-open Personal Use License | Built |
| D20 | **v1 is GitHub only** (projects + open-weight models). Codeberg, self-hosted Forgejo, and GitLab are parked; `forges/forgejo.js` stays in the repo, dormant | Decided by Will (Oct 21) |

## Next

1. Create the GitHub App, run `node proxy/check-token.mjs`, then deploy the proxy and set `github_proxy` (see `proxy/README.md`). Before the workshop, add every project the deck mentions to `projects.yml`.
2. DNS for ossfidelity.com (see README), then re-add the custom domain.
3. Local-AI app telemetry (Jan, Ollama, PocketPal AI) for the "Local isn't automatically private" section.
4. Cross-check model openness against the OSAI Index. Later: Codeberg and GitLab.
5. Re-check privacy cells before the workshop; Copilot's Aug. 2026 app change and Meta's Incognito Chat rollout are the likeliest to move.
