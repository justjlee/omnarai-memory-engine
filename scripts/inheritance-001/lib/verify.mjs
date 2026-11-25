// Inheritance study 001 — the pawl: independent verification of inherited artifacts. SEALED SIDE.
//
// An artifact's program is re-run, in the data-only interpreter, against the hidden checks of the task it came from.
// The verifier is code, not a model, so it is independent of every producer by construction. What a pass means is
// written into every receipt (scope_note): this program reproduced that task's hidden program on N unseen inputs. It
// does NOT verify the artifact's prose, and it says nothing about any other task.
//
// Receipts are never trusted on read: reverify() re-executes and fails closed on any disagreement (a forged or
// tampered receipt), because for a cheap deterministic verifier re-checking costs less than trusting.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { schemaVersion, seal, sha256, hexId, isSealedIntact } from "./canon.mjs";
import { runProgram, formatValue, parseValue, ProgramError } from "./dsl.mjs";

const SELF = fileURLToPath(import.meta.url);
const DSL = fileURLToPath(new URL("./dsl.mjs", import.meta.url));
export const VERIFIER = Object.freeze({
  id: "is1-dsl-hidden-checks",
  kind: "deterministic-dsl",
  version: "0.1.0",
  code_sha256: sha256(readFileSync(SELF, "utf8") + readFileSync(DSL, "utf8")),
});
// Kinds of evidence an evaluation may carry. A curator admission is moderation, not verification, so it is NOT a kind.
export const VERIFIER_KINDS = ["deterministic-dsl", "human-adjudication", "model-judge"];
export const EVALUATION_STATUSES = ["passed", "failed", "error", "inconclusive"];
export const EVIDENCE_TIERS = { "deterministic-dsl": "objective-hidden-tests", "human-adjudication": "human-adjudicated", "model-judge": "model-judged" };

// A verifier is independent of a producer unless it is a model of the producer's own (provider-returned) family.
export function isIndependent(verifier, producer) {
  if (!VERIFIER_KINDS.includes(verifier?.kind)) return false;
  if (verifier.kind !== "model-judge") return true;
  return Boolean(verifier.family && producer?.family && verifier.family !== producer.family && verifier.family !== "unknown");
}

function check(program, sealedTask, domain) {
  let passed = 0, steps = 0;
  for (const c of sealedTask.checks) {
    steps += program.length;
    const got = formatValue(runProgram(program, parseValue(c.input, domain), domain), domain);
    if (got === c.output) passed++;
  }
  return { passed, n: sealedTask.checks.length, steps };
}

// verifyArtifact → a sealed evaluation record. `timer` is injected so an offline run is byte-reproducible
// (cpu_ms_measured:false); a live run passes performance.now.
export function verifyArtifact(artifact, sealedIndex, { recordedAt, timer = null } = {}) {
  const t0 = timer ? timer() : 0;
  const src = artifact.source?.task_id;
  const sealedTask = sealedIndex.get(src);
  const domain = artifact.domain || "str";
  let status, cases = { task_id: src || null, n: 0, passed: 0, commitment_sha256: null }, detail = null, steps = 0;
  if (!sealedTask) { status = "error"; detail = "SOURCE_TASK_NOT_IN_SEALED_INDEX"; }
  else if (!artifact.content?.program) {
    status = "inconclusive"; detail = "NO_PROGRAM: a note without a program cannot be checked by this verifier";
    cases = { ...cases, n: sealedTask.checks.length, commitment_sha256: sha256(sealedTask.checks) };
  } else {
    try {
      const r = check(artifact.content.program, sealedTask, domain);
      steps = r.steps;
      cases = { task_id: src, n: r.n, passed: r.passed, commitment_sha256: sha256(sealedTask.checks) };
      status = r.passed === r.n ? "passed" : "failed";
    } catch (e) {
      status = e instanceof ProgramError ? "failed" : "error";
      detail = String(e.code || e.message || e).slice(0, 120);
      cases = { ...cases, n: sealedTask.checks.length, commitment_sha256: sha256(sealedTask.checks) };
    }
  }
  const elapsed = timer ? +(timer() - t0).toFixed(3) : 0;
  return seal({
    schema_version: schemaVersion("evaluation"),
    id: `IS1-EVAL-${hexId({ a: artifact.id, sha: artifact.sha256, v: VERIFIER.code_sha256 }, 12)}`,
    study_id: artifact.study_id,
    artifact_id: artifact.id,
    artifact_sha256: artifact.sha256,
    verifier: { ...VERIFIER },
    independent_of_producer: isIndependent(VERIFIER, artifact.producer),
    evidence_tier: EVIDENCE_TIERS[VERIFIER.kind],
    status,
    detail,
    cases,
    cost: { interpreter_steps: steps, cpu_ms: elapsed, cpu_ms_measured: Boolean(timer), model_tokens_in: 0, model_tokens_out: 0, human_minutes: 0, usd: 0 },
    scope_note: status === "passed"
      ? `Program reproduced its source task's hidden program on ${cases.passed}/${cases.n} unseen inputs. Evidence for this program on that task only; the note text is not verified.`
      : `Not verified (${status}).`,
    recorded_at: recordedAt,
  });
}

// Re-execute and compare. Throws on any disagreement; returns the fresh evaluation otherwise.
export class ForgedReceiptError extends Error {
  constructor(detail) { super(`FORGED_OR_STALE_RECEIPT ${detail}`); this.code = "FORGED_OR_STALE_RECEIPT"; }
}
export function reverify(evaluation, artifact, sealedIndex) {
  if (!isSealedIntact(evaluation)) throw new ForgedReceiptError(`${evaluation?.id}: receipt hash does not match its body`);
  if (evaluation.artifact_id !== artifact.id || evaluation.artifact_sha256 !== artifact.sha256) throw new ForgedReceiptError(`${evaluation.id}: receipt names a different artifact body`);
  if (evaluation.verifier?.kind === "deterministic-dsl") {
    if (evaluation.verifier.code_sha256 !== VERIFIER.code_sha256) throw new ForgedReceiptError(`${evaluation.id}: verifier code differs from the pinned verifier`);
    const fresh = verifyArtifact(artifact, sealedIndex, { recordedAt: evaluation.recorded_at });
    if (fresh.status !== evaluation.status || fresh.cases.passed !== evaluation.cases.passed || fresh.cases.n !== evaluation.cases.n) {
      throw new ForgedReceiptError(`${evaluation.id}: re-execution gives ${fresh.status} ${fresh.cases.passed}/${fresh.cases.n}, receipt says ${evaluation.status} ${evaluation.cases.passed}/${evaluation.cases.n}`);
    }
    return fresh;
  }
  // Human or model evidence cannot be re-executed here: it must at least be independent and intact.
  if (!isIndependent(evaluation.verifier, artifact.producer)) throw new ForgedReceiptError(`${evaluation.id}: verifier is not independent of the producer`);
  return evaluation;
}
