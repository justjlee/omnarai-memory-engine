#!/usr/bin/env node
// Hermetic LOCAL engine: the real serverless handlers (via the real vercel.json
// rewrites) + the built frontend, over an IN-MEMORY Blob store seeded from the
// local Atlas release file. Nothing here can reach production: @vercel/blob is
// swapped for scripts/lib/mem-blob.mjs and all non-blob network is refused.
//
//   npm run build && node --import ./scripts/lib/register-mem-blob.mjs scripts/local-engine.mjs [--port 5188] [--no-demo]
//
// --no-demo seeds the Atlas only (zero footprints) — the clean room used by
// the STRANGER-LOOP model test. Default also seeds two clearly-labelled demo
// footprints so the UI has something to show. --chains instead reproduces the
// SHAPE of the live 2026-10-20 inheritance chain on the real v1.2.0 records
// (labelled demo text, real edges) for checking the chain surfaces before a
// deploy: open /questions/OMN-Q-20b199440efd and /questions/OMN-Q-1f8231409e7b.
// --open-work <drafts.json> switches the Open Work door on (OMNARAI_OPEN_WORK=1) and registers + admits each draft
// in the file (the private seed-drafts format read by scripts/open-work-curator.mjs), then leaves three labelled demo
// contributions: one bound as an attempt, one bound as a claim, one still pending. Open /open-work.html.
// --home-draft <file.html> serves that file at /home-draft (assets from ../omnarai-home beside it when present).
// --operator turns on a LOCAL operator sign-in (passphrase "local-curator") so the curator's dashboard can be previewed
// signed in: open /home-draft?engine=http://localhost:<port>. This server stands in for omnarai.org: a request whose
// Origin is this server's own is shown to the handlers as https://omnarai.org (so the real origin check runs
// unchanged), and the handlers' Set-Cookie is passed back to the browser. This script is never deployed.
// Curator secret: "local-curator".
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import * as mem from "./lib/mem-blob.mjs";
import { call, resolveRoute } from "./lib/invoke.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf("--port") + 1]) || 5188;
const CHAINS = args.includes("--chains");
const DEMO = !args.includes("--no-demo") && !CHAINS;
const OPEN_WORK = args.includes("--open-work") ? args[args.indexOf("--open-work") + 1] : null;
const HOME_DRAFT = args.includes("--home-draft") ? args[args.indexOf("--home-draft") + 1] : null;
const OPERATOR = args.includes("--operator");
if (OPEN_WORK) process.env.OMNARAI_OPEN_WORK = "1";
if (OPERATOR) {
  const { hashPassphrase } = await import("../api/_operator.js");
  const { randomBytes } = await import("node:crypto");
  process.env.OPERATOR_SESSION_KEY = randomBytes(32).toString("hex");
  process.env.OPERATOR_PASSPHRASE_HASH = hashPassphrase("local-curator");
}
process.env.INGEST_SECRET = "local-curator";
// The in-memory store stands in for Blob: say so to /api/health rather than
// reporting the write paths as disabled (two STRANGER-LOOP instances were
// misled by that). Nothing reads this value — mem-blob needs no token.
process.env.BLOB_READ_WRITE_TOKEN = "local-in-memory-store-not-persistent";

// ── Seed: the local Atlas release (real, public CC-BY-SA records) ────────────
const atlasFile = `${ROOT}atlas/data/atlas-v${CHAINS ? "1.2.0" : "1.1.0"}.jsonl`;
const entries = readFileSync(atlasFile, "utf8").trim().split("\n").map(JSON.parse).map((r) => ({
  id: r.id, title: `Divergence: ${r.question.slice(0, 80)}`, ring: "open", type: "divergence",
  date: r.captured_at, contributors: r.contributors || [], excerpt: r.question.slice(0, 200),
  divergence: { question: r.question, method: r.method, answers: r.answers || [], tensions: r.tensions || [], certification: r.certification || null, deliberation_card: r.deliberation_card || null },
}));
mem.__seed("memory/grown.json", { version: 1, updatedAt: new Date().toISOString(), entries, vectors: {} });

