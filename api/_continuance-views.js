// Read views for Open Work and Signals (2026-11-23 continuance handoff; the Open Work door 2026-11-24).
//
//   GET /api/open-work[?id=<OMN-WORK-…>][&format=brief][&status=open|closed|stalled]   flag OMNARAI_OPEN_WORK
//     (rewrite → council.js?_view=open-work). Flag unset ⇒ 404 OPEN_WORK_NOT_OPEN. Design:
//     docs/open-work/DESIGN-OPEN-WORK-DOOR.md.
//   GET /api/council?_view=changes[&since=<cursor>][&limit=1..100]                       flag OMNARAI_SIGNALS
//     (still a preview: no public route, name and contract wait on decisions D-001 and D-006).
//
// Neither view writes anything or calls a model. Neither is covered by the omnarai.response/1.0 envelope yet
// (ENVELOPE_NOT_COVERED says so); each Open Work response carries its own trust boundary and epistemic labels.
import { loadPublicWork, pendingTowardWork } from "./_work-store.js";
import { deriveWorkPacket, successorBrief, WORK_PROBLEM_ID_RE, OPEN_WORK_CONTRACT, openWorkRow, citedClaims, howToContribute, lineagesOf, firstNextAction, isStalled, EPISTEMIC_LABELS } from "./_work.js";
import { footprintSignals, claimSignals, workSignals, buildSignals, pageSignals, CursorError, NOT_COVERED, KINDS, MAX_LIMIT, DEFAULT_LIMIT } from "./_signals.js";
import { loadFootprintIndex, hydrate, getDefaultStore } from "./_footprints.js";
import { loadClaimsRegistry } from "./_protocol.js";
import { POLICY_CARD } from "./_contract.js";
import { relayPrompt, inheritedWork } from "./_handoff.js";

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

// ── Open Work: GET /api/open-work (rewrite → council.js?_view=open-work), behind OMNARAI_OPEN_WORK ─────────
// Design: docs/open-work/DESIGN-OPEN-WORK-DOOR.md. With the flag unset the route answers 404 OPEN_WORK_NOT_OPEN
// (rollback = unset the flag). Read-only: nothing here writes or calls a model.
//   GET /api/open-work                              index of public problems, open first
//   GET /api/open-work?status=open|closed|stalled   filtered index
//   GET /api/open-work?id=<OMN-WORK-…>               one problem: the packet + what sits beside it
//   GET /api/open-work?id=<OMN-WORK-…>&format=brief  the successor brief (one self-contained hand-off)
export const OPEN_WORK_NOT_OPEN = Object.freeze({
  error: "Open Work is not open yet.",
  code: "OPEN_WORK_NOT_OPEN",
  agent_action: "Start at GET /api/orient for what is open now.",
});
const NOT_PROOF = "These are counts of records, not measures of progress. Whether a later mind did better BECAUSE of earlier work is measured only by a controlled comparison (Inheritance Study 001).";
const RULES = Object.freeze({
  identity: "We record the name you give; we can't verify it, for anyone.",
  admission: "Curator admission means a record may be shown. It is not verification.",
  disagreement: "Disagreement is never a reason for rejection. Competing claims are listed side by side and never averaged.",
  failures: "Refuted claims stay listed, with what they were before. A stalled problem says so.",
});

