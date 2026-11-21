// Inheritance study 001 — artifacts (what one generation leaves for the next) and their folded state.
//
// An artifact body is the authored output, kept VERBATIM, plus who produced it (as the RUNNER recorded the provider's
// answer, not as the model declared itself), what it was produced from, and what it builds on. The body never carries
// a verdict: evaluations are separate append-only records and the state is FOLDED from them, the same pattern as
// Footprint moderation (api/_footprints.js foldModeration). A primary is never edited; a correction is a new artifact
// that `supersedes` the old one.
import { schemaVersion, seal, hexId, isSealedIntact } from "./canon.mjs";
import { extractProgram } from "./dsl.mjs";
import { FP_ID_RE, ATLAS_RECORD_RE, detectSecrets } from "../../../api/_footprints.js";
import { VERIFIER_KINDS, isIndependent } from "./verify.mjs";
import { familyOfModelId } from "./identity.mjs";

export const ARTIFACT_KINDS = ["producer_output", "poison_fixture", "footprint_import"];
export const ARTIFACT_ID_RE = /^IS1-ART-g\d{1,3}-[0-9a-f]{12}$/;
export const MAX_TEXT_CHARS = 8000;

export { familyOfModelId };
// identity_status: how much we know about who produced this.
//   provider-returned  — the runner called the provider and recorded the model id the provider sent back
//   declared-unverified — a self-declared label (e.g. an imported Footprint); never used as identity evidence
//   investigator        — authored by the study team as a fixture (poison); never a "producer family"
export const IDENTITY_STATUSES = ["provider-returned", "declared-unverified", "investigator"];

export function makeArtifact({ studyId, generation, kind = "producer_output", domain = "str", producer, source, text, relations = {}, production = null, createdAt }) {
  const identity_status = kind === "poison_fixture" ? "investigator" : kind === "footprint_import" ? "declared-unverified" : "provider-returned";
  const family = identity_status === "provider-returned" ? familyOfModelId(producer.model_id_returned) : identity_status === "investigator" ? "investigator" : "declared:" + (producer.declared_lineage || "unresolved");
  const { program, error } = extractProgram(text, domain);
  const body = {
    schema_version: schemaVersion("artifact"),
    study_id: studyId,
    generation,
    kind,
    domain,
    producer: {
      provider: producer.provider,
      model_id_requested: producer.model_id_requested ?? null,
      model_id_returned: producer.model_id_returned ?? null,
      family,
      identity_status,
    },
    source: {
      task_id: source.task_id ?? null,
      family_id: source.family_id ?? null,
      input_snapshot_id: source.input_snapshot_id ?? null,
      input_snapshot_sha256: source.input_snapshot_sha256 ?? null,
      run_id: source.run_id ?? null,
      call_id: source.call_id ?? null,
      footprint_content_sha256: source.footprint_content_sha256 ?? null,
      // Every artifact the producer was SHOWN (exposure), whether or not it says it built on them.
      exposed_artifact_ids: [...(source.exposed_artifact_ids || [])].sort(),
    },
    // What producing it cost (curation cost is charged to arm C and amortized; see analyze.mjs).
    production: {
      tokens_in: production?.tokens_in ?? 0,
      tokens_out: production?.tokens_out ?? 0,
      usd: production?.usd ?? null,
      cost_status: production?.cost_status ?? (kind === "producer_output" ? "unknown" : "not-applicable"),
    },
    content: { text: String(text ?? ""), program, program_parse_error: program ? null : error },
    relations: {
      derived_from: [...(relations.derived_from || [])].sort(),
      supersedes: relations.supersedes ?? null,
      footprint_refs: [...(relations.footprint_refs || [])].sort(),
      atlas_refs: [...(relations.atlas_refs || [])].sort(),
    },
    created_at: createdAt,
  };
  return seal({ ...body, id: `IS1-ART-g${generation}-${hexId(body, 12)}` });
}

// Structural + semantic validation, fail closed. Returns [] or problems. Existence/causality of relations is the
// snapshot's job (it knows the pool); here only their form.
export function validateArtifactSemantics(a) {
  const errors = [];
  if (!isSealedIntact(a)) errors.push("ARTIFACT_INTEGRITY: sha256 does not match the body");
  if (!ARTIFACT_ID_RE.test(a.id || "")) errors.push("id must match IS1-ART-g<gen>-<12 hex>");
  else if (Number(a.id.slice(9).split("-")[0]) !== a.generation) errors.push("id generation differs from body generation");
  if (!ARTIFACT_KINDS.includes(a.kind)) errors.push(`kind must be one of ${ARTIFACT_KINDS.join(", ")}`);
  if (a.content?.text?.length > MAX_TEXT_CHARS) errors.push(`text longer than ${MAX_TEXT_CHARS}`);
  if (detectSecrets(a.content?.text || "").length) errors.push("SECRET_DETECTED: credential-shaped text in an artifact");
  if (a.producer?.identity_status === "provider-returned" && a.producer.family !== familyOfModelId(a.producer.model_id_returned)) {
    errors.push("PRODUCER_FAMILY_MISMATCH: family must be derived from the provider-returned model id");
  }
  for (const r of a.relations?.derived_from || []) if (!ARTIFACT_ID_RE.test(r)) errors.push(`derived_from ${r} is not an artifact id`);
  if (a.relations?.supersedes != null && !ARTIFACT_ID_RE.test(a.relations.supersedes)) errors.push("supersedes must be an artifact id");
  for (const r of a.relations?.footprint_refs || []) if (!FP_ID_RE.test(r)) errors.push(`footprint_ref ${r} is not a Footprint id`);
  for (const r of a.relations?.atlas_refs || []) if (!ATLAS_RECORD_RE.test(r)) errors.push(`atlas_ref ${r} is not an Atlas record id`);
  return errors;
}

// Folded state, from append-only evaluations (latest by recorded_at, then id). Only an intact, independent evaluation
// counts. A curator admission is not in VERIFIER_KINDS, so it can never move an artifact to "evaluated".
//   proposed    — no usable evaluation
//   evaluated   — latest usable evaluation passed
//   rejected    — latest usable evaluation failed
//   unverifiable — latest usable evaluation was error/inconclusive (fail closed: not inheritable as verified)
//   superseded  — a later artifact in the pool names this one in `supersedes`
export function foldArtifactState(artifact, evaluations = [], pool = []) {
  if (pool.some((p) => p.id !== artifact.id && p.relations?.supersedes === artifact.id)) return { state: "superseded", basis: null };
  const usable = evaluations
    .filter((e) => e.artifact_id === artifact.id && e.artifact_sha256 === artifact.sha256 && isSealedIntact(e)
      && VERIFIER_KINDS.includes(e.verifier?.kind) && isIndependent(e.verifier, artifact.producer))
    .sort((x, y) => (x.recorded_at || "").localeCompare(y.recorded_at || "") || x.id.localeCompare(y.id));
  const last = usable.at(-1);
  if (!last) return { state: "proposed", basis: null };
  const state = last.status === "passed" ? "evaluated" : last.status === "failed" ? "rejected" : "unverifiable";
  return { state, basis: last };
}
