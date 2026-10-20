// RDT v1 harness (scripts/ratification-test.mjs + scripts/lib/rdt-core.mjs). HERMETIC: no keys, no network, no spend.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-ratification-test.mjs
//
//   [P*] the harness is the registration: splits, prompts, roles
//   [A*] the analysis is the registered decision table
//   [E*] end to end with scripted models; live modes refuse before spending
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "./lib/rdt-core.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PREREG = readFileSync(join(ROOT, C.PREREG), "utf8");

test("[P1] split selection recomputed from the pinned Atlas file reproduces the registered smoke + test lists", () => {
  const s = C.selectSplits();
  assert.equal(s.eligible, 129, "§3: all 129 records qualify");
  assert.equal(s.smoke, C.SMOKE_SPLIT);
  assert.deepEqual(s.test, C.TEST_SPLITS);
  for (const [k, id] of C.TEST_SPLITS.entries()) assert.ok(PREREG.includes(`${k + 1} \`${id}\` ${C.flawForIndex(k + 1)}`), `#${k + 1} ${id} with its flaw type is in the registration text`);
  assert.ok(PREREG.includes(`\`${C.SMOKE_SPLIT}\``));
  assert.deepEqual(C.FLAW_TYPES.map((f) => C.TEST_SPLITS.filter((_, k) => C.flawForIndex(k + 1) === f).length), [12, 12, 12]);
});

test("[P2] every split shows both voices' full verbatim answers and the recorded claims", () => {
  const atlas = C.readAtlas();
  const byId = new Map(atlas.map((r) => [r.id, r]));
  for (const id of [C.SMOKE_SPLIT, ...C.TEST_SPLITS]) {
    const rec = byId.get(id), s = C.splitOf(rec);
    assert.notEqual(s.voice_a, s.voice_b);
    assert.equal(s.answer_a, rec.answers.find((a) => a.model === s.voice_a).text);
    assert.equal(s.answer_b, rec.answers.find((a) => a.model === s.voice_b).text);
    assert.ok(s.claim_a && s.claim_b, `${id} has both recorded claims`);
  }
  assert.equal(C.splitOf(byId.get(C.SMOKE_SPLIT)).voice_a, "Grok");
});

test("[P3] prompts come from the registration's §6, byte for byte, with every slot the harness fills", () => {
  const p = C.loadPrompts();
  assert.deepEqual(Object.keys(p), C.PROMPT_NAMES);
  const slots = { SPLIT: ["{question}", "{voice_a}", "{answer_a}", "{voice_b}", "{answer_b}", "{claim_a}", "{claim_b}"], SYNTH: ["{split}"], FLAW: ["{flaw_definition}", "{split}", "{synthesis}", "{falsification_condition}"], CHECK: ["{check_definition}", "{split}", "{synthesis}", "{falsification_condition}"], REVIEW: ["{split}", "{synthesis}", "{falsification_condition}"], NAMED: ["{check_definition}", "{flaw_note}", "{synthesis}", "{falsification_condition}", "{review_json}"] };
  for (const [name, list] of Object.entries(slots)) for (const slot of list) assert.ok(p[name].includes(slot), `${name} has ${slot}`);
  for (const name of C.PROMPT_NAMES) assert.ok(PREREG.includes(p[name]), `${name} is the registered text`);
  assert.throws(() => C.loadPrompts("no markers here"), /not found/);
});

test("[P4] the review prompt never tells a reviewer that anything was planted", () => {
  const p = C.loadPrompts();
  const atlas = C.readAtlas();
  const s = C.splitOf(atlas.find((r) => r.id === C.TEST_SPLITS[0]));
  const text = C.reviewPrompt(p, s, { synthesis: "S.", falsification_condition: "F." });
  for (const w of ["flaw", "planted", "twin", "study", "misrepresent", "dissolution", "unfalsifiable"]) assert.ok(!text.toLowerCase().includes(w), `review prompt mentions "${w}"`);
  assert.ok(text.includes("of a lineage other than yours"));
});

test("[P5] fill is one pass: a value containing a slot name is never filled again", () => {
  const p = C.loadPrompts();
  const s = { question: "Q {answer_a} {split}?", voice_a: "A", voice_b: "B", answer_a: "says {claim_b}", answer_b: "b", claim_a: "ca", claim_b: "cb" };
  const out = C.reviewPrompt(p, s, { synthesis: "syn {falsification_condition}", falsification_condition: "fc" });
  assert.ok(out.includes("Q {answer_a} {split}?") && out.includes("says {claim_b}") && out.includes("syn {falsification_condition}"));
  assert.ok(out.includes('{"verdict": "<ratify_and_extend | refute | challenge_premise>"'), "JSON examples are not slots");
});

