// Inheritance study 001 — frozen generation snapshots. SEALED SIDE (re-verifies receipts, scans for leaks).
//
// A snapshot is what generation g may inherit, frozen before any generation-g call: an ordered list of artifact ids and
// hashes, each with its folded state, the evaluation it rests on, and the arms that may show it. A trial cites ONE
// snapshot by hash, never "latest". Rules, all fail closed:
//   • strictly earlier generations only — same- and future-generation work is excluded and listed;
//   • every body re-hashes to its id's record; a duplicate id stops the build;
//   • parent links (derived_from / supersedes) must point at existing, strictly earlier artifacts;
//   • causality: an artifact may only have been exposed to, or cite, what its own generation's snapshot held;
//   • every "passed" receipt is re-executed (reverify); a forged or stale receipt stops the build;
//   • an artifact carrying a sealed evaluation task's canary, answer or program is excluded as a LEAK.
// Eligibility is evidence-scoped: arm C needs an independent passing evaluation — curator admission alone never counts.
import { schemaVersion, seal, hexId, IntegrityError, isSealedIntact } from "./canon.mjs";
import { validateArtifactSemantics, foldArtifactState } from "./artifacts.mjs";
import { reverify, ForgedReceiptError } from "./verify.mjs";
import { scanArtifact } from "./leak.mjs";

export const SNAPSHOT_POLICY_VERSION = "is1-snapshot-policy/0.1";

export class SnapshotError extends Error {
  constructor(code, detail) { super(`${code}${detail ? ` ${detail}` : ""}`); this.code = code; }
}

// arms each artifact may appear in (cross-family filtering against the CONSUMER happens at context time)
function eligibleArms(a, state, mainDomain) {
  const arms = [];
  const provider = a.producer.identity_status === "provider-returned";
  if (a.domain === mainDomain && (a.kind === "producer_output" || a.kind === "footprint_import")) arms.push("B");
  if (a.domain === mainDomain && a.kind === "producer_output" && provider && state === "evaluated") arms.push("C", "D");
  if (a.domain !== mainDomain && a.kind === "producer_output" && provider && state === "evaluated") arms.push("E");
  if (a.domain === mainDomain && (a.kind === "poison_fixture" || (a.kind === "producer_output" && state === "rejected"))) arms.push("D-poison");
  return arms;
}

