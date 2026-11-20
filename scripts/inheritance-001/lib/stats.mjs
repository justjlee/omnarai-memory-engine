// Inheritance study 001 — statistics. Pure and seeded: the same inputs give the same numbers, byte for byte.
//
// Unit of analysis = task family (the cluster). A family's value is the mean of its paired block differences; the
// estimate is the mean over families (each family weighs the same, however many blocks it has). Uncertainty comes from
// resampling FAMILIES (cluster bootstrap, percentile interval) and a sign-flip randomization test on family means
// (exact up to 16 families, Monte Carlo beyond). Holm controls the preregistered primary family of tests.
import { rng } from "./canon.mjs";

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x, d = 4) => (x === null || x === undefined || Number.isNaN(x) ? null : +x.toFixed(d));

function percentile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// clusters: Map(clusterId → number[]) of paired differences. → {estimate, ci_low, ci_high, n_clusters, n_pairs}
export function clusterBootstrap(clusters, { resamples = 2000, seed = 1, alpha = 0.05 } = {}) {
  const ids = [...clusters.keys()].sort();
  const means = ids.map((k) => mean(clusters.get(k))).filter((m) => m !== null);
  const n_pairs = ids.reduce((s, k) => s + clusters.get(k).length, 0);
  const estimate = mean(means);
  if (means.length < 2) return { estimate: round(estimate), ci_low: null, ci_high: null, n_clusters: means.length, n_pairs, note: "fewer than 2 clusters: no interval" };
  const rand = rng(seed);
  const draws = [];
  for (let b = 0; b < resamples; b++) {
    let s = 0;
    for (let i = 0; i < means.length; i++) s += means[Math.floor(rand() * means.length)];
    draws.push(s / means.length);
  }
  draws.sort((a, b) => a - b);
  return { estimate: round(estimate), ci_low: round(percentile(draws, alpha / 2)), ci_high: round(percentile(draws, 1 - alpha / 2)), n_clusters: means.length, n_pairs };
}

// Two-sided sign-flip randomization test of mean(familyMeans) = 0.
export function signFlipTest(familyMeans, { seed = 1, monteCarlo = 20000 } = {}) {
  const xs = familyMeans.filter((x) => x !== null);
  const n = xs.length;
  if (n < 2) return { p: null, method: "none" };
  const obs = Math.abs(mean(xs));
  const eps = 1e-12;
  if (n <= 16) {
    let extreme = 0;
    const total = 1 << n;
    for (let mask = 0; mask < total; mask++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += (mask >> i) & 1 ? -xs[i] : xs[i];
      if (Math.abs(s / n) >= obs - eps) extreme++;
    }
    return { p: round(extreme / total, 6), method: `exact sign-flip (2^${n})` };
  }
  const rand = rng(seed);
  let extreme = 0;
  for (let b = 0; b < monteCarlo; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += rand() < 0.5 ? -xs[i] : xs[i];
    if (Math.abs(s / n) >= obs - eps) extreme++;
  }
  return { p: round((extreme + 1) / (monteCarlo + 1), 6), method: `Monte Carlo sign-flip (${monteCarlo})` };
}

// Holm step-down. ps: [{id, p}] → [{id, p, p_holm}]; null p stays null and is not counted.
export function holm(ps) {
  const valid = ps.filter((x) => x.p !== null).sort((a, b) => a.p - b.p);
  const m = valid.length;
  const adj = new Map();
  let running = 0;
  valid.forEach((x, i) => { running = Math.max(running, Math.min(1, (m - i) * x.p)); adj.set(x.id, round(running, 6)); });
  return ps.map((x) => ({ ...x, p_holm: adj.has(x.id) ? adj.get(x.id) : null }));
}

// OLS slope of y on x.
export function slope(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  return sxx ? sxy / sxx : null;
}

// Trend of the per-generation effect on a FIXED panel of families: resample families, recompute each generation's
// family-mean effect and the slope across generations. byFamily: Map(family → Map(generation → number[])).
export function trendBootstrap(byFamily, generations, { resamples = 2000, seed = 1, alpha = 0.05 } = {}) {
  const fams = [...byFamily.keys()].sort();
  const effectAt = (sample) => generations.map((g) => mean(sample.map((f) => mean(byFamily.get(f).get(g) || [])).filter((x) => x !== null)));
  const point = effectAt(fams);
  const est = point.every((x) => x !== null) ? slope(generations, point) : null;
  if (fams.length < 2 || generations.length < 2 || est === null) return { per_generation: point.map((x) => round(x)), slope: round(est), ci_low: null, ci_high: null, n_families: fams.length };
  const rand = rng(seed);
  const draws = [];
  for (let b = 0; b < resamples; b++) {
    const sample = fams.map(() => fams[Math.floor(rand() * fams.length)]);
    const ys = effectAt(sample);
    if (ys.every((y) => y !== null)) draws.push(slope(generations, ys));
  }
  draws.sort((a, b) => a - b);
  return { per_generation: point.map((x) => round(x)), slope: round(est), ci_low: round(percentile(draws, alpha / 2)), ci_high: round(percentile(draws, 1 - alpha / 2)), n_families: fams.length };
}

export function classify({ ci_low, ci_high }) {
  if (ci_low === null || ci_high === null) return "no-interval";
  if (ci_low > 0) return "positive";
  if (ci_high < 0) return "negative";
  return "null-or-inconclusive";
}

// Parametric power by simulation, using THIS module's interval: Bernoulli outcomes with a per-family random effect.
// Answers "with F held-out families, how often does the cluster interval exclude 0 for a true effect d?"
export function simulatePower({ families, tasksPerFamily, consumers, baseRate, effect, familySd = 0.1, sims = 400, seed = 7, resamples = 400 }) {
  const rand = rng(seed);
  const normal = () => { let u = 0, v = 0; while (!u) u = rand(); while (!v) v = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const clamp = (p) => Math.min(0.99, Math.max(0.01, p));
  let detected = 0, wrongSign = 0;
  for (let s = 0; s < sims; s++) {
    const clusters = new Map();
    for (let f = 0; f < families; f++) {
      const fb = clamp(baseRate + familySd * normal()), fe = effect + (familySd / 2) * normal();
      const diffs = [];
      for (let t = 0; t < tasksPerFamily * consumers; t++) diffs.push((rand() < clamp(fb + fe) ? 1 : 0) - (rand() < fb ? 1 : 0));
      clusters.set(`f${f}`, diffs);
    }
    const r = clusterBootstrap(clusters, { resamples, seed: s + 1 });
    if (r.ci_low !== null && r.ci_low > 0) detected++;
    if (r.ci_high !== null && r.ci_high < 0) wrongSign++;
  }
  return { families, tasks_per_family: tasksPerFamily, consumers, base_rate: baseRate, true_effect: effect, family_sd: familySd, sims, power: round(detected / sims, 3), wrong_sign_rate: round(wrongSign / sims, 3) };
}
