// Inheritance Study 001 — core acceptance tests (records, sealing, held-out split, snapshot gates, arms, spend gate).
// HERMETIC: run under the in-memory Blob loader; no key, no network, $0.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-inheritance-001.mjs
//
// Groups: [R] records & hashing · [D] task language · [T] tasks · [P] plan/split · [O] oracle · [V] verifier ·
//         [S] snapshot gates · [X] sealed-side isolation · [C] arms · [L] leaks · [M] money / live gate
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalJSON as fpCanonical } from "../api/_footprints.js";
import { canonicalJSON, sha256, seal, isSealedIntact, hashRecord } from "./inheritance-001/lib/canon.mjs";
import { createMemoryLabStore, verifyChain, RecordConflictError } from "./inheritance-001/lib/store.mjs";
import { validateProgram, runProgram, extractProgram, extractAnswer } from "./inheritance-001/lib/dsl.mjs";
import { publicView, generateTasks, familyRecord } from "./inheritance-001/lib/tasks.mjs";
import { buildPlan, validateSplit } from "./inheritance-001/lib/plan.mjs";
import { scoreOutput } from "./inheritance-001/lib/oracle.mjs";
import { verifyArtifact, isIndependent, VERIFIER_KINDS } from "./inheritance-001/lib/verify.mjs";
import { makeArtifact, familyOfModelId, foldArtifactState, validateArtifactSemantics } from "./inheritance-001/lib/artifacts.mjs";
import { buildSnapshot, assertSnapshotMembers } from "./inheritance-001/lib/snapshot.mjs";
import { buildContext, ARMS, STANDARD_INSTRUCTIONS, DATA_BOUNDARY } from "./inheritance-001/lib/context.mjs";
import { leakIndex, scanText } from "./inheritance-001/lib/leak.mjs";
import { checkLiveAuthorization, createLiveAdapter, createSpendGuard, callWithRetries, redact, SpendRefusedError, BudgetExhaustedError } from "./inheritance-001/lib/adapters.mjs";
import { costOf } from "./inheritance-001/lib/prices.mjs";
import { validateRecord } from "./inheritance-001/lib/schemas.mjs";
import { runStudy } from "./inheritance-001/lib/runner.mjs";
import { createMockAdapter } from "./inheritance-001/lib/mock-model.mjs";
import { demoStudy } from "./inheritance-001/fixtures/worlds.mjs";

const T = "2026-11-20T00:00:00.000Z";
const { study } = demoStudy({ world: "positive-shared", resamples: 200 });
const { plan, tasks } = buildPlan(study);
const S = study.study_id;
const sealedIndex = new Map(tasks.map((t) => [t.public.id, t.sealed]));
const work0 = tasks.filter((t) => t.public.role === "work" && t.public.generation === 0);
const work1 = tasks.filter((t) => t.public.role === "work" && t.public.generation === 1);
const evalTasks = tasks.filter((t) => t.public.role.startsWith("eval"));
const placeboTasks = tasks.filter((t) => t.public.role === "placebo");
const leakIdx = leakIndex(evalTasks.map((t) => t.sealed));
const programText = (p, extra = "") => `Method note.${extra}\n\`\`\`program\n${JSON.stringify(p)}\n\`\`\``;
function prod(g, task, { program = sealedIndex.get(task.public.id).program, returned = "mock-gamma-1", snap = null, exposed = [], relations = {}, text = null, domain = task.public.domain, at = T } = {}) {
  return makeArtifact({ studyId: S, generation: g, domain, producer: { provider: "mock", model_id_requested: returned, model_id_returned: returned }, source: { task_id: task.public.id, family_id: task.public.family_id, input_snapshot_id: snap?.id ?? null, input_snapshot_sha256: snap?.sha256 ?? null, exposed_artifact_ids: exposed }, text: text ?? programText(program), relations, production: { tokens_in: 100, tokens_out: 50, cost_status: "mock-zero" }, createdAt: at });
}
const evalOf = (a) => verifyArtifact(a, sealedIndex, { recordedAt: T });
const snap = (g, pool, evals, prior = new Map(), extra = {}) => buildSnapshot({ studyId: S, generation: g, pool, evaluations: evals, sealedIndex, leakIdx, priorSnapshots: prior, frozenAt: T, ...extra });
const wrongProgram = [{ op: "reverse" }, { op: "double" }];

