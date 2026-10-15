#!/usr/bin/env node
// check-claims-registry.mjs — the claims registry's integrity gate (registry 1.0.0+).
//
// Fails the deploy when public/claims.json
//   1. does not validate against public/schemas/claims-registry-1.0.0.schema.json;
//   2. breaks a rule the schema cannot express — version numbering, wording ==
//      last version, status == last status_history entry, an unbroken history
//      chain, a refuted claim that is still live, a precommitment whose SHA-256
//      no longer matches its falsifier text, a duplicate claim_id;
//   3. REWRITES anything already published. Against the baseline (by default the
//      live /claims.json, i.e. what the public has seen): no claim disappears,
//      versions[], status_history[] and precommitments[] only grow (published
//      entries byte-identical), published objection TEXT never changes, and
//      provenance never changes. Against a 0.x baseline (the migration itself):
//      every claim, wording, evidence level and objection text carries over and
//      legacy_status records the old status verbatim.
//
//   node scripts/check-claims-registry.mjs [--file public/claims.json]
//       [--baseline <url | file | git:<rev>>]   (default: live, falling back to git:origin/main)
//       [--no-baseline]
//
// Exit: 0 ok · 1 violations · 2 cannot read the registry or schema.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { validate } from "./lib/json-schema-lite.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TERMINAL = new Set(["confirmed", "refuted", "scoped", "superseded", "withdrawn"]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// ── Pure checks (exported for the tests) ─────────────────────────────────────
export function checkRegistry(reg, schema) {
  const problems = validate(schema, reg).map((e) => `schema ${e}`);
  const seen = new Set();
  for (const c of reg.claims || []) {
    const id = c.claim_id;
    if (seen.has(id)) problems.push(`${id}: duplicate claim_id`);
    seen.add(id);
    const v = c.versions || [];
    v.forEach((e, i) => { if (e.version !== i + 1) problems.push(`${id}: versions[${i}].version is ${e.version}, expected ${i + 1} (ascending from 1, no gaps)`); });
    if (v.length && c.version !== v.at(-1).version) problems.push(`${id}: version ${c.version} ≠ last versions[] entry ${v.at(-1).version}`);
    if (v.length && c.wording !== v.at(-1).wording) problems.push(`${id}: wording differs from the last versions[] entry — a wording change must append a version (R2.2)`);
    const h = c.status_history || [];
    if (h.length && h[0].from !== null) problems.push(`${id}: status_history must start with the registration (from: null)`);
    h.forEach((e, i) => { if (i > 0 && e.from !== h[i - 1].to) problems.push(`${id}: status_history[${i}] starts from ${e.from} but the previous entry ended at ${h[i - 1].to}`); });
    if (h.length && c.status !== h.at(-1).to) problems.push(`${id}: status ${c.status} ≠ last status_history entry (${h.at(-1).to})`);
    if (c.evidence_level === "refuted" && !TERMINAL.has(c.status)) problems.push(`${id}: evidence_level refuted but status "${c.status}" is live`);
    for (const p of c.precommitments || []) {
      if (p.sha256 !== sha256(p.falsifier_text)) problems.push(`${id}: precommitment frozen ${p.frozen_at} — SHA-256 does not match its falsifier text (altered after freezing?)`);
    }
  }
  return problems;
}

export function checkAgainstBaseline(reg, base) {
  const problems = [];
  const now = new Map((reg.claims || []).map((c) => [c.claim_id, c]));
  const objectionTexts = (c) => (c.known_objections || []).map((o) => (typeof o === "string" ? o : o.objection));
  const legacy = String(base.claims_registry_version || base.registry_version || "").startsWith("0.");
  for (const b of base.claims || []) {
    const id = b.claim_id;
    const c = now.get(id);
    if (!c) { problems.push(`${id}: published claim is missing — claims are never deleted (withdraw or supersede instead)`); continue; }
    const missing = (legacy && !Array.isArray(b.known_objections) ? [b.known_objections] : objectionTexts(b)).filter((t) => t != null && !objectionTexts(c).includes(t));
    for (const t of missing) problems.push(`${id}: published objection text changed or removed: "${String(t).slice(0, 80)}…"`);
    if (legacy) {
      if (c.wording !== b.wording) problems.push(`${id}: wording changed during migration`);
      if (c.evidence_level !== b.evidence_level) problems.push(`${id}: evidence_level changed during migration`);
      if (c.provenance?.legacy_status !== b.status) problems.push(`${id}: provenance.legacy_status must record the old status "${b.status}" verbatim`);
      continue;
    }
    for (const key of ["versions", "status_history", "precommitments"]) {
      const old = b[key] || [];
      const cur = c[key] || [];
      if (cur.length < old.length || !old.every((e, i) => same(e, cur[i]))) problems.push(`${id}: published ${key}[] entries were rewritten or removed — ${key} is append-only`);
    }
    if (!same(b.provenance, c.provenance)) problems.push(`${id}: provenance changed`);
  }
  return problems;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function loadBaseline(spec) {
  if (spec.startsWith("git:")) return JSON.parse(execFileSync("git", ["show", `${spec.slice(4)}:public/claims.json`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  if (/^https?:\/\//.test(spec)) {
    const r = await fetch(`${spec}${spec.includes("?") ? "&" : "?"}ts=${Date.now()}`, { headers: { "x-omnarai-self": "1" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  return JSON.parse(readFileSync(spec, "utf8"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const file = opt("--file", join(ROOT, "public/claims.json"));
  let reg, schema;
  try {
    reg = JSON.parse(readFileSync(file, "utf8"));
    schema = JSON.parse(readFileSync(join(ROOT, "public/schemas/claims-registry-1.0.0.schema.json"), "utf8"));
  } catch (e) { console.error(`check-claims-registry: cannot read registry/schema: ${e.message}`); process.exit(2); }
  const problems = checkRegistry(reg, schema);

  let baseNote = "no baseline (--no-baseline)";
  if (!args.includes("--no-baseline")) {
    const tries = opt("--baseline", null) ? [opt("--baseline")] : ["https://engine.omnarai.org/claims.json", "git:origin/main"];
    let base = null;
    for (const t of tries) { try { base = await loadBaseline(t); baseNote = `baseline ${t} (registry ${base.claims_registry_version || base.registry_version})`; break; } catch (e) { baseNote = `baseline unreadable (${t}: ${e.message})`; } }
    if (base) problems.push(...checkAgainstBaseline(reg, base));
    else console.warn(`⚠️  check-claims-registry: ${baseNote} — append-only check SKIPPED, schema and rules still checked`);
  }

  const live = (reg.claims || []).filter((c) => reg._statuses?.[c.status]?.live).length;
  if (problems.length) {
    console.error(`🔴 check-claims-registry: ${problems.length} problem(s) in ${reg.claims?.length ?? 0} claim(s) — ${baseNote}`);
    for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
    process.exit(1);
  }
  const appendOnly = baseNote.startsWith("baseline ") ? `${baseNote}: nothing published was rewritten` : `${baseNote} — append-only NOT checked`;
  console.log(`🟢 check-claims-registry: registry ${reg.claims_registry_version}, ${reg.claims.length} claims (${live} live, ${reg.claims.length - live} dead) — schema valid, histories consistent, ${appendOnly}`);
}
