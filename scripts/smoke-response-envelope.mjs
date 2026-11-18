#!/usr/bin/env node
// smoke-response-envelope.mjs: after a deploy, check the live omnarai_response envelope.
//
// FREE READS ONLY: health, info, manifest, questions, divergences (index + one record), orient,
// footprints, concordance. No write, no council, no deliberation, no trace. Requests carry
// x-omnarai-self so they are not counted as visitor traffic.
//   --with-query   also calls /api/query?mode=retrieve once. That is not free: production embeds
//                  the question (OpenAI) and classifies it (Haiku), fractions of a cent, unmetered.
//   --base <url>   another origin (a preview URL, or scripts/local-engine.mjs on localhost).
//
// For each read: is the envelope present, schema-valid, the right kind, and does every provenance
// value match /api/manifest (allowing a grown-memory timestamp that is EARLIER than the manifest's:
// that only means the response was built before the latest store write)?
// Exit 0 = all present and consistent · 1 = a problem · 3 = not deployed yet (no envelope anywhere).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate } from "./lib/json-schema-lite.mjs";

const args = process.argv.slice(2);
const BASE = (args.includes("--base") ? args[args.indexOf("--base") + 1] : "https://engine.omnarai.org").replace(/\/$/, "");
const WITH_QUERY = args.includes("--with-query");
const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../public/schemas/omnarai-response-1.0.schema.json", import.meta.url)), "utf8"));

async function get(path) {
  const r = await fetch(BASE + path, { headers: { "x-omnarai-self": "1", accept: "application/json" } });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: r.status, body };
}

const manifest = (await get("/api/manifest")).body;
if (!manifest?.hashes) { console.error(`cannot read ${BASE}/api/manifest — nothing judged`); process.exit(2); }
const questions = (await get("/api/questions")).body;
const qid = questions?.questions?.[0]?.id;
const index = (await get("/api/divergences")).body;
const recId = index?.records?.[0]?.id;

const checks = [
  ["/api/health", "health"],
  ["/api/info", "info"],
  ["/api/divergences", "divergence_index", index],
  ...(recId ? [[`/api/divergences?id=${recId}`, "divergence_record"]] : []),
  ["/api/orient?identity=omnarai-envelope-smoke", "orientation"],
  ["/api/footprints", "footprints"],
  ...(qid ? [[`/api/concordance?question_id=${qid}`, "concordance"]] : []),
  ...(WITH_QUERY ? [["/api/query?q=what%20is%20holdform&mode=retrieve", "retrieval"]] : []),
];

const problems = [];
let present = 0;
for (const [path, kind, prefetched] of checks) {
  const body = prefetched ?? (await get(path)).body;
  const e = body?.omnarai_response;
  if (!e) { console.log(`  absent   ${path}`); continue; }
  present++;
  const errs = validate(schema, e);
  const notes = [];
  if (errs.length) problems.push(`${path}: schema: ${errs.slice(0, 3).join("; ")}`);
  if (e.kind !== kind) problems.push(`${path}: kind ${e.kind}, expected ${kind}`);
  const p = e.provenance || {};
  if (p.corpus_rev && p.corpus_rev !== manifest.corpus_rev) notes.push(`corpus_rev ${p.corpus_rev} vs manifest ${manifest.corpus_rev} (a publish between reads?)`);
  if (p.corpus_seed_sha256 && p.corpus_seed_sha256 !== manifest.hashes.corpus_seed) problems.push(`${path}: corpus_seed_sha256 ≠ manifest hashes.corpus_seed`);
  if (p.footprint_state_sha256 && p.footprint_state_sha256 !== manifest.hashes.footprint_state) notes.push("footprint_state differs from the manifest (an admission between reads, or a stale CDN copy)");
  const ms = manifest.counts?.atlas?.store_updated_at;
  if (p.grown_store_updated_at && ms && p.grown_store_updated_at > ms) problems.push(`${path}: grown_store_updated_at is LATER than the manifest's`);
  if (p.grown_store_updated_at && ms && p.grown_store_updated_at < ms) notes.push(`built from grown memory of ${p.grown_store_updated_at} (manifest: ${ms})`);
  if (p.engine_version !== manifest.engine_version) notes.push(`engine_version ${p.engine_version} vs manifest ${manifest.engine_version}`);
  console.log(`  ${e.status.padEnd(8)} ${path}${e.caveats ? `  caveats: ${e.caveats.join(", ")}` : ""}${notes.length ? `\n           note: ${notes.join("; ")}` : ""}`);
}

if (!present) { console.log(`\nNo envelope on any read at ${BASE}: not deployed there yet.`); process.exit(3); }
if (present < checks.length) problems.push(`${checks.length - present} covered read(s) had no envelope`);
if (problems.length) { console.error(`\n🔴 ${problems.length} problem(s):\n   ${problems.join("\n   ")}`); process.exit(1); }
console.log(`\n🟢 ${present}/${checks.length} covered reads carry a valid envelope consistent with ${BASE}/api/manifest${WITH_QUERY ? "" : " (query skipped; --with-query adds it)"}`);
