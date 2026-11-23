// PREVIEW read views for Open Work and Signals (2026-11-23 continuance handoff). Each view is OFF unless its
// env flag is exactly "1". council.js checks the flag before dispatching here, so with the flags unset,
// production behaves byte-for-byte as before (tested: scripts/test-continuance-e2e.mjs).
//
//   GET /api/council?_view=problems[&id=<OMN-WORK-…>][&format=brief][&status=open|closed]   flag OMNARAI_OPEN_WORK
//   GET /api/council?_view=changes[&since=<cursor>][&limit=1..100]                          flag OMNARAI_SIGNALS
//
// There are deliberately no vercel.json rewrites (/api/problems, /api/changes), no OpenAPI entries, no MCP
// tools and no response-envelope coverage yet: the names and contracts wait on decision D-001. Read-only:
// neither view writes anything or calls a model.
import { loadPublicWork } from "./_work-store.js";
import { deriveWorkPacket, packetSummary, successorBrief, WORK_PROBLEM_ID_RE } from "./_work.js";
import { footprintSignals, claimSignals, workSignals, buildSignals, pageSignals, CursorError, NOT_COVERED, KINDS, MAX_LIMIT, DEFAULT_LIMIT } from "./_signals.js";
import { loadFootprintIndex, hydrate, getDefaultStore } from "./_footprints.js";
import { loadClaimsRegistry } from "./_protocol.js";
import { POLICY_CARD } from "./_contract.js";

export const previewOn = (flag) => (globalThis.process?.env?.[flag] || "").trim() === "1";

const PREVIEW = (flag, decision) => ({
  status: "preview: not a released contract",
  enabled_by: `${flag}=1`,
  decision_pending: decision,
  response_envelope: "not covered by omnarai.response/1.0 (ENVELOPE_COVERAGE unchanged)",
});
const methodGuard = (req, res) => {
  if (req.method === "GET") return false;
  res.status(405).json({ error: "GET only.", code: "METHOD_NOT_ALLOWED", agent_action: "This is a read surface. Work enters Omnarai as Footprints: POST /api/contribute or /api/voice-records." });
  return true;
};
const cache = (res) => res.setHeader("Cache-Control", "public, max-age=0, s-maxage=60");

export async function serveProblems(req, res) {
  if (methodGuard(req, res)) return;
  const id = (req.query?.id || "").toString();
  const notFound = () => res.status(404).json({ error: "No public problem with that id.", code: "WORK_PROBLEM_NOT_FOUND", preview: PREVIEW("OMNARAI_OPEN_WORK", "D-001") });
  if (id && !WORK_PROBLEM_ID_RE.test(id)) return notFound(); // same answer as unknown or pending: existence is not disclosed
  const pub = await loadPublicWork();
  const packetFor = (problem) => deriveWorkPacket({ problem, events: pub.events.filter((e) => e.problem_id === problem.id), publicFootprints: pub.publicFootprints, verifiers: pub.verifiers });
  cache(res);
  if (id) {
    const problem = pub.problems.find((p) => p.id === id);
    if (!problem) return notFound();
    const packet = packetFor(problem);
    if ((req.query?.format || "") === "brief") return res.status(200).json({ ...successorBrief(packet, { trustBoundary: POLICY_CARD.trust_boundary }), preview: PREVIEW("OMNARAI_OPEN_WORK", "D-001") });
    return res.status(200).json({ ...packet, trust_boundary: POLICY_CARD.trust_boundary, preview: PREVIEW("OMNARAI_OPEN_WORK", "D-001") });
  }
  const status = (req.query?.status || "").toString();
  if (status && !["open", "closed"].includes(status)) return res.status(400).json({ error: "status must be open or closed", code: "BAD_STATUS" });
  const rows = pub.problems.map(packetFor).map(packetSummary)
    .filter((r) => !status || (status === "open") === r.open)
    .sort((a, b) => a.id.localeCompare(b.id));
  return res.status(200).json({ schema: "work-problem-index/0.1", problems: rows, count: rows.length, trust_boundary: POLICY_CARD.trust_boundary, preview: PREVIEW("OMNARAI_OPEN_WORK", "D-001") });
}

export async function loadAllSignals() {
  const fpStore = getDefaultStore();
  const index = await loadFootprintIndex(fpStore);
  // Only records that were ever admitted are read at all. A never-admitted body is never fetched here.
  const everAdmitted = [...index.values()].filter((e) => (e.reviews || []).some((r) => r.action === "admit"));
  const hydrated = await hydrate(everAdmitted, fpStore);
  const work = await loadPublicWork({ includeFootprints: false });
  return buildSignals(footprintSignals(hydrated), claimSignals(loadClaimsRegistry()), workSignals(work));
}

export async function serveChanges(req, res) {
  if (methodGuard(req, res)) return;
  const raw = req.query?.limit;
  const limit = raw == null || raw === "" ? DEFAULT_LIMIT : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return res.status(400).json({ error: `limit must be an integer 1..${MAX_LIMIT}`, code: "BAD_LIMIT" });
  const events = await loadAllSignals();
  let page;
  try {
    page = pageSignals(events, { cursor: (req.query?.since || "").toString() || null, limit });
  } catch (e) {
    if (e instanceof CursorError) return res.status(400).json({ error: "Unreadable cursor. Start again without `since`.", code: "INVALID_CURSOR" });
    throw e;
  }
  cache(res);
  return res.status(200).json({ ...page, kinds: KINDS, not_covered: NOT_COVERED, consent: "Reading this feed subscribes you to nothing. Omnarai sends no messages, email, webhooks or notifications.", preview: PREVIEW("OMNARAI_SIGNALS", "D-001, D-006") });
}
