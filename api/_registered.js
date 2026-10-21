// ── Registered questions, batches and the certification queue (2026-10-21) ──────────────────────────────────────────
// The design xz approved (docs/registered-questions-design.md, DL-0020). Underscore module ⇒ not a deployed function.
//
// A registered question is text the curator put on the record before anyone asked it. Its canonical id needs only that
// text (questionIdFor), so when the council later asks it verbatim the new Atlas record joins the same id. STATE IS
// DERIVED, never stored: registered (no Atlas record with the id) → recorded (asked) → tested (its queue record went
// through certification). Asking and certifying are the spend events; each runs only as a batch the curator approved in
// the decision log (DL-0005 method), and scripts/run-batch.mjs refuses anything else.
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import { questionIdFor } from "./_footprints.js";
import { tierOf, isTested } from "./_atlas-counts.js";

const here = dirname(fileURLToPath(import.meta.url));
function readPublicJson(rel) {
  for (const base of [join(here, "..", "public"), join(process.cwd(), "public")]) {
    try { return JSON.parse(readFileSync(join(base, rel), "utf-8")); } catch { /* try next */ }
  }
  return null;
}
let registryCache, batchesCache;
export const loadRegistry = () => (registryCache === undefined ? (registryCache = readPublicJson("registered-questions.json")) : registryCache);
export const loadBatches = () => (batchesCache === undefined ? (batchesCache = readPublicJson("batches.json")) : batchesCache);

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
// The council's standing panel. A record missing one of them is "ragged" and is not used as a certification target
// while a full-panel record of the same question exists.
export const FULL_PANEL = ["Claude", "GPT-4o", "Gemini", "Grok", "DeepSeek"];
const isFullPanel = (r) => FULL_PANEL.every((m) => (r.divergence?.answers || []).some((a) => a.model === m));

// Every registered question with its derived state. divRecords: Atlas records as the engine holds them.
export function registeredQuestions(registry = loadRegistry(), divRecords = []) {
  const byQ = new Map();
  for (const r of divRecords) {
    const qid = questionIdFor(r.divergence?.question);
    if (qid) (byQ.get(qid) || byQ.set(qid, []).get(qid)).push(r);
  }
  return (registry?.questions || []).map((q) => {
    const recs = (byQ.get(q.id) || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id.localeCompare(b.id));
    const tested = recs.filter(isTested);
    const state = !recs.length ? "registered" : tested.length ? "tested" : "recorded";
    return {
      id: q.id, text: q.text, state, set: q.set ?? null, set_index: q.set_index ?? null,
      registered_at: q.registered_at, registered_by: q.registered_by, decision: q.decision,
      records: recs.map((r) => ({ id: r.id, date: r.date || null, tier: tierOf(r) })),
      href: `/api/questions?id=${q.id}`,
    };
  });
}
export const registeredUnasked = (registry, divRecords) => registeredQuestions(registry, divRecords).filter((q) => q.state === "registered");

// The certification queue (design §4): recorded records only, one per question, never-tested questions only, in a
// seeded random order so the next batches estimate the untested population without bias. The record certified for a
// question is its newest full-panel record (the newest record when none has the full panel; flagged ragged).
export const QUEUE_RULE = {
  id: "certification-queue-v1",
  decision: "DL-0020",
  seed: "certification-queue-v1|DL-0020",
  text: "Recorded records only, one per question; only questions with no tested record; ordered by sha256(seed + '|' + question_id) ascending. The target is the question's newest record with the full five-model panel, or its newest record (flagged ragged) when none has the full panel. Tension-axis count is not used: among the 47 tested records it did not predict certification (3/18 at 3 axes, 2/14 at 4, 1/15 at 5).",
};
export function certificationQueue(divRecords = [], rule = QUEUE_RULE) {
  const byQ = new Map();
  for (const r of divRecords) {
    const qid = questionIdFor(r.divergence?.question);
    if (qid) (byQ.get(qid) || byQ.set(qid, []).get(qid)).push(r);
  }
  const out = [];
  for (const [qid, recs] of byQ) {
    if (recs.some(isTested)) continue;
    const newestFirst = recs.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.id.localeCompare(a.id));
    const full = newestFirst.find(isFullPanel);
    const target = full || newestFirst[0];
    out.push({ question_id: qid, record_id: target.id, ragged: !full, rank: sha256(`${rule.seed}|${qid}`) });
  }
  return out.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)).map(({ rank, ...q }, i) => ({ position: i + 1, ...q }));
}

