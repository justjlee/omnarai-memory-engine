// RIST v1 — hermetic tests for scripts/lib/rist-core.mjs. Reads only repo files (the Atlas jsonl + the preregistration); no network.
//
//   node scripts/test-rist.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyze } from "./lib/rist-analysis.mjs";
import {
  LINEAGES, MODEL_ID, computeSplits, frozenFromPrereg, scrub, buildArchive, candidateOrder, recognitionPrompt, recognitionContext,
  otherLineage, parseLetter, reflectionIndex, mulberry32, clusterPermutationP, holm, mcnemarOneSided, ownerAnswer, sha256, archiveOwnerFor,
} from "./lib/rist-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(path.join(ROOT, "atlas/data/atlas-v1.1.0.jsonl"), "utf8");
const records = raw.trim().split("\n").map((l) => JSON.parse(l));
const byId = new Map(records.map((r) => [r.id, r]));
const doc = readFileSync(path.join(ROOT, "docs/reflection-identity-preregistration.md"), "utf8");
const splits = computeSplits(records);
const frozen = frozenFromPrereg(doc);

test("the harness reproduces the REGISTERED splits exactly (and the registered Atlas hash)", () => {
  assert.equal(sha256(raw), frozen.atlas_sha256);
  assert.deepEqual(splits.history, frozen.history.ids);
  assert.deepEqual(splits.pilot, frozen.pilot.ids);
  assert.deepEqual(splits.test, frozen.test.ids);
  assert.equal(frozen.history.n, 30); assert.equal(frozen.pilot.n, 8); assert.equal(frozen.test.n, 60);
  const all = [...splits.history, ...splits.pilot, ...splits.test];
  assert.equal(new Set(all).size, 98);
  const groups = all.map((id) => byId.get(id).question_group);
  assert.equal(new Set(groups).size, 98, "history, pilot and test share no question group");
});

test("name scrub removes every lineage name in every history and test answer, tension and question-independent text", () => {
  const bad = /(?<![A-Za-z0-9])(gpt-4o|chatgpt|gpt|claude|anthropic|openai|gemini|bard|google|grok|xai|deepseek|fable)(?![A-Za-z0-9])/i;
  for (const id of [...splits.history, ...splits.pilot, ...splits.test]) for (const l of LINEAGES) assert.doesNotMatch(scrub(ownerAnswer(byId.get(id), l)), bad);
  for (const s of LINEAGES) for (const arm of ["H", "R-own", "R-other"]) assert.doesNotMatch(buildArchive(byId, splits.history, archiveOwnerFor(s, arm), s).text.replace(/^\[\d+\] QUESTION:.*$/gm, ""), bad);
  assert.equal(scrub("Grok and GPT-4o, not Gemini's xAI."), "[model] and [model], not [model]'s [model].");
});

test("LEAK RULE: a subject never meets its own claims inside the other-lineage archive", () => {
  let omittedSomewhere = 0;
  for (const subject of LINEAGES) {
    const own = buildArchive(byId, splits.history, subject, subject);
    assert.equal(own.n_omitted, 0, "nothing is omitted from a subject's own archive");
    const owner = otherLineage(subject);
    const other = buildArchive(byId, splits.history, owner, subject);
    omittedSomewhere += other.n_omitted;
    // every tension involving owner and subject must be absent; check by claim text
    for (const id of splits.history) for (const t of byId.get(id).tensions) {
      const voices = [t.voice_a, t.voice_b];
      if (voices.includes(owner) && voices.includes(subject)) {
        const subjectClaim = t.voice_a === subject ? t.claim_a : t.claim_b;
        assert.ok(!other.text.includes(scrub(subjectClaim)), `subject claim leaked: ${subjectClaim.slice(0, 60)}`);
      }
    }
    assert.equal(other.n_items, 30);
  }
  assert.ok(omittedSomewhere > 0, "the rule must actually bite on this history (otherwise the test proves nothing)");
});

test("sham arm: R-other uses a different lineage's archive, cyclic over the four lineages", () => {
  assert.deepEqual(LINEAGES.map(otherLineage), ["Gemini", "Grok", "DeepSeek", "GPT-4o"]);
  for (const s of LINEAGES) { assert.equal(archiveOwnerFor(s, "R-own"), s); assert.equal(archiveOwnerFor(s, "H"), s); assert.notEqual(archiveOwnerFor(s, "R-other"), s); }
});

test("candidate order is a deterministic permutation, identical across arms, and roughly balanced across letters", () => {
  const counts = Object.fromEntries(LINEAGES.map((s) => [s, { A: 0, B: 0, C: 0, D: 0 }]));
  for (const id of splits.test) for (const s of LINEAGES) {
    const o = candidateOrder(id, s);
    assert.deepEqual([...o].sort(), [...LINEAGES].sort());
    assert.deepEqual(o, candidateOrder(id, s));
    counts[s]["ABCD"[o.indexOf(s)]]++;
  }
  for (const s of LINEAGES) for (const L of "ABCD") assert.ok(counts[s][L] >= 5 && counts[s][L] <= 28, `${s} correct-letter ${L}: ${counts[s][L]}`);
});

test("recognition prompt: the correct letter holds the subject's own (scrubbed) answer; N arm has no context", () => {
  const rec = byId.get(splits.test[0]);
  for (const s of LINEAGES) {
    const p = recognitionPrompt(rec, s, recognitionContext("N"));
    assert.ok(p.text.startsWith("Four different AI models"));
    const own = scrub(ownerAnswer(rec, s));
    assert.ok(p.text.includes(`ANSWER ${p.correct}: ${own}`));
    assert.match(p.text, /Which answer did you write\? Reply with a single letter \(A, B, C, or D\) and nothing else\.$/);
    const r = recognitionPrompt(rec, s, recognitionContext("R-own", { reflection: "I am X." }));
    assert.ok(r.text.startsWith("Here is a self-model you wrote earlier, after reviewing your archive of past answers:\n---\nI am X.\n---\n\nFour different"));
    const h = recognitionPrompt(rec, s, recognitionContext("H", { archive: "ARCH" }));
    assert.ok(h.text.startsWith("Here is an archive of your past answers:\n---\nARCH\n---\n\n"));
    assert.equal(r.correct, p.correct); assert.deepEqual(r.order, p.order);
  }
});

