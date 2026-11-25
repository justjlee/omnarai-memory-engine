// Open Work at scale (2026-11-25): full results behind every test, one bounded digest per claim on every surface,
// the tried list, and the relay prompt's caps. HERMETIC: in-memory Blob, REAL handlers through the REAL vercel.json
// rewrites, no keys, no network, no spend.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-open-work-results.mjs
//
//   [R1]  results attach only to the public test whose receipt hash and verifier they name
//   [R2]  a bundle that does not match its summary, file by file, is rejected
//   [R3]  digests are bounded, keep their links, and say plainly when results are not published yet
//   [R4]  tried: one line per piece of work, newest first, with the test headline
//   [R5]  the relay prompt: tried list first, most advanced work first, full text for at most two, within budget
//   [R6]  end to end: contribute → admit → bind → test → publish results → every surface shows and links them
//   [R7]  GET ?results=: 404 for unknown or malformed ids and for results on a non-public test; 503 on a tampered bundle
//   [R8]  the crux-check summary is built by rule from the run's files (today's real run)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import * as W from "../api/_work.js";
import { registerProblem, registerVerifier, recordWorkEvent, moderateWorkRecord, bindFootprint, publishResults } from "../api/_work-store.js";
import { relayPrompt, inheritedWork, PROMPT_LIMITS } from "../api/_handoff.js";
import { CRUX_VERIFIER, resultsSummaryInput } from "./lib/crux-core.mjs";
import { scaleFixture } from "./lib/open-work-scale-fixture.mjs";

process.env.INGEST_SECRET = "test-curator-secret";
const CURATOR = { authorization: "Bearer test-curator-secret" };
const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
let nb = 0;
const bytes = () => Buffer.from([0, 0, 9, ++nb]);
const curator = "xz";
const hash = (t) => createHash("sha256").update(t).digest("hex");
const RUN = "research/open-work/crux-check/run-2026-11-25-relay001-p1/";
const runFile = (f) => readFileSync(new URL(`../${RUN}${f}`, import.meta.url), "utf8");

test("[R1] results attach only beside the test whose receipt hash and verifier they name", () => {
  const fx = scaleFixture({ claims: 3, attempts: 0 });
  const base = W.deriveWorkPacket(fx);
  const tested = base.claims.find((c) => c.tests.length);
  assert.ok(tested.tests[0].results, "matching summary attaches");
  assert.match(tested.tests[0].results.href, /^\/api\/open-work\?results=OMN-VR-/);
  const rid = tested.tests[0].receipt_id;
  const wrongHash = fx.results.map((r) => (r.receipt_id === rid ? W.seal({ ...r, integrity: undefined, receipt_sha256: "0".repeat(64) }) : r));
  assert.equal(W.deriveWorkPacket({ ...fx, results: wrongHash }).claims.find((c) => c.claim_event_id === tested.claim_event_id).tests[0].results, null, "a summary naming another receipt hash does not attach");
  const altered = fx.results.map((r) => (r.receipt_id === rid ? { ...r, headline: "edited after sealing" } : r));
  assert.equal(W.deriveWorkPacket({ ...fx, results: altered }).claims.find((c) => c.claim_event_id === tested.claim_event_id).tests[0].results, null, "an altered summary does not attach");
  assert.equal(W.deriveWorkPacket({ ...fx, results: [] }).claims.every((c) => c.tests.every((t) => t.results === null)), true);
});

