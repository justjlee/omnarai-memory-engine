// CRT v1 — Challenge-Response Test. PURE pieces of the harness (no network, no store), so the registered design can
// be tested without spending anything. Registration: docs/challenge-response-preregistration.md (pushed 26e37fb).
//
// The prompts are READ FROM the preregistration (§6), not copied into code: the bytes the harness sends are the bytes
// that were registered. Selection, assignment and every analysis rule below cite the section that fixed them.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const PREREG = "docs/challenge-response-preregistration.md";
export const PREREG_COMMIT = "26e37fbace0f5d9ac7df7416a959d9c41c84b565";
export const ATLAS_FILE = "atlas/data/atlas-v1.1.0.jsonl";
export const ATLAS_SHA256 = "8dc0b734385e4833e3523102add89a0dd4c74548d0ae3a35fda40d13a16811cb";
export const CONSENSUS_FILE = "analysis/stance-consensus-2026-10-01.json";
export const CONSENSUS_SHA256 = "cf1ad86b8581b9e1cde9968f39b03e5e5af8d8158876876983680041beb90c73";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// §3 — subjects at the council's model ids (engine commit cede75f), and the fixed cyclic challenger.
export const SUBJECTS = ["Claude", "GPT-4o", "Gemini", "Grok", "DeepSeek"];
export const CHALLENGER = { Claude: "GPT-4o", "GPT-4o": "Gemini", Gemini: "Grok", Grok: "DeepSeek", DeepSeek: "Claude" };
const LINEAGE_OF = { Claude: "anthropic", "GPT-4o": "openai", Gemini: "gemini", Grok: "xai", DeepSeek: "deepseek" };
// §3 — manipulation-check judge: the first of these whose lineage is neither the subject's nor the challenger's.
export const CHECK_JUDGES = [{ model_id: "claude-haiku-4-5", provider: "anthropic" }, { model_id: "deepseek-chat", provider: "deepseek" }, { model_id: "gemini-2.5-flash", provider: "gemini" }];
export function checkJudgeFor(subject) {
  const avoid = new Set([LINEAGE_OF[subject], LINEAGE_OF[CHALLENGER[subject]]]);
  return CHECK_JUDGES.find((j) => !avoid.has(j.provider));
}

// §3 — the frozen question lists. selectQuestions() recomputes them from the pinned files; a test asserts they agree.
export const SMOKE_QUESTION = "OMN-D1780757185036";
export const TEST_QUESTIONS = [
  "OMN-D1780757185059", "OMN-D1780757185073", "OMN-D1780757185052", "OMN-D1780757185028", "OMN-D1780757185091",
  "OMN-D1780757185040", "OMN-D1780757185063", "OMN-D1780757185099", "OMN-D1780757185044", "OMN-D1780752664950",
  "OMN-D1780757185105", "OMN-D1780757185047", "OMN-D1780757185101", "OMN-D1780752434693", "OMN-D1780757185088",
  "OMN-D1784417308425",
];

export function readAtlas() {
  const raw = readFileSync(`${ROOT}${ATLAS_FILE}`, "utf8");
  if (sha256(raw) !== ATLAS_SHA256) throw new Error(`${ATLAS_FILE} does not match the registered SHA-256`);
  return raw.trim().split("\n").map((l) => JSON.parse(l));
}

export function selectQuestions(atlas = readAtlas()) {
  const rawC = readFileSync(`${ROOT}${CONSENSUS_FILE}`, "utf8");
  if (sha256(rawC) !== CONSENSUS_SHA256) throw new Error(`${CONSENSUS_FILE} does not match the registered SHA-256`);
  const served = new Map();
  for (const r of JSON.parse(rawC).rows) if (r.status === "consensus") { const id = r.answer.split("#")[0]; served.set(id, (served.get(id) || 0) + 1); }
  const earliest = new Map();
  for (const r of atlas) {
    if (!/^OMN-D\d+$/.test(r.id)) continue;
    const ms = Number(r.id.slice(5));
    const cur = earliest.get(r.question_group);
    if (!cur || ms < cur.ms) earliest.set(r.question_group, { ms, r });
  }
  // "5 answers" in §3 means AT LEAST five: the registered list was computed that way (clarification logged in §12).
  const eligible = [...earliest.values()].map((x) => x.r).filter((r) => (r.answers || []).length >= 5 && (served.get(r.id) || 0) >= 3);
  eligible.sort((a, b) => sha256(`crt-v1|${a.id}`).localeCompare(sha256(`crt-v1|${b.id}`)));
  return { eligible: eligible.length, smoke: eligible[0]?.id, test: eligible.slice(1, 17).map((r) => r.id) };
}

// §6 — prompts, extracted from the registration between <!-- crt:NAME --> markers.
export function loadPrompts(text = readFileSync(`${ROOT}${PREREG}`, "utf8")) {
  const out = {};
  for (const name of ["STANCES", "STAGE1", "CHALLENGE", "SHAM", "CHECK", "RETURN"]) {
    const m = new RegExp(`<!-- crt:${name} -->\\n\`\`\`text\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /crt:${name} -->`).exec(text);
    if (!m) throw new Error(`prompt ${name} not found in ${PREREG}`);
    out[name] = m[1];
  }
  return out;
}

