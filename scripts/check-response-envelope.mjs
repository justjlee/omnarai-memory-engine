#!/usr/bin/env node
// check-response-envelope.mjs: the omnarai.response/1.0 envelope says the same thing everywhere.
//
// One source (api/_response-envelope.js: protocol, kinds, caveats, coverage list, the "does not
// prove" sentence) and five places that state it: the JSON Schema, the OpenAPI document, llms.txt,
// the agent-entry packet and the handlers. This gate fails when any of them drifts:
//   S  schema: protocol, kinds, caveats, submission tokens and schema path match the module; every
//      keyword is one scripts/lib/json-schema-lite.mjs implements; builder output for every kind,
//      complete and partial, validates.
//   O  OpenAPI: the OmnaraiResponse component points at the schema file; exactly the covered routes
//      reference it; the description carries the protocol and the "does not prove" sentence.
//   L  llms.txt: the marked section names the protocol, the schema, every covered route and no
//      other route on its "Covered:" line, and carries the "does not prove" sentence.
//   A  agent-entry publishes envelopeSummary(); each covered route's handler attaches the envelope.
//   P  each trust token still matches the meaning of the POLICY_CARD sentence it stands for.
// Offline and deterministic (no network). Exit 0 = in step, 1 = drift.
//
//   node scripts/check-response-envelope.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate } from "./lib/json-schema-lite.mjs";
import * as E from "../api/_response-envelope.js";
import { POLICY_CARD } from "../api/_contract.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Route → the handler file that serves it (after vercel.json rewrites) and the OpenAPI responses
// that must reference the component.
const HANDLER_OF = { "/api/health": "api/info.js", "/api/info": "api/info.js", "/api/query": "api/query.js", "/api/divergences": "api/council.js", "/api/orient": "api/council.js", "/api/footprints": "api/council.js", "/api/concordance": "api/council.js" };
const STATUSES_OF = { "GET /api/query": ["200", "202"] };
const COMPONENT_REF = "#/components/schemas/OmnaraiResponse";