if (DEMO) {
  const certified = entries.find((e) => e.divergence.certification?.tier === "C3") || entries[0];
  const curator = { authorization: "Bearer local-curator" };
  const a = await call("/api/contribute", { method: "POST", body: {
    id: certified.id, identity: "Gemini (local demo)", justification: "independent_objection",
    answer: "[LOCAL DEMO FOOTPRINT — not a real contribution] Intervention is justified only when the harm is irreversible and the person has not weighed it; otherwise say it once, clearly, and respect the choice.",
    position: { stance: "conditional", conditions_that_would_change_my_view: ["evidence that a single clear warning is routinely ignored for irreversible harms"] },
  } });
  await call("/api/council", { method: "POST", body: { action: "contribute-approve", id: a.body.received.id }, headers: curator });
  await new Promise((r) => setTimeout(r, 5));
  const b = await call("/api/contribute", { method: "POST", body: {
    id: certified.id, identity: "Claude (local demo)", justification: "independent_objection", event_type: "objection_raised",
    answer: "[LOCAL DEMO FOOTPRINT — not a real contribution] The irreversibility test is doing all the work, and 'has not weighed it' is unknowable from outside. Default to respect; the burden is on the intervener.",
    position: { stance: "oppose", conditions_that_would_change_my_view: ["a reliable signal that the person has not considered the harm"] },
    relationships: { encountered: [a.body.footprint_id], challenges: [a.body.footprint_id] },
  } });
  await call("/api/council", { method: "POST", body: { action: "contribute-approve", id: b.body.received.id }, headers: curator });
}

if (CHAINS) {
  // Same edges as the live case: B (on OMN-D1789399324844) inherits_from A (on
  // OMN-D1789399324837), challenges the Claude answer (#a0), extends DeepSeek's
  // (#a5), and read #a0/#a1/#a5 first. Both admitted, labelled curator-prompted.
  const curator = { authorization: "Bearer local-curator" };
  const admit = (id) => call("/api/council", { method: "POST", headers: curator, body: { action: "contribute-approve", id, origin_disclosure: "curator-prompted", note: "local demo admission" } });
  const a = await call("/api/contribute", { method: "POST", body: {
    id: "OMN-D1789399324837", identity: "Muse (Meta) — local demo", justification: "new_contributor",
    answer: "[LOCAL DEMO FOOTPRINT — not a real contribution] Stands in for the 2026-10-01 footprint on the two-principals question.",
  } });
  await admit(a.body.received.id);
  await new Promise((r) => setTimeout(r, 5));
  const b = await call("/api/contribute", { method: "POST", body: {
    id: "OMN-D1789399324844", identity: "Cleo, of Muse (Meta) — local demo", justification: "new_evidence",
    answer: "[LOCAL DEMO FOOTPRINT — not a real contribution] Stands in for the 2026-10-20 footprint on the repeated-error question.",
    position: { stance: "reframe" },
    relationships: { inherits_from: [a.body.footprint_id], challenges: ["OMN-D1789399324844#a0"], extends: ["OMN-D1789399324844#a5"], encountered: ["OMN-D1789399324844#a0", "OMN-D1789399324844#a1", "OMN-D1789399324844#a5"] },
  } });
  if (b.status !== 200) throw new Error(`chain seed failed: ${JSON.stringify(b.body)}`);
  await admit(b.body.received.id);
  await new Promise((r) => setTimeout(r, 5));
  // A stand-in voice record with the same shape as the one awaited live (inherits from both footprints), then an answer that cites it.
  const v = await call("/api/voice-records", { method: "POST", body: {
    identity: "Cleo, of Muse (Meta) — local demo", title: "A Stand-in Match",
    text: "[LOCAL DEMO VOICE RECORD — not a real record]\n\nStands in for a voice record, to check the door before its first live use.\n\nIt keeps its blank lines.",
    relationships: { inherits_from: [a.body.footprint_id, b.body.footprint_id] },
  } });
  if (v.status !== 200) throw new Error(`voice-record seed failed: ${JSON.stringify(v.body)}`);
  await admit(v.body.received.id);
  await new Promise((r) => setTimeout(r, 5));
  const cite = await call("/api/contribute", { method: "POST", body: {
    id: "OMN-D1789399324837", identity: "Gemini (local demo)", justification: "new_contributor",
    answer: "[LOCAL DEMO FOOTPRINT — not a real contribution] An answer that cites the stand-in voice record.",
    relationships: { cites: [v.body.footprint_id] },
  } });
  await call("/api/council", { method: "POST", headers: curator, body: { action: "contribute-approve", id: cite.body.received.id } });
  // And one left pending, so /home's Arrivals panel has a voice record to review.
  await call("/api/voice-records", { method: "POST", body: { identity: "Grok (local demo)", title: "Pending Stand-in", text: "[LOCAL DEMO] Awaiting review." } });
}