// ── Batches (design §3; DL-0005 method) ──
export const BATCH_KINDS = ["elicitation", "certification"];
export const BATCH_STATUSES = ["proposed", "approved", "run", "withdrawn"];
export const HARD_WALL_USD = 25;
// A batch may spend only when it is approved, names the decision-log entry that approved it, sits under the wall, and
// (for elicitation) lists only questions that are still registered-unasked. Returns a list of problems; [] = runnable.
export function batchProblems(batch, { registry = loadRegistry(), divRecords = [], decisionLog = "" } = {}) {
  const p = [];
  if (!batch || typeof batch !== "object") return ["no batch"];
  if (!BATCH_KINDS.includes(batch.kind)) p.push(`kind must be one of ${BATCH_KINDS.join(", ")}`);
  if (batch.status !== "approved") p.push(`status is "${batch.status}", not "approved": the curator approves each batch before it runs`);
  if (!/^DL-\d{4}$/.test(batch.approved_in || "")) p.push("approved_in must name the decision-log entry (DL-NNNN) that approved this batch");
  else if (decisionLog && !new RegExp(`^## ${batch.approved_in} · `, "m").test(decisionLog)) p.push(`${batch.approved_in} is not in the decision log`);
  if (!(Number(batch.estimate_usd) > 0) || Number(batch.estimate_usd) > HARD_WALL_USD) p.push(`estimate_usd must be > 0 and ≤ the $${HARD_WALL_USD} wall`);
  if (!Array.isArray(batch.items) || !batch.items.length) p.push("no items");
  if (batch.kind === "elicitation") {
    const unasked = new Set(registeredUnasked(registry, divRecords).map((q) => q.id));
    for (const it of batch.items || []) if (!unasked.has(it.question_id)) p.push(`${it.question_id} is not a registered-unasked question`);
  }
  if (batch.kind === "certification") {
    const queued = new Set(certificationQueue(divRecords).map((q) => q.record_id));
    for (const it of batch.items || []) if (!queued.has(it.record_id)) p.push(`${it.record_id} is not in the certification queue`);
  }
  return p;
}

// What the manifest says about questions (design §6). canonical_questions is computed by the caller, unchanged.
export function questionsDomain(divRecords = [], { registry = loadRegistry(), batches = loadBatches() } = {}) {
  const reg = registeredQuestions(registry, divRecords);
  const byQ = new Map();
  for (const r of divRecords) {
    const qid = questionIdFor(r.divergence?.question);
    if (qid) (byQ.get(qid) || byQ.set(qid, []).get(qid)).push(r);
  }
  const tested = { C0: 0, C1: 0, C2: 0, C3: 0 };
  let recordedUntested = 0;
  for (const recs of byQ.values()) {
    const t = recs.filter(isTested);
    if (!t.length) { recordedUntested++; continue; }
    const best = t.map(tierOf).sort().pop() || "C0";
    tested[best] = (tested[best] || 0) + 1;
  }
  const list = batches?.batches || [];
  const count = (kind, status) => list.filter((b) => b.kind === kind && b.status === status).length;
  const spent = (kind) => +list.filter((b) => b.kind === kind && b.status === "run").reduce((s, b) => s + (Number(b.actual_usd) || 0), 0).toFixed(2);
  const queue = certificationQueue(divRecords);
  return {
    registered_unasked: reg.filter((q) => q.state === "registered").length,
    by_state: { registered: reg.filter((q) => q.state === "registered").length, recorded_untested: recordedUntested, tested_by_best_tier: tested },
    elicitation: { proposed: count("elicitation", "proposed"), approved: count("elicitation", "approved"), run: count("elicitation", "run"), spent_usd: spent("elicitation") },
    certification_queue: { length: queue.length, rule: QUEUE_RULE.id, next: queue.slice(0, 5).map((q) => q.record_id), certification_batches_run: count("certification", "run"), spent_usd: spent("certification") },
    registry: "/registered-questions.json",
    batches: "/batches.json",
  };
}