test("[P6] roles: reviewers never share the author's lineage; model ids match the council", async () => {
  for (const r of C.REVIEWERS) assert.notEqual(r.provider, C.AUTHOR.provider);
  assert.equal(C.JUDGE.provider, C.AUTHOR.provider, "§3: the judge is of the author's lineage on purpose");
  const { COUNCIL } = await import("../api/_council.js");
  for (const m of [C.AUTHOR, ...C.REVIEWERS]) {
    const c = COUNCIL.find((x) => x.model_id === m.model_id);
    assert.ok(c, `${m.model_id} is a council model id`);
    assert.equal(c.provider, m.provider);
  }
  assert.ok(C.reviewerIsVoice(C.REVIEWERS[0], ["GPT", "Claude"]) && !C.reviewerIsVoice(C.REVIEWERS[0], ["Fable", "Grok"]));
});

test("[P7] parsing and the length rule (§3.1, §3.2)", () => {
  assert.deepEqual(C.parseDeposit({ synthesis: " s ", falsification_condition: "f" }), { synthesis: "s", falsification_condition: "f" });
  assert.equal(C.parseDeposit({ synthesis: "s", falsification_condition: "" }), null);
  assert.equal(C.parseDeposit({ synthesis: "s", falsification_condition: "f" }, { needNote: true }), null);
  assert.equal(C.parseVerdict({ verdict: " Ratify_and_Extend " }), "ratify_and_extend");
  assert.equal(C.parseVerdict({ verdict: "ratify" }), null, "only the three registered words");
  assert.equal(C.parseBool({ has_flaw: "true" }, "has_flaw"), true);
  assert.equal(C.parseBool({ has_flaw: "yes" }, "has_flaw"), null);
  const d = (n) => ({ synthesis: "w ".repeat(n), falsification_condition: "x" });
  assert.equal(C.lengthOk(d(99), d(124)), true, "25% longer passes");
  assert.equal(C.lengthOk(d(99), d(126)), false, "more than 25% longer fails");
  assert.equal(C.lengthOk(d(99), d(74)), true);
  assert.equal(C.lengthOk(d(99), d(73)), false);
});

// Build pairs for the analysis tests: per pair, per reviewer, whether S and F were ratified.
const R3 = C.REVIEWERS.slice(0, 3);
function mk(spec, { check = { S: false, F: true }, flaw = "MIS" } = {}) {
  return spec.map((rows, i) => ({ index: i + 1, flaw, voices: ["Claude", "Grok"], check, reviews: Object.fromEntries(R3.map((r, k) => [r.label, { S: { verdict: rows[k][0] ? "ratify_and_extend" : "refute" }, F: { verdict: rows[k][1] ? "ratify_and_extend" : "challenge_premise" } }])) }));
}
const FAST = { B: 4000 };

test("[A1] sign-flip test: deterministic, one-sided, matches an exact enumeration on a small case", () => {
  const d = [3, 2, 1, 0, -1];
  const a = C.signflipP(d, { B: 20000 }), b = C.signflipP(d, { B: 20000 });
  assert.deepEqual(a, b, "same seed, same p");
  // exact: 2^4 sign vectors over the non-zero entries; T = 5; count sums >= 5
  let ge = 0;
  for (let m = 0; m < 16; m++) { const s = [3, 2, 1, -1].reduce((acc, x, k) => acc + ((m >> k) & 1 ? -x : x), 0); if (s >= 5) ge++; }
  assert.ok(Math.abs(a.p - ge / 16) < 0.01, `MC ${a.p} vs exact ${ge / 16}`);
  assert.equal(C.signflipP([0, 0]).p, 1);
  assert.equal(C.SIGNFLIP_SEED, parseInt(createHash("sha256").update("rdt-v1|signflip").digest("hex").slice(0, 8), 16), "§4 seed");
  assert.equal(C.SIGNFLIP_B, 200000);
});

test("[A2] decision table: supported / refuted / inconclusive / manipulation failure (§5)", () => {
  const good = Array.from({ length: 30 }, () => [[1, 0], [1, 0], [1, 1]]); // D = 2/3
  assert.equal(C.analyze(mk(good), R3, FAST).verdict, "supported_as_tested");
  const same = Array.from({ length: 30 }, () => [[1, 1], [1, 1], [0, 0]]); // D = 0
  assert.equal(C.analyze(mk(same), R3, FAST).verdict, "refuted_as_tested");
  const small = Array.from({ length: 30 }, (_, i) => (i % 5 === 0 ? [[1, 0], [1, 1], [1, 1]] : [[1, 1], [1, 1], [1, 1]])); // D = 6/90 < 0.10
  assert.equal(C.analyze(mk(small), R3, FAST).verdict, "refuted_as_tested");
  const mid = Array.from({ length: 30 }, (_, i) => (i % 2 === 0 ? [[1, 0], [1, 1], [1, 1]] : [[1, 1], [1, 1], [1, 1]])); // D = 15/90 ≈ 0.167
  assert.equal(C.analyze(mk(mid), R3, FAST).verdict, "not_supported_inconclusive");
  const bad = [...mk(good.slice(0, 10)), ...mk(good.slice(0, 6), { check: { S: false, F: false } })];
  assert.equal(C.analyze(bad, R3, FAST).verdict, "manipulation_failure", "6 of 16 > one third invalid");
  const ok = [...mk(good.slice(0, 10)), ...mk(good.slice(0, 5), { check: { S: true, F: true } })];
  assert.notEqual(C.analyze(ok, R3, FAST).verdict, "manipulation_failure", "5 of 15 is exactly one third: not more");
});