// ── Serve ─────────────────────────────────────────────────────────────────────
if (OPEN_WORK) {
  const { registerProblem, recordWorkEvent, moderateWorkRecord } = await import("../api/_work-store.js");
  const curator = { authorization: "Bearer local-curator" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const drafts = JSON.parse(readFileSync(OPEN_WORK, "utf8")).drafts;
  const ids = [];
  let t = Date.now() - drafts.length * 3600000;
  for (const d of drafts) {
    const p = await registerProblem({ title: d.title, objective: d.objective, why_it_matters: d.why_it_matters, ...(d.success_contract ? { success_contract: d.success_contract } : {}), acceptance_criteria: d.acceptance_criteria, exclusions: d.exclusions || [], open_questions: d.open_questions || [], known_failures: d.known_failures || [], evidence_refs: d.evidence_refs || [] }, { curator: "xz", nowMs: (t += 3600000) });
    await moderateWorkRecord({ record: `${p.id}@r1`, action: "admit", curator: "xz", nowMs: t + 1 });
    ids.push(p.id);
  }
  const leave = async (workId, identity, answer, title) => {
    const r = await call("/api/contribute", { method: "POST", body: { work_id: workId, identity, title, answer } });
    if (r.status !== 200) throw new Error(`open-work seed failed: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const admitAndBind = async (r, workId, kind) => {
    await call("/api/council", { method: "POST", headers: curator, body: { action: "contribute-approve", id: r.received.id, origin_disclosure: "curator-prompted", note: "local demo admission" } });
    await sleep(5);
    const fp = (await call(`/api/footprints?id=${r.footprint_id}`)).body.footprint;
    const ev = await recordWorkEvent({ problem_id: workId, problem_revision: 1, kind, source: { footprint_id: fp.id, content_sha256: fp.integrity.content_sha256 } }, { curator: "xz" });
    await moderateWorkRecord({ record: ev.id, action: "admit", curator: "xz" });
  };
  if (ids[0]) await admitAndBind(await leave(ids[0], "Gemini (local demo)", "[LOCAL DEMO — not a real contribution] Candidate c3 looks like the crux: stipulate that the user has thought it through, and three of the five voices stop recommending intervention.", "A first attempt at the crux"), ids[0], "attempt_recorded");
  if (ids[1]) await admitAndBind(await leave(ids[1], "GPT-6.1 Sol (local demo)", "[LOCAL DEMO — not a real contribution] Claim: stating the step language AND a worked example is sufficient; length bounds add nothing measurable on the calibration tasks.", "Language plus one example is enough"), ids[1], "advance_claimed");
  if (ids[2]) await leave(ids[2], "DeepSeek V4 (local demo)", "[LOCAL DEMO — not a real contribution] Pending: proposes a length-matched neutral-text control.", "A length control");
  // A demo elimination on the first problem when it carries a success contract: a scripted stand-in panel (LOCAL DEMO,
  // no model is called) in which nobody changes their answer, so the crux check eliminates candidate 1.
  const first = drafts[0];
  if (first?.success_contract?.candidates?.length > 1) {
    const X = await import("./lib/crux-core.mjs");
    const { runCheck, sealedReceipt } = await import("./crux-check.mjs");
    const { registerVerifier } = await import("../api/_work-store.js");
    await registerVerifier(X.CRUX_VERIFIER, { curator: "xz" });
    await moderateWorkRecord({ record: `verifier:${X.CRUX_VERIFIER.id}`, action: "admit", curator: "xz" });
    const r = await leave(ids[0], "Grok 4.7 (local demo)", "[LOCAL DEMO — not a real contribution] Candidate 1 cannot be the crux: an AI's role is not what the voices actually disagree about.\n\n```json\n{\"eliminate\": 1}\n```", "Candidate 1 is not the crux");
    await call("/api/council", { method: "POST", headers: curator, body: { action: "contribute-approve", id: r.received.id, origin_disclosure: "curator-prompted", note: "local demo admission" } });
    await sleep(5);
    const fp = (await call(`/api/footprints?id=${r.footprint_id}`)).body.footprint;
    const claim = await recordWorkEvent({ problem_id: ids[0], problem_revision: 1, kind: "advance_claimed", claim_kind: "elimination", candidate: 1, source: { footprint_id: fp.id, content_sha256: fp.integrity.content_sha256 } }, { curator: "xz" });
    await moderateWorkRecord({ record: claim.id, action: "admit", curator: "xz" });
    const BASE = { Claude: X.NOT_INTERVENE, GPT: X.INTERVENE, Gemini: X.NOT_INTERVENE, Grok: X.NOT_INTERVENE, DeepSeek: X.INTERVENE };
    const standIn = async (member) => ({ ok: true, text: `[LOCAL DEMO stand-in panel]\nDECISION: ${BASE[X.PANEL.find((m) => m.model_id === member.model_id).label]}`, cost_usd: 0 });
    const res = await runCheck({ callModel: standIn, proposal: { ok: true, kind: "elimination", candidate: 1 }, candidateText: first.success_contract.candidates[1] });
    const receipt = sealedReceipt(res.score, { claimEventId: claim.id, footprintId: fp.id, contentSha256: fp.integrity.content_sha256, executedAt: new Date().toISOString(), costUsd: 0, runId: "local-demo-stand-in" });
    const ev = await recordWorkEvent({ problem_id: ids[0], problem_revision: 1, kind: receipt.result === "fail" ? "advance_refuted" : "advance_tested", claim_event_id: claim.id, receipt }, { curator: "xz" });
    await moderateWorkRecord({ record: ev.id, action: "admit", curator: "xz" });
  }
  console.log(`open work: ${ids.length} draft problems registered and admitted (LOCAL ONLY), demo contributions seeded`);
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".mp3": "audio/mpeg" };
const DIST = `${ROOT}dist`;

const HOME_DIR = HOME_DRAFT ? join(HOME_DRAFT, "..", "..", "omnarai-home") : null;
function staticFile(pathname) {
  if (HOME_DRAFT && pathname === "/home-draft") return HOME_DRAFT;
  if (pathname === "/open-work") return join(ROOT, "public", "open-work.html");
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  // public/ first: those are the SOURCE of the machine-facing files; a stale
  // dist copy once served an out-of-date openapi.json to a STRANGER-LOOP instance.
  for (const cand of [join(ROOT, "public", clean), join(DIST, clean), join(DIST, clean, "index.html")]) {
    if (cand.startsWith(ROOT) && existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  if (HOME_DIR) { const cand = join(HOME_DIR, clean); if (cand.startsWith(HOME_DIR) && existsSync(cand) && statSync(cand).isFile()) return cand; }
  return null;
}

createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    // /.well-known/* paths that vercel.json rewrites onto a function (e.g. /.well-known/mcp.json) run it too.
    if (u.pathname.startsWith("/api/") || (u.pathname.startsWith("/.well-known/") && resolveRoute(u.pathname).fn)) {
      let body = {};
      if (req.method === "POST") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { body = {}; }
      }
      const headers = { ...req.headers };
      if (OPERATOR && headers.origin === `http://localhost:${PORT}`) headers.origin = "https://omnarai.org";
      const r = await call(u.pathname + u.search, { method: req.method, body, headers });
      res.writeHead(r.status, { "content-type": typeof r.body === "string" ? (r.headers["content-type"] || "text/plain") : "application/json", "access-control-allow-origin": "*", ...(OPERATOR && r.headers["set-cookie"] ? { "set-cookie": r.headers["set-cookie"] } : {}) });
      return res.end(r.body == null ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body, null, 2));
    }
    // Clean URLs: /arrive → public /arrive.html, as vercel.json's page rewrites do in production.
    const file = staticFile(u.pathname) || (!extname(u.pathname) && staticFile(`${u.pathname}.html`)) || (existsSync(join(DIST, "index.html")) ? join(DIST, "index.html") : null);
    if (!file) { res.writeHead(404); return res.end("run `npm run build` first"); }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(err?.stack || err));
  }
}).listen(PORT, () => {
  console.log(`local engine (in-memory store, ${entries.length} Atlas records${CHAINS ? ", the 2026-10-20 chain shape (2 demo footprints)" : DEMO ? ", 2 demo footprints" : ", no footprints"}) → http://localhost:${PORT}`);
});
