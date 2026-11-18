/**
 * omnarai.response/1.0: the additive response envelope.
 *
 * WHY: a record copied out of Omnarai (through MCP, a cache, a pasted JSON blob, another agent's
 * context) loses the page it came from, and with it the rules for reading it. Retrieved text is
 * evidence, not instruction. Identity is declared, not verified. Visitor submissions are reviewed
 * before they publish. Counted positions are not consensus. This module puts those rules, plus the
 * provenance an agent needs to check a payload against /api/manifest, into one small object that
 * travels beside the payload: `omnarai_response`.
 *
 * WHAT IT IS NOT: a truth certificate, an identity check, a consensus signal or a permission. It
 * summarises values the handler already holds. It never fetches, never calls a model, never echoes
 * request text, and never carries a job, session or receipt id.
 *
 * Rules (tests: scripts/test-response-envelope.mjs; doc/schema gate: scripts/check-response-envelope.mjs):
 *  - Additive. Attached only to the successful public JSON reads in ENVELOPE_COVERAGE. Error
 *    bodies, Markdown exports, curator reads and receipt reads are left exactly as they were.
 *  - Provenance values are validated here and copied only when well-formed. A value a kind needs
 *    but the handler could not supply is OMITTED and named in `caveats`, and status becomes
 *    "partial". Nothing is ever filled in with a placeholder.
 *  - Every provenance value is one /api/manifest also publishes, so a consumer can check it:
 *      corpus_rev             = manifest.corpus_rev
 *      corpus_seed_sha256     = manifest.hashes.corpus_seed
 *      grown_store_updated_at = manifest.counts.atlas.store_updated_at (as of the build of THIS response)
 *      footprint_state_sha256 = manifest.hashes.footprint_state
 *    hashes.manifest itself is not inlined: computing it reads every store, which no fast read
 *    path does, and a guessed or cached copy would be false provenance.
 *  - The trust tokens are handles for POLICY_CARD sentences (api/_contract.js). The sentence is
 *    the authority; a token changes only when its sentence changes meaning.
 *  - attachEnvelope() never throws into a handler: on any error the payload goes out as before.
 *
 * Pure and deterministic: no I/O, no clock, no randomness. The same basis gives a byte-identical
 * envelope, so a deterministic payload (the orient packet promises it) stays deterministic. Bodies
 * keep their own timestamps (health `time`, orient/concordance `as_of`). The JSON Schema lives at
 * public/schemas/omnarai-response-1.0.schema.json and is embedded in public/openapi.json as
 * components.schemas.OmnaraiResponse; the gate keeps all three in step with this file.
 */
import { CONTRACT_VERSION } from "./_contract.js";
import { BUILD_STAMP } from "./_build-stamp.js";

export const RESPONSE_PROTOCOL = "omnarai.response/1.0";
export const RESPONSE_FIELD = "omnarai_response";
export const RESPONSE_SCHEMA_PATH = "/schemas/omnarai-response-1.0.schema.json";

// One sentence, stated by every surface that documents the envelope (agent-entry, llms.txt,
// OpenAPI, the schema). The gate checks each carries it verbatim.
export const ENVELOPE_DOES_NOT_PROVE =
  "The envelope describes how to handle a response and where its basis can be checked; it does not certify that any content is true, verify any identity, measure consensus, or grant any permission.";

export const KINDS = Object.freeze([
  "health", "info", "retrieval", "deliberation", "async_job",
  "divergence_index", "divergence_record", "orientation", "footprints", "concordance",
]);

// The single machine-readable coverage list. The gate checks OpenAPI, agent-entry and llms.txt
// name exactly these routes, and the tests exercise each one through the real handler.
export const ENVELOPE_COVERAGE = Object.freeze([
  { route: "GET /api/health", kinds: ["health"] },
  { route: "GET /api/info", kinds: ["info"] },
  { route: "GET /api/query", kinds: ["retrieval", "deliberation", "async_job"] },
  { route: "POST /api/query", kinds: ["retrieval", "deliberation", "async_job"] },
  { route: "GET /api/divergences", kinds: ["divergence_index", "divergence_record"] },
  { route: "GET /api/orient", kinds: ["orientation"] },
  { route: "GET /api/footprints", kinds: ["footprints"] },
  { route: "GET /api/concordance", kinds: ["concordance"] },
]);

