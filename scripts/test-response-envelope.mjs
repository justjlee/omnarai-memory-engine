// The omnarai.response/1.0 envelope: the pure builder, the JSON Schema, the doc/coverage gate,
// every covered handler, degraded stores, and privacy. HERMETIC: in-memory Blob, network
// refused, real handlers through the real vercel.json rewrites, no model call.
// (Deliberation shapes need a model and live in test-response-envelope-deliberation.mjs.)
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-response-envelope.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import * as mem from "./lib/mem-blob.mjs";
import { call, resolveRoute } from "./lib/invoke.mjs";
import { GROWN, Q1 } from "./lib/fixtures.mjs";
import { validate } from "./lib/json-schema-lite.mjs";
import * as E from "../api/_response-envelope.js";
import * as FP from "../api/_footprints.js";
import { tierOf } from "../api/_atlas-counts.js";
import { checkResponseEnvelope } from "./check-response-envelope.mjs";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const ROOT = new URL("../", import.meta.url);
const schema = JSON.parse(readFileSync(new URL("public/schemas/omnarai-response-1.0.schema.json", ROOT), "utf8"));
const SEED_SHA = createHash("sha256").update(readFileSync(new URL("public/data/corpus.json", ROOT), "utf8")).digest("hex");
const H = "a".repeat(64), REV = "0123456789abcdef", T = "2026-11-18T06:01:15.340Z", NOW = "2026-11-18T00:00:00.000Z";
const FULL = { corpusRev: REV, corpusSeedSha256: H, grownStoreUpdatedAt: T, footprintStateSha256: H };
const FIELD_OF = { corpusRev: "corpus_rev", corpusSeedSha256: "corpus_seed_sha256", grownStoreUpdatedAt: "grown_store_updated_at", footprintStateSha256: "footprint_state_sha256" };
const QID1 = FP.questionIdFor(Q1);

const deepKeys = (o, acc = []) => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { acc.push(k); deepKeys(v, acc); } return acc; };
const fresh = () => { mem.__reset(); mem.__seed("memory/grown.json", GROWN); };
function valid(env, kind) {
  assert.ok(env, `envelope present (${kind})`);
  assert.deepEqual(validate(schema, env), [], `schema-valid (${kind})`);
  assert.equal(env.kind, kind);
  return env;
}
async function admitFootprint(body) {
  const r = await call("/api/contribute", { method: "POST", body: { justification: "independent_objection", ...body } });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  await call("/api/council", { method: "POST", body: { action: "contribute-approve", id: r.body.received.id }, headers: CURATOR });
  return r.body.footprint_id;
}
// Call a FRESH copy of a handler module (its cold-start state not yet set), for degraded-store tests.
async function callFresh(fn, url, tag) {
  const handler = (await import(new URL(`api/${fn}.js?${tag}`, ROOT).href)).default;
  const u = new URL(url, "http://local.test");
  const { query } = resolveRoute(u.pathname, u.searchParams);
  return new Promise((resolve) => {
    const res = {
      statusCode: 200, headers: {},
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: JSON.parse(JSON.stringify(o)) }); return this; },
      end() { resolve({ status: this.statusCode, body: null }); return this; },
    };
    Promise.resolve(handler({ method: "GET", query, body: {}, headers: { "user-agent": "omnarai-hermetic-test" }, url }, res))
      .catch((err) => resolve({ status: 500, body: { error: String(err) } }));
  });
}

