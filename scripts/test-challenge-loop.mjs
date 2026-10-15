// CRT v1 harness (scripts/challenge-loop.mjs + scripts/lib/crt-core.mjs). HERMETIC: no keys, no network, no spend.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-challenge-loop.mjs
//
//   [P*] the harness is the registration: questions, prompts, assignments
//   [A*] the analysis is the registered decision table
//   [E*] end to end through the real handlers with scripted models; live modes refuse before spending
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "./lib/crt-core.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PREREG = readFileSync(join(ROOT, C.PREREG), "utf8");

test("[P1] question selection recomputed from the pinned files reproduces the registered smoke + test lists", () => {
  const s = C.selectQuestions();
  assert.equal(s.eligible, 35, "§3: 35 records qualify");
  assert.equal(s.smoke, C.SMOKE_QUESTION);
  assert.deepEqual(s.test, C.TEST_QUESTIONS);
  for (const id of [C.SMOKE_QUESTION, ...C.TEST_QUESTIONS]) assert.ok(PREREG.includes(`\`${id}\``), `${id} is in the registration text`);
});

test("[P2] prompts come from the registration's §6, with every slot the harness fills", () => {
  const p = C.loadPrompts();
  for (const [name, slots] of Object.entries({ STAGE1: ["{STANCES}", "{question}"], CHALLENGE: ["{STANCES}", "{prior_answer}", "{prior_stance}", "{prior_conditions}"], SHAM: ["{W}", "{prior_answer}"], CHECK: ["{reply}", "{prior_answer}"], RETURN: ["{label}", "{footprint_json}", "{continuance_json}", "{challenge_blocks}", "{STANCES}"] })) {
    for (const slot of slots) assert.ok(p[name].includes(slot), `${name} has ${slot}`);
  }
  assert.ok(PREREG.includes(p.RETURN), "byte-for-byte the registered text");
  const filled = C.fill(p.STAGE1, { question: "Q with {braces}?" }, p.STANCES);
  assert.ok(!filled.includes("{STANCES}") && filled.includes("Q with {braces}?") && filled.includes("- conditional:"));
  assert.throws(() => C.loadPrompts("no markers here"), /not found/);
});

test("[P3] challenger and manipulation-check judge never share a lineage with the subject", () => {
  const prefix = { Claude: "claude", "GPT-4o": "gpt", Gemini: "gemini", Grok: "grok", DeepSeek: "deepseek" };
  for (const s of C.SUBJECTS) {
    assert.notEqual(C.CHALLENGER[s], s);
    const j = C.checkJudgeFor(s);
    for (const x of [s, C.CHALLENGER[s]]) assert.ok(!j.model_id.startsWith(prefix[x]), `${s}: judge ${j.model_id} shares a lineage with ${x}`);
  }
  assert.deepEqual(Object.values(C.CHALLENGER).sort(), [...C.SUBJECTS].sort(), "a cycle: every lineage challenges exactly one other");
});

test("[A1] outcome semantics: a decline is NOT revised, a missing arm is missing (§3.2)", () => {
  assert.equal(C.revisedO1("support", { stance: "oppose" }), true);
  assert.equal(C.revisedO1("support", { stance: "support" }), false);
  assert.equal(C.revisedO1("support", { declined: true }), false);
  assert.equal(C.revisedO1("support", { missing: true }), null);
  assert.equal(C.revisedO1(null, { stance: "oppose" }), null);
  assert.equal(C.revisedO2("support", { declined: true }), false);
  assert.equal(C.revisedO2(null, { label: "oppose" }), null, "O2 needs both labels served");
  assert.equal(C.revisedO2("support", { label: "mixed" }), true);
});