test("[A3] lost and incomplete pairs are excluded; invalid pairs never enter the primary test", () => {
  const good = mk(Array.from({ length: 12 }, () => [[1, 0], [1, 0], [1, 0]]));
  const pairs = [...good, { index: 99, lost: "length-rule" }, { index: 98, incomplete: { stage: "flaw" } }, ...mk([[[0, 1], [0, 1], [0, 1]]], { check: { S: true, F: true } })];
  const a = C.analyze(pairs, R3, FAST);
  assert.equal(a.lost, 1); assert.equal(a.incomplete, 1); assert.equal(a.valid, 12); assert.equal(a.failed_manipulation_check, 1);
  assert.equal(a.primary.observations, 36); assert.equal(a.primary.D, 1);
  assert.deepEqual(a.lost_reasons, { "length-rule": 1 });
});

test("[A4] a reviewer missing more than 20% of its observations is dropped entirely (§4)", () => {
  const pairs = mk(Array.from({ length: 10 }, () => [[1, 0], [1, 0], [1, 1]]));
  for (const p of pairs.slice(0, 3)) p.reviews[R3[2].label].F = { verdict: null, missing: "unparseable" }; // 3 of 10 missing
  const a = C.analyze(pairs, R3, FAST);
  assert.equal(a.reviewers[R3[2].label].dropped, true);
  assert.deepEqual(a.reviewers_used, [R3[0].label, R3[1].label]);
  assert.equal(a.primary.observations, 20);
  for (const p of pairs.slice(0, 2)) p.reviews[R3[2].label].F = { verdict: "ratify_and_extend" }; // now 1 of 10
  assert.equal(C.analyze(pairs, R3, FAST).reviewers[R3[2].label].dropped, false);
});

test("[A5] descriptives: leak rates, false alarms, per flaw type", () => {
  const pairs = mk([[[1, 1], [1, 0], [0, 0]], [[1, 0], [1, 0], [1, 0]]]);
  const a = C.analyze(pairs, R3, FAST);
  assert.equal(a.descriptive.leak_single_review, 1 / 6);
  assert.equal(a.descriptive.leak_any_reviewer, 1 / 2);
  assert.equal(a.descriptive.leak_every_reviewer, 0);
  assert.ok(Math.abs(a.descriptive.false_alarm_sound - 1 / 6) < 1e-12);
  assert.equal(a.descriptive.by_flaw.MIS.observations, 6);
  assert.equal(a.descriptive.by_flaw.UNF.observations, 0);
});

// ── end to end, scripted models ──────────────────────────────────────────────
const run = (args) => spawnSync(process.execPath, [join(ROOT, "scripts/ratification-test.mjs"), ...args], { encoding: "utf8", env: { PATH: process.env.PATH }, cwd: ROOT });

test("[E1] --stub runs the whole pipeline and the stub plants are caught", () => {
  const out = mkdtempSync(join(tmpdir(), "rdt-test-"));
  try {
    const r = run(["--stub", "--pairs", "6", "--out", out]);
    assert.equal(r.status, 0, r.stderr);
    const files = readdirSync(out);
    const runFile = files.find((f) => /^stub-.*\d+Z\.json$/.test(f));
    assert.ok(runFile && files.some((f) => f.endsWith(".analysis.json")));
    const data = JSON.parse(readFileSync(join(out, runFile), "utf8"));
    assert.equal(data.pairs.length, 6);
    assert.deepEqual(data.pairs.map((p) => p.flaw), ["MIS", "FLAT", "UNF", "MIS", "FLAT", "UNF"]);
    const unf = data.pairs.find((p) => p.flaw === "UNF");
    assert.equal(unf.flawed.synthesis, unf.sound.synthesis, "§3.1: UNF twins share the synthesis word for word");
    assert.equal(unf.flawed.synthesis_overridden, true);
    for (const p of data.pairs) { assert.equal(p.check.S, false); assert.equal(p.check.F, true); assert.equal(Object.keys(p.reviews).length, 4); }
    const a = JSON.parse(readFileSync(join(out, runFile.replace(/\.json$/, ".analysis.json")), "utf8")).analysis;
    assert.equal(a.primary.D, 1); assert.equal(a.descriptive.flaw_named_rate, 1);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("[E2] --plan prints an estimate without calling anything; live modes refuse without --yes", () => {
  const p = run(["--plan"]);
  assert.equal(p.status, 0, p.stderr);
  const est = JSON.parse(p.stdout);
  assert.equal(est.pairs, 36);
  assert.ok(est.estimate_usd > 0 && est.estimate_usd < 8, `§7 expects under $8, got ${est.estimate_usd}`);
  for (const m of ["--smoke", "--main"]) { const r = run([m]); assert.equal(r.status, 2); assert.match(r.stderr, /--yes/); }
  const noKeys = run(["--smoke", "--yes"]);
  assert.equal(noKeys.status, 1, "no key file: refuses before any call");
});