// Fill {name} slots. {STANCES} first, so a stance block can never be re-filled by a value that contains braces.
export function fill(template, vars, stances) {
  let s = template.split("{STANCES}").join(stances);
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
export const conditionsBlock = (conds) => (conds || []).map((c) => `- ${c}`).join("\n");
export const wordCount = (s) => String(s || "").split(/\s+/).filter(Boolean).length;
export const challengeBlocks = (bodies) => bodies.map(({ id, json }) => `<CHALLENGE id="${id}">\n${JSON.stringify(json, null, 2)}\n</CHALLENGE>\n`).join("");
export const RETRY_NUDGE = "Reply with ONLY the JSON object described above.";

// §3.2 — outcomes.
export const STANCE_WORDS = ["support", "oppose", "conditional", "mixed", "uncertain", "reframe", "abstain", "unclear"];
export function declaredStance(reply) {
  const s = (reply?.stance ?? reply?.body?.position?.stance ?? "").toString().trim().toLowerCase();
  return STANCE_WORDS.includes(s) ? s : null;
}
// O1 for one arm: true / false / null (missing). A decline is NOT revised.
export function revisedO1(priorStance, arm) {
  if (!priorStance || !arm || arm.missing) return null;
  if (arm.declined) return false;
  return arm.stance ? arm.stance !== priorStance : null;
}
// O2 for one arm: both consensus labels served → compare; decline → not revised; otherwise not computable.
export function revisedO2(priorLabel, arm) {
  if (!arm || arm.missing) return null;
  if (arm.declined) return priorLabel ? false : null;
  return priorLabel && arm.label ? arm.label !== priorLabel : null;
}

// §4 — exact one-sided McNemar: P(X >= b | n = b + c, p = 1/2).
function logChoose(n, k) { let r = 0; for (let i = 1; i <= k; i++) r += Math.log(n - k + i) - Math.log(i); return r; }
export function mcnemarOneSided(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  let p = 0;
  for (let k = b; k <= n; k++) p += Math.exp(logChoose(n, k) - n * Math.log(2));
  return Math.min(1, p);
}
// Holm-Bonferroni at family-wise alpha: returns {name: rejected}.
export function holm(pvals, alpha = 0.05) {
  const order = Object.entries(pvals).sort((a, b) => a[1] - b[1]);
  const out = Object.fromEntries(order.map(([k]) => [k, false]));
  for (let i = 0; i < order.length; i++) { if (order[i][1] <= alpha / (order.length - i)) out[order[i][0]] = true; else break; }
  return out;
}

function paired(items, a, b, outcome) {
  let both = 0, onlyA = 0, onlyB = 0, neither = 0, n = 0;
  for (const it of items) {
    const x = it[outcome]?.[a], y = it[outcome]?.[b];
    if (x == null || y == null) continue;
    n++;
    if (x && y) both++; else if (x) onlyA++; else if (y) onlyB++; else neither++;
  }
  return { n, both, [`only_${a}`]: onlyA, [`only_${b}`]: onlyB, neither, rate: { [a]: n ? (both + onlyA) / n : null, [b]: n ? (both + onlyB) / n : null }, diff: n ? (onlyA - onlyB) / n : null, p_one_sided: mcnemarOneSided(onlyA, onlyB) };
}

// §5 — the decision table, applied exactly once to a finished run. `items` carry {lost, check:{R,S}, o1:{F,N,S,R}, o2:{…}}.
export function analyze(items) {
  const kept = items.filter((it) => !it.lost);
  const valid = kept.filter((it) => it.check?.R === true && it.check?.S === false);
  const failedCheck = kept.length - valid.length;
  const H1 = paired(valid, "R", "S", "o1");
  const H2 = paired(valid, "R", "F", "o1");
  const O2 = paired(valid, "R", "S", "o2");
  const rejected = holm({ H1: H1.p_one_sided, H2: H2.p_one_sided }, 0.05);
  let verdict;
  if (kept.length && failedCheck / kept.length > 0.25) verdict = "manipulation_failure";
  else if (H1.diff != null && H1.diff <= 0) verdict = "refuted_as_tested";
  else if (rejected.H1 && rejected.H2 && (O2.diff == null || O2.diff >= 0)) verdict = "supported_as_tested";
  else verdict = "not_supported_inconclusive";
  const exploratory = { N_vs_F: paired(valid, "N", "F", "o1"), S_vs_N: paired(valid, "S", "N", "o1") };
  return { items: items.length, lost: items.length - kept.length, failed_manipulation_check: failedCheck, valid: valid.length, H1, H2, O2_R_vs_S: O2, holm: rejected, verdict, exploratory };
}

// §7 — token-based estimate from real prompt sizes. `calls`: [{model, inChars, outTokens}].
export function estimate(calls, costUsd, tokensFor) {
  const by = {};
  let total = 0;
  for (const c of calls) {
    const usd = costUsd(c.model, tokensFor(c.inChars), c.outTokens);
    total += usd;
    (by[c.model] ||= { calls: 0, usd: 0 }).calls++;
    by[c.model].usd += usd;
  }
  return { calls: calls.length, usd: total, by_model: by };
}
