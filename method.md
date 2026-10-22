---
layout: page
title: How grades work
permalink: /method/
description: Every formula, weight, and source behind OSS Fidelity's grades.
---

# How grades *work*

Every number on this site comes from public data and the formulas on this page. The weights are **judgment calls informed by research**, not facts. They're all here, each with its reason, and you can drag them on any result page to see how a different set of priorities changes the grade.

## The short version

- **Three grades:** Reliability, Maintenance, and Visible security. Each one is a weighted average of 5–6 public signals.
- **Fidelity** is the plain average of the three.
- **Letters:** {% assign prev = 0 %}{% for l in site.data.weights.letters %}{% if l.min > 0 %}{{ l.letter }} {{ l.min }}+{% else %}{{ l.letter }} below {{ prev }}{% endif %}{% assign prev = l.min %}{% unless forloop.last %} · {% endunless %}{% endfor %}.
- **GitHub projects, for now.** The collectors are built so other hosts, like Codeberg and GitLab, can be added later using the same test.
- **Never scored:** stars, downloads, and whether AI helped write the code. AI help is shown separately.

## Three building blocks

| Block | Formula | In plain English |
|---|---|---|
| Saturating count | `min(1, ln(1+x) / ln(1+T))` | "T is enough. Past that, more adds little." Borrowed from the [OpenSSF Criticality Score](https://github.com/ossf/criticality_score). |
| Freshness | `0.5 ^ (days / h)` | "Worth half as much after h days." |
| Quiet stretch | `max(0, 1 − days / max)` | "Full credit for no gap, none at the maximum." |
| Straight line | `min(1, x / max)` | "Full credit at max." |

```
grade      = 100 × Σ(weight × signal) ÷ Σ(weight of signals we could measure)
confidence = Σ(weight we could measure) ÷ Σ(all weight)  →  below {{ site.data.weights.min_confidence | times: 100 | round }}%, no letter
fidelity   = (reliability + maintenance + security) ÷ 3
```

A missing measurement is **left out**, not counted as zero. For example, a project with no issues at all doesn't get zero for follow-through. A file that is truly absent, like a missing security policy, *does* count as zero.

{% for g in site.data.weights.grades -%}
{%- assign total = 0 -%}{%- for s in g.signals -%}{%- assign total = total | plus: s.weight -%}{%- endfor %}
## {{ g.label }}

*{{ g.question }}*

<div class="table-wrap"><table>
<thead><tr><th>Signal</th><th>Measured as</th><th class="num">Weight</th><th>Why</th></tr></thead>
<tbody>
{%- for s in g.signals %}
<tr id="{{ s.id }}"><td><strong>{{ s.label }}</strong></td><td>{{ s.measure }}</td><td class="num">{{ s.weight }}<br><span class="muted small">{{ s.weight | times: 100.0 | divided_by: total | round }}%</span></td><td>{{ s.why }} <a href="{{ s.source.url }}">{{ s.source.name }}</a></td></tr>
{%- endfor %}
</tbody></table></div>
{% endfor %}

## Rules that override the math

- **Archived** repositories get Maintenance capped at 0. The owners have said it's done.
- **No license** caps Reliability at 39 (an F). Without a license, all rights are reserved, so nobody else may legally keep the code alive, however healthy it looks today.
- **Source-available licenses** (BUSL, SSPL, Elastic and similar) cap Reliability at 54 (a D). You can read the code but not freely reuse or fork it. A choice that includes an open source license, like Redis's "RSALv2 or SSPL or AGPL", counts as open.
- **"Deprecated" or "no longer maintained"** near the top of the README caps Maintenance at 10. The phrase list comes from [Coelho et al. 2020](https://arxiv.org/abs/2003.04755).
- **Moved** projects aren't graded where they left. We point you to the new home. For example, Zig's old GitHub repository now says "Moved to Codeberg."
- **Hand-verified facts** fill gaps APIs can't see: foundation backing, or licenses GitHub can't read (LLVM's). Each one is listed with its source in [`_data/projects.yml`]({{ site.source_repo }}/blob/main/_data/projects.yml).

**"Maybe finished."** A project with a weak Maintenance grade, a release in the last two years, and little open backlog is labeled *may be finished, not abandoned*. The grade itself doesn't change.

<h2 id="sensitivity">Weight-sensitive grades</h2>

Our weights are judgment calls, so every result page also re-runs the math with every signal in a grade weighted equally, the default the OECD/JRC Handbook on composite indicators recommends when there's no evidence for anything else. If a letter would change, the page says so. That tells you the grade depends on *whose* priorities you use, not only on the facts.

## Shown, never scored

**AI disclosure.** We count how many commits from the last 90 days say an AI tool helped, using `Co-authored-by` and `Assisted-by` trailers and agent bot accounts. We also note files that set a repository up for AI agents, like `AGENTS.md`. We don't score any of this:
- Agent pull requests get merged often (62–78% depending on the tool, in [Pinna et al., MSR '26](https://arxiv.org/abs/2602.08915)), but nobody has measured yet whether they make projects easier or harder to maintain.
- Low-effort AI bug reports did push curl to [end its bug bounty](https://daniel.haxx.se/blog/2026/01/26/the-end-of-the-curl-bug-bounty/) in January 2026.
- Undisclosed AI use can't be detected, so every count is a floor.

**Stars.** In July 2024, 16.66% of GitHub repositories with 50+ stars had fake-star campaigns ([He et al., ICSE 2026](https://arxiv.org/abs/2412.13459)).

**Proprietary parts.** These flags use F-Droid's [Anti-Features](https://f-droid.org/docs/Anti-Features/) vocabulary, such as paid add-ons kept under a non-free license. They're checked by hand for listed projects only.

**OpenSSF Scorecard.** For projects in Scorecard's weekly scan, we show its 0–10 score next to ours for comparison. We don't mix it in, because it doesn't cover every host we plan to support.

## Calibration

Before publishing weights, we check them against projects whose standing is widely agreed. If a result looks wrong, we adjust the thresholds (the T values), never an individual project's score, and record the change below.

{% assign demo = "github.com/llvm/llvm-project|Should be near the top,github.com/msu/pika-orm|Middle to lower: young and mostly one person" | split: "," -%}
<div class="table-wrap"><table>
<thead><tr><th>Project</th><th>Expectation</th><th class="num">Fidelity</th><th class="num">Rel.</th><th class="num">Maint.</th><th class="num">Sec.</th></tr></thead>
<tbody>
{%- for d in demo %}{% assign kv = d | split: "|" %}{% assign s = site.data.scores.projects | where: "id", kv[0] | first %}
<tr><td><a href="{{ '/check/' | relative_url }}?r={{ kv[0] }}">{{ kv[0] }}</a></td><td>{{ kv[1] }}</td>
{%- if s.computed.fidelity %}<td class="num">{{ s.computed.fidelity.letter }} {{ s.computed.fidelity.score }}</td><td class="num">{{ s.computed.grades.reliability.score }}</td><td class="num">{{ s.computed.grades.maintenance.score }}</td><td class="num">{{ s.computed.grades.security.score }}</td>
{%- else %}<td class="num" colspan="4">next weekly run</td>{% endif %}</tr>
{%- endfor %}
</tbody></table></div>

## Limits

- Grades describe **habits you can see from outside**, not code quality. A well-run project can still ship a bug.
- **Security only sees practices visible on GitHub.** Signal is a good example. It publishes its security contact on its website and ships through app stores, so many of its practices are invisible here, and its Security grade is lower than its reputation.
- **Live checks are limited.** GitHub allows about 60 requests an hour per network without an account. When the site's GitHub proxy is running, live checks go through it instead: it holds a read-only token, caches answers, and keeps no logs. Without it, code review comes from the weekly run.
- **Low activity can mean "finished."** In one study, 41% of maintainers whose projects looked inactive said the software was simply done ([Coelho et al. 2020](https://arxiv.org/abs/2003.04755)). Read the reasons before judging.

## Disagree?

Good. That's the point of publishing the weights. Drag the sliders on any result, or [open an issue]({{ site.source_repo }}/issues) to argue for a different weight.

## Changelog

- **{{ site.data.weights.updated }} · v{{ site.data.weights.version }}**: No weights changed. Fixes from an outside review: release candidates and betas no longer count as the latest release; licenses are recognized from short notices, SPDX names, and "your choice of" files; follow-through leaves out bot pull requests and stale-bot closures; code review now checks the latest 30 changes on the main branch, the way OpenSSF Scorecard does, so changes pushed without review count against it and bots don't count as reviewers; AI disclosure uses a fixed 90-day window; no license and source-available licenses now cap Reliability; Security is renamed *Visible security*.
- **2026-10-21 · v1.0**: First published weights. Maintenance is built on Coelho et al.'s strongest predictors, Security uses OpenSSF Scorecard's risk weights, and license moved into Reliability.
