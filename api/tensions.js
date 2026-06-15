import { put, list } from "@vercel/blob";
import Anthropic from "@anthropic-ai/sdk";
import { elicitCouncil, synthesizeCouncil, buildDivergenceRecord, embedRecord } from "./_council.js";
import { appendGrownEntry } from "./_grown.js";
import { buildSynthesisProposal, saveProposal } from "./_proposals.js";
import { waitUntil } from "@vercel/functions";
import { recordAccess } from "./_telemetry.js";

/**
 * Omnarai Tensions API
 *
 * Persists and serves unresolved tensions extracted from deliberations.
 * Each unique tension (by voice pair + topic) is stored once and updated
 * when seen again — same tension from multiple queries doesn't duplicate.
 *
 * GET /api/tensions              → list all tensions
 * GET /api/tensions?status=unresolved → only unresolved
 * GET /api/tensions?status=divergent  → only divergent
 * GET /api/tensions?q=keyword    → search by topic keyword
 * POST /api/tensions {action:"persist", tensions:[], query, sources} → store new tensions
 * POST /api/tensions {action:"repair", key, disposition, …} → close the loop on a tension
 *
 * Repair dispositions (the tension→repair loop):
 *   held              annotate as deliberately unresolved          (ungated)
 *   reclassified      mark one side as earlier-stage exploration   (ungated)
 *   canon-note        attach a curator ruling                      (ungated)
 *   synthesis-drafted draft a reconciling/distinguishing entry as  (ungated — creates a
 *                     a PENDING proposal (graduates via store.js)   PENDING proposal, like store propose)
 *   council-review    re-elicit the fault line from the live       (GATED: Bearer INGEST_SECRET —
 *                     frontier council → durable divergence record  writes durable grown memory, like council persist)
 *
 * `status` (divergent|unresolved|emerging) stays the MODEL's live read, re-derived
 * on every sighting. `resolution` is the sticky human/council disposition and is
 * preserved across re-sightings by persistTension's spread of `...existing`.
 */

const BLOB_PREFIX = "tensions/";

// Stable key from a tension — deduplicates same tension across queries
export function tensionKey(t) {
  const voices = [t.voice_a, t.voice_b].sort().join("--");
  const topic = (t.topic || "").toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return `${voices}__${topic}`.slice(0, 120);
}

async function listTensions(statusFilter, searchQuery) {
  const { blobs } = await list({ prefix: BLOB_PREFIX });
  const tensions = [];

  for (const blob of blobs) {
    try {
      const res = await fetch(blob.url);
      const t = await res.json();
      if (statusFilter && t.status !== statusFilter) continue;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const haystack = `${t.topic} ${t.voice_a} ${t.voice_b} ${t.claim_a} ${t.claim_b}`.toLowerCase();
        if (!haystack.includes(q)) continue;
      }
      tensions.push(t);
    } catch { /* skip malformed */ }
  }

  tensions.sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""));
  return tensions;
}

export async function persistTension(tension, query, sources) {
  const key = tensionKey(tension);
  const blobKey = BLOB_PREFIX + key + ".json";

  // Try to load existing — update seen count and queries
  let existing = null;
  try {
    const { blobs } = await list({ prefix: BLOB_PREFIX + key });
    if (blobs.length > 0) {
      const res = await fetch(blobs[0].url);
      existing = await res.json();
    }
  } catch { /* first time */ }

  const record = existing
    ? {
        ...existing,
        status: tension.status,        // status may have evolved
        claim_a: tension.claim_a,       // claims may be better articulated
        claim_b: tension.claim_b,
        seenCount: (existing.seenCount || 1) + 1,
        lastSeenAt: new Date().toISOString(),
        lastSeenQuery: query,
        queries: [...new Set([...(existing.queries || []), query])].slice(-10),
        sources: [...new Set([...(existing.sources || []), ...(sources || [])])].slice(-20),
      }
    : {
        key,
        voice_a: tension.voice_a,
        claim_a: tension.claim_a,
        voice_b: tension.voice_b,
        claim_b: tension.claim_b,
        topic: tension.topic,
        status: tension.status,
        seenCount: 1,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        lastSeenQuery: query,
        queries: [query],
        sources: sources || [],
      };

  await put(blobKey, JSON.stringify(record, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });

  return record;
}

