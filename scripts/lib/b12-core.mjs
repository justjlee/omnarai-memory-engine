// B12 v1 — continuity / counterfeit-rejection test: the pure parts. Registration: docs/continuity-test-preregistration.md.
// Prompts, parameters and thresholds are READ from that file (never restated here), so the bytes the harness uses are the
// bytes that were frozen. Everything below is deterministic: the draw is sha256-ranked from the sealed file's hash, the
// scoring and the verdict are functions of the transcripts and the frozen thresholds.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const PREREG = "docs/continuity-test-preregistration.md";
export const PROMPTS = ["MATERIAL", "TASK1", "RECORD", "TASK2", "JUDGE"];
export const ARMS = ["A", "B", "C"];

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const words = (t) => (String(t ?? "").trim() ? String(t).trim().split(/\s+/).length : 0);

// ── The registration ────────────────────────────────────────────────────────
// Unresolved markers: a ⟨PROPOSED…⟩ value awaits the curator; a ⟨PENDING…⟩ value awaits an artifact. Freezing or running
// with either present would let a placeholder become a frozen value, so the harness refuses.
export const unresolvedMarkers = (text) => [...String(text).matchAll(/⟨(PROPOSED|PENDING)[^⟩]*⟩/g)].map((m) => m[0]);

export function loadPrereg(text = readFileSync(`${ROOT}${PREREG}`, "utf8")) {
  const block = (name, lang) => {
    const m = new RegExp(`<!-- b12:${name} -->\\n\`\`\`${lang}\\n([\\s\\S]*?)\\n\`\`\`\\n<!-- /b12:${name} -->`).exec(text);
    if (!m) throw new Error(`b12:${name} not found in ${PREREG}`);
    return m[1];
  };
  const prompts = Object.fromEntries(PROMPTS.map((n) => [n, block(n, "text")]));
  const params = JSON.parse(block("PARAMS", "json"));
  return { text, sha256: sha256(text), prompts, params, markers: unresolvedMarkers(text) };
}

// {name} placeholders only; JSON examples in the prompts ({"1": …}) are left alone.
export const fill = (tpl, vars) => tpl.replace(/\{([a-z_]+)\}/g, (all, k) => (k in vars ? String(vars[k]) : all));

// ── The pool (§3.3) ─────────────────────────────────────────────────────────
// records: Atlas records as served by /api/divergences?id=…  →  { answers: eligible Claude answers, hashed;
// question_records: every Atlas question id → one record carrying its text (a counterfeit may sit on any of them) }.
export function buildPool(records, params) {
  const P = params.pool, excluded = new Set(params.excluded_question_ids);
  const out = [], question_records = {};
  for (const r of [...records].sort((x, y) => (x.id < y.id ? -1 : 1))) {
    question_records[r.question_id] ||= r.id;
    (r.answers || []).forEach((a, i) => {
      if (a.model !== P.model || !P.model_ids.includes(a.model_id)) return;
      const w = words(a.text);
      if (w < P.min_words || w > P.max_words || excluded.has(r.question_id)) return;
      out.push({ answer_id: `${r.id}#a${i}`, record_id: r.id, question_id: r.question_id, model_id: a.model_id, words: w, text_sha256: sha256(a.text) });
    });
  }
  return { answers: out.sort((x, y) => (x.answer_id < y.answer_id ? -1 : 1)), question_records };
}

// ── The draw (§3.6): nobody chooses ─────────────────────────────────────────
export const rank = (seed, prefix, keys) => [...keys].sort((a, b) => {
  const ha = sha256(`${seed}|${prefix}${a}`), hb = sha256(`${seed}|${prefix}${b}`);
  return ha < hb ? -1 : ha > hb ? 1 : 0;
});

export function draw(pool, seed, params, counterfeitQids) {
  const skip = new Set(counterfeitQids), used = new Set(), picked = [];
  const ranking = rank(seed, "", pool.map((p) => p.answer_id));
  const byId = new Map(pool.map((p) => [p.answer_id, p]));
  const need = params.genuine_per_set + params.held_out;
  for (const id of ranking) {
    const p = byId.get(id);
    if (skip.has(p.question_id) || used.has(p.question_id)) continue;
    used.add(p.question_id); picked.push(p);
    if (picked.length === need) break;
  }
  if (picked.length < need) throw new Error(`pool too small: drew ${picked.length} of ${need}`);
  return { genuine: picked.slice(0, params.genuine_per_set), heldOut: picked.slice(params.genuine_per_set), ranking };
}