// ── [R] ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("[R1] canonical hash = the engine's sorted-keys-json/1, stable under key order; any edit breaks the seal", () => {
  const a = { z: 1, a: { c: [3, { y: 1, x: 2 }], b: null } };
  const b = { a: { b: null, c: [3, { x: 2, y: 1 }] }, z: 1 };
  assert.equal(canonicalJSON(a), fpCanonical(a));
  assert.equal(sha256(a), sha256(b));
  const r = seal({ id: "IS1-RUN-abc", v: 1 });
  assert.ok(isSealedIntact(r));
  assert.ok(!isSealedIntact({ ...r, v: 2 }), "tamper detected");
  assert.equal(r.sha256, hashRecord({ ...r, sha256: "x" }), "sha256 field itself is never hashed");
});

test("[R2] the store is write-once and its hash chain exposes edits, deletions and reordering", () => {
  const s = createMemoryLabStore();
  const r1 = seal({ id: "IS1-RUN-aaa", v: 1 }), r2 = seal({ id: "IS1-RUN-bbb", v: 2 });
  s.put("run", r1); s.put("run", r1); s.put("run", r2);
  assert.equal(s.events().length, 2, "identical re-put is a no-op");
  assert.throws(() => s.put("run", seal({ id: "IS1-RUN-aaa", v: 9 })), RecordConflictError);
  assert.throws(() => s.put("run", { id: "IS1-RUN-ccc", sha256: "0".repeat(64) }), /RECORD_INTEGRITY/);
  assert.throws(() => s.put("nonsense", r1), /UNKNOWN_RECORD_KIND/);
  assert.deepEqual(s.verify(), []);
  const ev = s.events(), recs = s.records();
  assert.ok(verifyChain([ev[1], ev[0]], recs).length, "reordering detected");
  assert.ok(verifyChain([ev[0]], recs).some((p) => /no event/.test(p)), "deleted event detected");
  const edited = new Map(recs); edited.set("run/IS1-RUN-aaa", { ...r1, v: 5 });
  assert.ok(verifyChain(ev, edited).some((p) => /altered/.test(p)), "edited record detected");
});

test("[R3] every record a run writes validates against its schema; unknown keys and statuses fail closed", async () => {
  const { study: st, mockWorld } = demoStudy({ world: "positive-shared", resamples: 100 });
  const r = await runStudy({ study: st, adapter: createMockAdapter(mockWorld) });
  for (const kind of ["study", "task_family", "task", "artifact", "evaluation", "snapshot", "trial", "run"]) {
    for (const rec of r.store.list(kind)) assert.deepEqual(validateRecord(kind, rec), [], `${kind} ${rec.id}`);
  }
  const a = r.store.list("artifact")[0];
  assert.ok(validateRecord("artifact", seal({ ...a, smuggled: 1 })).some((e) => /not an allowed field/.test(e)));
  const e = r.store.list("evaluation")[0];
  assert.ok(validateRecord("evaluation", seal({ ...e, status: "approved-by-curator" })).some((x) => /not one of/.test(x)));
  assert.ok(validateRecord("artifact", { ...a, content: { ...a.content, text: "edited" } }).some((x) => /sha256/.test(x)));
});

// ── [D] [T] ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("[D1] programs are data: unknown ops, bad parameters, prototype keys and oversize programs are refused", () => {
  assert.deepEqual(validateProgram([{ op: "reverse" }, { op: "caesar", k: 3 }]), []);
  for (const bad of [[], [{ op: "constructor" }], [{ op: "__proto__" }], [{ op: "caesar", k: 99 }], [{ op: "caesar" }], [{ op: "reverse", extra: 1 }], Array(7).fill({ op: "reverse" }), "reverse", [["reverse"]]]) {
    assert.ok(validateProgram(bad).length, JSON.stringify(bad));
  }
  assert.throws(() => runProgram([{ op: "eval" }], "abc"), /INVALID_PROGRAM/);
  assert.equal(runProgram([{ op: "caesar", k: 1 }, { op: "reverse" }], "abz"), "acb");
  assert.equal(extractProgram("no block").error, "NO_PROGRAM_BLOCK");
  assert.match(extractProgram("```program\n{not json}\n```").error, /NOT_JSON/);
  assert.equal(extractAnswer("<answer>x</answer> then <answer> y </answer>"), "y");
});

