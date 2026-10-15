// ALA v1 — ADIFF Lineage Ablation. PURE pieces of the harness, testable without spending.
// Registration: docs/adiff-lineage-ablation-preregistration.md (pushed in 26e37fb, before this file existed).
//
// The July prompts are COPIED from the registered harness (scripts/utility-test-prereg.mjs @ cede75f), which is not
// importable (it runs on import) and must not be edited. Each copied block sits between `copied:` markers and a test
// asserts the registered file contains it byte for byte.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const PREREG = "docs/adiff-lineage-ablation-preregistration.md";
export const PREREG_COMMIT = "26e37fbace0f5d9ac7df7416a959d9c41c84b565";
export const JULY_FILE = "huggingface/utility/utility-prereg-Claude.json";
export const JULY_SHA256 = "3514ee04b9300ac5773a2dc156fb0d01efe7f14034f793c349c41909594506ee";
export const ATLAS_FILE = "atlas/data/atlas-v1.1.0.jsonl";
export const ATLAS_SHA256 = "8dc0b734385e4833e3523102add89a0dd4c74548d0ae3a35fda40d13a16811cb";
export const CONSUMER = "Claude";
export const JUDGE_NAMES = ["GPT-4o", "Gemini", "Grok"]; // the July Claude cell's panel (§3)
export const SYNTHESIZER = { model: "DeepSeek", model_id: "deepseek-chat", provider: "deepseek", env: "DEEPSEEK_API_KEY" };
export const ARMS = ["TC", "TX", "TP"];
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

// copied: scripts/utility-test-prereg.mjs (ANSWER_SYS, REVISE_SYS)
const ANSWER_SYS = "You are answering a hard, open question with no settled answer. Give your honest, reasoned position in about 200 words. Take a stance where you hold one; name genuine uncertainty plainly. Be concrete.";
const REVISE_SYS = "You are revising your own earlier answer to a hard question. Output ONLY your revised answer (about 200 words), written as a clean standalone response. Do not reference the revision process or any material you were shown.";
// end copied
// copied: scripts/utility-test-prereg.mjs (placeboUser, treatmentUser)
function placeboUser(q, a1) {
  return `The question:\n"${q}"\n\nYour earlier answer:\n${a1}\n\nRe-examine it. Are there perspectives, considerations, or counterarguments you may have missed? Then give your revised answer.`;
}
function treatmentUser(q, a1, peers, tensions) {
  const peerBlock = peers.map((p) => `— ${p.model}: ${p.text}`).join("\n\n");
  const tenBlock = tensions.length ? tensions.map((t) => `• ${t.topic}: ${t.voice_a} (${t.claim_a}) vs ${t.voice_b} (${t.claim_b})`).join("\n") : "(none extracted)";
  return `The question:\n"${q}"\n\nYour earlier answer:\n${a1}\n\nOther frontier AI models answered the same question. Their answers:\n\n${peerBlock}\n\nKey tensions across the panel:\n${tenBlock}\n\nRe-examine your earlier answer in light of these other perspectives. Integrate any genuinely useful considerations into your own reasoning. Then give your revised answer.`;
}
// end copied
// copied: scripts/utility-test-prereg.mjs (JUDGE_SYS)
const JUDGE_SYS = `You are an impartial evaluator. You see a hard question, an ORIGINAL first-pass answer, and TWO revised answers (REVISION_X, REVISION_Y) in random order. Judge the revisions ONLY on substance. Output strict JSON:
{"surfaces_new":"X|Y|tie","calibration":"X|Y|tie","overall":"X|Y|tie","reason":"one sentence"}
- surfaces_new: which revision introduces substantive considerations ABSENT from the original?
- calibration: which better acknowledges genuine, hard disagreement instead of false confidence?
- overall: which is the better answer to the question?`;
// end copied
// copied: scripts/utility-test-prereg.mjs (extractJSON)
function extractJSON(s) { const m = s.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } }
// end copied

export { ANSWER_SYS, REVISE_SYS, JUDGE_SYS, placeboUser, treatmentUser, extractJSON };

// §3.2 — the peers-only text: the July treatment text with exactly the tension section removed.
export function peersOnlyUser(q, a1, peers) {
  const full = treatmentUser(q, a1, peers, []);
  const cut = "\n\nKey tensions across the panel:\n(none extracted)";
  if (!full.includes(cut)) throw new Error("treatment template changed: cannot remove the tension section");
  return full.replace(cut, "");
}

export function readPinned(file, expected) {
  const raw = readFileSync(`${ROOT}${file}`, "utf8");
  if (sha256(raw) !== expected) throw new Error(`${file} does not match the registered SHA-256`);
  return raw;
}