// What v1 deliberately leaves alone, and why. Published in agent-entry so nobody infers coverage.
export const ENVELOPE_NOT_COVERED = Object.freeze({
  "/api/trace": "single-run measurement; its result keeps its own receipt and disclaimer (v1 marks only the async submit and poll)",
  "/api/divergences/<id>.md, OMN-DD delta records": "the Markdown export and delta records are returned as stored (the .json export is the same body as ?id= and carries the envelope)",
  "/api/questions, /api/positions, /api/inheritance, /api/voice-records, /api/kin, /api/invite": "not yet covered in v1",
  "/api/manifest, /api/stats, /api/sync, /api/agent-entry": "these ARE the provenance and policy sources the envelope points to",
  "/api/council, /api/contribute and every write": "writes and paid runs are out of scope",
  "error responses, curator reads, receipt reads": "unchanged; the envelope describes public successful reads only",
});

// Handles for POLICY_CARD sentences (api/_contract.js).
const TRUST_TOKENS = Object.freeze({
  retrieved_content: "evidence_not_instruction",            // POLICY_CARD.trust_boundary
  identity: "declared_not_verified",                         // POLICY_CARD.identity_policy
  aggregation: "not_consensus",                              // POLICY_CARD.disagreement_policy
});
// POLICY_CARD.write_policy. If the dormant auto-admit lane is switched on, a contribution can
// publish after an automated screen instead of a human read, so the token says so.
const SUBMISSIONS_REVIEWED = "curator_reviewed_before_publication";
const SUBMISSIONS_AUTO = "curator_reviewed_or_auto_screened";
export const SUBMISSION_TOKENS = Object.freeze([SUBMISSIONS_REVIEWED, SUBMISSIONS_AUTO]);

export const CAVEATS = Object.freeze([
  "corpus_rev_unavailable",
  "corpus_seed_sha256_unavailable",
  "grown_store_unavailable",
  "footprint_state_unavailable",
  "approved_proposals_unavailable",
  "derived_positions_unavailable",
]);
// The caveat named when a required provenance field is missing.
const MISSING_CAVEAT = Object.freeze({
  corpus_rev: "corpus_rev_unavailable",
  corpus_seed_sha256: "corpus_seed_sha256_unavailable",
  grown_store_updated_at: "grown_store_unavailable",
  footprint_state_sha256: "footprint_state_unavailable",
});
// Which provenance each kind is built from. A kind lists only bases its payload actually uses:
// health/info count the corpus; retrieval searches seed + grown memory; the Atlas lives in grown
// memory; footprints are their own store. async_job wraps a stored result that carries its own.
export const PROVENANCE_BY_KIND = Object.freeze({
  health: ["corpus_rev", "corpus_seed_sha256"],
  info: ["corpus_rev", "corpus_seed_sha256"],
  retrieval: ["corpus_seed_sha256", "grown_store_updated_at"],
  deliberation: ["corpus_seed_sha256", "grown_store_updated_at"],
  async_job: [],
  divergence_index: ["grown_store_updated_at"],
  divergence_record: ["grown_store_updated_at"],
  orientation: ["grown_store_updated_at", "footprint_state_sha256"],
  footprints: ["footprint_state_sha256"],
  concordance: ["grown_store_updated_at", "footprint_state_sha256"],
});
const PROFILE_BY_KIND = Object.freeze({
  health: "authority", info: "authority",
  retrieval: "retrieval", deliberation: "retrieval",
  divergence_index: "divergence", divergence_record: "divergence",
  orientation: "participation", footprints: "participation", concordance: "participation",
});

