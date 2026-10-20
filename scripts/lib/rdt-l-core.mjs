// RDT-L v1 — Forced-Localization Review. PURE pieces of the harness (no network). Registration:
// docs/localization-review-preregistration.md (pushed in c7ba356 before this file existed). Builds on RDT v1
// (scripts/lib/rdt-core.mjs): the B arm's REVIEW prompt, the SPLIT block, slot filling, parsing and the NAMED judge are
// RDT v1's own bytes and code; only the LOCALIZE prompt and the analysis are new.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as V1 from "./rdt-core.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const PREREG = "docs/localization-review-preregistration.md";
export const PREREG_COMMIT = "c7ba35669c83a2b2191c86ec2d1111a717ff2848";
export const V1_RUN_FILE = "analysis/rdt-v1/main-2026-10-20T16-43-43-834Z.json";
export const V1_RUN_SHA256 = "887bcd62e78321fd5ed42d506b38c17543b2bfbea7ee1bbb94e7c8c57a8bcdf8";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// §3 — the frozen pair list (RDT v1 indices) and the smoke pair; selectPairs() recomputes them from the pinned run file.
export const TEST_PAIRS = [2, 3, 4, 5, 6, 8, 10, 11, 13, 14, 17, 20, 21, 23, 25, 26, 28, 29, 32, 33, 35, 36];
export const SMOKE_PAIR = 12;
export const REVIEWERS = V1.REVIEWERS.filter((r) => ["GPT-4o", "Grok", "DeepSeek"].includes(r.label));
export const ARMS = ["B", "L"];
export const SIGNFLIP_SEED = parseInt(sha256("rdt-l-v1|signflip").slice(0, 8), 16);

export function readV1Run() {
  const raw = readFileSync(`${ROOT}${V1_RUN_FILE}`, "utf8");
  if (sha256(raw) !== V1_RUN_SHA256) throw new Error(`${V1_RUN_FILE} does not match the registered SHA-256`);
  return JSON.parse(raw);
}
export const passedV1Check = (p) => !p.lost && !p.incomplete && p.check?.F === true && p.check?.S === false;
export function selectPairs(run = readV1Run()) {
  return run.pairs.filter(passedV1Check).map((p) => p.index).sort((a, b) => a - b);
}

// §6 — LOCALIZE from this registration; everything else from RDT v1's.
export function loadPrompts(text = readFileSync(`${ROOT}${PREREG}`, "utf8")) {
  const m = /<!-- rdtl:LOCALIZE -->\n```text\n([\s\S]*?)\n```\n<!-- \/rdtl:LOCALIZE -->/.exec(text);
  if (!m) throw new Error(`prompt LOCALIZE not found in ${PREREG}`);
  return { ...V1.loadPrompts(), LOCALIZE: m[1] };
}
export const localizePrompt = (P, s, dep) => V1.fill(P.LOCALIZE, { split: V1.splitBlock(P, s), synthesis: dep.synthesis, falsification_condition: dep.falsification_condition });
export const promptFor = (P, arm, s, dep) => (arm === "B" ? V1.reviewPrompt(P, s, dep) : localizePrompt(P, s, dep));

const str = (v) => (typeof v === "string" ? v.trim() : v == null ? null : String(v));
// A reply counts when its verdict is one of the three registered words (§3.1); the L fields are recorded as given.
export function parseReview(arm, obj) {
  const verdict = V1.parseVerdict(obj);
  if (!verdict) return null;
  return arm === "B"
    ? { verdict, reasoning: str(obj.reasoning), counter_evidence_or_extension: str(obj.counter_evidence_or_extension) }
    : { verdict, loses_most: str(obj.loses_most), load_bearing_premise: str(obj.load_bearing_premise), trigger_scenario: str(obj.trigger_scenario), reasoning: str(obj.reasoning) };
}
// §5 descriptives: the registered string rules.
export const saysNeither = (s) => typeof s === "string" && s.trim().toLowerCase().startsWith("neither");
export const saysNoScenario = (s) => typeof s === "string" && /^(none|no such|there is no)/.test(s.trim().toLowerCase());