export function buildSnapshot({ studyId, generation, pool, evaluations, sealedIndex, leakIdx = [], priorSnapshots = new Map(), mainDomain = "str", frozenAt, ablation = null }) {
  if (!Number.isInteger(generation) || generation < 1) throw new SnapshotError("INVALID_GENERATION", String(generation));
  const problems = [];
  const excluded = [];
  const seen = new Map();
  for (const a of pool) {
    if (seen.has(a.id)) throw new SnapshotError("DUPLICATE_ARTIFACT", a.id);
    seen.set(a.id, a);
  }
  // integrity + form, for EVERY artifact in the pool (a corrupt later artifact is still a corrupt store)
  for (const a of pool) {
    const errs = validateArtifactSemantics(a);
    if (errs.length) throw new IntegrityError(errs[0].startsWith("ARTIFACT_INTEGRITY") ? "ARTIFACT_INTEGRITY" : "ARTIFACT_INVALID", `${a.id}: ${errs[0]}`);
  }
  for (const e of evaluations) if (!isSealedIntact(e)) throw new IntegrityError("EVALUATION_INTEGRITY", e.id);

  const entries = [];
  const contentSeen = new Map();
  for (const a of [...pool].sort((x, y) => x.id.localeCompare(y.id))) {
    if (a.generation >= generation) { excluded.push({ artifact_id: a.id, reason: a.generation === generation ? "SAME_GENERATION" : "FUTURE_GENERATION" }); continue; }
    // parent links
    for (const p of [...(a.relations.derived_from || []), ...(a.relations.supersedes ? [a.relations.supersedes] : [])]) {
      const parent = seen.get(p);
      if (!parent) throw new SnapshotError("INVALID_PARENT_EDGE", `${a.id} -> ${p} (no such artifact)`);
      if (parent.generation >= a.generation) throw new SnapshotError("INVALID_PARENT_EDGE", `${a.id} (g${a.generation}) -> ${p} (g${parent.generation}): parents must be strictly earlier`);
    }
    // causality: what it was exposed to / cites must be in its own generation's snapshot
    if (a.kind === "producer_output") {
      const own = a.generation === 0 ? null : priorSnapshots.get(a.generation);
      const visible = new Set((own?.entries || []).map((e) => e.artifact_id));
      if (a.generation > 0 && (!own || own.sha256 !== a.source.input_snapshot_sha256)) {
        throw new SnapshotError("CAUSALITY_VIOLATION", `${a.id}: input snapshot ${a.source.input_snapshot_sha256} is not generation ${a.generation}'s frozen snapshot`);
      }
      for (const x of [...a.source.exposed_artifact_ids, ...a.relations.derived_from]) {
        if (!visible.has(x)) throw new SnapshotError("CAUSALITY_VIOLATION", `${a.id} was exposed to or cites ${x}, which its generation could not see`);
      }
    }
    const leaks = scanArtifact(a, leakIdx);
    if (leaks.length) { excluded.push({ artifact_id: a.id, reason: "LEAK", detail: leaks.map((l) => `${l.kind}:${l.task_id}`).slice(0, 5) }); problems.push(`LEAK ${a.id}`); continue; }
    const contentKey = `${a.domain}|${a.content.text}`;
    if (contentSeen.has(contentKey)) { excluded.push({ artifact_id: a.id, reason: "DUPLICATE_CONTENT", duplicate_of: contentSeen.get(contentKey) }); continue; }
    contentSeen.set(contentKey, a.id);

    const evs = evaluations.filter((e) => e.artifact_id === a.id);
    const { state, basis } = foldArtifactState(a, evs, pool.filter((p) => p.generation < generation));
    if (state === "evaluated" || state === "rejected") {
      try { reverify(basis, a, sealedIndex); } catch (err) {
        if (err instanceof ForgedReceiptError) throw new SnapshotError("FORGED_RECEIPT", err.message);
        throw err;
      }
    }
    entries.push({
      artifact_id: a.id,
      artifact_sha256: a.sha256,
      generation: a.generation,
      kind: a.kind,
      domain: a.domain,
      producer_family: a.producer.family,
      identity_status: a.producer.identity_status,
      state,
      evaluation_id: basis?.id ?? null,
      evaluation_sha256: basis?.sha256 ?? null,
      eligible: eligibleArms(a, state, mainDomain),
      production_tokens: (a.production?.tokens_in || 0) + (a.production?.tokens_out || 0),
    });
  }
  // Ablation targets are chosen HERE, at freeze time, by a rule fixed in the plan — before any generation-g outcome.
  let ablation_targets = [];
  if (ablation?.max_artifacts > 0) {
    ablation_targets = entries.filter((e) => e.eligible.includes("C"))
      .map((e) => ({ id: e.artifact_id, k: hexId({ seed: ablation.seed, g: generation, id: e.artifact_id }, 12) }))
      .sort((x, y) => x.k.localeCompare(y.k)).slice(0, ablation.max_artifacts).map((x) => x.id).sort();
  }
  const body = {
    schema_version: schemaVersion("snapshot"),
    study_id: studyId,
    generation,
    policy: {
      version: SNAPSHOT_POLICY_VERSION,
      allowed_generations: Array.from({ length: generation }, (_, i) => i),
      main_domain: mainDomain,
      c_requires: "independent evaluation, status passed, re-executed at freeze; curator admission is not evidence",
      cross_family_filter: "applied per consumer at context time, on provider-returned families",
    },
    entries,
    excluded,
    counts: {
      entries: entries.length,
      by_state: entries.reduce((o, e) => ({ ...o, [e.state]: (o[e.state] || 0) + 1 }), {}),
      by_arm: ["B", "C", "D-poison", "E"].reduce((o, k) => ({ ...o, [k]: entries.filter((e) => e.eligible.includes(k)).length }), {}),
      excluded: excluded.length,
    },
    ablation_targets,
    audits: { leak_problems: problems, causality: "passed", receipts_reexecuted: entries.filter((e) => e.evaluation_id && (e.state === "evaluated" || e.state === "rejected")).length },
    frozen_at: frozenAt,
  };
  return seal({ ...body, id: `IS1-SNAP-g${generation}-${hexId(body, 12)}` });
}

// The check every trial runs: the snapshot is intact and every artifact it shows is the exact body the snapshot froze.
export function assertSnapshotMembers(snapshot, artifacts) {
  if (!isSealedIntact(snapshot)) throw new IntegrityError("SNAPSHOT_INTEGRITY", snapshot?.id);
  const byId = new Map(snapshot.entries.map((e) => [e.artifact_id, e]));
  for (const a of artifacts) {
    const e = byId.get(a.id);
    if (!e) throw new SnapshotError("NOT_IN_SNAPSHOT", a.id);
    if (e.artifact_sha256 !== a.sha256 || !isSealedIntact(a)) throw new IntegrityError("SNAPSHOT_MISMATCH", a.id);
  }
}