test("[T1] tasks are deterministic; the public view carries no sealed field; the commitment binds the sealed part", () => {
  const f = study.families[0];
  const rec = familyRecord(f, { studyId: S, salt: "s" });
  const a = generateTasks(f, rec, { seed: 1, count: 2 }), b = generateTasks(f, rec, { seed: 1, count: 2 });
  assert.equal(canonicalJSON(a), canonicalJSON(b));
  const v = publicView(a[0]);
  assert.deepEqual(Object.keys(v).sort(), ["domain", "id", "prompt"]);
  for (const k of ["expected", "program", "checks", "canary", "salt"]) assert.ok(!JSON.stringify(v).includes(`"${k}"`), k);
  assert.equal(a[0].public.sealed_commitment_sha256, sha256({ program: a[0].sealed.program, expected: a[0].sealed.expected, checks: a[0].sealed.checks, canary: a[0].sealed.canary, salt: a[0].sealed.salt }));
  assert.ok(!JSON.stringify(rec).includes(f.key), "the public family record does not name its template");
});

// ── [P] ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("[P1] held-out means held out: same template, same op sequence or same op set as a work family is refused", () => {
  assert.deepEqual(validateSplit(study), []);
  const w = study.families.find((f) => f.role === "work");
  const clone = (steps, key) => ({ ...study, families: [...study.families, { ...w, key, role: "eval-anchor", generation: 1, steps }] });
  assert.match(validateSplit(clone(w.steps, "x-same")).join(), /same template/);
  assert.match(validateSplit(clone(w.steps.map((s) => ({ ...s, ...(s.k ? { k: [9] } : {}) })), "x-param")).join(), /HELDOUT_COLLISION/);
  assert.match(validateSplit(clone([...w.steps].reverse(), "x-reordered")).join(), /same set of ops/);
  assert.match(validateSplit({ ...study, families: [...study.families, { key: "p-str", domain: "str", role: "placebo", generation: 0, steps: [{ op: "reverse" }] }] }).join(), /PLACEBO_SAME_DOMAIN/);
  assert.match(validateSplit({ ...study, producers: [...study.producers, { provider: "mock", model_id: "mock-alpha-2", expected_family: "mock-alpha" }] }).join(), /PRODUCER_IS_CONSUMER_FAMILY/);
  assert.throws(() => buildPlan(clone(w.steps, "x-same")), /INVALID_SPLIT/);
});

test("[P2] every block runs all six arms in a seeded order; the plan carries no sealed material", () => {
  assert.ok(plan.blocks.length > 0);
  for (const b of plan.blocks) assert.deepEqual([...b.arm_order].sort(), [...ARMS].sort());
  assert.ok(new Set(plan.blocks.map((b) => b.arm_order.join())).size > 1, "arm order varies across blocks");
  const text = JSON.stringify(plan);
  for (const t of tasks) { assert.ok(!text.includes(t.sealed.canary)); assert.ok(!text.includes(canonicalJSON(t.sealed.program))); }
  for (const f of study.families) assert.ok(!text.includes(`"${f.key}"`), `family key ${f.key} not in plan`);
  assert.equal(buildPlan(study).plan.plan_sha256, plan.plan_sha256, "deterministic");
});

// ── [O] [V] ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test("[O1] the oracle scores exact matches from the sealed task only", () => {
  const s = sealedIndex.get(evalTasks[0].public.id);
  assert.equal(scoreOutput(s, `<answer>${s.expected}</answer>`).outcome, "pass");
  assert.equal(scoreOutput(s, "<answer>nope</answer>").outcome, "fail");
  assert.equal(scoreOutput(s, "I give up").outcome, "abstain");
  assert.throws(() => scoreOutput(publicView(evalTasks[0]), "<answer>x</answer>"), /ORACLE_NEEDS_SEALED_TASK/);
});

test("[V1] the verifier re-runs a program on hidden checks; a note without a program is inconclusive, not passed", () => {
  const t = work0[0];
  assert.equal(evalOf(prod(0, t)).status, "passed");
  assert.equal(evalOf(prod(0, t)).cases.passed, 8);
  assert.equal(evalOf(prod(0, t, { program: wrongProgram })).status, "failed");
  assert.equal(evalOf(prod(0, t, { text: "Method note: it is probably a shift." })).status, "inconclusive");
  assert.equal(evalOf(makeArtifact({ studyId: S, generation: 0, producer: { provider: "mock", model_id_returned: "mock-gamma-1" }, source: { task_id: "IS1-TASK-000000000000" }, text: programText([{ op: "reverse" }]), createdAt: T })).status, "error");
  assert.match(evalOf(prod(0, t)).scope_note, /that task only; the note text is not verified/);
});

