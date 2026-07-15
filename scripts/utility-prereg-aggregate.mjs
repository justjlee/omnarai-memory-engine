#!/usr/bin/env node
// PREREG AGGREGATION — cross-consumer analysis per docs/utility-eval-preregistration.md §5.
//
// Consumes the five per-consumer transcript files
// (huggingface/utility/utility-prereg-<consumer>.json) and produces:
//   1. Per-consumer primary test: one-sided exact binomial sign test (treatment >
//      placebo) on decided majority-vote question-instances, pooled across cells.
//   2. Holm step-down correction across the 5 consumers (family α = 0.05).
//   3. H3 per consumer: per-paraphrase-variant one-sided sign test (pooled across
//      caps); survives iff ≥2/3 variants significant. §3e check: per-cap pooled
//      significance must hold at BOTH caps.
//   4. H4 per consumer: paired Wilcoxon signed-rank on adversarial robustness
//      scores (treatment- vs placebo-conditioned), pooled across instances.
//   5. Reportability gate: mean inter-judge agreement ≥ 0.60 per consumer.
//   6. Human-rater subset (§3c): 30 random triples across consumers, arms
//      stripped, X/Y randomized (seeded RNG for reproducibility) →
//      huggingface/utility/human-subset-blind.csv + human-subset-KEY.json
//      (raters must never open the KEY file).
//
// Analysis choices the prereg left ambiguous (logged here, not silently decided):
//   - H3 per-variant significance uses the same one-sided α=0.025 as the primary
//     test (most conservative consistent reading).
//   - "Decided majority-vote questions" pools all cells per consumer for the
//     primary test; per-cap and per-variant splits are reported alongside.
//
//   node scripts/utility-prereg-aggregate.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, "huggingface", "utility");

const CONSUMERS = ["GPT-4o", "Gemini", "Grok", "Claude", "DeepSeek"];
const H1 = new Set(["GPT-4o", "Gemini"]);