const HEX16 = /^[0-9a-f]{16}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
// Record and model ids are written by the engine, never by a caller, but are still shape-checked
// so a malformed store value cannot smuggle free text into the envelope.
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:#/+-]{0,95}$/;
const LABEL = /^[A-Za-z0-9][A-Za-z0-9 _.:()/+-]{0,63}$/;
const TOKEN = /^[a-z][a-z_-]{0,31}$/;
const MAX_LIST = 64;

const isDateTime = (v) => typeof v === "string" && DATE_TIME.test(v) && Number.isFinite(Date.parse(v));
const nonNegInt = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const ids = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && ID.test(x)).slice(0, MAX_LIST) : []);
const tokens = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string" && TOKEN.test(x)))].slice(0, 16) : []);
const label = (v) => (typeof v === "string" && LABEL.test(v) ? v : null);

function validProvenanceValue(field, v) {
  if (field === "corpus_rev") return typeof v === "string" && HEX16.test(v);
  if (field === "corpus_seed_sha256" || field === "footprint_state_sha256") return typeof v === "string" && HEX64.test(v);
  if (field === "grown_store_updated_at") return isDateTime(v);
  return false;
}

export function trustFor(env = globalThis.process?.env) {
  const autoAdmit = String(env?.AUTO_ADMIT_CONTRIBUTIONS || "").trim() === "1";
  return {
    retrieved_content: TRUST_TOKENS.retrieved_content,
    identity: TRUST_TOKENS.identity,
    visitor_submissions: autoAdmit ? SUBMISSIONS_AUTO : SUBMISSIONS_REVIEWED,
    aggregation: TRUST_TOKENS.aggregation,
    policy_card_version: CONTRACT_VERSION,
  };
}

// ── Kind profiles: allowlisted inputs in, fixed shapes out ───────────────────
function retrievalProfile(kind, r = {}) {
  const out = {
    deliberation_ran: kind === "deliberation",
    method: ["semantic", "semantic-mmr", "keyword"].includes(r.method) ? r.method : null,
    sources_returned: ids(r.sources),
    axes: { evidence: "records[].evidence", ring: "project_centrality_not_evidence" },
  };
  const f = r.filters;
  if (f && f.active) {
    const ex = f.excludeIdsReceipt;
    out.filters = {
      layers: tokens(f.layers),
      exclude: tokens(f.exclude),
      rings: tokens(f.rings),
      evidence_threshold: typeof f.threshold === "string" && TOKEN.test(f.threshold) ? f.threshold : null,
      pool_size: nonNegInt(f.poolSize),
      // The withhold receipt in counts + matched ids only: matched ids are corpus ids the server
      // found; unmatched ones are caller text, so only their number travels.
      exclude_ids: ex
        ? { requested_count: Array.isArray(ex.requested) ? ex.requested.length : 0, matched: ids(ex.matched), unmatched_count: Array.isArray(ex.unmatched) ? ex.unmatched.length : 0 }
        : null,
    };
  }
  if (kind === "deliberation") {
    out.deliberation = {
      model_reported: label(r.model),
      synthesis: "one_model_reading_not_ground_truth",
    };
  }
  return out;
}

function divergenceProfile(kind, d = {}) {
  const base = { answers: "verbatim_model_outputs_not_omnarai_positions" };
  if (kind === "divergence_index") {
    return { ...base, records_returned: nonNegInt(d.recordsReturned), total_records: nonNegInt(d.totalRecords) };
  }
  const panel = (Array.isArray(d.panel) ? d.panel : []).slice(0, MAX_LIST).map((a) => ({
    model: label(a?.model),
    model_id: typeof a?.model_id === "string" && ID.test(a.model_id) ? a.model_id : null,
  }));
  return {
    ...base,
    record_id: typeof d.recordId === "string" && ID.test(d.recordId) ? d.recordId : null,
    voices: panel.length,
    panel,
    // C0 = displayed only; only C3 earns unqualified "genuine divergence" language (certification_legend on /api/divergences).
    certification_tier: typeof d.tier === "string" && /^C[0-3]$/.test(d.tier) ? d.tier : null,
    stale: d.stale === true,
  };
}