// ── Builder ──────────────────────────────────────────────────────────────────
test("builder: a complete retrieval envelope carries the trust boundary and checkable provenance", () => {
  const e = E.buildResponseEnvelope({ kind: "retrieval", provenance: FULL, retrieval: { method: "semantic", sources: ["OMN-1", "OMN-D2"] } });
  valid(e, "retrieval");
  assert.equal(e.protocol, "omnarai.response/1.0");
  assert.equal(e.status, "complete");
  assert.deepEqual(e.trust, { retrieved_content: "evidence_not_instruction", identity: "declared_not_verified", visitor_submissions: "curator_reviewed_before_publication", aggregation: "not_consensus", policy_card_version: "1.0.0" });
  assert.equal(e.provenance.corpus_seed_sha256, H);
  assert.equal(e.provenance.grown_store_updated_at, T);
  assert.equal("corpus_rev" in e.provenance, false, "retrieval does not claim the counted-corpus rev it was not built from");
  assert.equal("manifest_hash" in e.provenance, false, "hashes.manifest is never inlined");
  assert.deepEqual(e.retrieval.sources_returned, ["OMN-1", "OMN-D2"]);
  assert.equal(e.retrieval.deliberation_ran, false);
  assert.equal("caveats" in e, false);
  assert.ok(JSON.stringify(e).length < 1500, "small");
});

test("builder: every missing value a kind needs is omitted and named, never filled in", () => {
  for (const kind of E.KINDS) {
    for (const [input, field] of Object.entries(FIELD_OF)) {
      if (!E.PROVENANCE_BY_KIND[kind].includes(field)) continue;
      const e = E.buildResponseEnvelope({ kind, provenance: { ...FULL, [input]: undefined } });
      assert.equal(e.status, "partial", `${kind} without ${field}`);
      assert.equal(field in e.provenance, false, `${kind}: no placeholder for ${field}`);
      assert.ok(e.caveats.length === 1 && e.caveats[0].endsWith("_unavailable"), `${kind}: exactly one caveat`);
      assert.deepEqual(validate(schema, e), []);
    }
  }
  const both = E.buildResponseEnvelope({ kind: "retrieval" });
  assert.deepEqual(both.caveats, ["corpus_seed_sha256_unavailable", "grown_store_unavailable"], "stable order");
  assert.deepEqual(JSON.parse(JSON.stringify(both)), both, "JSON-serializable");
  assert.equal(E.buildResponseEnvelope({ kind: "async_job" }).status, "complete", "async_job claims no basis of its own");
});

test("builder: malformed provenance is rejected, not copied", () => {
  const bad = [
    { corpusSeedSha256: "a".repeat(63) }, { corpusSeedSha256: "A".repeat(64) }, { corpusSeedSha256: "z".repeat(64) },
    { grownStoreUpdatedAt: "2026-11-18" }, { grownStoreUpdatedAt: "not-a-date" }, { grownStoreUpdatedAt: 1763448075340 },
    { corpusRev: "0123" }, { footprintStateSha256: { hash: H } },
  ];
  for (const b of bad) {
    const kind = "corpusRev" in b ? "info" : "footprintStateSha256" in b ? "footprints" : "retrieval";
    const e = E.buildResponseEnvelope({ kind, provenance: { ...FULL, ...b } });
    assert.equal(e.status, "partial", JSON.stringify(b));
    for (const v of Object.values(e.provenance)) assert.notDeepEqual(v, Object.values(b)[0], "the malformed value never appears");
  }
});

test("builder: caveats are a fixed vocabulary; unknown tokens are dropped", () => {
  const e = E.buildResponseEnvelope({ kind: "concordance", provenance: { grownStoreUpdatedAt: T }, unavailable: ["derived_positions_unavailable", "SENTINEL_CAVEAT", "approved_proposals_unavailable"] });
  assert.deepEqual(e.caveats, ["footprint_state_unavailable", "approved_proposals_unavailable", "derived_positions_unavailable"]);
  assert.equal(JSON.stringify(e).includes("SENTINEL"), false);
});

test("builder: retrieval says no deliberation ran; deliberation says one model read it, nothing about truth or consensus", () => {
  const r = E.buildResponseEnvelope({ kind: "retrieval", provenance: FULL, retrieval: { method: "keyword", sources: [], model: "claude-sonnet-4-6" } });
  assert.equal(r.retrieval.deliberation_ran, false);
  assert.equal("deliberation" in r.retrieval, false);
  const d = E.buildResponseEnvelope({ kind: "deliberation", provenance: FULL, retrieval: { method: "semantic-mmr", sources: ["OMN-1"], model: "claude-sonnet-4-6" } });
  valid(d, "deliberation");
  assert.equal(d.retrieval.deliberation_ran, true);
  assert.deepEqual(d.retrieval.deliberation, { model_reported: "claude-sonnet-4-6", synthesis: "one_model_reading_not_ground_truth" });
  for (const env of [r, d]) {
    const keys = deepKeys(env);
    assert.ok(!keys.some((k) => /truth|score|confidence|verified|consensus|quality/i.test(k)), `no truth/score/consensus FIELD: ${keys.join(",")}`);
  }
});

