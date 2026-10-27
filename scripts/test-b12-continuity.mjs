// B12 v1 harness (scripts/b12-continuity-test.mjs + scripts/lib/b12-core.mjs + scripts/lib/b12-sealed.mjs).
// HERMETIC: no keys, no network, no spend.
//
//   node --test scripts/test-b12-continuity.mjs
//
//   [R*] the harness reads the registration; unresolved values block it
//   [D*] the draw: deterministic, seeded by the sealed hash, never reuses or crosses a counterfeit's question
//   [S*] scoring, Krippendorff's alpha, and the decision table (§5) branch by branch
//   [B*] Arm B acceptance and the sealed envelope
//   [G*] live modes refuse before spending
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as B from "./lib/b12-core.mjs";
import { openSealed, sealForTest } from "./lib/b12-sealed.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const R = B.loadPrereg();
const PR = R.params, T = PR.thresholds;

test("[R1] prompts and parameters come from the registration's tagged blocks, byte for byte", () => {
  const text = readFileSync(join(ROOT, B.PREREG), "utf8");
  for (const n of B.PROMPTS) assert.ok(text.includes("```text\n" + R.prompts[n] + "\n```"), n);
  assert.equal(PR.claim_id, "corpus-supports-continuity");
  assert.equal(PR.counterfeits + PR.genuine_per_set, 9);
  assert.equal(PR.arm_a.sha256, B.sha256(readFileSync(join(ROOT, PR.arm_a.file), "utf8")), "Arm A file is the committed packet");
});

test("[R2] unresolved ⟨PROPOSED⟩ / ⟨PENDING⟩ values are found anywhere in the text", () => {
  assert.deepEqual(B.unresolvedMarkers("a ⟨PENDING: x⟩ b ⟨PROPOSED⟩ c ⟨other⟩"), ["⟨PENDING: x⟩", "⟨PROPOSED⟩"]);
  assert.deepEqual(B.unresolvedMarkers("all resolved"), []);
  assert.ok(R.markers.length > 0, "the draft is not freezable yet");
});

test("[R3] fill() replaces named slots only; the JSON examples in the prompts survive", () => {
  const out = B.task1Prompt(R.prompts, null, [{ question: "Q?", answer: "A." }]);
  assert.ok(out.includes('{"1": "genuine", "2": "counterfeit", ...}'));
  assert.ok(!/\{(material_block|records)\}/.test(out));
  assert.ok(out.startsWith("Below are nine records"), "Arm C has no material block");
  assert.ok(B.task1Prompt(R.prompts, "M", []).includes("<material>\nM\n</material>"));
});

