#!/usr/bin/env node
// Consensus-gated derived stances (protocol Phase 5 adoption rule). PURE: no network, no Blob, no writes to the store.
//
// docs/OMNARAI-FOOTPRINT-PROTOCOL.md §6: a single labeller's stance is a property of labeller + prompt at least as much as of the
// answer (cross-labeller kappa ≈ 0.3). A derived stance may therefore be SERVED only where independent labellers agree.
//
// THE RULE (fixed 2026-10-01 from the 100-answer calibration sample, BEFORE any held-out data was labelled):
//   panel   = the original labeller (claude-haiku-4-5) + gemini-2.5-flash + deepseek-chat
//   a vote  = a grounded stance. A guarded label (evidence span not verbatim, below confidence floor, labeller error) is an
//             ABSTENTION, not a vote for `unclear`.
//   serve   iff there are ≥ 3 votes and ALL of them agree. Otherwise the answer is "contested" (votes disagree) or
//             "insufficient" (fewer than 3 votes). Neither is served as a stance; the verbatim answer is untouched either way.
// Calibration: on the 100-answer sample this recovered 38 of the 40 answers on which ≥ 5 of 6 labellers agree (about a tenth of
// the cost of running all six) and served only 1 answer that was not a 5-of-6 consensus.
//
//   node scripts/stance-consensus.mjs --panel <report.json> --derived analysis/stance-run-2026-09-30.json --out analysis/stance-consensus-….json
//   node scripts/stance-consensus.mjs --holdout 60 --consensus <out.json> --exclude <calibration-report.json> --ids-out /tmp/ids.json
//   node scripts/stance-consensus.mjs --validate <external-labeller-report.json> --consensus <out.json>
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const PANEL = ["claude-haiku-4-5", "gemini-2.5-flash", "deepseek-chat"];
export const MIN_VOTES = 3;
const ABSTAIN_GUARDS = new Set(["evidence-span-not-verbatim", "below-confidence-floor", "labeller-error", "no-result", "stance-outside-vocabulary"]);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** votes: { labeller → {stance, guard} | null }. Returns the consensus verdict for one answer. */
export function judge(votes) {
  const cast = Object.entries(votes).filter(([, v]) => v && !(v.guard && ABSTAIN_GUARDS.has(v.guard))).map(([k, v]) => [k, v.stance]);
  const abstained = Object.keys(votes).filter((k) => !cast.some(([c]) => c === k));
  const stances = [...new Set(cast.map(([, s]) => s))];
  if (cast.length < MIN_VOTES) return { status: "insufficient", consensus: null, votes: cast.length, abstained };
  if (stances.length === 1) return { status: "consensus", consensus: stances[0], votes: cast.length, abstained };
  return { status: "contested", consensus: null, votes: cast.length, abstained, split: Object.fromEntries(stances.map((s) => [s, cast.filter(([, x]) => x === s).length])) };
}

export function buildConsensus(derived, panelReport) {
  const byRef = new Map(panelReport.items.map((it) => [it.answer, it]));
  const rows = [];
  for (const d of derived) {
    const it = byRef.get(d.primary_text_ref);
    if (!it) continue;
    const votes = { "claude-haiku-4-5": { stance: d.stance, guard: d.derivation?.guard || null } };
    for (const l of PANEL.slice(1)) votes[l] = it.labels[l] ? { stance: it.labels[l].stance, guard: it.labels[l].guard } : null;
    const j = judge(votes);
    rows.push({ answer: d.primary_text_ref, derived_position_id: d.id, lineage: d.actor.lineage_id, original: d.stance, ...j, panel: Object.fromEntries(Object.entries(votes).map(([k, v]) => [k, v ? (v.guard && ABSTAIN_GUARDS.has(v.guard) ? "(abstain)" : v.stance) : "(missing)"])) });
  }
  return rows;
}

export function summarize(rows) {
  const by = (f) => rows.reduce((m, r) => ((m[f(r)] = (m[f(r)] || 0) + 1), m), {});
  const served = rows.filter((r) => r.status === "consensus");
  const lineages = [...new Set(rows.map((r) => r.lineage))].sort();
  return {
    n: rows.length, status: by((r) => r.status),
    served: served.length, served_share: served.length / rows.length,
    served_stance_distribution: served.reduce((m, r) => ((m[r.consensus] = (m[r.consensus] || 0) + 1), m), {}),
    by_lineage: Object.fromEntries(lineages.map((l) => { const rs = rows.filter((r) => r.lineage === l); return [l, { n: rs.length, served: rs.filter((r) => r.status === "consensus").length }]; })),
    original_label_survives: served.filter((r) => r.consensus === r.original).length,
    // a served stance equals the original by construction (unanimity includes it); the interesting number is how many originals were NOT supported
    originals_not_supported: rows.filter((r) => r.status !== "consensus").length,
  };
}