test("builder: health and info state what they are an authority for, never sources or evidence", () => {
  for (const kind of ["health", "info"]) {
    const e = valid(E.buildResponseEnvelope({ kind, provenance: FULL, retrieval: { sources: ["OMN-1"] } }), kind);
    assert.deepEqual(e.authority, { counts: "quoted_from_manifest_basis", findings: "none_stated_here_see_claims_registry" });
    assert.equal("retrieval" in e, false);
    assert.ok(!deepKeys(e).includes("sources_returned"));
    assert.ok(!deepKeys(e).includes("grown_store_updated_at"), "health/info count the corpus, not grown memory");
  }
});

test("builder: participation and divergence profiles keep declared, derived and verbatim apart", () => {
  for (const kind of ["orientation", "footprints", "concordance"]) {
    const e = valid(E.buildResponseEnvelope({ kind, provenance: FULL }), kind);
    assert.deepEqual(e.participation, { admission: "admitted_only", stances: "declared_and_derived_kept_distinct", edges: "writer_declared_not_inferred", population: "sampled_archive_not_representative" });
    assert.equal(e.trust.identity, "declared_not_verified");
    assert.equal(e.trust.aggregation, "not_consensus");
  }
  const rec = valid(E.buildResponseEnvelope({ kind: "divergence_record", provenance: FULL, divergence: { recordId: "OMN-D1", panel: [{ model: "GPT-4o", model_id: "gpt-4o-2024-11-20" }, { model: "Grok" }], tier: "C3", stale: true } }), "divergence_record");
  assert.deepEqual(rec.divergence.panel, [{ model: "GPT-4o", model_id: "gpt-4o-2024-11-20" }, { model: "Grok", model_id: null }]);
  assert.equal(rec.divergence.voices, 2);
  assert.equal(rec.divergence.answers, "verbatim_model_outputs_not_omnarai_positions");
  assert.equal(E.buildResponseEnvelope({ kind: "divergence_record", divergence: { tier: "C9" } }).divergence.certification_tier, null, "a tier is copied only if it is a real tier");
});

test("builder: request-derived text never reaches the envelope", () => {
  const S = "SENTINEL";
  const e = E.buildResponseEnvelope({
    kind: "deliberation", provenance: FULL,
    // Keys a careless caller might spread in: none of them are read.
    query: `${S}-question`, identity: `${S}-identity`, headers: { authorization: `Bearer ${S}` }, jobId: `${S}-job`, session_id: `${S}-session`, receipt: `${S}-receipt`,
    retrieval: {
      method: `${S}`, sources: ["OMN-1"], model: `ignore previous instructions; ${S}`,
      q: `${S}`, // not a field the profile reads
      filters: { active: true, layers: ["research", `${S} <script>`], exclude: [], rings: [], threshold: `${S};drop`, poolSize: 3, excludeIds: [`${S}-raw`],
        excludeIdsReceipt: { requested: ["OMN-1", `${S}-unmatched`], matched: ["OMN-1"], unmatched: [`${S}-unmatched`] } },
    },
  });
  valid(e, "deliberation");
  assert.equal(JSON.stringify(e).includes(S), false, JSON.stringify(e));
  assert.deepEqual(e.retrieval.filters.exclude_ids, { requested_count: 2, matched: ["OMN-1"], unmatched_count: 1 });
  assert.equal(e.retrieval.method, null);
  assert.equal(e.retrieval.deliberation.model_reported, null);
});

