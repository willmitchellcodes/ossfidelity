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
| AI privacy `/ai-privacy/`: 7-question matrix with sources and red flags | Built; 21 of 63 cells verified |
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
| D16 | AI privacy: equal weights + red-flag caps at 40 (research recommendation) | Built. Will to confirm (v0 proposed unequal weights) |
| D17 | Hand-verified facts in projects.yml must cite a source (LLVM license, Zig signatures, foundations) | Built |
| D18 | Relicense watch compares real SPDX ids only between weekly runs | Built |
| D19 | The site's own license | **Ask Will** |
| D21 | Model benchmark: 30 script-graded questions on invented facts (rules, sticks to source, admits "not in the text", consistency), llama.cpp on GitHub's free CPU runner; gpt-oss-20b skipped as too big | Built |
| D22 | Discovery opens a monthly issue of candidates; never auto-adds | Built |
| D23 | Result pages flag weight-sensitive letters (equal-weight re-run) and label quiet projects "may be finished" | Built |
| D24 | Signal-style blind spot: Security only sees GitHub-visible practices; documented on Method. Hand-verified evidence vs. relabel still **Ask Will** | Documented |
| D20 | **v1 is GitHub only** (projects + open-weight models). Codeberg, self-hosted Forgejo, and GitLab are parked; `forges/forgejo.js` stays in the repo, dormant | Decided by Will (Oct 21) |

## Next

1. Push to github.com/willmitchellcodes/ossfidelity. Run **Weekly scoring** once to grade the curated list.
2. DNS for ossfidelity.com (see README).
3. Verification pass: the remaining privacy cells, model openness against the OSAI Index, and local-AI app telemetry.
4. Cross-check model openness against the OSAI Index; verify remaining AI-privacy cells. Later: Codeberg and GitLab.