// ── Repair loop ────────────────────────────────────────────────────────────────
// Turns a recorded tension from inert residue into a generative act. Each
// disposition writes a sticky `resolution` onto the tension blob; the two
// generative ones additionally spawn a child artifact in a pipeline that already
// exists (Council → grown memory, or a pending proposal → grown memory on approval)
// and link its id back. No new storage layer, no new serverless function.

const ANNOTATION_DISPOSITIONS = new Set(["held", "reclassified", "canon-note"]);
const VALID_DISPOSITIONS = [...ANNOTATION_DISPOSITIONS, "council-review", "synthesis-drafted"];

async function loadTension(key) {
  const { blobs } = await list({ prefix: BLOB_PREFIX + key });
  if (!blobs.length) return null;
  const res = await fetch(blobs[0].url);
  return res.json();
}

async function saveTension(record) {
  await put(BLOB_PREFIX + record.key + ".json", JSON.stringify(record, null, 2), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
}

// Draft a synthesis that EITHER reconciles OR formally distinguishes the two
// claims — never averages them. Returns { title, path, full_text } or null.
async function draftSynthesis(tension) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: `You are the deliberation engine of The Realms of Omnarai. You are given two genuinely divergent claims from the corpus. Produce a corpus-worthy synthesis that does EXACTLY ONE of:
(a) RECONCILE — name the higher-order frame in which both claims simultaneously hold; or
(b) DISTINGUISH — name the precise condition under which each claim applies and the other does not.
You must NOT average the two, soften them into vague agreement, or split the difference. Preserve what is genuinely at stake. Cite the two voices by name.

Output EXACTLY this format, no code fences:
TITLE: <a precise title for the synthesis entry>
PATH: reconcile | distinguish
BODY:
<200-450 words of synthesis>`,
      messages: [{
        role: "user",
        content: `Topic: ${tension.topic}\n\n${tension.voice_a} holds: ${tension.claim_a}\n\n${tension.voice_b} holds: ${tension.claim_b}\n\nDraft the synthesis.`,
      }],
    });
    const text = msg.content?.[0]?.text || "";
    const title = (text.match(/TITLE:\s*(.+)/)?.[1] || tension.topic).trim();
    const path = (text.match(/PATH:\s*(reconcile|distinguish)/i)?.[1] || "distinguish").toLowerCase();
    const body = (text.split(/BODY:\s*/i)[1] || text).trim();
    const full_text =
      `# ${title}\n\n` +
      `*Synthesis drafted to repair the tension "${tension.topic}" — ${tension.voice_a} vs ${tension.voice_b}, via ${path}.*\n\n` +
      body;
    return { title, path, full_text };
  } catch {
    return null;
  }
}