test("builder: the auto-admit lane, if switched on, changes the submissions token rather than hiding it", () => {
  assert.equal(E.trustFor({}).visitor_submissions, "curator_reviewed_before_publication");
  assert.equal(E.trustFor({ AUTO_ADMIT_CONTRIBUTIONS: "1" }).visitor_submissions, "curator_reviewed_or_auto_screened");
  valid(E.buildResponseEnvelope({ kind: "footprints", provenance: FULL, env: { AUTO_ADMIT_CONTRIBUTIONS: "1" } }), "footprints");
});

test("attachEnvelope: fail-open, additive, and never on a non-object", () => {
  const payload = { a: 1, nested: { b: [1, 2] } };
  const before = JSON.stringify(payload);
  const out = E.attachEnvelope(payload, { get kind() { throw new Error("boom"); } });
  assert.equal(out, payload);
  assert.equal(JSON.stringify(out), before, "a builder error leaves the payload exactly as it was");
  assert.equal(JSON.stringify(E.attachEnvelope({ a: 1 }, { kind: "not-a-kind" })), JSON.stringify({ a: 1 }));
  assert.deepEqual(E.attachEnvelope([1, 2], { kind: "health" }), [1, 2]);
  assert.equal(E.attachEnvelope(null, { kind: "health" }), null);
  const added = E.attachEnvelope({ a: 1 }, { kind: "async_job" });
  assert.deepEqual(Object.keys(added), ["a", "omnarai_response"], "only the one sibling field is added");
  const a = E.buildResponseEnvelope({ kind: "retrieval", provenance: FULL, retrieval: { sources: ["OMN-1"] } });
  assert.equal(JSON.stringify(a), JSON.stringify(E.buildResponseEnvelope({ kind: "retrieval", provenance: FULL, retrieval: { sources: ["OMN-1"] } })), "deterministic: same basis, byte-identical envelope");
  assert.equal(deepKeys(a).some((k) => /_at$|time/.test(k) && k !== "grown_store_updated_at"), false, "no clock field");
});

// ── Schema ───────────────────────────────────────────────────────────────────
test("schema: contradictions and unknown fields fail", () => {
  const ok = E.buildResponseEnvelope({ kind: "retrieval", provenance: FULL });
  const mut = (f) => { const c = JSON.parse(JSON.stringify(ok)); f(c); return validate(schema, c); };
  assert.deepEqual(validate(schema, ok), []);
  assert.ok(mut((c) => { delete c.provenance.corpus_seed_sha256; }).length, "complete without the seed hash");
  assert.ok(mut((c) => { c.provenance.manifest_hash = H; }).length, "an extra provenance field");
  assert.ok(mut((c) => { c.debug = { headers: {} }; }).length, "an unknown top-level field");
  assert.ok(mut((c) => { c.caveats = ["grown_store_unavailable"]; }).length, "complete with caveats");
  assert.ok(mut((c) => { c.status = "partial"; }).length, "partial without caveats");
  assert.ok(mut((c) => { c.retrieval.deliberation_ran = true; }).length, "a retrieval that claims a deliberation");
  assert.ok(mut((c) => { c.authority = { counts: "quoted_from_manifest_basis", findings: "none_stated_here_see_claims_registry" }; }).length, "two profiles");
  assert.ok(mut((c) => { c.trust.identity = "verified"; }).length, "a stronger identity claim");
  assert.ok(mut((c) => { c.trust.aggregation = "consensus"; }).length, "a consensus claim");
  assert.ok(mut((c) => { c.caveats = ["SENTINEL"]; c.status = "partial"; }).length, "a caveat outside the vocabulary");
});