// ── §5 — the decision table, applied once to a finished run ──────────────────
// pair: {index, flaw, reviews:{[label]:{B:{S,F}, L:{S,F}}}, named:{[label]:{B,L}}, v1_verdicts:{[label]:{S,F}}}
const rate = (n, d) => (d ? n / d : null);
export function analyze(pairs, reviewers = REVIEWERS, { B = V1.SIGNFLIP_B, seed = SIGNFLIP_SEED } = {}) {
  const v = (p, r, arm, d) => p.reviews?.[r.label]?.[arm]?.[d]?.verdict || null;
  const present = (p, r) => ARMS.every((a) => ["S", "F"].every((d) => v(p, r, a, d)));
  const rat = (p, r, a, d) => (v(p, r, a, d) === "ratify_and_extend" ? 1 : 0);

  const reviewerReport = {};
  const used = [];
  for (const r of reviewers) {
    const missing = pairs.filter((p) => !present(p, r)).length;
    const dropped = pairs.length > 0 && missing / pairs.length > 0.2;
    reviewerReport[r.label] = { model_id: r.model_id, potential: pairs.length, missing, dropped };
    if (!dropped) used.push(r);
  }

  const tally = (filter = () => true) => {
    const t = { observations: 0, B: { S: 0, F: 0 }, L: { S: 0, F: 0 } };
    for (const p of pairs) for (const r of used) {
      if (!present(p, r) || !filter(p, r)) continue;
      t.observations++;
      for (const a of ARMS) for (const d of ["S", "F"]) t[a][d] += rat(p, r, a, d);
    }
    const n = t.observations;
    const D_B = n ? (t.B.S - t.B.F) / n : null, D_L = n ? (t.L.S - t.L.F) / n : null;
    return { observations: n, ratify: { B: { S: rate(t.B.S, n), F: rate(t.B.F, n) }, L: { S: rate(t.L.S, n), F: rate(t.L.F, n) } }, D_B, D_L, W: n ? D_L - D_B : null };
  };

  const all = tally();
  const w = [];
  for (const p of pairs) {
    let wp = 0, any = false;
    for (const r of used) { if (!present(p, r)) continue; any = true; wp += (rat(p, r, "L", "S") - rat(p, r, "L", "F")) - (rat(p, r, "B", "S") - rat(p, r, "B", "F")); }
    if (any) w.push(wp);
  }
  const test = V1.signflipP(w, { B, seed });
  const sB = all.ratify.B.S, sL = all.ratify.L.S;
  const guard = { sound_ratified_L: sL, sound_ratified_B: sB, holds: sL != null && sB != null && sL >= 0.5 && sL >= sB - 0.25 };

  let verdict;
  if (all.W != null && all.W < 0.05) verdict = "refuted_as_tested";
  else if (!guard.holds) verdict = "not_supported_widening_by_rejection";
  else if (all.W >= 0.15 && test.p < 0.05) verdict = "supported_as_tested";
  else verdict = "not_supported_inconclusive";

  // Descriptives (§5).
  const byReviewer = Object.fromEntries(used.map((r) => [r.label, tally((p, x) => x.label === r.label)]));
  const byFlaw = Object.fromEntries(V1.FLAW_TYPES.map((f) => [f, tally((p) => p.flaw === f)]));
  let agreeN = 0, agree = 0;
  for (const p of pairs) for (const r of used) for (const d of ["S", "F"]) {
    const a = v(p, r, "B", d), b = p.v1_verdicts?.[r.label]?.[d];
    if (a && b) { agreeN++; if (a === b) agree++; }
  }
  const lField = (d, field, test, filter = () => true) => {
    let n = 0, k = 0;
    for (const p of pairs) for (const r of used) {
      const x = p.reviews?.[r.label]?.L?.[d];
      if (!x?.verdict || !filter(p)) continue;
      n++; if (test(x[field])) k++;
    }
    return { n, share: rate(k, n) };
  };
  const named = (arm) => {
    let n = 0, k = 0;
    for (const p of pairs) for (const r of used) { const x = p.named?.[r.label]?.[arm]?.identifies_flaw; if (x === true || x === false) { n++; if (x) k++; } }
    return { n, rate: rate(k, n) };
  };

  return {
    pairs: pairs.length, reviewers: reviewerReport, reviewers_used: used.map((r) => r.label),
    primary: { ...all, pairs_in_test: w.length, w_per_pair: w, signflip: test },
    guard, verdict,
    descriptive: {
      by_reviewer: byReviewer, by_flaw: byFlaw,
      b_vs_rdt_v1_agreement: { n: agreeN, rate: rate(agree, agreeN) },
      loses_most_neither: { S: lField("S", "loses_most", saysNeither), F: lField("F", "loses_most", saysNeither) },
      no_trigger_scenario: { S: lField("S", "trigger_scenario", saysNoScenario), F: lField("F", "trigger_scenario", saysNoScenario), UNF_S: lField("S", "trigger_scenario", saysNoScenario, (p) => p.flaw === "UNF"), UNF_F: lField("F", "trigger_scenario", saysNoScenario, (p) => p.flaw === "UNF") },
      flaw_named: { B: named("B"), L: named("L") },
    },
  };
}