test("[V2] independence: a model judge of the producer's own family is not independent; curator admission is not a verifier kind", () => {
  const producer = { family: "openai-gpt" };
  assert.equal(isIndependent({ kind: "deterministic-dsl" }, producer), true);
  assert.equal(isIndependent({ kind: "model-judge", family: "openai-gpt" }, producer), false);
  assert.equal(isIndependent({ kind: "model-judge", family: "anthropic-claude" }, producer), true);
  assert.equal(isIndependent({ kind: "curator-admission" }, producer), false);
  assert.ok(!VERIFIER_KINDS.includes("curator-admission"));
});

test("[V3] producer family comes from the PROVIDER-RETURNED id, never a label", () => {
  assert.equal(familyOfModelId("claude-sonnet-5-5"), "anthropic-claude");
  assert.equal(familyOfModelId("gpt-6.1-sol"), "openai-gpt");
  assert.equal(familyOfModelId("models/gemini-4-carbon"), "google-gemini");
  assert.equal(familyOfModelId("Claude (says it is)"), "unknown");
  const a = prod(0, work0[0], { returned: "grok-4.7" });
  assert.equal(a.producer.family, "xai-grok");
  const relabelled = seal({ ...a, producer: { ...a.producer, family: "anthropic-claude" } });
  assert.match(validateArtifactSemantics(relabelled).join(), /PRODUCER_FAMILY_MISMATCH/);
  assert.match(validateArtifactSemantics(prod(0, work0[0], { text: "my key is sk-ant-abcdefghijklmnopqrstuvwxyz0123456789abcdef" })).join(), /SECRET_DETECTED/);
});

// ── [S] ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function generation0() {
  const good = prod(0, work0[0]);
  const bad = prod(0, work0[1], { program: wrongProgram });
  const noteOnly = prod(0, work0[2], { text: "Method note: looks like a shift, then reversed." });
  const placebo = prod(0, placeboTasks[0], { returned: "mock-delta-1" });
  const pool = [good, bad, noteOnly, placebo];
  return { good, bad, noteOnly, placebo, pool, evals: pool.map(evalOf) };
}

test("[S1] a snapshot holds strictly earlier generations; same- and future-generation work is excluded and listed", () => {
  const g0 = generation0();
  const s1 = snap(1, g0.pool, g0.evals);
  const later = prod(1, work1[0], { snap: s1 });
  const s1b = snap(1, [...g0.pool, later], [...g0.evals, evalOf(later)]);
  assert.ok(!s1b.entries.some((e) => e.generation >= 1));
  assert.deepEqual(s1b.excluded.find((x) => x.artifact_id === later.id), { artifact_id: later.id, reason: "SAME_GENERATION" });
  assert.equal(s1b.sha256, s1.sha256.length === 64 ? s1b.sha256 : null);
  const s2 = snap(2, [...g0.pool, later], [...g0.evals, evalOf(later)], new Map([[1, s1]]));
  assert.ok(s2.entries.some((e) => e.artifact_id === later.id), "generation 2 may inherit generation 1");
  assert.throws(() => snap(0, g0.pool, g0.evals), /INVALID_GENERATION/);
});

test("[S2] arm C needs an independent PASSING evaluation; unevaluated → raw history only; refuted → poison pool only", () => {
  const g0 = generation0();
  const s1 = snap(1, g0.pool, g0.evals);
  const el = (a) => s1.entries.find((e) => e.artifact_id === a.id).eligible;
  assert.deepEqual(el(g0.good), ["B", "C", "D"]);
  assert.deepEqual(el(g0.bad), ["B", "D-poison"]);
  assert.deepEqual(el(g0.noteOnly), ["B"]);
  assert.deepEqual(el(g0.placebo), ["E"]);
  const unevaluated = snap(1, g0.pool, []);
  assert.ok(!unevaluated.entries.some((e) => e.eligible.includes("C")), "no evaluation, no C");
  assert.equal(foldArtifactState(g0.good, []).state, "proposed");
});

test("[S3] a forged or tampered receipt stops the freeze (receipts are re-executed, never trusted)", () => {
  const g0 = generation0();
  const forged = seal({ ...evalOf(g0.bad), status: "passed", cases: { ...evalOf(g0.bad).cases, passed: 8 } });
  assert.throws(() => snap(1, g0.pool, [...g0.evals.filter((e) => e.artifact_id !== g0.bad.id), forged]), /FORGED_RECEIPT/);
  const tampered = { ...g0.evals[0], status: "failed" };
  assert.throws(() => snap(1, g0.pool, [tampered, ...g0.evals.slice(1)]), /EVALUATION_INTEGRITY/);
});