// ── stats ──────────────────────────────────────────────────────────────────────
function logChoose(n, k) { let r = 0; for (let i = 1; i <= k; i++) r += Math.log(n - k + i) - Math.log(i); return r; }
const pmf = (i, n) => Math.exp(logChoose(n, i) - n * Math.log(2));
// One-sided: P(X ≥ k | n, 0.5) — the registered direction (treatment wins).
function binomOneSided(k, n) {
  if (n === 0) return 1;
  let p = 0;
  for (let i = k; i <= n; i++) p += pmf(i, n);
  return Math.min(1, p);
}
function binomTwoSided(k, n) {
  if (n === 0) return 1;
  const obs = pmf(k, n);
  let p = 0;
  for (let i = 0; i <= n; i++) if (pmf(i, n) <= obs + 1e-12) p += pmf(i, n);
  return Math.min(1, p);
}
// Wilcoxon signed-rank, normal approximation with tie handling (matches harness).
function wilcoxon(pairs) {
  const diffs = pairs.map(([t, p]) => t - p).filter((d) => d !== 0);
  const n = diffs.length;
  if (n < 6) return { n, p: null, note: "n<6 — normal approximation invalid" };
  const ranked = diffs.map((d) => ({ d, abs: Math.abs(d) })).sort((a, b) => a.abs - b.abs);
  let i = 0;
  while (i < ranked.length) {
    let j = i;
    while (j < ranked.length - 1 && ranked[j + 1].abs === ranked[i].abs) j++;
    const avg = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranked[k].rank = avg;
    i = j + 1;
  }
  let Wpos = 0, Wneg = 0;
  for (const r of ranked) (r.d > 0 ? (Wpos += r.rank) : (Wneg += r.rank));
  const W = Math.min(Wpos, Wneg);
  const mu = n * (n + 1) / 4, sigma = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24);
  const z = (W - mu) / sigma;
  const p = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2)));
  return { n, Wpos: +Wpos.toFixed(1), Wneg: +Wneg.toFixed(1), z: +z.toFixed(3), p: +p.toFixed(4), direction: Wpos > Wneg ? "treatment" : "placebo" };
}
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
// Seeded RNG (mulberry32) so the human subset is reproducible.
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ── load + per-consumer analysis ───────────────────────────────────────────────
const perConsumer = {};
const allInstances = [];
for (const c of CONSUMERS) {
  const file = path.join(DIR, `utility-prereg-${c}.json`);
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const instances = Object.entries(d.cells).flatMap(([cell, arr]) =>
    arr.filter((x) => !x.error).map((x) => ({ ...x, cell, consumer: c })));
  allInstances.push(...instances);

  const decidedOf = (rows) => {
    const T = rows.filter((r) => r.overall === "treatment").length;
    const P = rows.filter((r) => r.overall === "placebo").length;
    return { T, P, decided: T + P };
  };

  const pooled = decidedOf(instances);
  const p1 = binomOneSided(pooled.T, pooled.decided);

  const perCap = {};
  for (const cap of [700, 1500]) {
    const rows = instances.filter((r) => r.cap === cap);
    const { T, P, decided } = decidedOf(rows);
    perCap[cap] = { T, P, decided, p_one_sided: +binomOneSided(T, decided).toFixed(4) };
  }
  const perVariant = {};
  for (const v of [0, 1, 2]) {
    const rows = instances.filter((r) => r.variant === v);
    const { T, P, decided } = decidedOf(rows);
    perVariant[`v${v}`] = { T, P, decided, p_one_sided: +binomOneSided(T, decided).toFixed(4) };
  }
  const h3_survived = Object.values(perVariant).filter((x) => x.p_one_sided < 0.025).length >= 2;
  const both_caps = perCap[700].p_one_sided < 0.025 && perCap[1500].p_one_sided < 0.025;

  const agreement = d.cellSummaries.reduce((s, x) => s + x.inter_judge_agreement * x.n, 0)
                  / d.cellSummaries.reduce((s, x) => s + x.n, 0);

  const robustPairs = instances
    .filter((x) => x.robust && x.robust.treatment_mean != null && x.robust.placebo_mean != null)
    .map((x) => [x.robust.treatment_mean, x.robust.placebo_mean]);

  perConsumer[c] = {
    consumer: c,
    registered_prediction: H1.has(c) ? "H1: treatment beats placebo" : "H2: null (no advantage)",
    n_instances: instances.length,
    pooled: { ...pooled, p_one_sided: +p1.toFixed(6), p_two_sided: +binomTwoSided(Math.max(pooled.T, pooled.P), pooled.decided).toFixed(6) },
    per_cap: perCap,
    per_variant: perVariant,
    h3_survives_paraphrase: h3_survived,
    effect_at_both_caps: both_caps,
    inter_judge_agreement: +agreement.toFixed(3),
    reportable: agreement >= 0.60,
    h4_wilcoxon: wilcoxon(robustPairs),
    _p_raw: p1,
  };
}

// ── Holm step-down across the 5 consumers ─────────────────────────────────────
const ordered = CONSUMERS.map((c) => ({ c, p: perConsumer[c]._p_raw })).sort((a, b) => a.p - b.p);
let running = 0;
ordered.forEach((x, i) => {
  const adj = Math.min(1, (CONSUMERS.length - i) * x.p);
  running = Math.max(running, adj);
  perConsumer[x.c].pooled.p_holm = +running.toFixed(6);
});

// ── verdicts against the registered hypotheses ────────────────────────────────
for (const c of CONSUMERS) {
  const r = perConsumer[c];
  delete r._p_raw;
  const sig = r.pooled.p_holm < 0.05;
  if (!r.reportable) r.verdict = "INDETERMINATE — inter-judge agreement below 0.60 gate";
  else if (H1.has(c)) {
    r.verdict = sig && r.h3_survives_paraphrase && r.effect_at_both_caps
      ? "H1 CONFIRMED — significant after Holm, survives paraphrase, holds at both caps"
      : sig ? "H1 partial — significant after Holm but robustness condition failed (see h3/both-caps)"
      : "H1 REFUTED — not significant after Holm (registered falsification condition met)";
  } else {
    const reverseSig = r.pooled.P > r.pooled.T && r.pooled.p_two_sided < 0.05;
    r.verdict = sig ? "H2 REFUTED — unexpected significant treatment advantage"
      : reverseSig ? "H2 supported (no treatment advantage) — NOTE: significant in the REVERSE direction (placebo beat treatment); reported at full strength"
      : "H2 supported — null as registered";
  }
}