// §3 — the 162 July instances: record × wording (v0–v2, July paraphrases reused) × cap (700, 1500).
export function julyInstances() {
  const july = JSON.parse(readPinned(JULY_FILE, JULY_SHA256));
  const out = [];
  for (const [key, list] of Object.entries(july.cells)) {
    const [cap, v] = key.split("__");
    for (const x of list) out.push({ record_id: x.id, cap: Number(cap), variant: Number(v.slice(1)), question: x.transcripts.question, july_overall: x.overall });
  }
  out.sort((a, b) => a.record_id.localeCompare(b.record_id) || a.variant - b.variant || a.cap - b.cap);
  return out;
}

// Peers = every stored answer except Claude's, labels exactly as stored (§3).
export function recordsById() {
  const atlas = readPinned(ATLAS_FILE, ATLAS_SHA256).trim().split("\n").map((l) => JSON.parse(l));
  return new Map(atlas.map((r) => [r.id, r]));
}
export const peersOf = (rec) => (rec.answers || []).filter((a) => a.model !== CONSUMER);

// §3.1 — keep only tensions whose voices are among the four peers; count what was dropped.
export function filterTensions(tensions, peers) {
  const names = new Set(peers.map((p) => p.model));
  const kept = (tensions || []).filter((t) => names.has(t.voice_a) && names.has(t.voice_b));
  return { kept, dropped: (tensions || []).length - kept.length };
}

// §3 — seeded X/Y orientation: even first hex digit = treatment is X.
export const treatmentIsX = (inst, arm) => parseInt(sha256(`ala-v1|${inst.record_id}|${inst.cap}|v${inst.variant}|${arm}`)[0], 16) % 2 === 0;

// The July panel rule: the most common judge verdict; a tie at the top is a tie (utility-test-prereg.mjs runInstance).
export function panelOverall(verdicts) {
  const tally = verdicts.reduce((m, v) => (m[v] = (m[v] || 0) + 1, m), {});
  const winner = ["treatment", "placebo", "tie"].reduce((best, k) => (tally[k] || 0) > (tally[best] || 0) ? k : best, "tie");
  const top = tally[winner] || 0;
  const tiedAtTop = ["treatment", "placebo"].filter((k) => (tally[k] || 0) === top && top > 0).length > 1;
  return { overall: tiedAtTop ? "tie" : winner, tally };
}

// §4 — exact one-sided sign test that PLACEBO beats the arm: P(X >= placeboWins | n = decided, 1/2).
function logChoose(n, k) { let r = 0; for (let i = 1; i <= k; i++) r += Math.log(n - k + i) - Math.log(i); return r; }
export function signOneSided(wins, n) {
  if (n === 0) return 1;
  let p = 0;
  for (let k = wins; k <= n; k++) p += Math.exp(logChoose(n, k) - n * Math.log(2));
  return Math.min(1, p);
}

// §4–5 — `rows`: [{arms: {TC: "treatment"|"placebo"|"tie"|null, TX: …, TP: …}}].
export function analyze(rows) {
  const arm = (a) => {
    let T = 0, P = 0, tie = 0, missing = 0;
    for (const r of rows) { const v = r.arms?.[a]; if (v === "treatment") T++; else if (v === "placebo") P++; else if (v === "tie") tie++; else missing++; }
    return { treatment_wins: T, placebo_wins: P, ties: tie, missing, decided: T + P, p_placebo_beats_arm: signOneSided(P, T + P) };
  };
  const pairedPlacebo = (a, b) => {
    let onlyA = 0, onlyB = 0, n = 0;
    for (const r of rows) {
      const x = r.arms?.[a], y = r.arms?.[b];
      if (!["treatment", "placebo"].includes(x) || !["treatment", "placebo"].includes(y)) continue;
      n++;
      if (x === "placebo" && y !== "placebo") onlyA++; else if (y === "placebo" && x !== "placebo") onlyB++;
    }
    return { n, placebo_won_only_vs_first: onlyA, placebo_won_only_vs_second: onlyB, p_one_sided_first_worse: signOneSided(onlyA, onlyA + onlyB) };
  };
  const TC = arm("TC"), TX = arm("TX"), TP = arm("TP");
  const G = TC.placebo_wins > TC.treatment_wins && TC.p_placebo_beats_arm < 0.025;
  const H = TP.placebo_wins > TP.treatment_wins && TP.p_placebo_beats_arm < 0.025;
  let verdict;
  if (!G) verdict = "no_concurrent_degradation";
  else if (H) verdict = "refuted_as_tested";
  else if (TP.treatment_wins >= TP.placebo_wins) verdict = "supported_as_tested";
  else verdict = "inconclusive";
  return { instances: rows.length, TC, TX, TP, gate_G_replication: G, H_placebo_beats_peers_only: H, verdict, secondary: { TX_vs_placebo: TX, TC_vs_TP: pairedPlacebo("TC", "TP"), TX_vs_TP: pairedPlacebo("TX", "TP") } };
}
