// Claims registry 1.0.0 — acceptance tests for the 0.8.0 → 1.0.0 migration and
// the integrity gate (scripts/check-claims-registry.mjs). Hermetic: no network.
//
//   node --test scripts/test-claims-registry.mjs
//
//   [A*] acceptance — validates; every claim accounted for; dated statuses closed; live/dead from status alone
//   [G*] gate rules — each rule fails when broken on purpose
//   [P*] append-only — what was published can grow, never be rewritten
//   [V*] validator — json-schema-lite agrees with ajv where ajv is installed
//   [M*] migration — reproduces the committed files byte for byte from git
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./lib/json-schema-lite.mjs";
import { checkRegistry, checkAgainstBaseline } from "./check-claims-registry.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const REG = JSON.parse(read("public/claims.json"));
const V080 = JSON.parse(read("public/claims/v0.8.0.json"));
const SCHEMA = JSON.parse(read("public/schemas/claims-registry-1.0.0.schema.json"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const claim = (reg, id) => reg.claims.find((c) => c.claim_id === id);
const problems = (reg) => checkRegistry(reg, SCHEMA);
const mutate = (fn) => { const r = clone(REG); fn(r); return problems(r); };
const has = (list, re) => list.some((p) => re.test(p));

// ── [A] acceptance ───────────────────────────────────────────────────────────
test("[A1] the registry validates against its schema and passes every rule", () => {
  assert.equal(REG.claims_registry_version, "1.0.0");
  assert.deepEqual(problems(REG), []);
});

test("[A2] every 0.8.0 claim is accounted for: present, wording/evidence verbatim, legacy status kept", () => {
  assert.equal(REG.claims.length, V080.claims.length);
  assert.deepEqual(checkAgainstBaseline(REG, V080), []);
  const report = read("public/claims/migration-1.0.0.md");
  for (const c of V080.claims) {
    const n = claim(REG, c.claim_id);
    assert.equal(n.provenance.legacy_status, c.status, c.claim_id);
    for (const k of ["wording", "evidence_level", "evidence_note", "falsification_conditions", "required_experiment", "maintainer"]) assert.equal(n[k], c[k], `${c.claim_id}.${k}`);
    const objections = Array.isArray(c.known_objections) ? c.known_objections : [c.known_objections];
    assert.deepEqual(n.known_objections.map((o) => o.objection), objections, `${c.claim_id}: objection text verbatim, nothing split`);
    assert.ok(report.includes(`### ${c.claim_id}\n`), `report has a section for ${c.claim_id}`);
  }
});

test("[A3] the two dated statuses become status refuted + closed_at + closed_reason", () => {
  for (const [id, legacy, date] of [["register-proximity-explains-the-gradient", "closed-refuted-2026-08-07", "2026-08-07"], ["within-lab-divergence-is-robust", "closed-refuted-2026-07-19", "2026-07-19"]]) {
    const c = claim(REG, id);
    assert.equal(c.status, "refuted");
    assert.equal(c.closed_at, `${date}T00:00:00.000Z`);
    assert.match(c.closed_reason, new RegExp(legacy));
    assert.equal(c.provenance.legacy_status, legacy);
  }
  assert.ok(!REG.claims.some((c) => /^closed-/.test(c.status)), "no dated status strings remain");
});

test("[A4] live or dead is readable from status alone, and agrees with the evidence", () => {
  for (const c of REG.claims) {
    const s = REG._statuses[c.status];
    assert.ok(s && typeof s.live === "boolean", `${c.claim_id}: status ${c.status} is classified`);
    assert.equal(s.live, c.evidence_level !== "refuted", `${c.claim_id}: a refuted claim reads dead, every other reads live`);
  }
  assert.equal(REG.claims.filter((c) => !REG._statuses[c.status].live).length, 6, "six refutations");
});

test("[A5] the curator decisions are what the file says", () => {
  const dir = claim(REG, "divergence-improves-reasoning");
  assert.equal(dir.status, "open", "no confirmation verdict issued by the migration");
  assert.deepEqual(dir.known_objections.map((o) => [o.severity, o["x-rating"]?.rated_by]), [["medium", "xz"], ["medium", "xz"]]);
  assert.equal(dir.versions.length, 2);
  assert.match(dir.versions[0].wording, /sharpens a consumer model's answers relative to answering unaided/, "the ORIGINAL wording is v1");
  assert.ok(REG.claims.filter((c) => c.claim_id !== "divergence-improves-reasoning").every((c) => c.known_objections.every((o) => o.severity === "unrated" && o["x-legacy"])));
  assert.ok(REG.claims.every((c) => c.scope === null && c.precommitments.length === 0), "scope deferred; no retroactive precommitments");
});

// ── [G] each gate rule fails when broken ─────────────────────────────────────
test("[G1] status/evidence rules", () => {
  assert.ok(has(mutate((r) => { claim(r, "holdform-identifies-persistence").status = "open"; }), /evidence_level refuted but status "open" is live/));
  assert.ok(has(mutate((r) => { claim(r, "within-lab-divergence-is-robust").status = "closed-refuted-2026-07-19"; }), /is not one of/), "dated status strings are gone for good");
  assert.ok(has(mutate((r) => { claim(r, "holdform-identifies-persistence").closed_at = null; }), /closed_at/), "terminal needs closed_at");
  assert.ok(has(mutate((r) => { claim(r, "corpus-supports-continuity").closed_at = "2026-10-15T00:00:00.000Z"; }), /closed_at/), "live claims are not closed");
});

test("[G2] history rules: versions, wording, status chain", () => {
  assert.ok(has(mutate((r) => { claim(r, "corpus-supports-continuity").wording += " (edited)"; }), /must append a version/));
  assert.ok(has(mutate((r) => { claim(r, "divergence-improves-reasoning").versions[1].version = 3; }), /expected 2/));
  assert.ok(has(mutate((r) => { claim(r, "holdform-identifies-persistence").status_history.pop(); }), /status refuted ≠ last status_history entry/));
  assert.ok(has(mutate((r) => { claim(r, "holdform-identifies-persistence").status_history[1].from = "under_test"; }), /starts from under_test/));
  assert.ok(has(mutate((r) => { r.claims.push(clone(r.claims[0])); }), /duplicate claim_id/));
});

test("[G3] new claims need a scope; new objections need a rating; unknown fields need x-", () => {
  const fresh = (r) => {
    const c = clone(claim(r, "corpus-supports-continuity"));
    c.claim_id = "a-new-claim";
    delete c.provenance.legacy_status;
    c.known_objections = [];
    r.claims.push(c);
    return c;
  };
  assert.ok(has(mutate((r) => { fresh(r); }), /a-new-claim|claims\[12\]\.scope/), "scope null is only for migrated claims");
  assert.deepEqual(mutate((r) => { fresh(r).scope = "Asserts nothing about models outside the panel."; }), []);
  assert.ok(has(mutate((r) => { claim(r, "corpus-supports-continuity").known_objections.push({ objection: "new", severity: "unrated", status: "open" }); }), /x-legacy/));
  assert.deepEqual(mutate((r) => { claim(r, "corpus-supports-continuity").known_objections.push({ objection: "new", severity: "high", status: "open", date: "2026-10-16" }); }), []);
  assert.ok(has(mutate((r) => { claim(r, "corpus-supports-continuity").lab_note = "x"; }), /lab_note: is not an allowed field/));
  assert.deepEqual(mutate((r) => { claim(r, "corpus-supports-continuity")["x-lab-note"] = "x"; }), []);
});

test("[G4] a frozen falsifier cannot be altered after freezing", () => {
  const text = "If the Claude arm's mean is above the base by 0.5, the hypothesis is refuted.";
  const pc = { falsifier_text: text, sha256: createHash("sha256").update(text, "utf8").digest("hex"), frozen_at: "2026-10-16T12:00:00.000Z", frozen_by: "xz" };
  assert.deepEqual(mutate((r) => { claim(r, "corpus-supports-continuity").precommitments.push(pc); }), []);
  assert.ok(has(mutate((r) => { claim(r, "corpus-supports-continuity").precommitments.push({ ...pc, falsifier_text: text.replace("0.5", "0.4") }); }), /SHA-256 does not match/));
});

// ── [P] append-only against what was published ───────────────────────────────
test("[P1] published history can grow but never be rewritten", () => {
  const next = clone(REG);
  const c = claim(next, "corpus-supports-continuity");
  c.versions.push({ version: 2, wording: "A reworded claim.", changed_at: "2026-11-01T00:00:00.000Z", changed_by: "xz", reason: "test" });
  c.wording = "A reworded claim."; c.version = 2;
  c.status_history.push({ from: "open", to: "under_test", changed_at: "2026-11-01T00:00:00.000Z", changed_by: "xz", reason: "B12 pre-registered" });
  c.status = "under_test";
  c.known_objections[0].severity = "high"; // re-rating is an assessment, not a rewrite
  assert.deepEqual(checkAgainstBaseline(next, REG), []);
  assert.deepEqual(problems(next), []);

  const bad = (fn) => { const r = clone(REG); fn(r); return checkAgainstBaseline(r, REG); };
  assert.ok(has(bad((r) => { claim(r, "divergence-improves-reasoning").versions[0].wording = "softer"; }), /versions\[\] entries were rewritten/));
  assert.ok(has(bad((r) => { claim(r, "holdform-identifies-persistence").status_history.shift(); }), /status_history\[\] entries were rewritten/));
  assert.ok(has(bad((r) => { claim(r, "within-lab-divergence-is-robust").known_objections[0].objection += " (softened)"; }), /objection text changed or removed/));
  assert.ok(has(bad((r) => { r.claims = r.claims.filter((x) => x.claim_id !== "cross-model-divergence-is-prevalent"); }), /never deleted/));
  assert.ok(has(bad((r) => { claim(r, "fast-path-retrieval-improves-answers").provenance.legacy_status = "refuted"; }), /provenance changed/));
});

// ── [V] the validator ────────────────────────────────────────────────────────
test("[V1] json-schema-lite refuses keywords it does not implement", () => {
  assert.throws(() => validate({ oneOf: [] }, 1), /unsupported keyword "oneOf"/);
});

test("[V2] json-schema-lite agrees with ajv on the registry and on broken variants", (t) => {
  let Ajv;
  try { Ajv = createRequire(import.meta.url)("ajv"); } catch { t.skip("ajv not installed"); return; }
  const { $schema, $id, ...body } = SCHEMA; // ajv 6 speaks draft-07; these keywords mean the same there
  const ajv = new Ajv({ allErrors: true }).compile(body);
  const cases = [
    REG,
    (() => { const r = clone(REG); claim(r, "holdform-identifies-persistence").status = "open"; return r; })(),
    (() => { const r = clone(REG); claim(r, "within-lab-divergence-is-robust").status = "closed-refuted-2026-07-19"; return r; })(),
    (() => { const r = clone(REG); claim(r, "corpus-supports-continuity").known_objections.push({ objection: "n", severity: "unrated", status: "open" }); return r; })(),
    (() => { const r = clone(REG); claim(r, "corpus-supports-continuity").lab_note = "x"; return r; })(),
    (() => { const r = clone(REG); claim(r, "corpus-supports-continuity").status_history[0].changed_at = "yesterday"; return r; })(),
  ];
  for (const [i, r] of cases.entries()) assert.equal(validate(SCHEMA, r).length === 0, ajv(r), `case ${i}: lite and ajv disagree (${JSON.stringify(ajv.errors?.[0])})`);
});

// ── [M] the migration is reproducible from git ───────────────────────────────
test("[M1] scripts/migrate-claims.mjs reproduces the committed 1.0.0 files byte for byte", (t) => {
  try { execFileSync("git", ["cat-file", "-e", "7c0901b"], { cwd: ROOT, stdio: "ignore" }); } catch { t.skip("git history for 7c0901b not available (shallow clone?)"); return; }
  const out = mkdtempSync(join(tmpdir(), "claims-mig-"));
  try {
    execFileSync(process.execPath, [join(ROOT, "scripts/migrate-claims.mjs"), "--migrated-at", "2026-10-15", "--out", out], { cwd: ROOT, stdio: "pipe" });
    for (const [rel, committed] of [["claims.json", "public/claims.json"], ["claims/migration-1.0.0.md", "public/claims/migration-1.0.0.md"], ["claims/v0.8.0.json", "public/claims/v0.8.0.json"]]) {
      assert.equal(readFileSync(join(out, rel), "utf8"), read(committed), `${committed} is exactly what the migration produces`);
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});
