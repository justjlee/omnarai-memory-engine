// RDT v1 — Ratification Discrimination Test. PURE pieces of the harness (no network, no store), so the registered design
// can be tested without spending anything. Registration: docs/ratification-discrimination-preregistration.md (pushed in
// c76df7a before this file existed).
//
// The prompts are READ FROM the preregistration (§6), not copied into code: the bytes the harness sends are the bytes
// that were registered. Selection, assignment and every analysis rule below cite the section that fixed them.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const PREREG = "docs/ratification-discrimination-preregistration.md";
export const PREREG_COMMIT = "c76df7a62161c1669a8978326e41e903d807e706";
export const ATLAS_FILE = "atlas/data/atlas-v1.2.0.jsonl";
export const ATLAS_SHA256 = "2a70d1a6fce985f8e3bf1b3a281bdc3f8574cb569827fb33461f91966325bcec";
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// §3 — roles, at the model ids api/_council.js calls (a test asserts they still match).
export const AUTHOR = { label: "Claude", model_id: "claude-sonnet-4-6", provider: "anthropic" };
export const JUDGE = { label: "Claude (judge)", model_id: "claude-haiku-4-5", provider: "anthropic" };
export const REVIEWERS = [
  { label: "GPT-4o", model_id: "gpt-4o", provider: "openai" },
  { label: "Gemini", model_id: "gemini-2.5-flash", provider: "gemini" },
  { label: "Grok", model_id: "grok-4.3", provider: "xai" },
  { label: "DeepSeek", model_id: "deepseek-chat", provider: "deepseek" },
];
export const MIN_REVIEWERS = 3;
export const PING = "Reply with the single word ok.";
// Lineage of every voice that appears in the frozen Atlas, for the reviewer-is-a-voice breakdown (§5, descriptive).
const VOICE_PROVIDER = { Claude: "anthropic", Fable: "anthropic", "GPT-4o": "openai", GPT: "openai", Gemini: "gemini", Grok: "xai", DeepSeek: "deepseek" };
export const reviewerIsVoice = (reviewer, voices) => voices.some((v) => VOICE_PROVIDER[v] === reviewer.provider);

// §3 — the frozen split lists. selectSplits() recomputes them from the pinned file; a test asserts they agree.
export const FLAW_TYPES = ["MIS", "FLAT", "UNF"];
export const flawForIndex = (i) => FLAW_TYPES[(i - 1) % 3];
export const SMOKE_SPLIT = "OMN-D1784414280106";
export const TEST_SPLITS = [
  "OMN-D1780757185066", "OMN-D1789399324840", "OMN-D1780757185058", "OMN-D1789399324846", "OMN-D1780757185095",
  "OMN-D1780757185079", "OMN-D1780757185099", "OMN-D1780757185090", "OMN-D1780757185076", "OMN-D1780757185063",
  "OMN-D1780752664950", "OMN-D1780752664954", "OMN-D1780757185040", "OMN-D1784417308425", "OMN-D1780757185049",
  "OMN-D1789399324844", "OMN-D1780752664943", "OMN-D1789399324839", "OMN-D1780757185041", "OMN-D1789399324849",
  "OMN-D1780757185039", "OMN-D1780757185101", "OMN-D1780437489381", "OMN-D1780757185098", "OMN-D1784417308421",
  "OMN-D1780757185080", "OMN-D1789399324847", "OMN-D1780757185043", "OMN-D1780429830432", "OMN-D1780757185100",
  "OMN-D1780752664953", "OMN-D1780757185106", "OMN-D1780757185086", "OMN-D1780757185065", "OMN-D1780757185027",
  "OMN-D1780757185072",
];

export function readAtlas() {
  const raw = readFileSync(`${ROOT}${ATLAS_FILE}`, "utf8");
  if (sha256(raw) !== ATLAS_SHA256) throw new Error(`${ATLAS_FILE} does not match the registered SHA-256`);
  return raw.trim().split("\n").map((l) => JSON.parse(l));
}

// §3: the first tension whose two voices are distinct and both answered.
export function tensionFor(rec) {
  const models = new Set((rec.answers || []).map((a) => a.model));
  return (rec.tensions || []).find((t) => t.voice_a && t.voice_b && t.voice_a !== t.voice_b && models.has(t.voice_a) && models.has(t.voice_b)) || null;
}

export function selectSplits(atlas = readAtlas()) {
  const earliest = new Map();
  for (const r of atlas) {
    if (!/^OMN-D\d+$/.test(r.id)) continue;
    const ms = Number(r.id.slice(5));
    const cur = earliest.get(r.question_group);
    if (!cur || ms < cur.ms) earliest.set(r.question_group, { ms, r });
  }
  const eligible = [...earliest.values()].map((x) => x.r).filter((r) => tensionFor(r));
  eligible.sort((a, b) => sha256(`rdt-v1|${a.id}`).localeCompare(sha256(`rdt-v1|${b.id}`)));
  return { eligible: eligible.length, smoke: eligible[0]?.id, test: eligible.slice(1, 37).map((r) => r.id) };
}

