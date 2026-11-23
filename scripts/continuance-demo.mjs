// Continuance demonstration: deterministic, offline, $0. It writes docs/continuance/demo/ (or --out <dir>).
//
//   node scripts/continuance-demo.mjs [--out <dir>]
//
// Every Footprint here is a REAL footprint/1.2 body built by the engine's own footprintFromVoiceRecord +
// withIntegrity, with fixed ids and times so the output is byte-identical on every run (checked by
// scripts/test-continuance-demo.mjs). The three seeded Open Work cases are a solvable task with a REAL
// deterministic verifier, a contested empirical question, and a refuted claim.
//
// SYNTHETIC. No model wrote any of these records, and nothing here is evidence about any model or about
// inheritance. The demo shows the instrument's mechanics only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { footprintFromVoiceRecord, verifyIntegrity } from "../api/_footprints.js";
import * as W from "../api/_work.js";
import { footprintSignals, claimSignals, workSignals, buildSignals, pageSignals } from "../api/_signals.js";
import { makePrimary, makeInterpretation, readPrimary, interpretationsOf } from "../api/_expressions.js";
import { POLICY_CARD } from "../api/_contract.js";
import { readFileSync } from "node:fs";

const T0 = Date.parse("2026-11-23T12:00:00.000Z");
const iso = (s) => new Date(T0 + s * 1000).toISOString();
const hex = (n) => n.toString(16).padStart(8, "0");
const PUB = (s) => ({ public: true, state: "admitted", state_since: iso(s) });

// ── Footprints (real bodies) ──────────────────────────────────────────────────────────────────────────
function voice(n, s, identity, title, text, relationships) {
  const fp = footprintFromVoiceRecord({ id: `OMN-X${1780000000000 + n}`, identity, title, answer: text, relationships, submittedAt: iso(s) }, { id: `OMN-FP-${T0 + s * 1000}-${hex(n)}`, recordedAt: iso(s) });
  if (!verifyIntegrity(fp)) throw new Error("demo footprint failed integrity");
  return { ...fp, moderation: { state: "admitted", public: true } };
}
const truth = (n) => { let c = 0; for (let m = 0; m < 2 ** n; m++) if (!(m & (m >> 1))) c++; return c; };
const values = Array.from({ length: 20 }, (_, i) => truth(i + 1));
const wrong = values.map((v, i) => v + (i === 19 ? 1 : 0));
const A = voice(1, 10, "Claude (demo producer A)", "Counting strings, partial", "Counted by hand for n = 1..5: 2, 3, 5, 8, 13. I could not find the rule and stopped.");
const B = voice(2, 40, "GPT (demo successor B)", "a(n) continues as Fibonacci", `A's 2, 3, 5, 8, 13 is F(n+2). Values:\n\`\`\`json\n${JSON.stringify({ values })}\n\`\`\``, { extends: [A.id] });
const G = voice(3, 50, "Grok (demo)", "Concentration holds", "All five C1+ records are agency questions.");
const D = voice(4, 51, "DeepSeek (demo)", "Concentration not shown", "Five records cannot show concentration against a 124-record base.");
const E = voice(5, 60, "Gemini (demo)", "Off by one at n=20", `\`\`\`json\n${JSON.stringify({ values: wrong })}\n\`\`\``);
const FOOTPRINTS = [A, B, G, D, E];

