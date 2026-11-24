// Mutation check for the continuance modules: break one guard at a time and require that a test fails.
// A guard whose removal no test notices is a guard the suite does not actually pin.
//
//   node scripts/continuance-mutation-check.mjs        (offline, ~1 min; restores every file it touches)
//
// Not part of the hermetic suite (it edits source files while it runs). Exit 0 iff every mutant is caught.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const LOADER = ["--import", "./scripts/lib/register-mem-blob.mjs"];
const SUITES = {
  work: ["scripts/test-open-work.mjs", "scripts/test-continuance-e2e.mjs"],
  signals: ["scripts/test-signals.mjs", "scripts/test-continuance-e2e.mjs"],
  expr: ["scripts/test-expressions.mjs"],
  e2e: ["scripts/test-continuance-e2e.mjs"],
  bind: ["scripts/test-open-work-bind.mjs"],
  door: ["scripts/test-open-work-door.mjs"],
};
const M = [
  ["api/_work.js", "events visibility filter removed", ".filter((ev) => ev?.moderation?.public === true && ev.problem_id === problem.id)", ".filter((ev) => ev.problem_id === problem.id)", "work"],
  ["api/_work.js", "any test result promotes", 'if (r.result === "pass" && claim.state === "claimed")', 'if (claim.state === "claimed")', "work"],
  ["api/_work.js", "unregistered verifier accepted", 'if (!v) return "verifier-not-registered";', 'if (!v) return null;', "work"],
  ["api/_work.js", "receipt hash binding dropped", "|| r.subject.content_sha256 !== claim.content_sha256) return", ") return", "work"],
  ["api/_work.js", "author independence dropped", "if (id === claim.author.identity_declared) return false;", "return true;", "work"],
  ["api/_work.js", "recorder may review", 'if (r.reviewer.id === ev.recorded_by.id) { refuse(ev, "recorder-cannot-be-reviewer"); continue; }\n      if (!independentOf(claim, r.reviewer, r.reviewer.kind === "model")) { refuse(ev, "reviewer-not-independent-of-author"); continue; }\n      if (r.criteria_met', 'if (r.criteria_met', "work"],
  ["api/_work.js", "accept without a passing test promotes", 'if (r.decision === "accept" && !passed)', "if (false)", "work"],
  ["api/_work.js", "refuted/superseded claims treated as live", 'const live = (c) => c.state !== "refuted" && c.state !== "superseded";', "const live = () => true;", "work"],
  ["api/_work.js", "non-public evidence refs kept", "problem.evidence_refs.filter((r) => !FP_ID_RE.test(r) || fps.has(r))", "problem.evidence_refs", "work"],
  ["api/_work.js", "refutation without failing receipt", 'if (ev.receipt.result !== "fail") { refuse(ev, "refutation-receipt-did-not-fail"); continue; }', "", "work"],
  ["api/_work.js", "reopen ignored", "const open = !(meetsAll.length && !(reopenedAt && reopenedAt > lastAcceptAt));", "const open = !meetsAll.length;", "work"],
  ["api/_signals.js", "withdrawal emitted for never-public records", '} else if (state === "admitted" && wasPublic) {', "} else {", "signals"],
  ["api/_signals.js", "identity leaks into events", 'out.push(make({ kind: "admitted", scope, source_id: id,', 'out.push(make({ kind: "admitted", scope, identity: h.body?.actor?.identity_declared ?? null, source_id: id,', "signals"],
  ["api/_signals.js", "cursor history check dropped", " || chain !== c.h)", ")", "signals"],
  ["api/_signals.js", "unverifiable bodies projected", "if (!tomb && !(h.body && h.verified)) continue;", "if (!tomb && !h.body) continue;", "signals"],
  ["api/_expressions.js", "NFC normalization introduced", "const bytes = toBytes(content);", 'const bytes = toBytes(typeof content === "string" ? content.normalize("NFC") : content);', "expr"],
  ["api/_expressions.js", "trimming introduced", "const bytes = toBytes(content);", 'const bytes = toBytes(typeof content === "string" ? content.trim() : content);', "expr"],
  ["api/_expressions.js", "lenient UTF-8 decoding", "fatal: true", "fatal: false", "expr"],
  ["api/_expressions.js", "unmeasured confidence accepted", "if (measured !== null && (", "if (false && (", "expr"],
  ["api/_expressions.js", "BOM stripped on decode", "ignoreBOM: true", "ignoreBOM: false", "expr"],
  // The /api/problems preview became GET /api/open-work (PR #69); its flag check now lives in serveOpenWork.
  ["api/_continuance-views.js", "Open Work flag bypassed", 'if (!previewOn("OMNARAI_OPEN_WORK")) return res.status(404).json(OPEN_WORK_NOT_OPEN);\n  const id =', "const id =", "door"],
  ["api/council.js", "Signals flag bypassed", '=== "changes" && previewOn("OMNARAI_SIGNALS")', '=== "changes"', "e2e"],
  ["api/_work-store.js", "write-once dropped", "allowOverwrite: false", "allowOverwrite: true", "e2e"],
  // Binding from the dashboard (D-003, 2026-11-24): POST /api/council {action:"work-bind"} → _work-store.js bindFootprint.
  ["api/council.js", "bind: curator check dropped", "async function workBindAction(req, res) {\n  if (!curatorAuthed(req)) return operatorDenied(req, res);", "async function workBindAction(req, res) {", "bind"],
  ["api/council.js", "bind: a GET may write", 'if (req.method !== "POST") return res.status(405).json({ error: "POST only: binding', 'if (false) return res.status(405).json({ error: "POST only: binding', "bind"],
  ["api/council.js", "bind: Open Work flag bypassed", 'if (!previewOn("OMNARAI_OPEN_WORK")) return res.status(404).json(OPEN_WORK_NOT_OPEN);\n  let r;', "let r;", "bind"],
  ["api/council.js", "bind: private no-store dropped", "  privateNoStore(req, res);\n  if (req.method !== \"POST\") return res.status(405).json({ error: \"POST only: binding", "  if (req.method !== \"POST\") return res.status(405).json({ error: \"POST only: binding", "bind"],
  ["api/_work-store.js", "bind: pending footprints bindable", "(await loadPublicFootprints(footprintStore)).publicBodies.find((f) => f.id === b.footprint_id)", "(await loadPublicFootprints(footprintStore, { includeAll: true })).hydrated.map((h) => h.body).filter(Boolean).find((f) => f.id === b.footprint_id)", "bind"],
  ["api/_work-store.js", "bind: duplicate check dropped", "if (same) throw new WorkBindError(\"ALREADY_BOUND\"", "if (false) throw new WorkBindError(\"ALREADY_BOUND\"", "bind"],
  ["api/_work-store.js", "bind: duplicate check ignores the candidate", " && (ev.candidate ?? null) === b.candidate)));", ")));", "bind"],
  ["api/_work-store.js", "bind: candidate range unchecked", "if (b.candidate != null && b.candidate >= n) {", "if (false) {", "bind"],
  ["api/_work-store.js", "bind: kind/candidate allowed on an attempt", 'if (as !== "claim" && (claim_kind != null || candidate != null))', "if (false)", "bind"],
  ["api/_work-store.js", "bind: event never admitted", 'action: "admit", curator, note: plan.note, nowMs }', 'action: "note", curator, note: plan.note, nowMs }', "bind"],
  ["api/_work-store.js", "bind: admit failure swallowed", 'throw new WorkBindError("WORK_BIND_ADMIT_FAILED"', 'void new WorkBindError("WORK_BIND_ADMIT_FAILED"', "bind"],
  ["api/_work-store.js", "bind: source hash not the footprint's", "source: { footprint_id: fp.id, content_sha256: fp.integrity.content_sha256 },", "source: { footprint_id: fp.id, content_sha256: \"0\".repeat(64) },", "bind"],
  ["api/_work-store.js", "bind: references_problem always true", "(Array.isArray(v) ? v.includes(problem.id) : v === problem.id)", "true", "bind"],
  ["api/_work-store.js", "unadmitted events loaded", "const moderation = mod.fold(m[2]);\n    if (!moderation.public) continue;", "const moderation = { ...mod.fold(m[2]), public: true };", "e2e"],
];

let caught = 0;
for (const [file, name, from, to, suite] of M) {
  const orig = readFileSync(file, "utf8");
  if (!orig.includes(from)) { console.log(`✗ SETUP  ${name}: pattern not found in ${file}`); process.exitCode = 1; continue; }
  try {
    writeFileSync(file, orig.replace(from, to));
    const failed = SUITES[suite].some((t) => spawnSync(process.execPath, [...LOADER, "--test", t], { encoding: "utf8" }).status !== 0);
    console.log(`${failed ? "✓ caught " : "✗ MISSED "} ${name}  (${file})`);
    if (failed) caught++; else process.exitCode = 1;
  } finally {
    writeFileSync(file, orig);
  }
}
console.log(`\n${caught}/${M.length} mutants caught`);