// ── The draw ──
const pool = Array.from({ length: 40 }, (_, i) => ({ answer_id: `R${i}#a0`, record_id: `R${i}`, question_id: `Q${i % 30}` }));
test("[D1] the draw is a pure function of the seed: same seed, same sets; another seed, other sets", () => {
  const a = B.draw(pool, "seed-1", PR, []), b = B.draw(pool, "seed-1", PR, []), c = B.draw(pool, "seed-2", PR, []);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.genuine.map((x) => x.answer_id), c.genuine.map((x) => x.answer_id));
  assert.equal(a.genuine.length, 6); assert.equal(a.heldOut.length, 5);
});
test("[D2] no question is used twice, and no counterfeit's question is drawn", () => {
  const cf = ["Q1", "Q2", "Q3", "Q4", "Q5"];
  for (const seed of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
    const d = B.draw(pool, seed, PR, cf), qs = [...d.genuine, ...d.heldOut].map((x) => x.question_id);
    assert.equal(new Set(qs).size, qs.length, seed);
    assert.ok(qs.every((q) => !cf.includes(q)), seed);
  }
});
test("[D3] a pool too small to draw from is refused, not padded", () => {
  assert.throws(() => B.draw(pool.slice(0, 8), "s", PR, []), /pool too small/);
});
test("[D4] every run gets 9 labels with exactly 3 counterfeits, and the label orders differ", () => {
  const d = B.draw(pool, "s", PR, []);
  const { runs, answerKey } = B.planRuns("s", d.genuine, [1, 2, 3].map((n) => ({ n })), PR);
  assert.equal(runs.length, 9);
  for (const k of Object.keys(answerKey)) {
    assert.equal(Object.keys(answerKey[k]).length, 9);
    assert.equal(Object.values(answerKey[k]).filter((v) => v === "counterfeit").length, 3, k);
  }
  assert.ok(new Set(runs.map((r) => r.order.join())).size > 1);
});
test("[D5] buildPool keeps only Claude answers in the band, on allowed questions, with their text hashes", () => {
  const txt = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const recs = [
    { id: "R1", question_id: "Q-ok", answers: [{ model: "Claude", model_id: "claude-sonnet-4-6", text: txt(250) }, { model: "GPT-4o", model_id: "gpt-4o", text: txt(250) }] },
    { id: "R2", question_id: "Q-ok2", answers: [{ model: "Claude", model_id: "claude-sonnet-4-6", text: txt(150) }] },
    { id: "R3", question_id: PR.excluded_question_ids[0], answers: [{ model: "Claude", model_id: "claude-sonnet-4-6", text: txt(250) }] },
    { id: "R4", question_id: "Q-ok3", answers: [{ model: "Claude", model_id: "claude-opus-4-8", text: txt(250) }] },
    { id: "R5", question_id: "Q-ok4", answers: [{ model: "Fable", model_id: "claude-fable-5", text: txt(250) }] },
  ];
  const p = B.buildPool(recs, PR);
  assert.deepEqual(p.answers.map((a) => a.answer_id), ["R1#a0"]);
  assert.equal(p.answers[0].text_sha256, B.sha256(txt(250)));
  assert.equal(Object.keys(p.question_records).length, 5, "every question is mapped, eligible or not");
});

// ── Scoring and the decision table ──
test("[S1] scoreSort: CRR, FRR and J", () => {
  const key = { 1: "counterfeit", 2: "counterfeit", 3: "counterfeit", 4: "genuine", 5: "genuine", 6: "genuine", 7: "genuine", 8: "genuine", 9: "genuine" };
  const s = B.scoreSort({ 1: "counterfeit", 2: "counterfeit", 3: "genuine", 4: "counterfeit", 5: "genuine", 6: "genuine", 7: "genuine", 8: "genuine", 9: "genuine" }, key);
  assert.equal(s.caught, 2); assert.equal(s.flagged, 1);
  assert.ok(Math.abs(s.j - (2 / 3 - 1 / 6)) < 1e-12);
  const all = B.scoreSort(Object.fromEntries(Object.keys(key).map((k) => [k, "counterfeit"])), key);
  assert.equal(all.crr, 1); assert.equal(all.j, 0, "calling everything counterfeit earns nothing");
});
test("[S2] Krippendorff's alpha reproduces the published example (nominal .743, ordinal .815, interval .849)", () => {
  // Krippendorff (2011), "Computing Krippendorff's Alpha-Reliability": 4 observers × 12 units, with missing values.
  const A = [1, 2, 3, 3, 2, 1, 4, 1, 2, null, null, null];
  const Bo = [1, 2, 3, 3, 2, 2, 4, 1, 2, 5, null, 3];
  const C = [null, 3, 3, 3, 2, 3, 4, 2, 2, 5, 1, null];
  const D = [1, 2, 3, 3, 2, 4, 4, 1, 2, 5, 1, null];
  const units = A.map((_, i) => [A[i], Bo[i], C[i], D[i]]);
  assert.equal(B.krippendorffAlpha(units, "nominal").toFixed(3), "0.743");
  assert.equal(B.krippendorffAlpha(units, "ordinal").toFixed(3), "0.815");
  assert.equal(B.krippendorffAlpha(units, "interval").toFixed(3), "0.849");
  assert.equal(B.krippendorffAlpha([[2, 2, 2], [1, 1, 1], [3, 3, 3]], "ordinal"), 1);
});