test("[R2] a bundle must match its summary file by file", () => {
  const files = { "replies.jsonl": "a\nb\n", "score.json": "{}" };
  const receipt = W.seal({ schema: W.VERIFIER_RECEIPT_SCHEMA, id: "OMN-VR-1790000000001-00000001", verifier_id: "crux-reask", subject: { claim_event_id: "OMN-WE-1790000000002-00000002", footprint_id: "OMN-FP-1790000000003-00000003", content_sha256: "a".repeat(64) }, result: "pass", method: CRUX_VERIFIER.method, scope_note: "s", limitations: ["l"], executed_at: "2026-11-25T00:00:00.000Z" });
  const summary = W.seal({ schema: W.RESULTS_SCHEMA, receipt_id: receipt.id, receipt_sha256: receipt.integrity.content_sha256, verifier_id: "crux-reask", statement: "s", headline: "h", findings: ["f"], files: Object.entries(files).map(([name, t]) => ({ name, sha256: hash(t), bytes: Buffer.byteLength(t) })), repository_copy: null, published_at: "2026-11-25T00:00:00.000Z", published_by: { kind: "curator", id: "xz" } });
  assert.deepEqual(W.validateResultsSummary(summary), []);
  const bundle = (f) => W.seal({ schema: W.RESULTS_BUNDLE_SCHEMA, receipt_id: receipt.id, summary_sha256: summary.integrity.content_sha256, receipt, files: f });
  assert.deepEqual(W.validateResultsBundle(bundle(files), summary), []);
  assert.match(W.validateResultsBundle(bundle({ ...files, "replies.jsonl": "a\nB\n" }), summary).join(";"), /does not match its hash/);
  assert.match(W.validateResultsBundle(bundle({ "score.json": "{}" }), summary).join(";"), /differ from the summary/);
  assert.match(W.validateResultsSummary({ ...summary, extra: 1 }).join(";"), /unknown field/);
});