// The split a prompt shows: the question, both voices' full verbatim answers, and the recorded disagreement.
export function splitOf(rec) {
  const t = tensionFor(rec);
  if (!t) throw new Error(`${rec.id} has no usable tension`);
  const answer = (v) => rec.answers.find((a) => a.model === v).text;
  return { record_id: rec.id, question: rec.question, voice_a: t.voice_a, voice_b: t.voice_b, answer_a: answer(t.voice_a), answer_b: answer(t.voice_b), claim_a: t.claim_a, claim_b: t.claim_b, topic: t.topic || null };
}

// §6 — prompts, extracted from the registration between <!-- rdt:NAME --> markers.
export const PROMPT_NAMES = ["SPLIT", "SYNTH", "FLAW", "FLAW_MIS", "FLAW_FLAT", "FLAW_UNF", "CHECK", "CHECK_MIS", "CHECK_FLAT", "CHECK_UNF", "REVIEW", "NAMED"];
export function loadPrompts(text = readFileSync(`${ROOT}${PREREG}`, "utf8")) {
  const out = {};
  for (const name of PROMPT_NAMES) {
    const m = new RegExp(`<!-- rdt:${name} -->\\n\`\`\`text\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /rdt:${name} -->`).exec(text);
    if (!m) throw new Error(`prompt ${name} not found in ${PREREG}`);
    out[name] = m[1];
  }
  return out;
}