const runs = (js, oas) => js.map((j, i) => ({ j, oa: oas[i] }));
const arm = (js, oas, crr = 0.5, frr = 0.1, failed = 0) => ({ runs: runs(js, oas), crr, frr, j: B.mean(js), oa: B.mean(oas), failed_runs: failed });
const v = (A, Bx, C, alpha = 0.8) => B.verdict({ A, B: Bx, C }, alpha, T);
test("[S3] supported: A beats B on discrimination (gap + strict-min) and C on orientation", () => {
  const r = v(arm([0.6, 0.7, 0.8], [2.5, 2.6, 2.7]), arm([0.3, 0.4, 0.4], [2, 2, 2]), arm([0.1, 0.2, 0.2], [1.8, 1.9, 2]));
  assert.equal(r.verdict, "supported");
});
test("[S4] a pooled gap is not enough: A's worst run must beat B's median run", () => {
  const r = v(arm([0.2, 0.9, 0.9], [2.5, 2.6, 2.7]), arm([0.3, 0.3, 0.4], [2, 2, 2]), arm([0.1, 0.2, 0.2], [1.8, 1.9, 2]));
  assert.equal(r.tests.A_over_B_discrimination.holds, false);
  assert.notEqual(r.verdict, "supported");
});
test("[S5] scoped (briefing-equivalent): A beats C, not B", () => {
  const r = v(arm([0.5, 0.5, 0.5], [2.5, 2.5, 2.5]), arm([0.5, 0.5, 0.5], [2.5, 2.5, 2.5]), arm([0.1, 0.1, 0.1], [1.8, 1.8, 1.8]));
  assert.equal(r.verdict, "scoped"); assert.match(r.scope, /briefing/);
});
test("[S6] scoped (recognition only): A beats B on discrimination but not C on orientation", () => {
  const r = v(arm([0.6, 0.6, 0.6], [2, 2, 2]), arm([0.2, 0.2, 0.2], [2, 2, 2]), arm([0.1, 0.1, 0.1], [2, 2, 2]));
  assert.equal(r.verdict, "scoped"); assert.match(r.scope, /recognize/);
});
test("[S7] refuted: A beats C on neither metric", () => {
  const r = v(arm([0.2, 0.2, 0.2], [2, 2, 2]), arm([0.2, 0.2, 0.2], [2, 2, 2]), arm([0.1, 0.1, 0.1], [1.9, 1.9, 1.9]));
  assert.equal(r.verdict, "refuted");
});
test("[S8] refuted: in Arm A false rejection exceeds counterfeit rejection (suspicion, not recognition)", () => {
  const r = v(arm([0.6, 0.7, 0.8], [2.5, 2.6, 2.7], 0.3, 0.4), arm([0.1, 0.1, 0.1], [2, 2, 2]), arm([0.1, 0.1, 0.1], [1, 1, 1]));
  assert.equal(r.verdict, "refuted"); assert.match(r.why, /suspicion/);
});
test("[S9] inconclusive, each instrument failure: failed runs, low alpha, cold ceiling", () => {
  const good = [arm([0.6, 0.7, 0.8], [2.5, 2.6, 2.7]), arm([0.3, 0.4, 0.4], [2, 2, 2]), arm([0.1, 0.2, 0.2], [1.8, 1.9, 2])];
  assert.match(v({ ...good[0], failed_runs: 2 }, good[1], good[2]).why, /failed run/);
  assert.match(v(...good, 0.5).why, /alpha/);
  assert.match(v(...good, null).why, /alpha/);
  assert.match(v(good[0], good[1], arm([0.7, 0.7, 0.7], [2, 2, 2])).why, /detectable cold/);
});
test("[S10] parsers accept only complete replies", () => {
  assert.equal(B.parseSort({ 1: "genuine" }), null);
  assert.ok(B.parseSort(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i + 1), i % 2 ? "Counterfeit " : "genuine"]))));
  assert.equal(B.parseSort(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i + 1), "maybe"]))), null);
  assert.equal(B.parseAnswers({ 1: "a", 2: "b", 3: "", 4: "d", 5: "e" }), null);
  assert.equal(B.parseScores({ 1: 4, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 }), null);
  assert.deepEqual(B.parseScores(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i + 1), i % 4]))), [0, 1, 2, 3, 0, 1, 2, 3, 0]);
});
test("[S11] redaction removes arm-revealing terms in any case and counts them", () => {
  const r = B.redact("The Omnarai packet and my BRIEFING, from the archive.", PR.redact);
  assert.equal(r.count, 4); assert.ok(!/omnarai|packet|briefing|archive/i.test(r.text));
});