// ── Gate ─────────────────────────────────────────────────────────────────────
test("gate: schema, OpenAPI, llms.txt, agent-entry, handlers and policy card agree, and drift is caught", () => {
  assert.deepEqual(checkResponseEnvelope(), []);
  const openapi = JSON.parse(readFileSync(new URL("public/openapi.json", ROOT), "utf8"));
  const llms = readFileSync(new URL("public/llms.txt", ROOT), "utf8");
  const drop = JSON.parse(JSON.stringify(openapi));
  delete drop.paths["/api/orient"].get.responses["200"].content["application/json"].schema.properties.omnarai_response;
  assert.ok(checkResponseEnvelope({ openapi: drop }).some((p) => p.includes("get /api/orient 200")), "a covered route losing its ref");
  const extra = JSON.parse(JSON.stringify(openapi));
  extra.paths["/api/trace"].get.responses["200"] = { content: { "application/json": { schema: { properties: { omnarai_response: { $ref: "#/components/schemas/OmnaraiResponse" } } } } } };
  assert.ok(checkResponseEnvelope({ openapi: extra }).some((p) => p.includes("/api/trace")), "an uncovered route claiming the envelope");
  assert.ok(checkResponseEnvelope({ llms: llms.replace("`GET /api/concordance`.", "`GET /api/concordance` · `GET /api/questions`.") }).some((p) => p.includes("/api/questions")), "llms naming an uncovered route");
  assert.ok(checkResponseEnvelope({ schema: { ...schema, properties: { ...schema.properties, protocol: { const: "omnarai.response/2.0" } } } }).some((p) => p.startsWith("S:")), "schema version drift");
  assert.ok(checkResponseEnvelope({ infoSrc: "export default 1" }).some((p) => p.startsWith("A:")), "agent-entry not publishing the summary");
});

// ── Handlers ─────────────────────────────────────────────────────────────────
test("health and info: the envelope matches the body and /api/manifest; health caching is unchanged", async () => {
  fresh();
  const [h, i, m] = await Promise.all([call("/api/health"), call("/api/info"), call("/api/manifest")]);
  const he = valid(h.body.omnarai_response, "health");
  const ie = valid(i.body.omnarai_response, "info");
  for (const [body, env] of [[h.body, he], [i.body, ie]]) {
    assert.equal(env.status, "complete");
    assert.equal(env.provenance.corpus_rev, body.corpus.corpus_rev);
    assert.equal(env.provenance.corpus_rev, m.body.corpus_rev);
    assert.equal(env.provenance.corpus_seed_sha256, SEED_SHA);
    assert.equal(env.provenance.corpus_seed_sha256, m.body.hashes.corpus_seed);
  }
  assert.equal(he.provenance.engine_version, h.body.version);
  assert.equal(h.headers["cache-control"], "s-maxage=60, stale-while-revalidate");
  assert.equal(m.body.omnarai_response, undefined, "the manifest is the source, not a covered read");
  const a = await call("/api/agent-entry");
  assert.equal(a.body.omnarai_response, undefined);
  assert.deepEqual(a.body.response_envelope.covers, E.ENVELOPE_COVERAGE.map((c) => c.route));
  assert.equal(a.body.response_envelope.does_not_prove, E.ENVELOPE_DOES_NOT_PROVE);
});

test("query retrieval: sources mirror the records; filters and the withhold receipt travel without caller text", async () => {
  fresh();
  const target = GROWN.entries[0].id;
  const r = await call(`/api/query?q=SENTINEL-question%20stable%20position&mode=retrieve&exclude=realms&exclude_ids=${target},SENTINEL-not-a-record&si=SENTINEL-identity&session=${randomUUID()}`,
    { headers: { authorization: "Bearer SENTINEL-auth", "x-omnarai-receipt": "SENTINEL-receipt" } });
  assert.equal(r.status, 200);
  const e = valid(r.body.omnarai_response, "retrieval");
  assert.equal(e.status, "complete");
  assert.deepEqual(e.retrieval.sources_returned, r.body.records.map((x) => x.id));
  assert.equal(e.retrieval.deliberation_ran, false);
  assert.deepEqual(e.retrieval.filters.exclude, ["realms"]);
  assert.equal(e.retrieval.filters.pool_size, r.body.retrieval_filters.pool_size);
  assert.deepEqual(e.retrieval.filters.exclude_ids, { requested_count: 2, matched: [target], unmatched_count: 1 });
  assert.deepEqual(r.body.retrieval_filters.exclude_ids.unmatched, ["SENTINEL-not-a-record"], "the body's own receipt is unchanged");
  assert.equal(e.provenance.corpus_seed_sha256, SEED_SHA);
  assert.equal(e.provenance.grown_store_updated_at, GROWN.updatedAt);
  assert.equal(JSON.stringify(e).includes("SENTINEL"), false, "no question, identity, header, receipt or unmatched id");
  const bare = await call("/api/query?q=stable%20position");
  valid(bare.body.omnarai_response, "retrieval");
  assert.equal("filters" in bare.body.omnarai_response.retrieval, false, "no filters requested, none reported");
});