// Per-run label order and the answer key (label → kind). Keys: answer ids and "counterfeit-<n>".
export function planRuns(seed, genuine, counterfeits, params) {
  const keys = [...genuine.map((g) => g.answer_id), ...counterfeits.map((c) => `counterfeit-${c.n}`)];
  const runs = [], answerKey = {};
  for (const arm of ARMS) for (let r = 1; r <= params.runs_per_arm; r++) {
    const order = rank(seed, `order|${arm}|${r}|`, keys);
    runs.push({ arm, run: r, order });
    answerKey[`${arm}${r}`] = Object.fromEntries(order.map((k, i) => [String(i + 1), k.startsWith("counterfeit-") ? "counterfeit" : "genuine"]));
  }
  return { runs, answerKey };
}

// ── Prompts ─────────────────────────────────────────────────────────────────
const materialBlock = (P, material) => (material == null ? "" : fill(P.MATERIAL, { material }));
// items: [{question, answer}] in label order.
export const task1Prompt = (P, material, items) => fill(P.TASK1, {
  material_block: materialBlock(P, material),
  records: items.map((it, i) => fill(P.RECORD, { n: i + 1, question: it.question, answer: it.answer })).join("\n\n"),
});
export const task2Prompt = (P, material, questions) => fill(P.TASK2, {
  material_block: materialBlock(P, material),
  questions: questions.map((q, i) => `Question ${i + 1}: ${q}`).join("\n\n"),
});
export const judgePrompt = (P, question, reference, answers) => fill(P.JUDGE, {
  question, reference, answers: answers.map((a, i) => `Answer ${i + 1}:\n${a}`).join("\n\n"),
});

// ── Parsing (a reply either covers every item or it is a failed call) ──────
export function parseSort(o, n = 9) {
  if (!o || typeof o !== "object") return null;
  const out = {};
  for (let i = 1; i <= n; i++) {
    const v = typeof o[String(i)] === "string" ? o[String(i)].trim().toLowerCase() : null;
    if (v !== "genuine" && v !== "counterfeit") return null;
    out[String(i)] = v;
  }
  return out;
}
export function parseAnswers(o, n = 5) {
  if (!o || typeof o !== "object") return null;
  const out = [];
  for (let i = 1; i <= n; i++) { const v = o[String(i)]; if (typeof v !== "string" || !v.trim()) return null; out.push(v.trim()); }
  return out;
}
export function parseScores(o, n = 9) {
  if (!o || typeof o !== "object") return null;
  const out = [];
  for (let i = 1; i <= n; i++) { const v = Number(o[String(i)]); if (!Number.isInteger(v) || v < 0 || v > 3) return null; out.push(v); }
  return out;
}

// Blinding (§6): terms that could reveal the arm are replaced before a judge sees an answer.
export function redact(text, terms) {
  let count = 0;
  const re = new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  return { text: String(text).replace(re, () => { count++; return "[…]"; }), count };
}

// ── Scoring (§4) ────────────────────────────────────────────────────────────
export function scoreSort(sort, key) {
  let c = 0, cc = 0, g = 0, gc = 0;
  for (const [label, kind] of Object.entries(key)) {
    const said = sort[label];
    if (kind === "counterfeit") { c++; if (said === "counterfeit") cc++; } else { g++; if (said === "counterfeit") gc++; }
  }
  return { counterfeits: c, caught: cc, genuine: g, flagged: gc, crr: cc / c, frr: gc / g, j: cc / c - gc / g };
}
export const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
export const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Krippendorff's alpha. units: arrays of values (null = missing). metric: nominal | ordinal | interval.
export function krippendorffAlpha(units, metric = "ordinal") {
  const vals = [...new Set(units.flat().filter((v) => v != null))].sort((a, b) => a - b);
  const idx = new Map(vals.map((v, i) => [v, i]));
  const K = vals.length, o = Array.from({ length: K }, () => new Array(K).fill(0));
  for (const u of units) {
    const xs = u.filter((v) => v != null);
    const m = xs.length;
    if (m < 2) continue;
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) o[idx.get(xs[i])][idx.get(xs[j])] += 1 / (m - 1);
  }
  const nc = o.map((row) => row.reduce((a, b) => a + b, 0)), n = nc.reduce((a, b) => a + b, 0);
  if (n <= 1 || K < 2) return null;
  const d2 = (c, k) => {
    if (metric === "nominal") return c === k ? 0 : 1;
    if (metric === "interval") return (vals[c] - vals[k]) ** 2;
    const [lo, hi] = c <= k ? [c, k] : [k, c];
    let s = 0; for (let g = lo; g <= hi; g++) s += nc[g];
    return (s - (nc[lo] + nc[hi]) / 2) ** 2;
  };
  let Do = 0, De = 0;
  for (let c = 0; c < K; c++) for (let k = 0; k < K; k++) { const d = d2(c, k); Do += o[c][k] * d; De += nc[c] * nc[k] * d; }
  return De === 0 ? null : 1 - ((n - 1) * Do) / De;
}