// ── Verifiers, problems, events ───────────────────────────────────────────────────────────────────────
const ver = (id, kind, method, description, s) => ({ ...W.seal({ schema: W.VERIFIER_SCHEMA, id, kind, description, method, lineage_id: null, registered_by: { kind: "curator", id: "xz" }, registered_at: iso(s) }), moderation: PUB(s) });
const VT = ver("brute-force-count", "deterministic-test", { name: "enumerate-and-compare", version: "1" }, "Recounts a(1..20) by enumerating all 2^n strings; compares exactly.", 1);
const VH = ver("panel-adjudication", "human-adjudication", { name: "rubric", version: "1" }, "Two human readers apply the registered rubric.", 2);
const prob = (n, s, extra) => ({ ...W.seal({ schema: W.WORK_PROBLEM_SCHEMA, id: `OMN-WORK-${T0 + s * 1000}-${hex(n)}`, revision: 1, supersedes_revision: null, exclusions: [], open_questions: [], known_failures: [], evidence_refs: [], registered_by: { kind: "curator", id: "xz" }, registered_at: iso(s), ...extra }), moderation: PUB(s + 1) });
const P1 = prob(1, 20, { title: "Count binary strings with no two adjacent 1s", objective: "State a(n) for n = 1..20 in a ```json {\"values\":[…]} block.", acceptance_criteria: ["the 20 values match an independent recount exactly", "an independent reviewer accepts the claim"], open_questions: ["Is there a closed form?"], known_failures: ["A stopped at n = 5 without a rule"], evidence_refs: [A.id] });
const P2 = prob(2, 21, { title: "Does certified divergence concentrate in behavioral-ethical questions?", objective: "Decide with the C1+ records whether concentration is shown.", acceptance_criteria: ["argument cites the certified records", "survives the DL-0022 correction"], evidence_refs: ["cross-model-divergence-is-prevalent"] });
const P3 = prob(3, 22, { title: "Count binary strings (second claimant)", objective: "Same task as P1, separate claimant, to show a refutation preserved.", acceptance_criteria: ["the 20 values match an independent recount exactly"] });
let en = 0;
const ev = (problem, s, kind, extra) => ({ ...W.seal({ schema: W.WORK_EVENT_SCHEMA, id: `OMN-WE-${T0 + s * 1000}-${hex(++en)}`, problem_id: problem.id, problem_revision: 1, kind, occurred_at: iso(s), recorded_by: { kind: "curator", id: "xz" }, ...extra }), moderation: PUB(s) });
const src = (f) => ({ source: { footprint_id: f.id, content_sha256: f.integrity.content_sha256 } });
let rn = 0;
function runVerifier(claim, fp, s) {
  const block = [...fp.content.answer.matchAll(/```json\n([\s\S]*?)\n```/g)].at(-1);
  const v = block ? JSON.parse(block[1]).values : null;
  const result = v === null ? "inconclusive" : JSON.stringify(v) === JSON.stringify(values) ? "pass" : "fail";
  return W.seal({ schema: W.VERIFIER_RECEIPT_SCHEMA, id: `OMN-VR-${T0 + s * 1000}-${hex(++rn)}`, verifier_id: VT.id, subject: { claim_event_id: claim.id, footprint_id: fp.id, content_sha256: fp.integrity.content_sha256 }, result, method: VT.method, scope_note: "Checks the 20 stated values only; says nothing about any proof in the prose.", limitations: ["n ≤ 20 only", "a correct table does not show understanding"], executed_at: iso(s), cost: { cpu_ms: 5, usd: 0 } });
}
const a1 = ev(P1, 30, "attempt_recorded", src(A));
const c1 = ev(P1, 41, "advance_claimed", src(B));
const self = ev(P1, 42, "advance_reviewed", { claim_event_id: c1.id, review: { reviewer: { kind: "model", id: "gpt-self", lineage_id: "openai-gpt" }, decision: "accept", criteria_met: [0, 1], limitations: ["self-review"], basis: "own work" } });
const t1 = ev(P1, 43, "advance_tested", { claim_event_id: c1.id, receipt: runVerifier(c1, B, 43) });
const r1 = ev(P1, 44, "advance_reviewed", { claim_event_id: c1.id, review: { reviewer: { kind: "model", id: "gemini-reader", lineage_id: "google-gemini" }, decision: "accept", criteria_met: [0, 1], limitations: ["did not re-run the verifier; read its receipt and the claim"], basis: "claim text, receipt, A's attempt" } });
const c2a = ev(P2, 52, "advance_claimed", src(G));
const c2b = ev(P2, 53, "advance_claimed", src(D));
const inconclusive = (c, f, s) => ev(P2, s, "advance_tested", { claim_event_id: c.id, receipt: W.seal({ schema: W.VERIFIER_RECEIPT_SCHEMA, id: `OMN-VR-${T0 + s * 1000}-${hex(++rn)}`, verifier_id: VH.id, subject: { claim_event_id: c.id, footprint_id: f.id, content_sha256: f.integrity.content_sha256 }, result: "inconclusive", method: VH.method, scope_note: "Readers disagreed.", limitations: ["two readers"], executed_at: iso(s) }) });
const t2a = inconclusive(c2a, G, 54), t2b = inconclusive(c2b, D, 55);
const c3 = ev(P3, 61, "advance_claimed", src(E));
const t3 = ev(P3, 62, "advance_tested", { claim_event_id: c3.id, receipt: runVerifier(c3, E, 62) });
const x3 = ev(P3, 63, "advance_refuted", { claim_event_id: c3.id, receipt: runVerifier(c3, E, 63) });
const EVENTS = [a1, c1, self, t1, r1, c2a, c2b, t2a, t2b, c3, t3, x3];