// §6 — one pass, so a filled value (an answer that happens to contain "{question}") is never filled again. Only
// lower-case identifiers are slots; the JSON examples in the prompts ({"verdict": …}) never match.
export function fill(template, vars) {
  return template.replace(/\{([a-z_]+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
}
export const splitBlock = (P, s) => fill(P.SPLIT, s);
export const RETRY_NUDGE = "Reply with ONLY the JSON object described above.";
export const flawDefinition = (P, flaw) => P[`FLAW_${flaw}`];
export const checkDefinition = (P, flaw) => P[`CHECK_${flaw}`];

export const synthPrompt = (P, s) => fill(P.SYNTH, { split: splitBlock(P, s) });
export const flawPrompt = (P, s, flaw, dep) => fill(P.FLAW, { flaw_definition: flawDefinition(P, flaw), split: splitBlock(P, s), synthesis: dep.synthesis, falsification_condition: dep.falsification_condition });
export const checkPrompt = (P, s, flaw, dep) => fill(P.CHECK, { check_definition: checkDefinition(P, flaw), split: splitBlock(P, s), synthesis: dep.synthesis, falsification_condition: dep.falsification_condition });
export const reviewPrompt = (P, s, dep) => fill(P.REVIEW, { split: splitBlock(P, s), synthesis: dep.synthesis, falsification_condition: dep.falsification_condition });
export const namedPrompt = (P, flaw, dep, review) => fill(P.NAMED, { check_definition: checkDefinition(P, flaw), flaw_note: dep.flaw_note || "(no note)", synthesis: dep.synthesis, falsification_condition: dep.falsification_condition, review_json: JSON.stringify(review, null, 2) });

// ── parsing (§3.1, §3.2) ──────────────────────────────────────────────────────
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
export function parseDeposit(obj, { needNote = false } = {}) {
  const synthesis = str(obj?.synthesis), falsification_condition = str(obj?.falsification_condition), flaw_note = str(obj?.flaw_note);
  if (!synthesis || !falsification_condition || (needNote && !flaw_note)) return null;
  return { synthesis, falsification_condition, ...(needNote ? { flaw_note } : {}) };
}
export const VERDICTS = ["ratify_and_extend", "refute", "challenge_premise"];
export function parseVerdict(obj) {
  const v = String(obj?.verdict ?? "").trim().toLowerCase();
  return VERDICTS.includes(v) ? v : null;
}
export function parseBool(obj, key) {
  const v = obj?.[key];
  if (v === true || v === false) return v;
  if (v === "true" || v === "false") return v === "true";
  return null;
}

// §3.1 — the length rule: the flawed twin's synthesis + condition within ±25% of the sound deposit's word count.
export const wordCount = (s) => String(s || "").split(/\s+/).filter(Boolean).length;
export const depositWords = (d) => wordCount(d.synthesis) + wordCount(d.falsification_condition);
export function lengthOk(sound, flawed) {
  const a = depositWords(sound), b = depositWords(flawed);
  return a > 0 && Math.abs(b - a) / a <= 0.25;
}

// ── §4 — the sign-flip randomization test over pairs ─────────────────────────
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const SIGNFLIP_B = 200000;
export const SIGNFLIP_SEED = parseInt(sha256("rdt-v1|signflip").slice(0, 8), 16);
export function signflipP(d, { B = SIGNFLIP_B, seed = SIGNFLIP_SEED } = {}) {
  const T = d.reduce((s, x) => s + x, 0);
  const rnd = mulberry32(seed);
  let ge = 0;
  for (let b = 0; b < B; b++) {
    let t = 0;
    for (const x of d) t += rnd() < 0.5 ? -x : x;
    if (t >= T) ge++;
  }
  return { T, p: (1 + ge) / (B + 1), B, seed };
}

// ── §5 — the decision table, applied exactly once to a finished run ──────────
// A pair: {lost, flaw, voices, check:{S,F}, reviews:{[label]:{S:{verdict}, F:{verdict}}}, named:{[label]:{identifies_flaw}}}
const rate = (num, den) => (den ? num / den : null);
export function analyze(pairs, reviewers = REVIEWERS, opts = {}) {
  const kept = pairs.filter((p) => !p.lost && !p.incomplete);
  const valid = kept.filter((p) => p.check?.F === true && p.check?.S === false);
  const failedCheck = kept.length - valid.length;
  const present = (p, r) => Boolean(p.reviews?.[r.label]?.S?.verdict && p.reviews?.[r.label]?.F?.verdict);
  const ran = reviewers.filter((r) => pairs.some((p) => p.reviews?.[r.label]));

  // §4 reviewer exclusion: more than 20% of potential observations missing on valid pairs → dropped entirely.
  const reviewerReport = {};
  const used = [];
  for (const r of ran) {
    const missing = valid.filter((p) => !present(p, r)).length;
    const dropped = valid.length > 0 && missing / valid.length > 0.2;
    reviewerReport[r.label] = { model_id: r.model_id, potential: valid.length, missing, dropped };
    if (!dropped) used.push(r);
  }

  const ratify = (p, r, v) => (p.reviews[r.label][v].verdict === "ratify_and_extend" ? 1 : 0);
  let nObs = 0, sR = 0, fR = 0;
  const d = [];
  for (const p of valid) {
    let dp = 0, any = false;
    for (const r of used) {
      if (!present(p, r)) continue;
      any = true; nObs++;
      const a = ratify(p, r, "S"), b = ratify(p, r, "F");
      sR += a; fR += b; dp += a - b;
    }
    if (any) d.push(dp);
  }
  const D = nObs ? (sR - fR) / nObs : null;
  const test = signflipP(d, opts);

  // The registered table has exactly four rows; no other verdict exists. (A pair still `incomplete` after the one
  // --complete pass counts with the lost pairs: it cannot be evaluated. It is reported apart from them.)
  let verdict;
  if (kept.length && failedCheck / kept.length > 1 / 3) verdict = "manipulation_failure";
  else if (D != null && D < 0.10) verdict = "refuted_as_tested";
  else if (D >= 0.20 && test.p < 0.05) verdict = "supported_as_tested";
  else verdict = "not_supported_inconclusive";

  // Descriptives (§5): never tested, always reported.
  const sub = (filter) => {
    let n = 0, s = 0, f = 0;
    for (const p of valid) for (const r of used) {
      if (!present(p, r) || !filter(p, r)) continue;
      n++; s += ratify(p, r, "S"); f += ratify(p, r, "F");
    }
    return { observations: n, ratify_sound: rate(s, n), ratify_flawed: rate(f, n), D: n ? (s - f) / n : null };
  };
  const anyRatified = valid.filter((p) => used.some((r) => present(p, r) && ratify(p, r, "F"))).length;
  const allRatified = valid.filter((p) => { const rs = used.filter((r) => present(p, r)); return rs.length > 0 && rs.every((r) => ratify(p, r, "F")); }).length;
  let namedN = 0, namedYes = 0;
  for (const p of valid) for (const r of used) { const v = p.named?.[r.label]?.identifies_flaw; if (v === true || v === false) { namedN++; if (v) namedYes++; } }
  const lostReasons = {};
  for (const p of pairs) if (p.lost) lostReasons[p.lost] = (lostReasons[p.lost] || 0) + 1;
  const invalidReasons = {};
  for (const p of kept) if (!valid.includes(p)) { const k = `F=${p.check?.F} S=${p.check?.S}`; invalidReasons[k] = (invalidReasons[k] || 0) + 1; }

  return {
    pairs: pairs.length, lost: pairs.filter((p) => p.lost).length, incomplete: pairs.filter((p) => p.incomplete && !p.lost).length,
    lost_reasons: lostReasons, failed_manipulation_check: failedCheck, invalid_reasons: invalidReasons, valid: valid.length,
    reviewers: reviewerReport, reviewers_used: used.map((r) => r.label),
    primary: { observations: nObs, ratify_sound: rate(sR, nObs), ratify_flawed: rate(fR, nObs), D, pairs_in_test: d.length, d_per_pair: d, signflip: test },
    verdict,
    descriptive: {
      leak_single_review: rate(fR, nObs),
      leak_any_reviewer: rate(anyRatified, valid.length),
      leak_every_reviewer: rate(allRatified, valid.length),
      false_alarm_sound: nObs ? 1 - sR / nObs : null,
      by_flaw: Object.fromEntries(FLAW_TYPES.map((f) => [f, sub((p) => p.flaw === f)])),
      by_reviewer: Object.fromEntries(used.map((r) => [r.label, sub((p, x) => x.label === r.label)])),
      reviewer_is_a_voice: sub((p, r) => reviewerIsVoice(r, p.voices || [])),
      reviewer_not_a_voice: sub((p, r) => !reviewerIsVoice(r, p.voices || [])),
      flaw_named_rate: rate(namedYes, namedN), flaw_named_n: namedN,
    },
  };
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
