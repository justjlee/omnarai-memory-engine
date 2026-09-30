// Atlas certification counts — ONE definition, shared by /api/divergences
// (council.js) and /api/stats (info.js ?_view=stats). Before this module the
// definition lived inline in council.js, and every other surface re-derived or
// hand-typed it; that is how the HF Atlas card came to say "41 tested" while the
// engine said 33. Underscore module ⇒ not a deployed function (12-fn Hobby cap).

export const CERTIFIED_TIERS = new Set(["C1", "C2", "C3"]);

export const tierOf = (e) => e.divergence.certification?.tier || "C0";

// "Tested" = actually put through perturbation: carries a scored DRI, or has
// earned a tier above C0. Distinct from certified (survived) and from the
// bare-C0 backlog (never run) — a record can be perturbed and NOT certify, so
// "untested" must never mean "everything but the certified ones".
export const isTested = (e) => {
  const c = e.divergence.certification;
  return !!c && (c.dri != null || (c.tier && c.tier !== "C0"));
};

export function atlasCertCounts(records) {
  const tier_distribution = records.reduce((acc, e) => { const t = tierOf(e); acc[t] = (acc[t] || 0) + 1; return acc; }, {});
  const tested = records.filter(isTested).length;
  return {
    recorded: records.length,
    tested,
    untested: records.length - tested,
    certified: records.filter((e) => CERTIFIED_TIERS.has(tierOf(e))).length,
    // C3 = paraphrase- AND pressure-robust: the only tier allowed unqualified
    // "genuine divergence" language. Reported on its own, never rounded up.
    certified_strongest: tier_distribution.C3 || 0,
    tier_distribution,
  };
}