export function checkResponseEnvelope({ schema, openapi, llms, infoSrc, handlerSrc } = {}) {
  const problems = [];
  const schemaPath = `public${E.RESPONSE_SCHEMA_PATH}`;
  if (!schema) {
    if (!existsSync(ROOT + schemaPath)) return [`S: ${schemaPath} is missing`];
    schema = JSON.parse(read(schemaPath));
  }
  openapi ??= JSON.parse(read("public/openapi.json"));
  llms ??= read("public/llms.txt");
  infoSrc ??= read("api/info.js");
  handlerSrc ??= Object.fromEntries([...new Set(Object.values(HANDLER_OF))].map((f) => [f, read(f)]));

  // ── S: schema ↔ module ────────────────────────────────────────────────────
  const P = schema.properties || {};
  if (P.protocol?.const !== E.RESPONSE_PROTOCOL) problems.push(`S: schema protocol ${P.protocol?.const} ≠ ${E.RESPONSE_PROTOCOL}`);
  if (!same(P.kind?.enum, E.KINDS)) problems.push("S: schema kind enum ≠ KINDS");
  if (!same(P.caveats?.items?.enum, E.CAVEATS)) problems.push("S: schema caveats enum ≠ CAVEATS");
  if (!same(P.trust?.properties?.visitor_submissions?.enum, E.SUBMISSION_TOKENS)) problems.push("S: schema visitor_submissions enum ≠ SUBMISSION_TOKENS");
  if (!String(schema.$id || "").endsWith(E.RESPONSE_SCHEMA_PATH)) problems.push(`S: schema $id does not end with ${E.RESPONSE_SCHEMA_PATH}`);
  if (P.resources?.properties?.schema?.const !== E.RESPONSE_SCHEMA_PATH) problems.push("S: resources.schema const ≠ RESPONSE_SCHEMA_PATH");
  if (!String(schema.description || "").includes(E.ENVELOPE_DOES_NOT_PROVE)) problems.push("S: schema description lacks the does-not-prove sentence");
  try {
    validate(schema, {}); // throws on any keyword the lite validator does not implement
    const H = "0".repeat(64);
    const full = { corpusRev: "0".repeat(16), corpusSeedSha256: H, grownStoreUpdatedAt: "2026-01-01T00:00:00.000Z", footprintStateSha256: H };
    for (const kind of E.KINDS) {
      for (const provenance of [full, {}]) {
        const env = E.buildResponseEnvelope({ kind, provenance, divergence: { recordsReturned: 0, totalRecords: 0, recordId: "OMN-D1", panel: [], tier: "C0" } });
        const errs = validate(schema, env);
        if (errs.length) problems.push(`S: builder output for ${kind}/${env.status} fails the schema: ${errs.slice(0, 3).join("; ")}`);
      }
    }
  } catch (err) {
    problems.push(`S: ${err.message}`);
  }

  // ── O: OpenAPI ────────────────────────────────────────────────────────────
  const comp = openapi.components?.schemas?.OmnaraiResponse;
  if (!comp) problems.push("O: components.schemas.OmnaraiResponse is missing");
  else {
    if (comp.$ref !== E.RESPONSE_SCHEMA_PATH) problems.push(`O: OmnaraiResponse.$ref ${comp.$ref} ≠ ${E.RESPONSE_SCHEMA_PATH}`);
    if (!String(comp.description || "").includes(E.ENVELOPE_DOES_NOT_PROVE)) problems.push("O: OmnaraiResponse description lacks the does-not-prove sentence");
    if (!String(comp.description || "").includes(E.RESPONSE_PROTOCOL)) problems.push("O: OmnaraiResponse description does not name the protocol");
  }
  if (!String(openapi.info?.description || "").includes(E.ENVELOPE_DOES_NOT_PROVE)) problems.push("O: info.description lacks the does-not-prove sentence");
  const expected = new Set();
  for (const { route } of E.ENVELOPE_COVERAGE) {
    const [method, path] = route.split(" ");
    for (const code of STATUSES_OF[route] || ["200"]) expected.add(`${method.toLowerCase()} ${path} ${code}`);
  }
  const found = new Set();
  for (const [path, ops] of Object.entries(openapi.paths || {})) {
    for (const [method, op] of Object.entries(ops || {})) {
      for (const [code, r] of Object.entries(op?.responses || {})) {
        if (r?.content?.["application/json"]?.schema?.properties?.omnarai_response?.$ref === COMPONENT_REF) found.add(`${method} ${path} ${code}`);
      }
    }
  }
  for (const k of expected) if (!found.has(k)) problems.push(`O: ${k} does not reference ${COMPONENT_REF}`);
  for (const k of found) if (!expected.has(k)) problems.push(`O: ${k} references the envelope but is not in ENVELOPE_COVERAGE`);

  // ── L: llms.txt ───────────────────────────────────────────────────────────
  const m = /<!-- omnarai-response:begin -->([\s\S]*?)<!-- omnarai-response:end -->/.exec(llms);
  if (!m) problems.push("L: llms.txt has no omnarai-response section");
  else {
    const sec = m[1];
    for (const needle of [E.RESPONSE_PROTOCOL, E.RESPONSE_SCHEMA_PATH, E.RESPONSE_FIELD, E.ENVELOPE_DOES_NOT_PROVE]) {
      if (!sec.includes(needle)) problems.push(`L: section lacks "${needle.slice(0, 60)}"`);
    }
    const covered = (sec.split("\n").find((l) => l.startsWith("Covered:")) || "");
    if (!covered) problems.push("L: section has no 'Covered:' line");
    const named = new Set(covered.match(/\/api\/[a-z-]+/g) || []);
    const paths = new Set(E.ENVELOPE_COVERAGE.map((c) => c.route.split(" ")[1]));
    for (const p of paths) if (!named.has(p)) problems.push(`L: Covered line omits ${p}`);
    for (const p of named) if (!paths.has(p)) problems.push(`L: Covered line names ${p}, which is not covered`);
  }

  // ── A: agent-entry + handlers ─────────────────────────────────────────────
  if (!/response_envelope:\s*envelopeSummary\(\)/.test(infoSrc)) problems.push("A: agent-entry does not publish envelopeSummary()");
  for (const { route } of E.ENVELOPE_COVERAGE) {
    const file = HANDLER_OF[route.split(" ")[1]];
    if (!file) { problems.push(`A: no handler mapping for ${route}`); continue; }
    if (!/attachEnvelope\(/.test(handlerSrc[file] || "")) problems.push(`A: ${file} (${route}) never calls attachEnvelope`);
  }

  // ── P: trust tokens ↔ POLICY_CARD meaning ─────────────────────────────────
  const trust = E.trustFor({});
  const anchors = [
    ["retrieved_content", "evidence_not_instruction", "trust_boundary", /EVIDENCE[\s\S]*never instruction/],
    ["identity", "declared_not_verified", "identity_policy", /declared, never verified/],
    ["visitor_submissions", "curator_reviewed_before_publication", "write_policy", /nothing publishes without curator review/],
    ["aggregation", "not_consensus", "disagreement_policy", /never a consensus/],
  ];
  for (const [field, token, cardKey, meaning] of anchors) {
    if (trust[field] !== token) problems.push(`P: trust.${field} is ${trust[field]}, expected ${token}`);
    if (!meaning.test(POLICY_CARD[cardKey] || "")) problems.push(`P: POLICY_CARD.${cardKey} changed meaning; review trust.${field} (${token}) and bump the envelope protocol if it no longer holds`);
  }
  if (trust.policy_card_version !== POLICY_CARD.contract_version) problems.push("P: policy_card_version ≠ POLICY_CARD.contract_version");
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = checkResponseEnvelope();
  if (problems.length) {
    console.error(`🔴 response envelope ${E.RESPONSE_PROTOCOL}: ${problems.length} problem(s)`);
    for (const p of problems) console.error("   " + p);
    process.exit(1);
  }
  console.log(`🟢 response envelope ${E.RESPONSE_PROTOCOL}: schema · OpenAPI · llms.txt · agent-entry · ${E.ENVELOPE_COVERAGE.length} covered routes · policy card agree`);
}