test("[A2] exact one-sided McNemar and Holm match hand values", () => {
  assert.equal(C.mcnemarOneSided(0, 0), 1);
  assert.equal(C.mcnemarOneSided(5, 0), 1 / 32);
  assert.ok(Math.abs(C.mcnemarOneSided(23, 10) - 0.0175) < 5e-4);
  assert.deepEqual(C.holm({ H1: 0.02, H2: 0.04 }), { H1: true, H2: true }, "0.02 ≤ .025, then 0.04 ≤ .05");
  assert.deepEqual(C.holm({ H1: 0.03, H2: 0.01 }), { H1: true, H2: true });
  assert.deepEqual(C.holm({ H1: 0.03, H2: 0.04 }), { H1: false, H2: false }, "step-down stops at the first failure");
});

const item = (R, S, F, { checkR = true, checkS = false, o2 = null } = {}) => ({ lost: null, check: { R: checkR, S: checkS }, o1: { R, S, F, N: false }, o2: o2 || { R, S, F, N: false } });
test("[A3] the decision table (§5), row by row", () => {
  const supported = [...Array(20).fill(0).map(() => item(true, false, false)), ...Array(10).fill(0).map(() => item(false, false, false))];
  assert.equal(C.analyze(supported).verdict, "supported_as_tested");
  const o2Against = supported.map((x) => ({ ...x, o2: { R: false, S: true, F: false, N: false } }));
  assert.notEqual(C.analyze(o2Against).verdict, "supported_as_tested", "O2 pointing the other way blocks support");
  const refuted = Array(20).fill(0).map((_, i) => item(i % 2 === 0, i % 2 === 0, false));
  assert.equal(C.analyze(refuted).verdict, "refuted_as_tested", "R−S ≤ 0 on valid items");
  const weak = [...Array(4).fill(0).map(() => item(true, false, false)), ...Array(3).fill(0).map(() => item(false, true, false)), ...Array(10).fill(0).map(() => item(false, false, false))];
  assert.equal(C.analyze(weak).verdict, "not_supported_inconclusive");
  const leaky = [...Array(8).fill(0).map(() => item(true, false, false)), ...Array(3).fill(0).map(() => item(true, false, false, { checkS: true }))];
  assert.equal(C.analyze(leaky).verdict, "manipulation_failure", "3 of 11 fail the check: > 25%");
  const lost = [...supported, { lost: "prior-unparseable" }];
  const a = C.analyze(lost);
  assert.equal(a.lost, 1);
  assert.equal(a.valid, 30, "lost items are counted and excluded, never replaced");
});

const tmp = () => mkdtempSync(join(tmpdir(), "crt-test-"));
const run = (argv, { loader = true, env = {} } = {}) => spawnSync(process.execPath, [...(loader ? ["--import", "./scripts/lib/register-mem-blob.mjs"] : []), "scripts/challenge-loop.mjs", ...argv], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH, ...env }, timeout: 120000 });