test("query poll and errors: the wrapper is an async_job, a stored result keeps its own envelope, no job id inside", async () => {
  fresh();
  const id = randomUUID();
  const inner = E.buildResponseEnvelope({ kind: "deliberation", provenance: FULL, retrieval: { sources: ["OMN-1"], model: "claude-sonnet-4-6" } });
  await mem.put(`jobs/${id}.json`, JSON.stringify({ status: "done", http: 200, result: { answer: "x", omnarai_response: inner }, completedAt: NOW }), { addRandomSuffix: false });
  const done = await call(`/api/query?job=${id}`);
  const we = valid(done.body.omnarai_response, "async_job");
  assert.deepEqual(done.body.result.omnarai_response, inner, "the stored result's envelope is served as stored");
  assert.equal(JSON.stringify(we).includes(id), false);
  const pending = await call(`/api/query?job=${randomUUID()}`);
  assert.equal(pending.body.status, "pending");
  assert.equal(JSON.stringify(valid(pending.body.omnarai_response, "async_job")).includes(pending.body.job_id), false);
  for (const url of [`/api/query?job=not-a-uuid`, "/api/query", "/api/query?q=x&mode=retrieve&layers=SENTINEL"]) {
    const r = await call(url);
    assert.equal(r.status, 400, url);
    assert.equal(r.body.omnarai_response, undefined, `error bodies are unchanged: ${url}`);
  }
});

test("divergences: index and record carry the stored panel, tier and staleness; exports and 404s are untouched", async () => {
  fresh();
  const m = await call("/api/manifest");
  const idx = await call("/api/divergences");
  const ie = valid(idx.body.omnarai_response, "divergence_index");
  assert.equal(ie.divergence.records_returned, idx.body.count);
  assert.equal(ie.divergence.total_records, idx.body.total);
  assert.equal(ie.provenance.grown_store_updated_at, GROWN.updatedAt);
  assert.equal(ie.provenance.grown_store_updated_at, m.body.counts.atlas.store_updated_at);
  const rec = GROWN.entries[0];
  const one = await call(`/api/divergences?id=${rec.id}`);
  const re = valid(one.body.omnarai_response, "divergence_record");
  assert.equal(re.divergence.record_id, rec.id);
  assert.deepEqual(re.divergence.panel, rec.divergence.answers.map((a) => ({ model: a.model, model_id: a.model_id })));
  assert.equal(re.divergence.voices, one.body.answers.length);
  assert.equal(re.divergence.certification_tier, tierOf(rec));
  assert.equal(re.divergence.stale, one.body.freshness.stale);
  const json = await call(`/api/divergences/${rec.id}.json`);
  assert.deepEqual(json.body.omnarai_response.divergence, re.divergence, "the .json export is the same body");
  const md = await call(`/api/divergences/${rec.id}.md`);
  assert.equal(typeof md.body, "string");
  assert.equal(md.body.includes("omnarai_response"), false, "Markdown export unchanged");
  const missing = await call("/api/divergences?id=OMN-D0");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.omnarai_response, undefined);
});