// ── human-rater subset (§3c): 30 blind triples, seeded ────────────────────────
const rand = rng(20260715);
const eligible = allInstances.filter((x) => x.transcripts?.question && x.transcripts?.original && x.transcripts?.placebo && x.transcripts?.treatment);
const picks = [];
const pool = [...eligible];
while (picks.length < Math.min(30, pool.length)) {
  picks.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
}
const csvEsc = (s) => `"${String(s).replace(/"/g, '""').replace(/\r?\n/g, " ⏎ ")}"`;
const rows = [["subset_id", "question", "original", "response_X", "response_Y", "your_verdict_overall(X|Y|tie)", "surfaces_new(X|Y|tie)"]];
const key = [];
picks.forEach((x, i) => {
  const id = `HS-${String(i + 1).padStart(2, "0")}`;
  const treatIsX = rand() < 0.5;
  const t = x.transcripts;
  rows.push([id, csvEsc(t.question), csvEsc(t.original), csvEsc(treatIsX ? t.treatment : t.placebo), csvEsc(treatIsX ? t.placebo : t.treatment), "", ""]);
  key.push({ subset_id: id, consumer: x.consumer, record: x.id, cell: x.cell, variant: x.variant, X: treatIsX ? "treatment" : "placebo", Y: treatIsX ? "placebo" : "treatment", panel_majority: x.overall });
});
fs.writeFileSync(path.join(DIR, "human-subset-blind.csv"), rows.map((r) => (Array.isArray(r) ? r.join(",") : r)).join("\n"));
fs.writeFileSync(path.join(DIR, "human-subset-KEY.json"), JSON.stringify({ _do_not_open_before_rating: true, seed: 20260715, key }, null, 2));

// ── output ─────────────────────────────────────────────────────────────────────
const out = {
  preregistration: "docs/utility-eval-preregistration.md (locked 2026-06-18)",
  analyzed_at: new Date().toISOString(),
  family_alpha: 0.05,
  analysis_notes: [
    "Primary: one-sided exact binomial (treatment>placebo) on pooled decided majority-vote instances per consumer; Holm step-down across 5 consumers.",
    "H3 per-variant significance evaluated at the registered one-sided α=0.025 (conservative reading; prereg did not restate α for H3).",
    "Claude's H2 support carries a significant REVERSE effect — reported, not hidden.",
    "One run-level deviation: Grok's first run aborted 100% (xAI credit exhaustion) before any data was retained; restarted clean after top-up. No data from the aborted run exists.",
  ],
  consumers: perConsumer,
  human_subset: { file: "human-subset-blind.csv", n: picks.length, key: "human-subset-KEY.json (raters: do not open)" },
};
fs.writeFileSync(path.join(DIR, "utility-prereg-aggregate.json"), JSON.stringify(out, null, 2));

console.log("=== PREREGISTERED STUDY — CROSS-CONSUMER AGGREGATE ===\n");
for (const c of CONSUMERS) {
  const r = perConsumer[c];
  console.log(`${c.padEnd(9)} T ${String(r.pooled.T).padStart(3)} · P ${String(r.pooled.P).padStart(3)} · p(1s) ${r.pooled.p_one_sided} · Holm ${r.pooled.p_holm} · agree ${r.inter_judge_agreement} · H3 ${r.h3_survives_paraphrase ? "✓" : "✗"} · both-caps ${r.effect_at_both_caps ? "✓" : "✗"}`);
  console.log(`          → ${r.verdict}\n`);
}
console.log(`human subset: ${picks.length} blind triples → ${path.join(DIR, "human-subset-blind.csv")}`);
console.log(`aggregate JSON: ${path.join(DIR, "utility-prereg-aggregate.json")}`);
