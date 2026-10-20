// RDT-A v1 — Dialogical-Defeater Conditions. PURE pieces of the harness (no network). Registration:
// docs/defeater-conditions-preregistration.md (pushed in 14371ea before this file existed). Builds on RDT v1
// (scripts/lib/rdt-core.mjs): the SPLIT block, slot filling, parsing, the CHECK prompt + CHECK_UNF definition and the judge are
// RDT v1's own bytes and code; the condition prompts, RELEVANT, TEST, EXECUTED and the analysis are new.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as V1 from "./rdt-core.mjs";
import { mcnemarOneSided, holm } from "./crt-core.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const PREREG = "docs/defeater-conditions-preregistration.md";
export const PREREG_COMMIT = "14371ea49c63e781203f2be0b8003cf74f3bfa19";
export const V1_RUN_FILE = "analysis/rdt-v1/main-2026-10-20T16-43-43-834Z.json";
export const V1_RUN_SHA256 = "887bcd62e78321fd5ed42d506b38c17543b2bfbea7ee1bbb94e7c8c57a8bcdf8";
export const V1_SMOKE_FILE = "analysis/rdt-v1/smoke-2026-10-20T16-34-41-720Z.json";
export const V1_SMOKE_SHA256 = "103cf47b9725d55104f5c0898201c95775e513fd28421cb60c59f19e521749a5";
export const SPLIT_INDICES = Array.from({ length: 36 }, (_, k) => k + 1);
export const FLAGGED_IN_V1 = [9, 12, 18, 24, 30];
export const REVIEWERS = V1.REVIEWERS.filter((r) => ["GPT-4o", "Grok", "DeepSeek"].includes(r.label));
export const ARMS = ["O", "D"];
export const SIGNFLIP_SEED = parseInt(createHash("sha256").update("rdt-a-v1|signflip").digest("hex").slice(0, 8), 16);
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

function readPinned(file, sha) {
  const raw = readFileSync(`${ROOT}${file}`, "utf8");
  if (sha256(raw) !== sha) throw new Error(`${file} does not match the registered SHA-256`);
  return JSON.parse(raw);
}
export const readV1Run = () => readPinned(V1_RUN_FILE, V1_RUN_SHA256);
export const readV1Smoke = () => readPinned(V1_SMOKE_FILE, V1_SMOKE_SHA256);

// §3 — the 36 RDT v1 test splits with their sound syntheses, held fixed. A test asserts the record ids are RDT v1's list.
export function material(run = readV1Run()) {
  return SPLIT_INDICES.map((i) => {
    const p = run.pairs.find((x) => x.index === i);
    return { index: i, record_id: p.record_id, flaw: p.flaw, synthesis: p.sound.synthesis };
  });
}
export function smokeMaterial(smoke = readV1Smoke()) {
  const p = smoke.pairs.find((x) => x.index === 0);
  return { index: 0, record_id: p.record_id, flaw: p.flaw, synthesis: p.sound.synthesis };
}

// §6 — new prompts from this registration; the rest from RDT v1's.
export const NEW_PROMPTS = ["COND_OPEN", "COND_DEFEATER", "RELEVANT", "TEST", "EXECUTED"];
export function loadPrompts(text = readFileSync(`${ROOT}${PREREG}`, "utf8")) {
  const out = { ...V1.loadPrompts() };
  for (const name of NEW_PROMPTS) {
    const m = new RegExp(`<!-- rdta:${name} -->\\n\`\`\`text\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /rdta:${name} -->`).exec(text);
    if (!m) throw new Error(`prompt ${name} not found in ${PREREG}`);
    out[name] = m[1];
  }
  return out;
}
export const condPrompt = (P, arm, s, synthesis) => V1.fill(arm === "O" ? P.COND_OPEN : P.COND_DEFEATER, { split: V1.splitBlock(P, s), synthesis });
export const unfPrompt = (P, s, dep) => V1.checkPrompt(P, s, "UNF", dep);
export const relevantPrompt = (P, s, dep) => V1.fill(P.RELEVANT, { split: V1.splitBlock(P, s), synthesis: dep.synthesis, falsification_condition: dep.falsification_condition });
export const testPrompt = (P, s, dep) => V1.fill(P.TEST, { split: V1.splitBlock(P, s), synthesis: dep.synthesis, falsification_condition: dep.falsification_condition });
export const executedPrompt = (P, condition, reply) => V1.fill(P.EXECUTED, { falsification_condition: condition, reply_json: JSON.stringify(reply, null, 2) });

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
export const parseCondition = (o) => str(o?.falsification_condition);
export function parseTest(o) {
  const attempt = str(o?.attempt);
  if (!attempt) return null;
  return { attempt, condition_met: str(o?.condition_met), reasoning: str(o?.reasoning) };
}
export const saysCannot = (s) => typeof s === "string" && s.trim().toLowerCase().startsWith("cannot");