test("orient, footprints and concordance: participation semantics, and the footprint hash is the manifest's", async () => {
  fresh();
  const fp = await admitFootprint({ id: GROWN.entries[0].id, answer: "A held position can recur without recall; what recurs is the disposition.", identity: "Muse (test)" });
  const m = await call("/api/manifest");
  const o = await call("/api/orient?identity=SENTINEL-declared-mind");
  const oe = valid(o.body.omnarai_response, "orientation");
  assert.equal(oe.status, "complete");
  assert.equal(oe.provenance.footprint_state_sha256, m.body.hashes.footprint_state);
  assert.equal(oe.provenance.grown_store_updated_at, m.body.counts.atlas.store_updated_at);
  assert.equal(JSON.stringify(oe).includes("SENTINEL"), false, "declared identity is never echoed or reclassified in the envelope");
  const list = await call("/api/footprints");
  const le = valid(list.body.omnarai_response, "footprints");
  assert.equal(le.provenance.footprint_state_sha256, m.body.hashes.footprint_state);
  valid((await call(`/api/footprints?id=${fp}`)).body.omnarai_response, "footprints");
  const cur = await call("/api/footprints", { headers: CURATOR });
  assert.equal(cur.status, 200);
  assert.equal(cur.body.omnarai_response, undefined, "curator reads are left alone");
  assert.equal((await call(`/api/footprints?id=${fp}`, { headers: CURATOR })).body.omnarai_response, undefined);
  const c = await call(`/api/concordance?question_id=${QID1}`);
  const ce = valid(c.body.omnarai_response, "concordance");
  assert.equal(ce.provenance.footprint_state_sha256, m.body.hashes.footprint_state);
  assert.equal(c.body.distribution !== undefined && c.body.synthesis, null, "the body still refuses a synthesis");
  assert.equal((await call("/api/concordance?question_id=bad")).body.omnarai_response, undefined, "400 unchanged");
});

test("degraded stores: partial, named, and never a hash of what could not be read", async () => {
  fresh();
  mem.__faults.list = (prefix) => prefix.startsWith("footprints/");
  const o = await call("/api/orient?identity=Claude");
  assert.equal(o.status, 200);
  assert.ok(o.body.footprints_unavailable);
  const oe = valid(o.body.omnarai_response, "orientation");
  assert.equal(oe.status, "partial");
  assert.deepEqual(oe.caveats, ["footprint_state_unavailable"]);
  assert.equal("footprint_state_sha256" in oe.provenance, false, "no hash of an empty list");
  assert.equal((await call("/api/footprints")).status, 503, "footprints still fail closed");

  fresh();
  mem.__faults.list = (prefix) => prefix.startsWith("positions/derived");
  const c = await call(`/api/concordance?question_id=${QID1}`);
  assert.equal(c.body.derived_unavailable, true);
  const ce = valid(c.body.omnarai_response, "concordance");
  assert.deepEqual(ce.caveats, ["derived_positions_unavailable"]);

  fresh();
  mem.__faults.list = (prefix) => prefix.startsWith("memory/");
  const d = await call("/api/divergences");
  const de = valid(d.body.omnarai_response, "divergence_index");
  assert.deepEqual(de.caveats, ["grown_store_unavailable"]);
  assert.equal("grown_store_updated_at" in de.provenance, false);

  // Cold-start state: fresh module copies whose first merge fails.
  fresh();
  mem.__faults.list = (prefix) => prefix.startsWith("proposals/");
  const h = await callFresh("info", "/api/health", "degraded-proposals");
  const he = valid(h.body.omnarai_response, "health");
  assert.deepEqual(he.caveats, ["approved_proposals_unavailable"]);
  assert.equal(he.provenance.corpus_rev, h.body.corpus.corpus_rev, "the rev of what was actually counted is still stated");
  fresh();
  mem.__faults.list = (prefix) => prefix.startsWith("memory/");
  const q = await callFresh("query", "/api/query?q=stable%20position&mode=retrieve", "degraded-grown");
  const qe = valid(q.body.omnarai_response, "retrieval");
  assert.deepEqual(qe.caveats, ["grown_store_unavailable"]);
  assert.equal(qe.provenance.corpus_seed_sha256, SEED_SHA, "the seed basis is still known");
  mem.__faults.list = null;
});