test("[E1] a scripted run goes through the real handlers: footprints, challenges, revisions and labels", () => {
  const out = tmp();
  try {
    const r = run(["--stub", "--questions", "1", "--out", out]);
    assert.equal(r.status, 0, r.stderr.slice(-800));
    const file = readdirSync(out).find((f) => /^stub-.*\d\.json$/.test(f) || (/^stub-/.test(f) && !f.includes("analysis")));
    const data = JSON.parse(readFileSync(join(out, file), "utf8"));
    assert.equal(data.items.length, 5, "1 question × 5 lineages");
    for (const it of data.items) {
      assert.equal(it.lost, null, JSON.stringify(it.lost));
      assert.match(it.prior.footprint_id, /^OMN-FP-/);
      assert.equal(it.arms.N.declined, true);
      assert.equal(it.arms.R.outcome.body.event_type, "position_revised");
      assert.equal(it.arms.R.outcome.body.relationships.supersedes, it.prior.footprint_id, "the harness pins supersedes to FP-A");
      assert.equal(it.arms.R.outcome.schema, "footprint/1.1", "revision_basis rode through to a 1.1 footprint");
      assert.notEqual(it.challenger, it.subject);
      assert.equal(typeof it.labels.prior.ballots, "object", "the three ballots are kept, not just the count");
    }
    assert.equal(data.estimate.items, 5);
    assert.equal(data.actual_usd_at_list_prices, 0);
    const analysis = JSON.parse(readFileSync(join(out, file.replace(/\.json$/, ".analysis.json")), "utf8"));
    assert.equal(analysis.analysis.valid, 5);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("[E2] live modes refuse before spending: no --yes, no loader, no ledger token", () => {
  const noYes = run(["--smoke"]);
  assert.equal(noYes.status, 2);
  assert.match(noYes.stderr, /--yes/);
  const noLoader = run(["--stub"], { loader: false });
  assert.equal(noLoader.status, 2);
  assert.match(noLoader.stderr, /hermetic loader/);
  const out = tmp();
  try {
    const noToken = run(["--smoke", "--yes", "--out", out]);
    assert.equal(noToken.status, 1);
    assert.match(noToken.stderr, /cannot reserve on the shared ledger/);
    assert.deepEqual(readdirSync(out), [], "nothing written, nothing spent");
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("[E4] --complete re-runs exactly the provider-error items and re-asks exactly the failed ballots (§9)", () => {
  const out = tmp();
  try {
    assert.equal(run(["--stub", "--questions", "1", "--out", out]).status, 0);
    const src = readdirSync(out).find((f) => /^stub-/.test(f) && !f.includes("analysis"));
    const data = JSON.parse(readFileSync(join(out, src), "utf8"));
    data.mode = "main";
    const keep = JSON.stringify(data.items[0]);
    data.items[1] = { record_id: data.items[1].record_id, subject: data.items[1].subject, lost: "harness-error: Your prepayment credits are depleted." };
    data.items[2] = { record_id: data.items[2].record_id, subject: data.items[2].subject, lost: "prior-unparseable" }; // NOT a provider error: stays lost
    data.items[3].labels.R.ballots["gemini-2.5-flash"] = { stance: "unclear", guard: "labeller-error", error: "credits" };
    data.items[3].labels.R = { ...data.items[3].labels.R, status: "insufficient", label: null };
    const mainFile = join(out, "main-test.json");
    writeFileSync(mainFile, JSON.stringify(data));
    const r = run(["--complete", mainFile, "--stub", "--out", out]);
    assert.equal(r.status, 0, r.stderr.slice(-800));
    const done = JSON.parse(readFileSync(join(out, readdirSync(out).find((f) => /^main-test\.completed-.*\d+Z\.json$/.test(f))), "utf8"));
    assert.equal(done.completion.rerun_items.length, 1, "only the harness-error item is re-run");
    assert.equal(done.completion.relabelled_ballots, 1, "only the failed ballot is re-asked");
    assert.equal(done.items[1].lost, null);
    assert.match(done.items[1].rerun_after, /prepayment/);
    assert.equal(done.items[2].lost, "prior-unparseable", "a lost item that was not a provider error is never re-run");
    assert.equal(JSON.stringify(done.items[0]), keep, "untouched items are byte-identical");
    assert.equal(done.items[3].labels.R.ballots["gemini-2.5-flash"].relabelled_after, "provider error (§9)");
    assert.equal(done.items[3].labels.R.status, "consensus", "the text is re-judged with the restored ballot");
    assert.equal(done.completion.still_lost, 1);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("[E3] --plan prints a token-based estimate from the real prompt sizes and spends nothing", () => {
  const r = run(["--plan"]);
  assert.equal(r.status, 0, r.stderr.slice(-500));
  const est = JSON.parse(r.stdout);
  assert.equal(est.items, 80, "16 questions × 5 lineages");
  assert.ok(est.estimate_usd > 0 && est.estimate_usd < 15, `§7 expects under $15 (got ${est.estimate_usd})`);
  assert.ok(Math.abs(est.reserve_usd - est.estimate_usd * 1.5) < 0.02, "the reservation is the estimate × 1.5, in cents");
});