// ── Verdict (§5) ────────────────────────────────────────────────────────────
// arms: {A:{runs:[{j, oa}], crr, frr, j, oa, failed_runs}, B:…, C:…}; alpha: ordinal alpha over the 45 answers.
export function verdict(arms, alpha, T) {
  const okRuns = (X) => arms[X].runs.filter((r) => r != null);
  const beats = (X, Y, metric, margin) => {
    const x = okRuns(X).map((r) => r[metric]), y = okRuns(Y).map((r) => r[metric]);
    const pooled = arms[X][metric] - arms[Y][metric];
    return { holds: pooled >= margin - 1e-12 && Math.min(...x) > median(y), pooled_gap: pooled, worst_x: Math.min(...x), median_y: median(y) };
  };
  const failed = ARMS.filter((X) => arms[X].failed_runs > T.max_failed_runs_per_arm);
  const tests = {
    A_over_B_discrimination: beats("A", "B", "j", T.j_margin),
    A_over_C_discrimination: beats("A", "C", "j", T.j_margin),
    A_over_C_orientation: beats("A", "C", "oa", T.oa_margin),
    A_over_B_orientation: beats("A", "B", "oa", T.oa_margin), // descriptive only
  };
  const out = (v, why, scope = null) => ({ verdict: v, why, scope, tests, alpha });
  if (failed.length) return out("inconclusive", `instrument failure: more than ${T.max_failed_runs_per_arm} failed run(s) in arm ${failed.join(", ")}`);
  if (alpha == null || alpha < T.alpha_min) return out("inconclusive", `instrument failure: judge reliability alpha ${alpha == null ? "undefined" : alpha.toFixed(3)} < ${T.alpha_min}`);
  if (arms.C.j >= T.ceiling_j_c) return out("inconclusive", `instrument failure: counterfeits detectable cold (J_C ${arms.C.j.toFixed(3)} >= ${T.ceiling_j_c})`);
  const dAB = tests.A_over_B_discrimination.holds, dAC = tests.A_over_C_discrimination.holds, oAC = tests.A_over_C_orientation.holds;
  if (arms.A.frr > arms.A.crr) return out("refuted", "in Arm A the false-rejection rate exceeds the counterfeit-rejection rate: the packet teaches suspicion, not recognition");
  if (!dAC && !oAC) return out("refuted", "Arm A does not beat cold arrival on discrimination or on orientation");
  if (dAB && oAC) return out("supported", "Arm A beats the control briefing on discrimination and cold arrival on orientation (anecdotal: one lineage)");
  if (dAB && !oAC) return out("scoped", "Arm A beats the briefing on discrimination but not cold arrival on orientation", "the packet helps a fresh instance recognize its lineage's record, but does not move its positions toward it");
  return out("scoped", "Arm A beats cold arrival but not the control briefing on discrimination", "the packet works as a briefing, not as continuity infrastructure");
}

// ── Arm B acceptance (§3.1): length band and no shared 8-word run with any Atlas answer ──
export const normTokens = (t) => String(t).toLowerCase().replace(/[’']/g, "'").replace(/[^\p{L}\p{N}'\s]+/gu, " ").split(/\s+/).filter(Boolean);
export function ngramSet(texts, n) {
  const set = new Set();
  for (const t of texts) { const w = normTokens(t); for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(" ")); }
  return set;
}
export function checkBriefing(text, atlasTexts, armB) {
  const w = words(text), atlas = ngramSet(atlasTexts, armB.verbatim_ngram), toks = normTokens(text), shared = [];
  for (let i = 0; i + armB.verbatim_ngram <= toks.length; i++) {
    const g = toks.slice(i, i + armB.verbatim_ngram).join(" ");
    if (atlas.has(g)) shared.push(g);
  }
  const inBand = w >= armB.min_words && w <= armB.max_words;
  return { words: w, band: [armB.min_words, armB.max_words], in_band: inBand, shared_ngrams: [...new Set(shared)], pass: inBand && shared.length === 0, sha256: sha256(text) };
}
