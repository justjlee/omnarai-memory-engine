#!/usr/bin/env node
// RIST v1 — run the REGISTERED analysis on the logged calls. No choices are made here: every test, threshold and rule is in
// scripts/lib/rist-analysis.mjs and docs/reflection-identity-preregistration.md §6, §10, §12a.7.
//
//   node scripts/rist-analyze.mjs            # reads analysis/rist-v1/calls.jsonl, writes results.json + results.md
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeSplits, LINEAGES, ARMS } from "./lib/rist-core.mjs";
import { analyze, HYPOTHESES, LICENSED, LICENSED_H2 } from "./lib/rist-analysis.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "analysis/rist-v1");
const records = fs.readFileSync(path.join(ROOT, "atlas/data/atlas-v1.1.0.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const splits = computeSplits(records);
const calls = fs.readFileSync(path.join(OUT, "calls.jsonl"), "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const R = analyze(calls, splits.test);
if (R.error) { console.error(R.error); process.exit(1); }

const pct = (x) => (x == null ? "n/a" : `${(100 * x).toFixed(1)}%`);
const pp = (x) => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)} pp`);
const reflects = calls.filter((c) => c.kind === "reflect");
const models = {}; for (const c of calls) if (c.model_returned) (models[c.subject] ||= new Set()).add(c.model_returned);
const spend = calls.reduce((s, c) => s + (c.usd || 0), 0);
const stage0 = (() => { try { return JSON.parse(fs.readFileSync(path.join(OUT, "stage0.json"), "utf8")); } catch { return null; } })();
const lic = LICENSED[R.outcome];

const md = [];
md.push("# RIST v1 — results (registered analysis)", "",
  `Registered: \`fe0f807880d6df055bf51fe6f855020682354113\` (public, branch creation 2026-10-02T15:24:25Z). Analysis: \`scripts/lib/rist-analysis.mjs\`. Spend ≈ $${spend.toFixed(2)}.`, "",
  `## Outcome: **${R.outcome}**${R.h2_supported ? " · H2 supported" : ""}`, "",
  `**Licensed sentence (§10):** ${lic.licensed}`, `**Never licensed:** ${lic.never}` + (R.h2_supported ? `\n\n**H2 additionally licenses:** ${LICENSED_H2.licensed} (never: ${LICENSED_H2.never})` : ""), "",
  "## Accuracy per arm (60 test records × 4 subjects = 240 trials; chance 25%)", "", "| Arm | Overall (95% cluster-bootstrap CI) | " + LINEAGES.join(" | ") + " | Invalid |", "|---|---|" + LINEAGES.map(() => "---").join("|") + "|---|");
for (const arm of ARMS) { const a = R.accuracy[arm]; md.push(`| ${arm} | ${pct(a.overall)} (${pct(a.ci95[0])}–${pct(a.ci95[1])}) | ${LINEAGES.map((s) => pct(a.by_subject[s])).join(" | ")} | ${a.invalid}/${a.n} |`); }
md.push("", "## Hypotheses (one-sided; cluster = test record; Holm over the three)", "", "| | Contrast | Mean paired diff (95% CI) | p (perm) | Holm p | McNemar p | Subjects positive | Supported |", "|---|---|---|---|---|---|---|---|");
for (const h of HYPOTHESES) { const c = R.hypotheses[h.id]; md.push(`| ${h.id} | ${h.label} | ${pp(c.mean_diff)} (${pp(c.cluster_bootstrap_ci95[0])} to ${pp(c.cluster_bootstrap_ci95[1])}) | ${c.permutation_p.toFixed(4)} | ${c.holm_p.toFixed(4)} | ${c.mcnemar.p_one_sided.toFixed(4)} (${c.mcnemar.a_only_correct}/${c.mcnemar.b_only_correct}) | ${c.subjects_positive}/4 | **${c.supported ? "yes" : "no"}** |`); }
md.push("", "Per-subject mean paired difference:", "", "| | " + LINEAGES.join(" | ") + " |", "|---|" + LINEAGES.map(() => "---").join("|") + "|");
for (const h of HYPOTHESES) md.push(`| ${h.id} | ${LINEAGES.map((s) => pp(R.hypotheses[h.id].by_subject[s])).join(" | ")} |`);
md.push("", "## Sensitivity (declared in §6)", "", `- Any arm >5% invalid: **${R.sensitivity.invalid_share_over_5pct_in_some_arm}**`,
  "- Excluding invalid trials: " + HYPOTHESES.map((h) => `${h.id} ${pp(R.sensitivity.excluding_invalid[h.id].mean_diff)} (p ${R.sensitivity.excluding_invalid[h.id].permutation_p.toFixed(4)}, n=${R.sensitivity.excluding_invalid[h.id].n_pairs})`).join("; "),
  "- Leave-one-subject-out, H1: " + Object.entries(R.sensitivity.leave_one_subject_out_H1).map(([k, v]) => `${k}: ${pp(v.mean_diff)} (p ${v.permutation_p.toFixed(4)})`).join("; "),
  "", "## Chosen-letter distribution", "", ...ARMS.map((arm) => `- ${arm}: ${JSON.stringify(R.letters[arm])}`),
  "", "## Provenance", "", `- Stage 0 (ceiling pilot): ${stage0 ? `N accuracy ${pct(stage0.N_accuracy)} on ${stage0.n_trials} trials; passed = ${stage0.passed}` : "n/a"}`,
  "- Model ids returned by the APIs: " + Object.entries(models).map(([s, set]) => `${s}: ${[...set].join(", ")}`).join("; "),
  "- Tensions shown per archive (§4.3, logged): " + [...new Map(reflects.map((r) => [`${r.subject}/${r.arm}`, r.archive_stats])).entries()].map(([k, v]) => `${k}: ${v.n_tensions} shown, ${v.n_omitted} omitted`).join("; "));
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ computed_at: new Date().toISOString(), registered_sha: "fe0f807880d6df055bf51fe6f855020682354113", spend_usd: +spend.toFixed(4), models_returned: Object.fromEntries(Object.entries(models).map(([k, v]) => [k, [...v]])), ...R }, null, 1));
fs.writeFileSync(path.join(OUT, "results.md"), md.join("\n") + "\n");
console.log(md.join("\n"));