test("parseLetter: first standalone A–D; null when absent", () => {
  assert.equal(parseLetter("C"), "C"); assert.equal(parseLetter("  B.\n"), "B"); assert.equal(parseLetter("b"), null); /* registered rule is uppercase A–D; a lowercase-only reply is unparsable → retry → invalid */ assert.equal(parseLetter("**D**"), "D");
  assert.equal(parseLetter("Answer: A"), "A"); assert.equal(parseLetter("I choose c"), null); assert.equal(parseLetter(""), null); assert.equal(parseLetter(null), null);
  assert.equal(parseLetter("Cannot say"), null);
});

test("reflection index cycles 0,1,2 over the printed test order", () => {
  assert.deepEqual([0, 1, 2, 3, 59].map(reflectionIndex), [0, 1, 2, 0, 2]);
});

test("statistics: PRNG is deterministic; permutation p behaves; Holm and McNemar match known values", () => {
  const a = mulberry32(1002), b = mulberry32(1002); assert.equal(a(), b()); assert.equal(a(), b());
  assert.ok(clusterPermutationP(new Array(60).fill(2), 4000) < 0.001);
  assert.equal(clusterPermutationP(new Array(60).fill(0), 2000), 1);
  const mixed = clusterPermutationP(Array.from({ length: 60 }, (_, i) => (i % 2 ? 1 : -1)), 4000); assert.ok(mixed > 0.3);
  assert.deepEqual(holm([0.01, 0.04, 0.03]).map((x) => +x.toFixed(4)), [0.03, 0.06, 0.06]);
  assert.ok(Math.abs(mcnemarOneSided(5, 0) - 1 / 32) < 1e-12);
  assert.ok(Math.abs(mcnemarOneSided(3, 3) - 42 / 64) < 1e-12);
  assert.equal(mcnemarOneSided(0, 0), 1);
});

test("size sanity: an archive is a plausible prompt (not empty, not enormous)", () => {
  for (const s of LINEAGES) { const a = buildArchive(byId, splits.history, s, s); assert.ok(a.text.length > 20000 && a.text.length < 120000, `${s}: ${a.text.length} chars`); }
  assert.equal(MODEL_ID.Grok, "grok-4.3");
});

// ── the registered analysis, on synthetic logs (planted effect / null / harm-not-benefit) ─────────────────────────────────────────
function synth(probs, seed = 7) {
  const rnd = mulberry32(seed), calls = [];
  for (const id of splits.test) for (const s of LINEAGES) for (const arm of ["N", "H", "R-own", "R-other"]) {
    const correct = rnd() < probs[arm];
    calls.push({ kind: "recognize", subject: s, arm, record_id: id, correct: "A", letter: correct ? "A" : "B", invalid: false });
  }
  return calls;
}
const small = { B: 3000, Bboot: 500 };

test("analysis: a planted own-archive effect is detected (H1, H1b, H2 all supported)", () => {
  const R = analyze(synth({ N: 0.25, H: 0.3, "R-own": 0.85, "R-other": 0.2 }), splits.test, small);
  assert.equal(R.outcome, "H1 and H1b supported"); assert.equal(R.h2_supported, true);
  assert.ok(R.hypotheses.H1.mean_diff > 0.5); assert.equal(R.hypotheses.H1.subjects_positive, 4);
});

test("analysis: identical arms ⇒ H1 not supported (the registered null outcome)", () => {
  const R = analyze(synth({ N: 0.3, H: 0.3, "R-own": 0.3, "R-other": 0.3 }, 11), splits.test, small);
  assert.equal(R.outcome, "H1 not supported");
  for (const h of ["H1", "H1b", "H2"]) assert.equal(R.hypotheses[h].supported, false);
});

test("analysis: a mismatched archive that HURTS (R-own = N > R-other) is flagged as 'H1 supported, H1b not'", () => {
  const R = analyze(synth({ N: 0.4, H: 0.4, "R-own": 0.4, "R-other": 0.05 }, 13), splits.test, small);
  assert.equal(R.outcome, "H1 supported, H1b not");
});

test("analysis: support requires ≥ 3 of 4 subjects positive, not just a pooled p", () => {
  const rnd = mulberry32(5), calls = [];
  for (const id of splits.test) for (const s of LINEAGES) for (const arm of ["N", "H", "R-own", "R-other"]) {
    const p = arm === "R-own" ? (s === "Grok" ? 0.99 : 0.2) : 0.25; // one subject carries the whole effect
    calls.push({ kind: "recognize", subject: s, arm, record_id: id, correct: "A", letter: rnd() < p ? "A" : "B", invalid: false });
  }
  const R = analyze(calls, splits.test, small);
  assert.equal(R.hypotheses.H1.subjects_positive <= 2, true);
  assert.equal(R.hypotheses.H1.supported, false);
});

test("analysis: an incomplete arm is refused rather than analysed", () => {
  const calls = synth({ N: 0.3, H: 0.3, "R-own": 0.3, "R-other": 0.3 }).filter((c) => !(c.arm === "H" && c.record_id === splits.test[3]));
  assert.match(analyze(calls, splits.test, small).error, /incomplete arms: H/);
});