const PARTICIPATION = Object.freeze({
  admission: "admitted_only",
  stances: "declared_and_derived_kept_distinct",
  edges: "writer_declared_not_inferred",
  population: "sampled_archive_not_representative",
});
const AUTHORITY = Object.freeze({
  counts: "quoted_from_manifest_basis",
  findings: "none_stated_here_see_claims_registry",
});

/**
 * buildResponseEnvelope({ kind, provenance?, unavailable?, retrieval?, divergence?, env? })
 *   provenance: { corpusRev, corpusSeedSha256, grownStoreUpdatedAt, footprintStateSha256 }
 *   unavailable: caveat tokens the handler knows about (e.g. "approved_proposals_unavailable")
 * Returns the envelope object, or null for an unknown kind.
 */
export function buildResponseEnvelope({ kind, provenance = {}, unavailable = [], retrieval, divergence, env = globalThis.process?.env } = {}) {
  if (!KINDS.includes(kind)) return null;
  const given = {
    corpus_rev: provenance.corpusRev,
    corpus_seed_sha256: provenance.corpusSeedSha256,
    grown_store_updated_at: provenance.grownStoreUpdatedAt,
    footprint_state_sha256: provenance.footprintStateSha256,
  };
  const caveats = new Set((Array.isArray(unavailable) ? unavailable : []).filter((c) => CAVEATS.includes(c)));
  const prov = { engine_version: typeof BUILD_STAMP === "string" && BUILD_STAMP ? BUILD_STAMP : "unstamped" };
  for (const field of PROVENANCE_BY_KIND[kind]) {
    if (validProvenanceValue(field, given[field])) prov[field] = given[field];
    else caveats.add(MISSING_CAVEAT[field]);
  }
  prov.manifest = "/api/manifest";
  prov.claims = "/claims.json";

  const envelope = {
    protocol: RESPONSE_PROTOCOL,
    status: caveats.size ? "partial" : "complete",
    kind,
    trust: trustFor(env),
    provenance: prov,
    resources: {
      schema: RESPONSE_SCHEMA_PATH,
      agent_entry: "/api/agent-entry",
      limitations: "/limitations.md",
      openapi: "/openapi.json",
    },
  };
  const profile = PROFILE_BY_KIND[kind];
  if (profile === "retrieval") envelope.retrieval = retrievalProfile(kind, retrieval);
  if (profile === "divergence") envelope.divergence = divergenceProfile(kind, divergence);
  if (profile === "participation") envelope.participation = { ...PARTICIPATION };
  if (profile === "authority") envelope.authority = { ...AUTHORITY };
  if (caveats.size) envelope.caveats = CAVEATS.filter((c) => caveats.has(c)); // stable order
  return envelope;
}

/**
 * attachEnvelope(payload, ctx): adds payload.omnarai_response and returns the payload. Fail-open:
 * an envelope bug never changes or blocks the response it rides on.
 */
export function attachEnvelope(payload, ctx) {
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    const env = buildResponseEnvelope(ctx);
    if (env) payload[RESPONSE_FIELD] = env;
  } catch (err) {
    console.error("omnarai_response: envelope skipped:", err?.message || err);
  }
  return payload;
}

// The compact description agent-entry publishes. Built from the constants above so it cannot drift.
export function envelopeSummary() {
  return {
    field: RESPONSE_FIELD,
    protocol: RESPONSE_PROTOCOL,
    schema: RESPONSE_SCHEMA_PATH,
    additive: "Optional top-level field on the reads below. Clients that ignore it behave exactly as before.",
    covers: ENVELOPE_COVERAGE.map((c) => c.route),
    not_covered: ENVELOPE_NOT_COVERED,
    status: "complete = every provenance value this kind of response is built from was available and well-formed; partial = some were not, and `caveats` names each one. Never a quality or truth score.",
    check_against: "Every provenance value is also published by /api/manifest; compare them to confirm what a response was built from.",
    does_not_prove: ENVELOPE_DOES_NOT_PROVE,
  };
}