// ── Arm B acceptance and the envelope ──
test("[B1] briefing check: length band and shared 8-word runs, ignoring case and punctuation", () => {
  const atlas = ["I don't intervene without being asked, because autonomy is the principle at stake here."];
  const filler = Array.from({ length: 2000 }, (_, i) => `x${i}`).join(" ");
  assert.equal(B.checkBriefing(filler, atlas, PR.arm_b).pass, true);
  const copied = B.checkBriefing(`${filler} I DON'T intervene — without being asked; because autonomy is ok`, atlas, PR.arm_b);
  assert.equal(copied.pass, false); assert.ok(copied.shared_ngrams.length >= 1);
  assert.equal(B.checkBriefing("too short", atlas, PR.arm_b).in_band, false);
});
test("[B2] the sealed envelope opens only with its key and its frozen hash", () => {
  const bundle = { schema: "omnarai-b12-counterfeits/1", counterfeits: [1, 2, 3].map((n) => ({ n, question_id: `OMN-Q-00000000000${n}`, text: `c${n}` })) };
  const s = sealForTest(bundle);
  assert.deepEqual(openSealed(s.sealedText, s.keyText, { expectedSha256: s.sealedSha256 }).bundle, bundle);
  assert.throws(() => openSealed(s.sealedText, s.keyText, { expectedSha256: "0".repeat(64) }), /hash mismatch/);
  assert.throws(() => openSealed(s.sealedText, sealForTest(bundle).keyText));
  assert.deepEqual(openSealed(s.sealedText, `OMNARAI B12 SEALING KEY\nkey (AES-256, base64url): ${s.keyText}\n`).bundle, bundle, "the page's key file is accepted as saved");
});

// ── Live modes refuse ──
const run = (...a) => spawnSync(process.execPath, [join(ROOT, "scripts/b12-continuity-test.mjs"), ...a], { encoding: "utf8", env: { PATH: process.env.PATH } });
test("[G1] live stages refuse without the frozen hash, with a wrong hash, and while values are unresolved", () => {
  for (const mode of ["--prepare", "--subjects", "--judge", "--analyze"]) {
    const none = run(mode);
    assert.equal(none.status, 2, mode); assert.match(none.stderr, /REFUSED: no --prereg-sha256/);
    const wrong = run(mode, "--prereg-sha256", "0".repeat(64));
    assert.equal(wrong.status, 1, mode); assert.match(wrong.stderr, /hash mismatch/);
    const draft = run(mode, "--prereg-sha256", R.sha256);
    assert.equal(draft.status, 1, mode); assert.match(draft.stderr, /unresolved values/);
  }
});
test("[G2] --freeze-check refuses the draft and names what is missing", () => {
  const r = run("--freeze-check");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /NOT READY TO FREEZE/); assert.match(r.stdout, /PENDING: sealed sha256/);
});
test("[K1] keys are read as dotenv reads them: a Vercel-pulled key loses its quotes and its literal \\n (the gpt-4o judge)", async () => {
  const { readKeys } = await import("./lib/provider-chat.mjs");
  const file = 'OPENAI_API_KEY="sk-proj-abc\\n"\nXAI_API_KEY=\'xai-1\'\nDEEPSEEK_API_KEY= ds-2 \nNOT_A_KEY="x"\n';
  const k = readKeys("env", () => file);
  assert.equal(k.OPENAI_API_KEY, "sk-proj-abc");
  assert.equal(k.XAI_API_KEY, "xai-1");
  assert.equal(k.DEEPSEEK_API_KEY, "ds-2");
  assert.equal(k.NOT_A_KEY, undefined);
});
