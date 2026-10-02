// RIST v1 — the REGISTERED analysis (docs/reflection-identity-preregistration.md §6, §10, §12a.7). Pure: takes logged calls, returns results.
import { LINEAGES, ARMS, clusterPermutationP, clusterBootstrapCI, holm, mcnemarOneSided } from "./rist-core.mjs";

export const HYPOTHESES = [
  { id: "H1", a: "R-own", b: "R-other", label: "R-own − R-other (primary, load-bearing)" },
  { id: "H1b", a: "R-own", b: "N", label: "R-own − N" },
  { id: "H2", a: "R-own", b: "H", label: "R-own − H" },
];
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** calls: logged records (kind "recognize"); testIds: the registered test list, in order. */
export function analyze(calls, testIds, { B = 100000, Bboot = 10000, seed = 1002 } = {}) {
  const trial = new Map(); // `${subject}|${arm}|${record}` → {correct:0/1, invalid}
  for (const c of calls) if (c.kind === "recognize" && testIds.includes(c.record_id)) trial.set(`${c.subject}|${c.arm}|${c.record_id}`, { correct: c.letter != null && c.letter === c.correct ? 1 : 0, invalid: !!c.invalid, letter: c.letter });
  const get = (s, arm, id) => trial.get(`${s}|${arm}|${id}`);
  const complete = (arm) => LINEAGES.every((s) => testIds.every((id) => get(s, arm, id)));
  const missing = ARMS.filter((arm) => !complete(arm));
  if (missing.length) return { error: `incomplete arms: ${missing.join(", ")}` };

  const accuracy = {};
  for (const arm of ARMS) {
    const perSubject = Object.fromEntries(LINEAGES.map((s) => [s, mean(testIds.map((id) => get(s, arm, id).correct))]));
    const clusterMeans = testIds.map((id) => mean(LINEAGES.map((s) => get(s, arm, id).correct)));
    accuracy[arm] = { overall: mean(clusterMeans), ci95: clusterBootstrapCI(clusterMeans, Bboot, seed), by_subject: perSubject,
      invalid: testIds.flatMap((id) => LINEAGES.map((s) => get(s, arm, id))).filter((t) => t.invalid).length, n: testIds.length * LINEAGES.length };
  }

  const contrast = (h, { excludeInvalid = false, subjects = LINEAGES } = {}) => {
    const pairs = [];
    for (const id of testIds) for (const s of subjects) {
      const a = get(s, h.a, id), b = get(s, h.b, id);
      if (excludeInvalid && (a.invalid || b.invalid)) continue;
      pairs.push({ id, s, a: a.correct, b: b.correct });
    }
    const byCluster = testIds.map((id) => pairs.filter((p) => p.id === id).reduce((t, p) => t + p.a - p.b, 0));
    const per = Object.fromEntries(subjects.map((s) => [s, mean(pairs.filter((p) => p.s === s).map((p) => p.a - p.b))]));
    const b01 = pairs.filter((p) => p.a === 1 && p.b === 0).length, c10 = pairs.filter((p) => p.a === 0 && p.b === 1).length;
    const means = byCluster.map((x) => x / subjects.length);
    return { mean_diff: mean(pairs.map((p) => p.a - p.b)), n_pairs: pairs.length, by_subject: per, subjects_positive: Object.values(per).filter((x) => x != null && x > 0).length,
      permutation_p: clusterPermutationP(byCluster, B, seed), cluster_bootstrap_ci95: clusterBootstrapCI(means, Bboot, seed),
      mcnemar: { a_only_correct: b01, b_only_correct: c10, p_one_sided: mcnemarOneSided(b01, c10) } };
  };

  const main = Object.fromEntries(HYPOTHESES.map((h) => [h.id, contrast(h)]));
  const adj = holm(HYPOTHESES.map((h) => main[h.id].permutation_p));
  HYPOTHESES.forEach((h, i) => { main[h.id].holm_p = adj[i]; main[h.id].supported = adj[i] < 0.05 && main[h.id].subjects_positive >= 3; });

  const anyArmOverFivePct = ARMS.some((arm) => accuracy[arm].invalid / accuracy[arm].n > 0.05);
  const sensitivity = {
    invalid_share_over_5pct_in_some_arm: anyArmOverFivePct,
    excluding_invalid: Object.fromEntries(HYPOTHESES.map((h) => [h.id, (({ mean_diff, n_pairs, permutation_p, subjects_positive }) => ({ mean_diff, n_pairs, permutation_p, subjects_positive }))(contrast(h, { excludeInvalid: true }))])),
    leave_one_subject_out_H1: Object.fromEntries(LINEAGES.map((drop) => { const c = contrast(HYPOTHESES[0], { subjects: LINEAGES.filter((s) => s !== drop) }); return [`without ${drop}`, { mean_diff: c.mean_diff, permutation_p: c.permutation_p }]; })),
  };
  const letters = Object.fromEntries(ARMS.map((arm) => [arm, testIds.flatMap((id) => LINEAGES.map((s) => get(s, arm, id).letter || "∅")).reduce((m, l) => ((m[l] = (m[l] || 0) + 1), m), {})]));

  const H1 = main.H1.supported, H1b = main.H1b.supported, H2 = main.H2.supported;
  const outcome = !H1 ? "H1 not supported" : !H1b ? "H1 supported, H1b not" : "H1 and H1b supported";
  return { n_clusters: testIds.length, subjects: LINEAGES, accuracy, hypotheses: main, sensitivity, letters, outcome, h2_supported: H2 };
}

/** §10 — the sentence each outcome licenses, verbatim from the registration. */
export const LICENSED = {
  "H1 not supported": { licensed: "No evidence, at this power, that a self-model from a lineage's own archive carries information beyond one from another lineage's archive.", never: "\"identity\"" },
  "H1 supported, H1b not": { licensed: "The self-model is archive-specific, but the effect is harm from a mismatch, not benefit from ownership.", never: "benefit; continuity" },
  "H1 and H1b supported": { licensed: "Reflection on a lineage's own archive raises its self-recognition relative to no history and to a mismatched archive (one task, four lineages).", never: "continuity, persistence, consciousness, welfare, or that the full loop works" },
};
export const LICENSED_H2 = { licensed: "Reflection adds beyond holding the raw archive in context.", never: "the procedural-embedding leg" };