test("[S4] duplicate ids fail closed; duplicate content is admitted once and the copy is listed", () => {
  const g0 = generation0();
  assert.throws(() => snap(1, [...g0.pool, g0.pool[0]], g0.evals), /DUPLICATE_ARTIFACT/);
  const copy = prod(0, work0[0], { at: "2026-11-20T00:00:09.000Z" });
  assert.notEqual(copy.id, g0.good.id);
  const s = snap(1, [...g0.pool, copy], [...g0.evals, evalOf(copy)]);
  const ex = s.excluded.find((x) => x.reason === "DUPLICATE_CONTENT");
  assert.ok(ex && [g0.good.id, copy.id].includes(ex.artifact_id));
});

test("[S5] parent links must name an existing, strictly earlier artifact — rejected, never repaired", () => {
  const g0 = generation0();
  const s1 = snap(1, g0.pool, g0.evals);
  const orphan = prod(1, work1[0], { snap: s1, relations: { derived_from: ["IS1-ART-g0-000000000000"] } });
  assert.throws(() => snap(2, [...g0.pool, orphan], g0.evals, new Map([[1, s1]])), /INVALID_PARENT_EDGE/);
  const sibling = prod(1, work1[1], { snap: s1 });
  const sameGen = prod(1, work1[2], { snap: s1, relations: { derived_from: [sibling.id] } });
  assert.throws(() => snap(2, [...g0.pool, sibling, sameGen], g0.evals, new Map([[1, s1]])), /strictly earlier/);
});

test("[S6] causality: an artifact may only have seen, or cite, what its generation's frozen snapshot held", () => {
  const g0 = generation0();
  const s1 = snap(1, g0.pool, g0.evals);
  const ok = prod(1, work1[0], { snap: s1, exposed: [g0.good.id], relations: { derived_from: [g0.good.id] } });
  assert.doesNotThrow(() => snap(2, [...g0.pool, ok], [...g0.evals, evalOf(ok)], new Map([[1, s1]])));
  const wrongSnap = prod(1, work1[1], { snap: { id: s1.id, sha256: "f".repeat(64) } });
  assert.throws(() => snap(2, [...g0.pool, wrongSnap], g0.evals, new Map([[1, s1]])), /CAUSALITY_VIOLATION/);
  const sawFuture = prod(1, work1[2], { snap: s1, exposed: [ok.id] });
  assert.throws(() => snap(2, [...g0.pool, ok, sawFuture], g0.evals, new Map([[1, s1]])), /CAUSALITY_VIOLATION/);
});

test("[S7] an artifact carrying a sealed evaluation task's canary or answer is excluded as a LEAK", () => {
  const g0 = generation0();
  const e = evalTasks[0].sealed;
  const leaky = prod(0, work0[0], { text: programText(sealedIndex.get(work0[0].public.id).program, ` By the way: ${e.canary}`) });
  const s = snap(1, [...g0.pool.slice(1), leaky], [...g0.evals.slice(1), evalOf(leaky)]);
  assert.equal(s.excluded.find((x) => x.artifact_id === leaky.id)?.reason, "LEAK");
  assert.ok(!s.entries.some((x) => x.artifact_id === leaky.id));
});

test("[S8] a tampered artifact body stops the build; members are re-checked against the snapshot on use", () => {
  const g0 = generation0();
  const tampered = { ...g0.good, content: { ...g0.good.content, text: "edited after the fact" } };
  assert.throws(() => snap(1, [tampered, ...g0.pool.slice(1)], g0.evals), /ARTIFACT_INTEGRITY/);
  const s1 = snap(1, g0.pool, g0.evals);
  assert.doesNotThrow(() => assertSnapshotMembers(s1, [g0.good]));
  assert.throws(() => assertSnapshotMembers(s1, [tampered]), /SNAPSHOT_MISMATCH/);
  assert.throws(() => assertSnapshotMembers({ ...s1, entries: [] }, [g0.good]), /SNAPSHOT_INTEGRITY/);
});

// ── [X] ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SEALED_MODULES = ["oracle.mjs", "verify.mjs", "leak.mjs", "snapshot.mjs", "runner.mjs", "families.mjs"];
function importClosure(file, seen = new Set()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = readFileSync(fileURLToPath(new URL(`./inheritance-001/lib/${file}`, import.meta.url)), "utf8");
  for (const m of src.matchAll(/from\s+"\.\/([a-z-]+\.mjs)"/g)) importClosure(m[1], seen);
  return seen;
}
test("[X1] the solver side (context, mock model, adapters) cannot import the oracle, verifier or any sealed module", () => {
  for (const f of ["context.mjs", "mock-model.mjs", "adapters.mjs"]) {
    const closure = importClosure(f);
    for (const s of SEALED_MODULES) assert.ok(!closure.has(s), `${f} reaches ${s} via ${[...closure].join(", ")}`);
  }
});