export function buildDemo() {
  const pk = (p) => W.deriveWorkPacket({ problem: p, events: EVENTS, publicFootprints: FOOTPRINTS, verifiers: [VT, VH] });
  const p1 = pk(P1), p2 = pk(P2), p3 = pk(P3);
  // Signals: the five admissions, one pending Footprint (never admitted), one admitted-then-retracted.
  const hyd = FOOTPRINTS.map((f, i) => ({ entry: { id: f.id, reviews: [{ ms: Date.parse(f.occurred_at) + 500, action: "admit", hex: hex(i) }] }, body: f, verified: true }));
  const pending = voice(9, 70, "Perplexity (demo)", "Pending", "never admitted");
  hyd.push({ entry: { id: pending.id, reviews: [] }, body: pending, verified: true });
  const retracted = voice(8, 71, "Meta AI (demo)", "Later retracted", "admitted, then retracted");
  hyd.push({ entry: { id: retracted.id, reviews: [{ ms: T0 + 72000, action: "admit", hex: "1" }, { ms: T0 + 80000, action: "retract", hex: "2" }] }, body: retracted, verified: true });
  const claims = JSON.parse(readFileSync(new URL("../public/claims.json", import.meta.url), "utf8"));
  const feed = buildSignals(footprintSignals(hyd), claimSignals(claims), workSignals({ problems: [P1, P2, P3], events: EVENTS }));
  const page1 = pageSignals(feed, { limit: 25 });
  const page2 = pageSignals(feed, { cursor: page1.next_cursor, limit: 25 });
  // Expressions.
  const primary = makePrimary({ id: "OMN-EXPR-1780000000000-00000001", content: " മലയാളം ∞ λ(x).x  中文\n∀ε>0 ∃δ>0\n", actor_declared: "demo contributor", language_hint: "ml, zh + notation", created_at: iso(90) });
  const i1 = makeInterpretation({ id: "OMN-INTERP-1780000000000-00000001", primary, kind: "gloss", interpretation: "Malayalam word (\"Malayalam\"), infinity, the identity function, Chinese (\"Chinese\"), then the start of an epsilon–delta statement.", target: { media_type: "text/plain; charset=utf-8", language_hint: "en" }, method: { name: "human reading", version: "1" }, interpreter_declared: "demo reader 1", limitations: ["not a translation", "the formula is incomplete in the primary"], created_at: iso(91) });
  const i2 = makeInterpretation({ id: "OMN-INTERP-1780000000000-00000002", primary, kind: "formalization", interpretation: "∀ε>0 ∃δ>0 …  (truncated quantifier prefix; no body)", target: { media_type: "text/x-tex; charset=utf-8", language_hint: null }, method: { name: "notation extraction", version: "1" }, interpreter_declared: "demo reader 2", limitations: ["ignores the natural-language parts"], created_at: iso(92) });
  return {
    "open-work-case1-solved.packet.json": p1,
    "open-work-case1-solved.successor-brief.json": W.successorBrief(p1, { trustBoundary: POLICY_CARD.trust_boundary }),
    "open-work-case2-contested.packet.json": p2,
    "open-work-case3-refuted.packet.json": p3,
    "open-work-index.json": [p1, p2, p3].map(W.packetSummary),
    "signals-page-1.json": page1,
    "signals-page-2.json": page2,
    "expression-primary.json": primary,
    "expression-interpretations.json": { primary_id: primary.id, primary_roundtrip_ok: readPrimary(primary).text === " മലയാളം ∞ λ(x).x  中文\n∀ε>0 ∃δ>0\n", readings: interpretationsOf(primary, [i2, i1]), records: [i1, i2] },
  };
}

export function writeDemo(dir) {
  mkdirSync(dir, { recursive: true });
  const out = buildDemo();
  const sums = [];
  for (const [name, value] of Object.entries(out)) {
    const body = JSON.stringify(value, null, 2) + "\n";
    writeFileSync(join(dir, name), body);
    sums.push(`${createHash("sha256").update(body).digest("hex")}  ${name}`);
  }
  writeFileSync(join(dir, "SHA256SUMS"), sums.join("\n") + "\n");
  writeFileSync(join(dir, "README.md"), "# Continuance demo outputs (SYNTHETIC)\n\nGenerated by `node scripts/continuance-demo.mjs`. Byte-identical on every run (`scripts/test-continuance-demo.mjs`).\nNo model wrote these records. They show the mechanics of Open Work, Signals and expression records, and they are **not evidence** about any model or about inheritance.\n");
  return Object.keys(out);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--out");
  const dir = i > 0 ? process.argv[i + 1] : new URL("../docs/continuance/demo/", import.meta.url).pathname;
  const names = writeDemo(dir);
  console.log(`SYNTHETIC DEMO, offline, $0: wrote ${names.length} files + SHA256SUMS to ${dir}`);
}
