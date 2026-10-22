# Methodology

The published methodology now lives in [`../method.md`](../method.md) (rendered at ossfidelity.com/method/). It builds its tables directly from `_data/weights.json`, the same file the formula reads, so the docs and the math can't drift apart.

This file held the v0 draft from planning (Oct 21, 2026). Here's what changed after the research report:
- Maintenance is now built on Coelho et al. 2020's strongest predictors: recent commits, longest quiet stretch, follow-through, releases, and docs.
- Security weights copy OpenSSF Scorecard's risk levels.
- License is both a Reliability signal (an open license means the project can be forked) and a visible badge.
- AI privacy uses equal weights with red-flag caps, replacing the v0 unequal weights. This is pending Will's decision.