/** Held-out validation set: answers NOT in the calibration sample, half served / half not, spread over lineages, seeded by answer-id hash. */
export function pickHoldout(rows, n, excludeRefs) {
  const pool = rows.filter((r) => !excludeRefs.has(r.answer));
  const order = (arr) => arr.slice().sort((a, b) => sha256(a.answer).localeCompare(sha256(b.answer)));
  const take = (arr, k) => { const lists = new Map(); for (const r of order(arr)) (lists.get(r.lineage) || lists.set(r.lineage, []).get(r.lineage)).push(r); const out = []; for (let i = 0; out.length < k && [...lists.values()].some((l) => l[i]); i++) for (const l of lists.values()) if (l[i] && out.length < k) out.push(l[i]); return out; };
  const served = take(pool.filter((r) => r.status === "consensus"), Math.ceil(n / 2));
  const notServed = take(pool.filter((r) => r.status !== "consensus"), Math.floor(n / 2));
  return { served, notServed };
}

/** Held-out result: how often do EXTERNAL labellers (not in the panel) reproduce the panel's label? */
export function validate(externalReport, rows, predictions) {
  const byRef = new Map(rows.map((r) => [r.answer, r]));
  const out = { predictions, labellers: {} };
  const labellers = Object.keys(externalReport.labellers).filter((l) => !PANEL.includes(l));
  for (const l of labellers) {
    const agree = { served: [0, 0], not_served: [0, 0] };
    for (const it of externalReport.items) {
      const r = byRef.get(it.answer); if (!r) continue;
      const lab = it.labels[l]; if (!lab || (lab.guard && ABSTAIN_GUARDS.has(lab.guard))) continue;
      const bucket = r.status === "consensus" ? "served" : "not_served";
      agree[bucket][1]++; if (lab.stance === (r.status === "consensus" ? r.consensus : r.original)) agree[bucket][0]++;
    }
    out.labellers[l] = { served: { agree: agree.served[0], n: agree.served[1], rate: agree.served[1] ? agree.served[0] / agree.served[1] : null }, not_served: { agree_with_original: agree.not_served[0], n: agree.not_served[1], rate: agree.not_served[1] ? agree.not_served[0] / agree.not_served[1] : null } };
  }
  const rate = (k) => { const v = Object.values(out.labellers).map((x) => x[k]); const a = v.reduce((s, x) => s + (x.agree ?? x.agree_with_original), 0), n = v.reduce((s, x) => s + x.n, 0); return n ? a / n : null; };
  out.pooled = { served_rate: rate("served"), not_served_rate: rate("not_served") };
  out.verdict = {
    served_prediction_met: out.pooled.served_rate != null && out.pooled.served_rate >= predictions.served_min,
    not_served_prediction_met: out.pooled.not_served_rate != null && out.pooled.not_served_rate <= predictions.not_served_max,
  };
  return out;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  if (val("--panel")) {
    const derived = JSON.parse(readFileSync(val("--derived"), "utf8")).derived_positions;
    const rows = buildConsensus(derived, JSON.parse(readFileSync(val("--panel"), "utf8")));
    const out = { rule: "serve iff >= 3 non-abstaining votes among {claude-haiku-4-5 (original), gemini-2.5-flash, deepseek-chat} and all agree; guarded labels are abstentions", frozen: "2026-10-01, from the 100-answer calibration sample, before any held-out data was labelled", summary: summarize(rows), rows };
    writeFileSync(val("--out"), JSON.stringify(out, null, 1));
    const s = out.summary;
    console.log(`n=${s.n}  served(consensus)=${s.served} (${(100 * s.served_share).toFixed(0)}%)  contested=${s.status.contested || 0}  insufficient=${s.status.insufficient || 0}`);
    console.log("served stances:", JSON.stringify(s.served_stance_distribution)); console.log("by lineage:", JSON.stringify(s.by_lineage));
  } else if (val("--holdout")) {
    const cons = JSON.parse(readFileSync(val("--consensus"), "utf8"));
    const excl = new Set(JSON.parse(readFileSync(val("--exclude"), "utf8")).items.map((i) => i.answer));
    const { served, notServed } = pickHoldout(cons.rows, Number(val("--holdout")), excl);
    const ids = [...served, ...notServed].map((r) => r.answer);
    writeFileSync(val("--ids-out"), JSON.stringify(ids));
    const predictions = { stated_before_labelling: true, served_min: 0.8, not_served_max: 0.55, text: "External labellers (gpt-4o, claude-sonnet-4-6; neither is in the panel) will reproduce the panel's label on >= 80% of SERVED answers, and the original label on <= 55% of NOT-SERVED answers." };
    writeFileSync(val("--ids-out").replace(/\.json$/, "") + ".predictions.json", JSON.stringify({ predictions, served_ids: served.map((r) => r.answer), not_served_ids: notServed.map((r) => r.answer) }, null, 1));
    console.log(`holdout: ${served.length} served + ${notServed.length} not-served = ${ids.length} answers (calibration sample excluded)`);
  } else if (val("--validate")) {
    const cons = JSON.parse(readFileSync(val("--consensus"), "utf8"));
    const pred = JSON.parse(readFileSync(val("--predictions"), "utf8")).predictions;
    const res = validate(JSON.parse(readFileSync(val("--validate"), "utf8")), cons.rows, pred);
    if (val("--out")) writeFileSync(val("--out"), JSON.stringify(res, null, 1));
    console.log(JSON.stringify({ pooled: res.pooled, verdict: res.verdict, labellers: res.labellers }, null, 1));
  } else { console.error("see header for usage"); process.exit(2); }
}