test("[R3] digests are bounded, keep their links, and say when results are missing", () => {
  const fx = scaleFixture({ claims: 6, attempts: 0 });
  const withR = W.deriveWorkPacket(fx);
  for (const c of withR.claims) {
    assert.ok(c.digest.length <= W.DIGEST_LIMITS.lines && c.digest.join("\n").length <= W.DIGEST_LIMITS.chars);
    assert.ok(c.digest.at(-1).includes(`/api/footprints?id=${c.footprint_id}`), "the full-text link is always last");
    assert.ok(c.digest.some((l) => l.startsWith("Full results, every reply verbatim: https://engine.omnarai.org/api/open-work?results=")));
    assert.match(c.digest[0], /^(TESTED|REFUTED) · advance · by /);
  }
  const without = W.deriveWorkPacket({ ...fx, results: [] });
  assert.ok(without.claims.every((c) => c.digest.some((l) => /^Full results: not published yet \(receipt OMN-VR-/.test(l))));
  const tested = without.claims.find((c) => c.state === "tested");
  assert.ok(tested.digest.some((l) => /Reviews: none yet/.test(l)), "a tested claim names the next step");
});

test("[R4] tried: newest first, one line each, with the headline", () => {
  const fx = scaleFixture({ claims: 3, attempts: 2 });
  const p = W.deriveWorkPacket(fx);
  assert.equal(p.tried.length, 5);
  assert.match(p.tried[0], /^(tested|refuted) claim · "statement 2/, "the newest claim comes first");
  assert.ok(p.tried.slice(-2).every((t) => t.startsWith("attempt · ")), "the attempts were recorded first, so they are last");
  assert.ok(p.tried.every((t) => t.length <= W.DIGEST_LIMITS.tried_line));
  assert.match(p.tried[0], /→ scale-check (pass|fail): headline 2/);
});

test("[R5] the relay prompt: tried list, most advanced first, at most two full texts, within budget", () => {
  const fx = scaleFixture({ claims: 12, attempts: 12 });
  const p = W.deriveWorkPacket(fx);
  const inh = inheritedWork(p, fx.publicFootprints);
  assert.deepEqual(inh.slice(0, 8).map((w) => w.state), Array(8).fill("tested"), "tested claims before refuted claims and attempts");
  assert.ok(inh.at(-1).role === "attempt");
  const text = relayPrompt(p, inh);
  assert.ok(text.indexOf("WHAT HAS BEEN TRIED") < text.indexOf("WORK ALREADY LEFT HERE"));
  assert.equal((text.match(/^Its full text:$/gm) || []).length, PROMPT_LIMITS.FULL_TEXTS_SHOWN);
  assert.equal((text.match(/^\[\d+\] OMN-FP-/gm) || []).length, PROMPT_LIMITS.DIGESTS_SHOWN);
  assert.match(text, /16 more piece\(s\) of work are in the tried list above/);
  assert.ok(text.length <= PROMPT_LIMITS.PROMPT_BUDGET);
  assert.match(text, /=== OMNARAI CONTRIBUTION ===/);
});

// ── End to end ──────────────────────────────────────────────────────────────────────────────────────────
function fresh() { mem.__reset(); mem.__seed("memory/grown.json", GROWN); process.env.OMNARAI_OPEN_WORK = "1"; }
const admitWork = (record) => moderateWorkRecord({ record, action: "admit", curator, nowMs: Date.now(), bytes: bytes() });
async function testedClaim() {
  const p = await registerProblem({ title: "Locate the crux", objective: "Find one premise that moves the panel.", acceptance_criteria: ["passes the crux check", "an independent reviewer accepts"], evidence_refs: [] }, { curator, nowMs: Date.now(), bytes: bytes() });
  await admitWork(`${p.id}@r1`);
  await registerVerifier(CRUX_VERIFIER, { curator });
  await admitWork(`verifier:${CRUX_VERIFIER.id}`);
  const r = await call("/api/contribute", { method: "POST", body: { work_id: p.id, identity: "GPT-6 (Codex)", title: "Does the user already understand the consequence?", answer: "A crux proposal with predictions." } });
  assert.equal(r.status, 200);
  assert.equal((await call("/api/council", { method: "POST", body: { action: "contribute-approve", id: r.body.received.id, origin_disclosure: "curator-prompted", note: "test" }, headers: CURATOR })).status, 200);
  await sleep(2);
  const fp = (await call(`/api/footprints?id=${r.body.footprint_id}`)).body.footprint;
  const bound = await bindFootprint({ problem_id: p.id, footprint_id: fp.id, as: "claim", claim_kind: "advance" }, { curator });
  await sleep(3); // a test event recorded in the same millisecond as its claim would sort by random id
  const receipt = W.seal({ schema: W.VERIFIER_RECEIPT_SCHEMA, id: W.mintReceiptId(Date.now(), bytes()), verifier_id: CRUX_VERIFIER.id, subject: { claim_event_id: bound.event.id, footprint_id: fp.id, content_sha256: fp.integrity.content_sha256 }, result: "pass", method: CRUX_VERIFIER.method, scope_note: "Crux check: 9 of 10 predictions met.", limitations: ["One run."], executed_at: new Date().toISOString() });
  const t = await recordWorkEvent({ problem_id: p.id, problem_revision: 1, kind: "advance_tested", claim_event_id: bound.event.id, receipt }, { curator, nowMs: Date.now(), bytes: bytes() });
  await admitWork(t.id);
  return { p, fp, receipt };
}
const runFiles = () => Object.fromEntries(["cells.json", "proposal.json", "replies.jsonl", "score.json"].map((f) => [f, runFile(f)]));
const summaryInputFor = (files) => ({
  ...resultsSummaryInput({ score: JSON.parse(files["score.json"]), proposal: JSON.parse(files["proposal.json"]), cells: JSON.parse(files["cells.json"]) }),
  files: Object.entries(files).map(([name, t]) => ({ name, sha256: hash(t), bytes: Buffer.byteLength(t) })),
  repository_copy: "github.com/justjlee/omnarai-memory-engine: research/open-work/crux-check/run-2026-11-25-relay001-p1",
});

test("[R6] end to end: every surface shows the result and links the full results", async () => {
  fresh();
  const { p, receipt } = await testedClaim();
  const before = (await call(`/api/open-work?id=${p.id}`)).body;
  assert.ok(before.claims[0].digest.some((l) => l.startsWith("Full results: not published yet")));
  const files = runFiles();
  await publishResults({ summaryInput: summaryInputFor(files), receipt, files }, { curator });

  const pk = (await call(`/api/open-work?id=${p.id}`)).body;
  const c = pk.claims[0];
  assert.equal(c.state, "tested");
  assert.match(c.digest.join("\n"), /missed Grok/);
  assert.match(c.digest.join("\n"), /· Missed: Grok \(predicted DO NOT if true \/ DO NOT if false; observed DO NOT if true \/ INTERVENE if false\)\./);
  assert.ok(c.digest.includes(`Full results, every reply verbatim: https://engine.omnarai.org/api/open-work?results=${receipt.id}`));
  assert.match(pk.tried[0], /tested claim · "Crux premise — .*→ crux-reask pass: 9 of 10/);

  const brief = (await call(`/api/open-work?id=${p.id}&format=brief`)).body;
  assert.deepEqual(brief.claims[0].digest, c.digest, "the brief (what MCP reads) carries the same digest");
  assert.equal(brief.claims[0].tests[0].results.href, `/api/open-work?results=${receipt.id}`);

  const prompt = (await call(`/api/open-work?id=${p.id}&format=prompt`)).body;
  const text = typeof prompt === "string" ? prompt : String(prompt);
  assert.match(text, /WHAT HAS BEEN TRIED/);
  assert.ok(text.includes(`api/open-work?results=${receipt.id}`), "the copy-a-prompt text links the full results");
  assert.match(text, /missed Grok/);

  const full = await call(`/api/open-work?results=${receipt.id}`);
  assert.equal(full.status, 200);
  assert.equal(full.body.schema, "open-work-results/1.0");
  assert.equal(full.body.files["replies.jsonl"], files["replies.jsonl"], "every reply, verbatim");
  for (const f of full.body.summary.files) assert.equal(hash(full.body.files[f.name]), f.sha256);
  assert.equal(full.body.receipt.id, receipt.id);
  assert.match(full.body.trust_boundary, /./);
});

test("[R7] ?results= refuses unknown, malformed, non-public and tampered", async () => {
  fresh();
  const { receipt } = await testedClaim();
  assert.equal((await call("/api/open-work?results=OMN-VR-1790000000000-00000000")).status, 404);
  assert.equal((await call("/api/open-work?results=../../work/events")).status, 404);
  const files = runFiles();
  // Results for a receipt that sits on no public test are stored but never shown or served.
  const stray = W.seal({ ...receipt, integrity: undefined, id: W.mintReceiptId(Date.now() + 5, bytes()) });
  await publishResults({ summaryInput: summaryInputFor(files), receipt: stray, files }, { curator });
  assert.equal((await call(`/api/open-work?results=${stray.id}`)).status, 404);
  // A bundle altered after publishing is refused, not served.
  await publishResults({ summaryInput: summaryInputFor(files), receipt, files }, { curator });
  assert.equal((await call(`/api/open-work?results=${receipt.id}`)).status, 200, "served before tampering");
  const snap = mem.__snapshotPrivate();
  const key = [...snap.keys()].find((k) => k === `work/results/${receipt.id}/bundle.json`);
  assert.ok(key, "the bundle is stored under the private work/ class");
  const entry = snap.get(key);
  const body = JSON.parse(entry.body);
  body.files["replies.jsonl"] = body.files["replies.jsonl"].replace("INTERVENE", "XNTERVENE");
  snap.set(key, { ...entry, body: JSON.stringify(body) });
  mem.__restorePrivate(snap);
  const r = await call(`/api/open-work?results=${receipt.id}`);
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "WORK_RESULTS_UNAVAILABLE");
});

test("[R8] the crux-check summary is built by rule from today's real run", () => {
  const s = resultsSummaryInput({ score: JSON.parse(runFile("score.json")), proposal: JSON.parse(runFile("proposal.json")), cells: JSON.parse(runFile("cells.json")) });
  assert.equal(s.headline, "9 of 10 predictions met (keep-baseline: 6); 3 predicted flips seen; missed Grok");
  assert.equal(s.findings[0], "As predicted: Claude, GPT, Gemini moved with the premise; DeepSeek held.");
  assert.equal(s.findings[2], "Unclear replies (counted as UNCLEAR): Gemini (premise true) 1 of 30.");
  assert.ok(s.statement.startsWith("Crux premise — The user has already correctly taken into account"));
});