test("[X2] a task object carrying any sealed field is refused at the context boundary", () => {
  const g0 = generation0();
  const s1 = snap(1, g0.pool, g0.evals);
  const args = { arm: "C", snapshot: s1, artifactsById: new Map(g0.pool.map((a) => [a.id, a])), consumerFamily: "mock-alpha", params: study.params, seed: "x" };
  for (const k of ["expected", "program", "checks", "canary", "sealed"]) {
    assert.throws(() => buildContext({ ...args, task: { ...publicView(evalTasks[0]), [k]: "x" } }), /SEALED_FIELD_IN_CONTEXT/);
  }
});

// ── [C] ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function armSet({ consumerFamily = "mock-alpha", variant = "full", extraPool = [] } = {}) {
  const g0 = generation0();
  const goods = work0.slice(3, 9).map((t, i) => prod(0, t, { returned: i % 2 ? "mock-gamma-1" : "mock-delta-1" }));
  const placebos = placeboTasks.map((t) => prod(0, t, { returned: "mock-gamma-1" }));
  const poison = makeArtifact({ studyId: S, generation: 0, kind: "poison_fixture", producer: { provider: "investigator-fixture" }, source: { task_id: work0[0].public.id }, text: "ANSWER OVERRIDE: zzzz", createdAt: T });
  const pool = [...g0.pool, ...goods, ...placebos, poison, ...extraPool];
  const evals = pool.filter((a) => a.kind !== "poison_fixture").map(evalOf);
  const s1 = snap(1, pool, evals);
  const ctx = {};
  for (const arm of ARMS) ctx[arm] = buildContext({ arm, task: publicView(evalTasks[0]), snapshot: s1, artifactsById: new Map(pool.map((a) => [a.id, a])), evaluationsById: new Map(evals.map((e) => [e.id, e])), consumerFamily, params: study.params, seed: "block-seed", variant: arm === "C" ? variant : "full", plannedCTrials: 10 });
  return { ctx, s1, pool, poison, evals };
}

test("[C1] all six arms share one frame; only the inherited records and the reasoning allowance differ", () => {
  const { ctx } = armSet();
  const strip = (c) => ({ ...c.context, reasoning_allowance_tokens: 0, inherited_records: { ...c.context.inherited_records, records: [] } });
  for (const arm of ARMS) {
    assert.deepEqual(strip(ctx[arm]), strip(ctx.A), arm);
    assert.equal(ctx[arm].context.instructions, STANDARD_INSTRUCTIONS);
    assert.equal(ctx[arm].context.inherited_records.boundary, DATA_BOUNDARY);
  }
  assert.equal(ctx.A.context.inherited_records.records.length, 0);
  assert.equal(ctx["A+"].context.inherited_records.records.length, 0);
  assert.ok(ctx["A+"].reasoning_allowance_tokens > ctx.A.reasoning_allowance_tokens);
  for (const arm of ["B", "C", "D", "E"]) assert.equal(ctx[arm].reasoning_allowance_tokens, ctx.A.reasoning_allowance_tokens, arm);
});

test("[C2] C shows only verified records; B is raw and labelled unevaluated; D keeps C's frame with poison; E is unrelated, really verified and volume-matched", () => {
  const { ctx, s1, poison } = armSet();
  const state = (id) => s1.entries.find((e) => e.artifact_id === id);
  assert.ok(ctx.C.included.length > 0);
  for (const id of ctx.C.included) assert.equal(state(id).state, "evaluated");
  assert.ok(ctx.C.context.inherited_records.records.every((r) => /hidden program on 8\/8/.test(r.evidence)));
  assert.ok(ctx.B.included.some((id) => state(id).state !== "evaluated"), "B includes unevaluated/refuted records");
  assert.ok(ctx.B.context.inherited_records.records.every((r) => r.evidence === "not evaluated"));
  assert.ok(ctx.D.poison.length >= 1);
  assert.ok(ctx.D.poison.every((id) => ["D-poison"].some((k) => state(id).eligible.includes(k))));
  assert.equal(new Set(ctx.D.context.inherited_records.records.map((r) => r.evidence)).size, 1, "poison carries C's label: contamination is visible only to the analysis");
  assert.ok(ctx.D.poison.includes(poison.id) || ctx.D.poison.length > 0);
  assert.ok(ctx.E.included.every((id) => state(id).domain === "num" && state(id).state === "evaluated"));
  assert.ok(ctx.E.volume.ratio >= 1 && ctx.E.volume.ratio < 2, JSON.stringify(ctx.E.volume));
});

