// OSS Fidelity: the scoring formula.
// This file is pure: it turns raw signals into grades with no network calls.
// The browser and the weekly GitHub Action both use it, so live and cached
// grades always agree. The weights live in _data/weights.json.

export const NORMS = {
  // Saturating log scale from the OpenSSF Criticality Score:
  // "T is enough, and past that, more adds little."
  sat: (x, { T }) => (x <= 0 ? 0 : Math.min(1, Math.log1p(x) / Math.log1p(T))),
  // Straight line up to `max`.
  linear: (x, { max }) => clamp(x / max),
  // Half-life decay: worth half after `h` days.
  fresh: (days, { h }) => Math.pow(0.5, Math.max(0, days) / h),
  // Inverted gap: 0 days is full credit, `max` days or more is none.
  gap: (days, { max }) => clamp(1 - days / max),
  // Already a 0–1 value (ratios and tiers).
  unit: (x) => clamp(x),
};

export function clamp(x, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, x));
}

export function letterFor(score, letters) {
  for (const { min, letter } of letters) if (score >= min) return letter;
  return letters[letters.length - 1].letter;
}

// Status rules that override the math. They're shown on the Method page.
export const OVERRIDES = {
  archived: { grade: "maintenance", cap: 0, note: "The owners archived this repository (read-only)." },
  deprecated: { grade: "maintenance", cap: 10, note: "The README says this project is deprecated or unmaintained." },
};

/**
 * record.signals: { [id]: { value: number|null, detail?: string } }
 * value === null (or missing) means "not available", and that signal is
 * left out of the grade. Lower confidence is reported instead.
 * weights: parsed _data/weights.json
 * custom:  optional { [signalId]: weight } overrides from the "tune" sliders
 */
export function computeGrades(record, weights, custom = {}) {
  const out = { grades: {}, fidelity: null };
  const status = record.status || {};
  for (const g of weights.grades) {
    let total = 0, have = 0, sum = 0;
    const parts = g.signals.map((s) => {
      const w = custom[s.id] ?? s.weight;
      total += w;
      const sig = record.signals?.[s.id];
      const v = sig?.value;
      if (v === null || v === undefined || Number.isNaN(v)) {
        return { id: s.id, label: s.label, weight: w, na: true, detail: sig?.detail };
      }
      const norm = NORMS[s.norm.type](v, s.norm);
      have += w;
      sum += w * norm;
      return { id: s.id, label: s.label, weight: w, raw: v, norm, points: w * norm, detail: sig?.detail };
    });
    const confidence = total ? have / total : 0;
    let score = have ? (100 * sum) / have : null;
    const notes = [];
    for (const [flag, rule] of Object.entries(OVERRIDES)) {
      if (status[flag] && rule.grade === g.id && score !== null && score > rule.cap) {
        score = rule.cap;
        notes.push(rule.note);
      }
    }
    // Points as a share of 100, so the breakdown adds up to the grade.
    for (const p of parts) if (!p.na) p.share = have ? (100 * p.points) / have : 0;
    const enough = confidence >= weights.min_confidence && score !== null;
    out.grades[g.id] = {
      id: g.id,
      label: g.label,
      score: enough ? Math.round(score) : null,
      letter: enough ? letterFor(score, weights.letters) : "?",
      confidence,
      parts,
      notes,
    };
  }
  const scored = Object.values(out.grades).filter((g) => g.score !== null);
  if (scored.length === weights.grades.length) {
    const f = scored.reduce((a, g) => a + g.score, 0) / scored.length;
    out.fidelity = { score: Math.round(f), letter: letterFor(f, weights.letters) };
  }
  return out;
}
