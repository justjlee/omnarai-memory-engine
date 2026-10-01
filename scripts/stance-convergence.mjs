#!/usr/bin/env node
// Do frontier lineages converge in STANCE on the same question? An independent cross-check of the Atlas's central measured finding.
//
// The Atlas finding (claims.json cross-model-divergence-is-prevalent: refuted) rests on a divergence index (DRI) built from embedding
// spread. Stance labels are a different instrument. Using only the consensus-served derived stances (analysis/stance-consensus-…,
// rule in docs/OMNARAI-FOOTPRINT-PROTOCOL.md §6), this asks: for two different lineages answering the same record, how often do their
// served stances match, versus what the stance mix alone would give by chance?
//
// PURE and offline. Reads two analysis files; writes nothing unless --out is given.
//   node scripts/stance-convergence.mjs --consensus analysis/stance-consensus-2026-10-01.json [--out analysis/stance-convergence-2026-10-01.json]
import { readFileSync, writeFileSync } from "node:fs";

export function convergence(rows) {
  const served = rows.filter((r) => r.status === "consensus");
  const byRec = new Map();
  for (const r of served) { const rec = r.answer.split("#")[0]; (byRec.get(rec) || byRec.set(rec, []).get(rec)).push({ lineage: r.lineage, stance: r.consensus }); }
  let pairs = 0, agree = 0, recsMulti = 0, recsSplit = 0;
  for (const v of byRec.values()) {
    if (new Set(v.map((x) => x.lineage)).size < 2) continue;
    recsMulti++;
    const stances = new Set(v.map((x) => x.stance));
    if (stances.has("support") && stances.has("oppose")) recsSplit++;
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) if (v[i].lineage !== v[j].lineage) { pairs++; if (v[i].stance === v[j].stance) agree++; }
  }
  const mix = {}; served.forEach((r) => (mix[r.consensus] = (mix[r.consensus] || 0) + 1));
  const chance = Object.values(mix).reduce((s, k) => s + (k / served.length) ** 2, 0);
  return { served_answers: served.length, records_with_served_answers: byRec.size, records_with_two_or_more_lineages_served: recsMulti, cross_lineage_pairs: pairs, pairs_agree: agree, pairs_agree_rate: pairs ? agree / pairs : null, chance_agreement_from_stance_mix: chance, records_with_both_support_and_oppose_served: recsSplit };
}

if (process.argv[1] && process.argv[1].endsWith("stance-convergence.mjs")) {
  const args = process.argv.slice(2); const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const rows = JSON.parse(readFileSync(val("--consensus"), "utf8")).rows;
  const out = { what: "Cross-lineage stance agreement on the same record, among consensus-served derived stances", ...convergence(rows),
    caveats: ["Served stances are the answers four labellers could agree on: a selection toward clearly propositional answers, and 60% of them are `support`. The chance baseline uses that mix, so a shared 'yes' to a yes/no question counts as expected, not as convergence.", "Records with fewer than two lineages served cannot be compared (see records_with_two_or_more_lineages_served).", "Certified (C3) records are rare in the served set, so this says nothing about whether certification tracks stance divergence.", "A different instrument agreeing with the Atlas finding is corroboration, not proof; both read the same answers."] };
  console.log(JSON.stringify(out, null, 1));
  if (val("--out")) writeFileSync(val("--out"), JSON.stringify(out, null, 1));
}