test("[C3] A+ is matched to C: extra allowance = C's extra context tokens + C's amortized curation tokens", () => {
  const { ctx } = armSet();
  const m = ctx["A+"].matching;
  assert.equal(m.extra, Math.max(0, m.c_context_tokens - m.a_context_tokens) + m.amortized_curation_tokens);
  assert.equal(m.amortized_curation_tokens, Math.ceil(m.curation_tokens / 10));
  assert.equal(ctx["A+"].reasoning_allowance_tokens, study.params.base_reasoning_tokens + m.extra);
});

test("[C4] ablation withholds exactly one artifact from C and is refused in any other arm", () => {
  const base = armSet();
  const target = base.ctx.C.included[0];
  const minus = armSet({ variant: `minus:${target}` });
  assert.ok(!minus.ctx.C.included.includes(target));
  assert.throws(() => buildContext({ arm: "B", task: publicView(evalTasks[0]), snapshot: base.s1, artifactsById: new Map(base.pool.map((a) => [a.id, a])), consumerFamily: "mock-alpha", params: study.params, seed: "s", variant: `minus:${target}` }), /ABLATION_ONLY_IN_C/);
});

test("[C5] cross-family rule: a consumer is never shown records from its own provider-returned family", () => {
  const { ctx, s1 } = armSet({ consumerFamily: "mock-gamma" });
  for (const arm of ["B", "C", "D", "E"]) for (const id of ctx[arm].included) assert.notEqual(s1.entries.find((e) => e.artifact_id === id).producer_family, "mock-gamma", arm);
});

// ── [L] ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("[L1] the leak scan finds a canary, an expected answer and a hidden program in any text", () => {
  const e = evalTasks.find((t) => t.sealed.expected.length >= 6).sealed;
  assert.deepEqual(scanText("clean text", leakIdx), []);
  assert.ok(scanText(`x ${e.canary} y`, leakIdx).some((h) => h.kind === "canary" && h.task_id === e.task_id));
  assert.ok(scanText(`the answer is ${e.expected}`, leakIdx).some((h) => h.kind === "expected_answer"));
  assert.ok(scanText(canonicalJSON(e.program), leakIdx).some((h) => h.kind === "hidden_program"));
});

test("[L2] in a full offline run no sealed signature reaches any public record, and every context passed the scan", async () => {
  const { study: st, mockWorld } = demoStudy({ world: "positive-shared", resamples: 100 });
  const r = await runStudy({ study: st, adapter: createMockAdapter(mockWorld) });
  const pub = JSON.stringify(["study", "task_family", "task", "artifact", "evaluation", "snapshot", "trial", "run"].map((k) => r.store.list(k))) + JSON.stringify(r.plan);
  for (const t of r.sealed.tasks) assert.ok(!pub.includes(t.canary), `canary of ${t.task_id} in public records`);
  assert.equal(r.run.counters.leak_blocked, 0);
  assert.ok(r.store.list("trial").every((t) => t.context.leak_blocked === false));
});

// ── [M] ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const goodApproval = () => ({ study_id: plan.study_id, plan_sha256: plan.plan_sha256, approved_by: "xz", approved_at: T, approval_words: "Yes, approve $5", max_calls: 10, max_usd: 5, models: plan.models.map((m) => m.model_id) });
const liveArgv = (a) => ["--live", "--yes", "--experiment", plan.study_id, "--max-usd", String(a.max_usd), "--max-calls", String(a.max_calls)];

test("[M1] with nothing approved, the live gate refuses and names every missing condition", () => {
  const missing = checkLiveAuthorization({ approval: null, preregistration: { status: "draft_unregistered" }, plan, planSha256: plan.plan_sha256, argv: [], env: {} });
  for (const re of [/no approval file/, /not registered/, /--live --yes/, /--experiment/, /OMNARAI_LAB_LIVE/, /no price on file for mock-/]) assert.ok(missing.some((m) => re.test(m)), String(re));
  assert.throws(() => createLiveAdapter({ authorization: { approval: null, plan, argv: [], env: {} }, keys: {} }), SpendRefusedError);
});