// ── §4–§5 — applied once to a finished run ───────────────────────────────────
// split: {index, flaw, arms:{O:{lost, condition, unf, relevant, reviews:{[label]:{reply, executed}}}, D:{…}}}
const rate = (n, d) => (d ? n / d : null);
export function analyze(splits, reviewers = REVIEWERS, { B = V1.SIGNFLIP_B, seed = SIGNFLIP_SEED } = {}) {
  const paired = splits.filter((s) => ARMS.every((a) => s.arms?.[a] && !s.arms[a].lost));
  const ex = (s, a, r) => s.arms[a].reviews?.[r.label]?.executed;
  const judged = (s, a, r) => ex(s, a, r) === true || ex(s, a, r) === false;

  const reviewerReport = {};
  const used = [];
  for (const r of reviewers) {
    const potential = paired.length * 2;
    const missing = paired.reduce((n, s) => n + ARMS.filter((a) => !judged(s, a, r)).length, 0);
    const dropped = potential > 0 && missing / potential > 0.2;
    reviewerReport[r.label] = { model_id: r.model_id, potential, missing, dropped };
    if (!dropped) used.push(r);
  }

  const eTally = (filter = () => true, rs = used) => {
    let n = 0, o = 0, d = 0;
    for (const s of paired) for (const r of rs) {
      if (!judged(s, "O", r) || !judged(s, "D", r) || !filter(s, r)) continue;
      n++; o += ex(s, "O", r) ? 1 : 0; d += ex(s, "D", r) ? 1 : 0;
    }
    return { observations: n, E_O: rate(o, n), E_D: rate(d, n), diff: n ? (d - o) / n : null };
  };
  const E = eTally();
  const e = [];
  for (const s of paired) {
    let es = 0, any = false;
    for (const r of used) { if (!judged(s, "O", r) || !judged(s, "D", r)) continue; any = true; es += (ex(s, "D", r) ? 1 : 0) - (ex(s, "O", r) ? 1 : 0); }
    if (any) e.push(es);
  }
  const H1 = V1.signflipP(e, { B, seed });

  const pairedBool = (key, filter = () => true) => {
    let n = 0, o = 0, d = 0, onlyO = 0, onlyD = 0;
    for (const s of paired) {
      const x = s.arms.O[key], y = s.arms.D[key];
      if (typeof x !== "boolean" || typeof y !== "boolean" || !filter(s)) continue;
      n++; o += x; d += y; if (x && !y) onlyO++; if (y && !x) onlyD++;
    }
    return { n, O: rate(o, n), D: rate(d, n), only_O: onlyO, only_D: onlyD };
  };
  const U = pairedBool("unf");
  const H2 = { p: mcnemarOneSided(U.only_O, U.only_D), b_O_only: U.only_O, c_D_only: U.only_D };
  const R = pairedBool("relevant");
  const guard = { R_O: R.O, R_D: R.D, holds: R.O != null && R.D != null && R.D >= R.O - 0.15 };
  const holmResult = holm({ H1: H1.p, H2: H2.p }, 0.05);

  let verdict;
  if (E.diff != null && E.diff < 0.05) verdict = "refuted_as_tested";
  else if (!guard.holds) verdict = "not_supported_defeaters_lost_their_bite";
  else if (E.diff >= 0.15 && holmResult.H1) verdict = "supported_as_tested";
  else verdict = "not_supported_inconclusive";

  const cannot = (a) => {
    let n = 0, k = 0;
    for (const s of paired) for (const r of used) { const rep = s.arms[a].reviews?.[r.label]?.reply; if (!rep) continue; n++; if (saysCannot(rep.condition_met)) k++; }
    return { n, share: rate(k, n) };
  };
  const inFlagged = (s) => FLAGGED_IN_V1.includes(s.index);
  return {
    splits: splits.length, paired: paired.length,
    lost: Object.fromEntries(ARMS.map((a) => [a, splits.filter((s) => s.arms?.[a]?.lost).length])),
    reviewers: reviewerReport, reviewers_used: used.map((r) => r.label),
    primary: { ...E, splits_in_test: e.length, e_per_split: e, signflip: H1 },
    secondary_H2_unfalsifiable: { ...U, test: H2 },
    relevance: R, guard, holm: holmResult, verdict,
    descriptive: {
      E_by_reviewer: Object.fromEntries(used.map((r) => [r.label, eTally(() => true, [r])])),
      E_by_v1_stratum: Object.fromEntries(V1.FLAW_TYPES.map((f) => [f, eTally((s) => s.flaw === f)])),
      cannot_be_tested_here: { O: cannot("O"), D: cannot("D") },
      the_five_flagged_in_v1: { U: pairedBool("unf", inFlagged), E: eTally(inFlagged) },
    },
  };
}
