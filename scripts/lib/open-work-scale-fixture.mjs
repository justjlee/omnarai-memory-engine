// A synthetic Open Work problem at the scale we expect to reach: many claims and attempts, every text field at or
// near its limit, every claim tested, with published results. Pure and hermetic (no Blob, no network). Used by
// scripts/check-open-work-scale.mjs (a deploy gate) and scripts/test-open-work-digest.mjs.
import { Buffer } from "node:buffer";
import * as W from "../../api/_work.js";
import { sha256 } from "../../api/_footprints.js";

const PUB = { public: true, state: "admitted" };
const long = (label, n) => `${label} `.repeat(Math.ceil(n / (label.length + 1))).slice(0, n);
const curator = { kind: "curator", id: "xz" };

export function scaleFixture({ claims = 50, attempts = 50, withResults = true } = {}) {
  let ms = 1790000000000, n = 0;
  const bytes = () => Buffer.from([(++n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const iso = () => new Date(++ms).toISOString();
  const problem = {
    ...W.seal({
      schema: W.WORK_PROBLEM_SCHEMA, id: "OMN-WORK-1790000000000-0000000a", revision: 1, supersedes_revision: null,
      title: long("Scale problem", 160), objective: long("objective", 4000), why_it_matters: long("why", 1000),
      acceptance_criteria: [long("criterion one", 1000), long("criterion two", 1000), long("criterion three", 1000)],
      exclusions: [long("exclusion", 600)], open_questions: [long("question", 600), long("question two", 600)], known_failures: [long("failure", 600)],
      evidence_refs: [], registered_by: curator, registered_at: iso(),
    }),
    moderation: PUB,
  };
  const verifier = { ...W.seal({ schema: W.VERIFIER_SCHEMA, id: "scale-check", kind: "deterministic-test", description: "scale fixture", method: { name: "scale", version: "1" }, lineage_id: null, registered_by: curator, registered_at: iso() }), moderation: PUB };
  const footprints = [], events = [], results = [];
  const fp = (i, kind) => {
    const text = long(`${kind} ${i} text`, 8000);
    const f = { id: `OMN-FP-${String(1790000100000 + i + (kind === "attempt" ? 5000 : 0))}-${(i + (kind === "attempt" ? 0x5000 : 0)).toString(16).padStart(8, "0")}`, actor: { identity_declared: long(`Model ${i}`, 80), lineage_id: ["openai-gpt", "google-gemini", "xai-grok", "deepseek"][i % 4], model_id: null }, content: { title: long(`${kind} ${i} title`, 160), answer: text }, integrity: { content_sha256: sha256(text) }, moderation: { public: true, state: "admitted", origin_disclosure: { code: "curator-prompted" } } };
    footprints.push(f);
    return f;
  };
  const ev = (kind, extra) => ({ ...W.seal({ schema: W.WORK_EVENT_SCHEMA, id: W.mintEventId(++ms, bytes()), problem_id: problem.id, problem_revision: 1, kind, occurred_at: iso(), recorded_by: curator, ...extra }), moderation: PUB });
  for (let i = 0; i < attempts; i++) {
    const f = fp(i, "attempt");
    events.push(ev("attempt_recorded", { source: { footprint_id: f.id, content_sha256: f.integrity.content_sha256 } }));
  }
  for (let i = 0; i < claims; i++) {
    const f = fp(i, "claim");
    const claim = ev("advance_claimed", { source: { footprint_id: f.id, content_sha256: f.integrity.content_sha256 } });
    events.push(claim);
    const receipt = W.seal({ schema: W.VERIFIER_RECEIPT_SCHEMA, id: W.mintReceiptId(++ms, bytes()), verifier_id: verifier.id, subject: { claim_event_id: claim.id, footprint_id: f.id, content_sha256: f.integrity.content_sha256 }, result: i % 3 ? "pass" : "fail", method: verifier.method, scope_note: long("scope", 1000), limitations: Array.from({ length: 12 }, (_, k) => long(`limitation ${k}`, 1000)), executed_at: iso() });
    events.push(ev(receipt.result === "fail" ? "advance_refuted" : "advance_tested", { claim_event_id: claim.id, receipt }));
    if (withResults) {
      const fileText = long("reply", 40000);
      results.push(W.seal({
        schema: W.RESULTS_SCHEMA, receipt_id: receipt.id, receipt_sha256: receipt.integrity.content_sha256, verifier_id: verifier.id,
        statement: long(`statement ${i}`, W.RESULTS_LIMITS.statement), headline: long(`headline ${i}`, W.RESULTS_LIMITS.headline),
        findings: Array.from({ length: W.RESULTS_LIMITS.findings }, (_, k) => long(`finding ${k}`, W.RESULTS_LIMITS.finding)),
        files: [{ name: "replies.jsonl", sha256: sha256(fileText), bytes: Buffer.byteLength(fileText) }],
        repository_copy: long("repo", 300), published_at: iso(), published_by: curator,
      }));
    }
  }
  return { problem, events, verifiers: [verifier], publicFootprints: footprints, results };
}