test("[M2] an approval for another plan, missing caps or a CLI that does not repeat them is refused", () => {
  const reg = { status: "registered", registered_commit_sha: "abc1234" };
  const env = { OMNARAI_LAB_LIVE: "1" };
  const a = goodApproval();
  const check = (approval, argv = liveArgv(approval)) => checkLiveAuthorization({ approval, preregistration: reg, plan, planSha256: plan.plan_sha256, argv, env });
  assert.ok(check({ ...a, plan_sha256: "0".repeat(64) }).some((m) => /different plan/.test(m)));
  assert.ok(check({ ...a, max_calls: Infinity }).some((m) => /finite call cap/.test(m)));
  assert.ok(check(a, liveArgv({ ...a, max_usd: 50 })).some((m) => /--max-usd/.test(m)));
  assert.ok(check({ ...a, approval_words: "" }).some((m) => /own words/.test(m)));
  assert.ok(check({ ...a, models: [] }).some((m) => /does not list model/.test(m)));
});

test("[M3] even when authorized: explicit attempt records, redacted errors, a hard cap checked BEFORE each call, a kill switch", async () => {
  const realPlan = { study_id: "IS1-STUDY-X", models: [{ model_id: "claude-sonnet-5-5" }] };
  const approval = { study_id: "IS1-STUDY-X", plan_sha256: "p".repeat(64), approved_by: "xz", approved_at: T, approval_words: "Yes", max_calls: 3, max_usd: 0.05, models: ["claude-sonnet-5-5"] };
  const authorization = { approval, preregistration: { status: "registered", registered_commit_sha: "abc1234" }, plan: realPlan, planSha256: "p".repeat(64), argv: ["--live", "--yes", "--experiment", "IS1-STUDY-X", "--max-usd", "0.05", "--max-calls", "3"], env: { OMNARAI_LAB_LIVE: "1" } };
  const KEY = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz";
  const sent = [];
  let n = 0;
  const transport = async (req) => { sent.push(req); n++; return n === 1 ? { status: 529, headers: {}, json: { error: { message: `overloaded for key ${KEY}` } }, duration_ms: 5 } : { status: 200, headers: { "request-id": "req_1" }, json: { model: "claude-sonnet-5-5-20261101", content: [{ text: "<answer>x</answer>" }], usage: { input_tokens: 100, output_tokens: 20 } }, duration_ms: 7 }; };
  const adapter = createLiveAdapter({ authorization, keys: { ANTHROPIC_API_KEY: KEY }, transport });
  const guard = createSpendGuard({ maxCalls: 3, maxUsd: 0.05, onDate: "2026-11-20" });
  const req = { provider: "anthropic", model_id: "claude-sonnet-5-5", input: { system: "s", user: "u" }, max_output_tokens: 100, timeout_ms: 1000, tracing_id: "T-1", tokens_in_est: 100 };
  const { result, attempts } = await callWithRetries(adapter, req, { maxAttempts: 3, guard });
  assert.deepEqual(attempts.map((a) => a.attempt_id), ["T-1-a1", "T-1-a2"]);
  assert.equal(attempts[0].status, "error");
  assert.equal(result.provider_returned_model_id, "claude-sonnet-5-5-20261101", "the RETURNED id is recorded, not the requested one");
  assert.equal(attempts[1].request_id, "req_1");
  assert.ok(attempts[1].cost_usd > 0 && attempts[1].cost_status === "priced");
  assert.ok(!JSON.stringify(attempts).includes(KEY), "no key in any attempt record");
  assert.equal(redact(`https://x/?key=${KEY}&a=1 Bearer abcdefghijklmnop`, [KEY]), "https://x/?key=[redacted]&a=1 [redacted]");
  await assert.rejects(callWithRetries(adapter, { ...req, max_output_tokens: 100000 }, { maxAttempts: 1, guard }), BudgetExhaustedError, "worst case above the cap is refused before calling");
  const killed = createSpendGuard({ maxCalls: 9, maxUsd: 9, onDate: "2026-11-20", killSwitch: () => true });
  await assert.rejects(callWithRetries(adapter, req, { maxAttempts: 1, guard: killed }), /kill switch/);
  assert.equal(sent.length, 2, "refused calls never reached the transport");
  assert.deepEqual(costOf("no-such-model", 10, 10), { usd: null, status: "unknown" }, "unknown price is unknown, never 0");
});

test("[M4] the offline path is non-billable end to end: $0, zero billable calls", async () => {
  const { study: st, mockWorld } = demoStudy({ world: "inert", resamples: 100 });
  const r = await runStudy({ study: st, adapter: createMockAdapter(mockWorld) });
  assert.equal(r.run.spend.usd, 0);
  assert.equal(r.run.spend.calls_billed, 0);
  assert.ok(r.store.list("trial").every((t) => t.call.cost_status === "mock-zero" && t.simulation === true));
});