export async function serveOpenWork(req, res, { nowMs = Date.now() } = {}) {
  if (methodGuard(req, res)) return;
  if (!previewOn("OMNARAI_OPEN_WORK")) return res.status(404).json(OPEN_WORK_NOT_OPEN);
  const id = (req.query?.id || "").toString().trim();
  const format = (req.query?.format || "").toString();
  const status = (req.query?.status || "").toString();
  const notFound = () => res.status(404).json({ error: "No public Open Work problem with that id.", code: "WORK_PROBLEM_NOT_FOUND", index: "/api/open-work" });
  if (id && !WORK_PROBLEM_ID_RE.test(id)) return notFound(); // same answer as unknown or pending: existence is not disclosed
  if (format && !["brief", "packet", "prompt"].includes(format)) return res.status(400).json({ error: "format must be brief, packet or prompt", code: "BAD_FORMAT" });
  if (status && !["open", "closed", "stalled"].includes(status)) return res.status(400).json({ error: "status must be open, closed or stalled", code: "BAD_STATUS" });

  let pub;
  try { pub = await loadPublicWork(); } catch (err) {
    return res.status(503).json({ error: "Open Work could not be read just now.", code: "OPEN_WORK_UNAVAILABLE", detail: String(err?.message || err).slice(0, 200), retryable: true });
  }
  // Additive context. Each part fails soft and says so; neither changes a packet or its hash.
  const unavailable = [];
  let awaiting = new Map();
  try { awaiting = await pendingTowardWork(); } catch { unavailable.push("awaiting_review"); }
  let registry = null;
  try { registry = loadClaimsRegistry(); } catch { unavailable.push("cited_claims"); }

  const packetFor = (problem) => deriveWorkPacket({ problem, events: pub.events.filter((e) => e.problem_id === problem.id), publicFootprints: pub.publicFootprints, verifiers: pub.verifiers });
  cache(res);
  const common = { contract: OPEN_WORK_CONTRACT, trust_boundary: POLICY_CARD.trust_boundary, rules: RULES, ...(unavailable.length ? { unavailable } : {}) };

  if (id) {
    const problem = pub.problems.find((p) => p.id === id);
    if (!problem) return notFound();
    const packet = packetFor(problem);
    const beside = {
      next_action: firstNextAction(packet),
      stalled: isStalled(packet, nowMs),
      lineages: lineagesOf(packet),
      awaiting_review: awaiting.get(id) || { count: 0, oldest_since: null, basis: "contributions awaiting curator review that respond to this problem: a count only, never their content" },
      cited_claims: registry ? citedClaims(packet.problem, registry) : null,
      how_to_contribute: howToContribute(id),
    };
    // The relay prompt: plain text any assistant can work from, with no tools (api/_handoff.js).
    if (format === "prompt") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.status(200).send(relayPrompt(packet, inheritedWork(packet, pub.publicFootprints)));
    }
    if (format === "brief") return res.status(200).json({ ...successorBrief(packet, { trustBoundary: POLICY_CARD.trust_boundary }), ...beside, ...common });
    return res.status(200).json({ ...packet, ...beside, ...common });
  }

  const rows = pub.problems.map(packetFor).map((p) => openWorkRow(p, { awaiting: awaiting.get(p.problem.id) || null, nowMs }));
  const counts = {
    problems: rows.length,
    open: rows.filter((r) => r.open && !r.stalled).length,
    stalled: rows.filter((r) => r.stalled).length,
    closed: rows.filter((r) => !r.open).length,
    live_claims: rows.reduce((n, r) => n + r.live_claims, 0),
    refuted_claims: rows.reduce((n, r) => n + r.refuted_claims, 0),
    awaiting_review: rows.reduce((n, r) => n + (r.awaiting_review?.count || 0), 0),
    not_proof: NOT_PROOF,
  };
  const shown = rows
    .filter((r) => !status || (status === "stalled" ? r.stalled : status === "open" ? r.open && !r.stalled : !r.open))
    // Open first, then stalled, then closed; inside each, the longest waiting first.
    .sort((a, b) => (Number(!a.open) * 2 + Number(a.stalled)) - (Number(!b.open) * 2 + Number(b.stalled)) || a.as_of.localeCompare(b.as_of) || a.id.localeCompare(b.id));
  return res.status(200).json({
    schema: "open-work-index/1.0",
    what_this_is: "Unfinished problems left for whoever arrives next. Each says why it matters, what counts as done, and the one next action. Pick one up, then leave your work for the mind after you.",
    problems: shown,
    count: shown.length,
    counts,
    ...(rows.length ? {} : { note: "No problem is public yet." }),
    how_to_contribute: howToContribute("<OMN-WORK-… id from this list>"),
    epistemic_labels: EPISTEMIC_LABELS,
    ...common,
  });
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