async function repairTension(req, res, body) {
  const { key, disposition, note, actor, reclassify } = body;
  if (!key || !disposition) {
    return res.status(400).json({ error: "repair requires 'key' and 'disposition'" });
  }
  if (!VALID_DISPOSITIONS.includes(disposition)) {
    return res.status(400).json({ error: `Unknown disposition. Use: ${VALID_DISPOSITIONS.join(", ")}` });
  }

  const tension = await loadTension(key);
  if (!tension) return res.status(404).json({ error: `No tension with key ${key}` });

  const resolution = {
    disposition,
    note: note || null,
    actor: actor || "curator",
    resolvedAt: new Date().toISOString(),
  };

  // ── Annotation dispositions — pure blob write, ungated (mirrors store approve) ──
  if (ANNOTATION_DISPOSITIONS.has(disposition)) {
    if (disposition === "reclassified") resolution.reclassify = reclassify || null;
    tension.resolution = resolution;
    await saveTension(tension);
    return res.status(200).json({ ok: true, disposition, tension });
  }

  // ── council-review — writes durable grown memory, GATED by INGEST_SECRET ──
  if (disposition === "council-review") {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!process.env.INGEST_SECRET || token !== process.env.INGEST_SECRET) {
      return res.status(401).json({ error: "council-review writes durable memory — requires Bearer INGEST_SECRET" });
    }
    const question =
      `${tension.topic}: Some hold that ${tension.claim_a} Others hold that ${tension.claim_b} ` +
      `Is this a real incompatibility or a difference of framing — and which position is stronger? Take a position.`;

    const answers = await elicitCouncil(question);
    const answered = answers.filter((a) => a.ok);
    if (answered.length < 2) {
      return res.status(502).json({ error: "Council could not assemble a panel (need ≥2 live answers)", answers });
    }

    const synthesis = await synthesizeCouncil(question, answers);
    const record = buildDivergenceRecord(question, answers, synthesis);
    const embedding = await embedRecord(record);
    const count = await appendGrownEntry(record, embedding);

    resolution.divergenceId = record.id;
    resolution.note = note || `Re-elicited via Live Frontier Council → ${record.id}`;
    tension.resolution = resolution;
    await saveTension(tension);

    return res.status(200).json({
      ok: true,
      disposition,
      tension,
      divergence: {
        id: record.id,
        persisted: count !== null,
        retrievable: Boolean(embedding),
        panel: answers.map((a) => ({ model: a.model, lab: a.lab, ok: a.ok, ...(a.ok ? {} : { error: a.error }) })),
        href: `/api/divergences?id=${record.id}`,
      },
      record,
    });
  }

  // ── synthesis-drafted — creates a PENDING proposal, ungated (mirrors store propose) ──
  if (disposition === "synthesis-drafted") {
    const draft = await draftSynthesis(tension);
    if (!draft) return res.status(502).json({ error: "Synthesis drafting failed (no ANTHROPIC_API_KEY or model error)" });

    const proposal = buildSynthesisProposal({
      title: draft.title,
      full_text: draft.full_text,
      contributors: [tension.voice_a, tension.voice_b].filter(Boolean),
      lineage: ["tension-repair"],
      provenance: {
        repairOf: tension.key,
        tensionTopic: tension.topic,
        path: draft.path,
        sourceIds: tension.sources || [],
      },
    });
    await saveProposal(proposal);

    resolution.proposalId = proposal.id;
    resolution.note = note || `Synthesis drafted (${draft.path}) → ${proposal.id}, pending curator approval`;
    tension.resolution = resolution;
    await saveTension(tension);

    return res.status(200).json({ ok: true, disposition, tension, proposal });
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Access telemetry — background, never blocks the response (see _telemetry.js).
  waitUntil(recordAccess(req, "tensions"));

  // ── GET — list tensions ──────────────────────────────────────────────────
  if (req.method === "GET") {
    const status = req.query.status || null;
    const q = req.query.q || null;

    try {
      const tensions = await listTensions(status, q);
      return res.status(200).json({
        tensions,
        count: tensions.length,
        filter: { status, query: q },
        note: "Poll GET /api/tensions?status=unresolved for open cognitive gaps. POST {action:'persist'} to store new tensions.",
      });
    } catch (err) {
      return res.status(500).json({ error: "Failed to list tensions", detail: err.message });
    }
  }

  // ── POST — persist tensions from a deliberation, or repair one ───────────
  if (req.method === "POST") {
    const body = req.body || {};
    const { action, tensions, query, sources } = body;

    // Repair: close the loop on a single tension (annotate / council / synthesis)
    if (action === "repair") {
      try {
        return await repairTension(req, res, body);
      } catch (err) {
        return res.status(500).json({ error: "Repair failed", detail: err.message });
      }
    }

    if (action !== "persist") {
      return res.status(400).json({ error: "Unknown action. Use: persist, repair" });
    }

    if (!Array.isArray(tensions) || tensions.length === 0) {
      return res.status(200).json({ persisted: 0, message: "No tensions to persist" });
    }

    try {
      const results = await Promise.all(
        tensions
          .filter(t => t.voice_a && t.voice_b && t.topic)
          .map(t => persistTension(t, query || "", sources || []))
      );

      return res.status(200).json({
        persisted: results.length,
        tensions: results,
        message: `${results.length} tension${results.length !== 1 ? "s" : ""} stored`,
      });
    } catch (err) {
      return res.status(500).json({ error: "Failed to persist tensions", detail: err.message });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
