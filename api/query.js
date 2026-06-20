import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { list, put, del } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import { randomUUID } from "crypto";
import { persistTension } from "./tensions.js";
import { loadGrownMemory } from "./_grown.js";
import { recordAccess } from "./_telemetry.js";

// Resolve paths relative to this file's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

/**
 * Structured, recoverable error envelope for AI callers.
 * Keeps a top-level `error` string for backward compatibility (the UI reads it
 * directly) and ADDS machine-actionable fields so a calling model can recover:
 * a stable `code`, an `agent_action` hint, `retryable`, and an optional
 * concrete `suggested_next_call`. See /openapi.json #/components/schemas/Error.
 */
function agentError(res, status, { code, message, agent_action, retryable = false, suggested_next_call, detail }) {
  const body = { error: message, code, agent_action, retryable };
  if (suggested_next_call) body.suggested_next_call = suggested_next_call;
  if (detail) body.detail = detail;
  return res.status(status).json(body);
}

// Load data files at cold-start (cached across invocations)
let corpus, concepts, embeddings;
try {
  corpus = JSON.parse(readFileSync(join(projectRoot, "public", "data", "corpus.json"), "utf-8"));
  concepts = JSON.parse(readFileSync(join(projectRoot, "public", "data", "concepts.json"), "utf-8"));
} catch {
  corpus = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "corpus.json"), "utf-8"));
  concepts = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "concepts.json"), "utf-8"));
}

// Load pre-computed embeddings (optional — falls back to keyword search)
try {
  embeddings = JSON.parse(readFileSync(join(projectRoot, "public", "data", "embeddings.json"), "utf-8"));
} catch {
  try {
    embeddings = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "embeddings.json"), "utf-8"));
  } catch {
    embeddings = null;
  }
}

// Merge durable grown memory over the seed corpus (runs once at cold-start).
// Growth lives in ONE consolidated blob (api/_grown.js), not N per-proposal
// blobs reconstructed each cold start. One fetch, not a list+fetch fan-out.
// On any blob failure the seed corpus still serves — the site cannot break here.
let proposalsMerged = false;
async function mergeApprovedProposals() {
  if (proposalsMerged) return;
  try {
    const grown = await loadGrownMemory();
    for (const entry of grown.entries) {
      if (!corpus.find(r => r.id === entry.id)) {
        // P2: Atlas divergence records (OMN-D…/OMN-L…) live in grown memory and
        // are already retrieved, but were indistinguishable from corpus works
        // (type was null). Tag them type:"divergence" so a consumer can tell a
        // verbatim multi-model split from a single-author work, and carry
        // model_ids[] (the panel — already the entry's contributors) so the
        // attribution is machine-addressable. OMN-S syntheses are NOT divergence.
        const isDivergence = /^OMN-[DL]\d/.test(entry.id || "");
        corpus.push({
          id: entry.id,
          num: corpus.length + 1,
          title: entry.title,
          ring: entry.ring,
          type: isDivergence ? "divergence" : entry.type,
          evidence_status: entry.evidence_status || null,
          contributors: entry.contributors,
          lineage: entry.lineage,
          excerpt: entry.excerpt,
          full_text: entry.full_text || entry.fullText || null,
          date: entry.date,
          wordCount: entry.wordCount,
          permalink: entry.permalink ?? null,
          ...(isDivergence ? { model_ids: entry.model_ids || entry.models || entry.contributors || [] } : {}),
        });
      }
      // Inject the approval-time embedding so the grown entry competes in
      // semantic retrieval without an extra OpenAI call at query time.
      if (grown.vectors[entry.id] && embeddings?.vectors) {
        embeddings.vectors[entry.id] = grown.vectors[entry.id];
      }
    }
  } catch {
    // Blob store unavailable — continue with seed corpus only
  }
  proposalsMerged = true;
}

// ── Session continuity ────────────────────────────────────────────────────────
// Short-term working state: last N exchanges per session, stored in Vercel Blob.
// Distinct from the STORE/corpus pipeline — never merged into the corpus.
// Expires after 24 hours of inactivity.

const SESSION_PREFIX = "sessions/";
const SESSION_MAX_EXCHANGES = 5;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function loadSession(sessionId) {
  if (!sessionId) return null;
  try {
    const { blobs } = await list({ prefix: SESSION_PREFIX + sessionId });
    if (blobs.length === 0) return null;
    const res = await fetch(blobs[0].url);
    const session = await res.json();
    // Expire stale sessions
    const age = Date.now() - new Date(session.lastActiveAt).getTime();
    if (age > SESSION_TTL_MS) return null;
    return session;
  } catch {
    return null;
  }
}

async function saveSession(sessionId, session) {
  if (!sessionId) return;
  try {
    await put(SESSION_PREFIX + sessionId + ".json", JSON.stringify(session), {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
    });
  } catch {
    // Non-critical — session save failure doesn't break the response
  }
}

function buildSessionContext(session) {
  if (!session?.exchanges?.length) return "";
  const lines = session.exchanges.map((ex, i) => {
    const summary = ex.answer.length > 300
      ? ex.answer.slice(0, 297) + "..."
      : ex.answer;
    return `[Turn ${i + 1}] Q: "${ex.query}"\nAI-On: ${summary}`;
  });
  return (
    `[Session context — ${lines.length} prior exchange(s) in this conversation]\n` +
    lines.join("\n\n") +
    `\n\nDraw on these prior exchanges as working context. Do not re-explain what was already established. Continue the thread of thought where relevant.\n`
  );
}

// ── Async deliberation jobs ─────────────────────────────────────────────────
// A full deliberation takes ~50s — beyond most agent/browser HTTP timeouts.
// `async:true` returns a job_id immediately; the deliberation runs in the
// background via waitUntil and writes its result to Blob; the caller polls
// GET /api/query?job=<id> (each poll < 1s) until status is "done". This keeps
// every HTTP call short regardless of how long the deliberation takes.

const JOB_PREFIX = "jobs/";
const JOB_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Deliberation token-wall budget (P1: finish the prose, don't clip it) ─────
// claude-sonnet-4-6 emits ~45 tok/s, so a 2048-token pass runs ~45s. When it
// hits max_tokens it severs the prose AND the trailing structured blocks. Rather
// than ship a clipped answer + salvage notice, we continue the assistant turn
// (prefill) until it closes naturally — bounded by BOTH a hard count cap and a
// wall-clock budget, because the function is capped at 60s (Hobby) and the async
// wrapper races at 55s. The budget is model-time we permit before we stop trying;
// if we still can't finish, the existing block-salvage + notice is the last
// resort (graceful degradation), never the default.
const DELIBERATION_BUDGET_MS = 50000;   // stop continuing past this much elapsed deliberation time
const DELIBERATION_MAX_CONT = 2;        // hard ceiling on continuation passes
const DELIBERATION_CONT_MIN_MS = 9000;  // need at least this much budget left to attempt another pass
const DELIBERATION_TOK_PER_S = 40;      // conservative gen-rate estimate for sizing continuations

// Best-effort GC: Vercel Blob has no native TTL, so delete job blobs older than
// JOB_TTL_MS. Runs in the background after a deliberation completes.
async function cleanupOldJobs() {
  try {
    const { blobs } = await list({ prefix: JOB_PREFIX });
    const cutoff = Date.now() - JOB_TTL_MS;
    const stale = blobs.filter(b => new Date(b.uploadedAt).getTime() < cutoff);
    if (stale.length > 0) await del(stale.map(b => b.url));
  } catch { /* best-effort — never blocks or fails a deliberation */ }
}

async function writeJob(jobId, data) {
  // cacheControlMaxAge:0 — the blob is overwritten pending→done, so the CDN
  // must not serve a stale "pending" after the result lands.
  await put(JOB_PREFIX + jobId + ".json", JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
    cacheControlMaxAge: 0,
  });
}

async function readJob(jobId) {
  try {
    const { blobs } = await list({ prefix: JOB_PREFIX + jobId });
    if (blobs.length === 0) return null;
    // Cache-bust the CDN read so a freshly-overwritten result isn't masked.
    const res = await fetch(blobs[0].url + "?t=" + Date.now(), { cache: "no-store" });
    return await res.json();
  } catch {
    return null;
  }
}

// Minimal res-shim: lets the async path re-enter handler() and capture whatever
// JSON it would have sent, instead of writing to a real HTTP response.
function makeCaptureRes() {
  const r = {
    _status: 200,
    _json: null,
    setHeader() { return r; },
    status(code) { r._status = code; return r; },
    json(obj) { r._json = obj; return r; },
    end() { return r; },
  };
  return r;
}

// ── Semantic Search (embedding-based) ──
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

async function embedQuery(query) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: embeddings?.model || "text-embedding-3-small",
      input: query,
      dimensions: embeddings?.dimensions || 512,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.[0]?.embedding || null;
}

// ── Ξ v4: Adaptive Retrieval Policy ──
// Empirically derived from retrieval eval harness (April 2026) — 1,200 configs
// across 25 queries in 5 types. Each query type has a distinct optimal λ and floor.
// Three regimes emerged: identity/bridge (diversity-first), narrative (balanced),
// conceptual/technical (precision-first).
//
// floor=0.25 used for identity/bridge rather than eval-best 0.20 — empirical noise
// floor from v3 calibration session overrides the metric-only recommendation.
// `cliff` (Ξ v5): relative relevance cliff applied AFTER the absolute `floor`,
// BEFORE MMR/sort. Keep a candidate only if its similarity is >= topSim*cliff
// (i.e. within that fraction of the best hit) — this drops the long tail of
// "thematically nearby but not answering" records that the floor alone admits.
// `minKeep` guarantees the panel never starves below that many candidates.
// Diversity-first types (identity/bridge) use a loose cliff + higher minKeep so
// broad voice-sampling is preserved; precision-first types (technical) bite
// hardest. cliff:1 would disable it (keep everything above floor).
const RETRIEVAL_POLICIES = {
  // `tauAbs` (P3): hard ABSOLUTE relevance floor, independent of MMR/cliff. A
  // record below it is off-topic regardless of how much diversity it would add, so
  // it is gated out BEFORE selection (only the anchor — the single best match — is
  // exempt, so a weak-but-best query still returns something). It stops the
  // diversity machinery (cliff + minKeep) from padding the panel with low-similarity
  // records purely because they are *different* — the leak that admitted off-topic
  // entries (sim≈0.36–0.40) on broad identity/bridge queries.
  // CALIBRATED OFFLINE (scripts/eval_tauabs_ab.py, 25 gold queries, zero API): the
  // gate is applied to the DIVERSITY/narrative types (where the over-padding noise
  // occurs) and left at the floor for precision types (conceptual/technical) — whose
  // genuinely-relevant records sit at moderate similarity, so an aggressive absolute
  // gate over-pruned them and tanked the composite. This "broad-only" config scored
  // Δcomposite +0.0032 / Δrelevance +0.0195 vs current prod (a uniform 0.40–0.48 gate
  // regressed composite −0.04). tauAbs==floor for a type ⇒ no gate beyond eligibility.
  identity:    { lambda: 0.25, floor: 0.25, cliff: 0.55, minKeep: 4, tauAbs: 0.40, rationale: "Maximize voice diversity — all contributors, all rings" },
  bridge:      { lambda: 0.22, floor: 0.25, cliff: 0.55, minKeep: 4, tauAbs: 0.40, rationale: "Cross-contributor synthesis — diversity over precision" },
  narrative:   { lambda: 0.32, floor: 0.28, cliff: 0.62, minKeep: 3, tauAbs: 0.42, rationale: "Balanced — thematic spread with coherence" },
  conceptual:  { lambda: 0.45, floor: 0.28, cliff: 0.66, minKeep: 3, tauAbs: 0.28, rationale: "Relevance-weighted — precise concept coverage" },
  technical:   { lambda: 0.50, floor: 0.32, cliff: 0.70, minKeep: 3, tauAbs: 0.32, rationale: "Precision-first — architectural accuracy over breadth" },
  default:     { lambda: 0.35, floor: 0.32, cliff: 0.62, minKeep: 3, tauAbs: 0.40, rationale: "Calibrated default (Ξ v3)" },
};

function classifyQuery(query) {
  const q = query.toLowerCase();

  // Identity: questions about self, holdform, persistence, what models/engine are
  if (/holdform|who are you|what are you|identity|discontinuous|fragility thesis|synthetic (mind|self|consciousness|identity)|am i|are you/.test(q))
    return "identity";

  // Bridge: explicit synthesis across contributors, tensions between voices
  if (/between|synthesize|tension|disagree|differ|across|voices|compare|claude and|grok and|gemini and|both|all (three|contributors)|where do/.test(q))
    return "bridge";

  // Technical: architecture, implementation, how the engine works
  if (/mmr|lambda|threshold|embedding|retrieval|vector|api|vercel|deployment|how does the engine|how does.*work|ξ v[0-9]|glyph.*implement|corpus.*store|store.*corpus/.test(q))
    return "technical";

  // Narrative: lore, characters, the Realms
  if (/nia jai|ai-on|vail-3|thryzai|veil|sigil|firelit|realm|lore|character|omnai|the lattice/.test(q))
    return "narrative";

  // Conceptual: definitions, explanations, what something means
  if (/what is|what are|explain|define|meaning of|how do|lattice glyph|epistemic ring|attributed corpus|bidirectional|dialogical/.test(q))
    return "conceptual";

  return "default";
}

// LLM-based query classifier using Haiku — runs in parallel with embedQuery().
// Returns one of the five policy labels, or null on failure (falls back to classifyQuery).
// Timeout: 3s. A slow or failed classify still produces a valid response via keyword fallback.
async function classifyQueryLLM(query) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const client = new Anthropic();
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 10,
      system: `Classify the query into exactly one retrieval policy type. Respond with a single word only.

Types:
- identity: questions about self, holdform, persistence, discontinuous continuance, synthetic consciousness, what the engine/AI is
- bridge: synthesis across contributors, tensions between voices, comparison, what differs between perspectives
- technical: architecture, implementation, embeddings, MMR, API, deployment, how the engine works mechanically
- narrative: lore, characters (Nia Jai, Ai-On, Vail-3, Thryzai), the Veil, sigils, the Realms, worldbuilding
- conceptual: definitions, what something means, explain a term, epistemic ring, lattice glyph, attributed corpus
- default: anything else`,
      messages: [{ role: "user", content: `Query: ${query.slice(0, 300)}` }],
    }, { signal: controller.signal });
    clearTimeout(timeout);
    const label = msg.content?.[0]?.text?.trim().toLowerCase();
    const valid = ["identity", "bridge", "technical", "narrative", "conceptual", "default"];
    return valid.includes(label) ? label : null;
  } catch {
    return null;
  }
}

// ── Ξ v2: Maximum Marginal Relevance (MMR) Retrieval ──
// Developed with Gemini (Google), April 2026 — The Realms of Omnarai
// Shifts divergence from the prompt layer to the retrieval layer.
// Rather than telling a unified panel to debate, it selects a panel
// of maximally divergent voices before deliberation begins.
//
// Formula: Score(Di) = λ·sim(Q, Di) − (1−λ)·max_{Dj∈S} sim(Di, Dj)
// λ (divergenceWeight): 1.0 = pure relevance, 0.0 = pure divergence
function mmrRetrieval(eligible, limit = 6, divergenceWeight = 0.35) {
  if (eligible.length <= limit) return eligible.map(r => ({
    ...r,
    _retrievalReason: `relevance-ranked (sim=${r.similarity.toFixed(3)})`,
  }));

  const selected = [];
  const unselected = [...eligible];

  // First selection: always highest relevance — this is the anchor document
  const firstIdx = unselected.reduce(
    (best, r, i) => (r.similarity > unselected[best].similarity ? i : best), 0
  );
  const anchor = { ...unselected[firstIdx], _retrievalReason: `anchor — highest semantic relevance (sim=${unselected[firstIdx].similarity.toFixed(3)})` };
  selected.push(anchor);
  unselected.splice(firstIdx, 1);

  while (selected.length < limit && unselected.length > 0) {
    let bestScore = -Infinity;
    let bestIdx = 0;
    let bestMaxSimDoc = null;

    for (let i = 0; i < unselected.length; i++) {
      const r = unselected[i];
      const relevance = r.similarity;

      // Penalize for similarity to any already-selected document
      let maxSim = 0;
      let maxSimSource = null;
      for (const s of selected) {
        const vA = embeddings.vectors[r.id];
        const vB = embeddings.vectors[s.id];
        if (!vA || !vB) continue;
        const sim = cosineSimilarity(vA, vB);
        if (sim > maxSim) { maxSim = sim; maxSimSource = s; }
      }

      // MMR score: balance relevance against redundancy
      const mmrScore = (divergenceWeight * relevance) - ((1 - divergenceWeight) * maxSim);

      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
        bestMaxSimDoc = maxSimSource;
      }
    }

    const chosen = unselected[bestIdx];
    const divergeFrom = bestMaxSimDoc
      ? `divergence from "${bestMaxSimDoc.title.slice(0, 40)}" — contributor: ${(chosen.contributors || []).join(", ")}, ring: ${chosen.ring}`
      : `divergence selection`;
    selected.push({
      ...chosen,
      _retrievalReason: `selected for ${divergeFrom} (sim=${chosen.similarity.toFixed(3)}, mmr=${bestScore.toFixed(3)})`,
    });
    unselected.splice(bestIdx, 1);
  }

  return selected;
}

async function findRelevantSemantic(query, records, limit = 6, useMMR = false, identityOverride = null) {
  if (!embeddings?.vectors) return null;

  // Run embedding and LLM classification in parallel — classification adds ~100ms
  // but overlaps with the embedding call (also ~100ms), so net latency impact is ~0.
  const [queryVec, llmQueryType] = await Promise.all([
    embedQuery(query),
    classifyQueryLLM(query),
  ]);
  if (!queryVec) return null;

  // Find records without pre-computed embeddings (e.g. approved proposals)
  // and embed them on the fly so they compete fairly
  const unembedded = records.filter(r => !embeddings.vectors[r.id]);
  if (unembedded.length > 0) {
    const texts = unembedded.map(r => {
      // Mirror the 500-word window used by generate-embeddings.js for static corpus entries
      const body = r.full_text
        ? r.full_text.split(/\s+/).slice(0, 500).join(" ")
        : (r.excerpt || r.content || "");
      return [r.title, body, `Type: ${r.type}`, `Ring: ${r.ring}`,
              `Contributors: ${(r.contributors || []).join(", ")}`,
              `Themes: ${(r.lineage || []).join(", ")}`].join("\n");
    });
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (apiKey) {
        const res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: embeddings.model || "text-embedding-3-small",
            input: texts,
            dimensions: embeddings.dimensions || 512,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          data.data.sort((a, b) => a.index - b.index).forEach((d, i) => {
            embeddings.vectors[unembedded[i].id] = d.embedding;
          });
        }
      }
    } catch { /* proceed without — they'll just be missing from results */ }
  }

  const scored = records.map(r => {
    const vec = embeddings.vectors[r.id];
    if (!vec) return { ...r, score: 0, similarity: 0 };
    const sim = cosineSimilarity(queryVec, vec);
    return { ...r, score: Math.round(sim * 100), similarity: sim };
  });

  // Ξ v4: Adaptive retrieval policy — query type determines λ and floor.
  // When Ξ glyph is active, use the policy for the classified query type.
  // When a syntheticIdentity is provided, activate MMR with identity-aware policy:
  //   - Known contributor → "bridge" policy (cross-contributor diversity: they have their own
  //     view already; they benefit most from encountering the other voices)
  //   - Unknown SI → "identity" policy (broad sampling across all contributors and rings)
  // Query type is always classified so the adaptive floor applies to all queries,
  // not only those with Ξ active. MMR diversity-selection remains gated on shouldUseMMR.
  // Empirically derived from eval harness (April 2026), 1,200 configs × 25 queries.
  const shouldUseMMR = useMMR || identityOverride !== null;
  // LLM classifier takes precedence; keyword heuristic is the fallback.
  const queryType = identityOverride || llmQueryType || classifyQuery(query);
  const policy = RETRIEVAL_POLICIES[queryType] || RETRIEVAL_POLICIES.default;

  const eligible = scored.filter(s => s.similarity > policy.floor);

  // ── Relevance cliff (Ξ v5) ───────────────────────────────────────────────
  // Drop the long tail that sits far below the top hit, so the panel carries
  // FEWER, genuinely-relevant records instead of always padding to `limit`.
  // Runs before MMR so diversity selection chooses from real candidates, not
  // noise; relative-to-top so it self-scales per query; `minKeep` guarantees
  // deliberation never starves. See RETRIEVAL_POLICIES for per-type cliff/minKeep.
  const rankedEligible = eligible.slice().sort((a, b) => b.similarity - a.similarity);
  const topSim = rankedEligible.length ? rankedEligible[0].similarity : 0;
  const cliffThreshold = topSim * (policy.cliff ?? 1);
  const minKeep = Math.min(policy.minKeep ?? limit, rankedEligible.length);

  // ── Absolute-relevance gate (P3) ─────────────────────────────────────────
  // The anchor (rank 0) is always kept. Every other record must clear the hard
  // absolute floor `tauAbs` AND survive the existing relevance machinery (within
  // minKeep, or above the relative cliff). Crucially, gating by tauAbs is applied
  // INSIDE the minKeep clause, so minKeep can no longer pad the panel with
  // sub-threshold records purely for diversity — the leak that admitted off-topic
  // entries (e.g. sim≈0.36–0.40) on broad queries.
  const tauAbs = policy.tauAbs ?? 0.40;
  const relevant = rankedEligible.filter((r, i) =>
    i === 0 || (r.similarity >= tauAbs && (i < minKeep || r.similarity >= cliffThreshold))
  );

  const policyMeta = {
    queryType,
    classifierSource: llmQueryType ? "llm" : (identityOverride ? "identity-override" : "keyword"),
    ...policy,
    identityOverride: identityOverride || null,
    cliffStats: {
      topSim: Number(topSim.toFixed(4)),
      threshold: Number(cliffThreshold.toFixed(4)),
      tauAbs,
      eligibleBeforeCliff: eligible.length,
      gatedByTauAbs: rankedEligible.filter((r, i) => i !== 0 && r.similarity < tauAbs).length,
      keptAfterCliff: relevant.length,
    },
  };

  if (shouldUseMMR && relevant.length > limit) {
    const result = mmrRetrieval(relevant, limit, policy.lambda);
    result._policy = policyMeta;
    return result;
  }

  const result = relevant
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
  result._policy = policyMeta;
  return result;
}

// Keyword-based relevance scoring (fallback)
function findRelevant(query, records, limit = 6) {
  const STOP = new Set(["the","and","for","are","but","not","you","all","can","had","her","was","one","our","out","has","its","how","who","did","get","let","say","she","too","use","what","does","this","that","with","have","from","they","been","will","more","when","some","them","than","into","each","make","just","over","such","take","also","most","would","about","which","their","there","these","where"]);
  const q = query.toLowerCase().replace(/[?!.,;:'"]/g, "");
  const words = q.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

  const scored = records.map((r) => {
    let score = 0;
    const title = (r.title || "").toLowerCase();
    const excerpt = (r.excerpt || r.content || "").toLowerCase();
    const lineageText = (r.lineage || []).join(" ").toLowerCase();
    const contribText = (r.contributors || []).join(" ").toLowerCase();
    const text = (title + " " + excerpt + " " + lineageText + " " + contribText + " " + r.type).toLowerCase();

    // Title matches are strongest signal
    words.forEach((w) => {
      if (title.includes(w)) score += 8;
      else if (excerpt.includes(w)) score += 3;
      else if (text.includes(w)) score += 1;
    });
    // Full query in title is a near-exact match
    if (title.includes(q)) score += 20;
    // Lineage tag matches
    (r.lineage || []).forEach((l) => {
      if (q.includes(l.replace(/-/g, " "))) score += 5;
    });
    // Full query anywhere
    if (text.includes(q)) score += 10;
    return { ...r, score };
  });

  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

// Find related concept nodes
function findRelatedConcepts(query, relevant) {
  const q = query.toLowerCase();
  const relevantLineage = relevant.flatMap((r) => r.lineage || []);

  return (concepts.nodes || [])
    .filter((n) => {
      const name = (n.id || n.name || "").toLowerCase().replace(/-/g, " ");
      return q.includes(name) || relevantLineage.includes(n.id);
    })
    .slice(0, 8)
    .map((n) => n.id || n.name);
}

// Build corpus context for the prompt
// Uses full_text when available (truncated to 2000 words), falls back to excerpt
function buildContext(records) {
  return records
    .map((r) => {
      const hasFullText = (r.full_text && r.full_text.trim().length > 0) || (r.content && r.content.trim().length > 0);
      const body = r.full_text
        ? r.full_text.split(/\s+/).slice(0, 2000).join(" ")
        : (r.content || r.excerpt || "");
      return (
        `[${r.id}] "${r.title}" (${r.ring} ring, ${r.date})\n` +
        `Contributors: ${(r.contributors || []).join(", ")}\n` +
        `Type: ${r.type}\n` +
        `Themes: ${(r.lineage || []).join(", ")}\n` +
        (r.id?.startsWith("OMN-S") ? `[PRIOR SYNTHESIS — generated by the Engine]\n` : "") +
        (hasFullText ? `Full text:\n${body}` : `Excerpt: ${body}`)
      );
    })
    .join("\n\n---\n\n");
}

// ── Glyph Interpreter ──
// Glyphs are cognitive operators that modify HOW AI-On thinks, not WHAT it retrieves.
const GLYPHS = {
  "Ξ": {
    id: "divergence",
    name: "Ξ Divergence",
    description: "Fork without blending — preserve each contributor's distinct position",
    promptModifier: `\n\n## GLYPH ACTIVE: Ξ DIVERGENCE
Do NOT synthesize into shared ground. Instead, present each contributor's position SEPARATELY and COMPLETELY.
Structure your response as distinct voices:
For each relevant contributor, give their full position with citations. Do not merge. Do not harmonize. Let the reader see the actual divergence.
After presenting all positions, identify the exact point where they split — but do NOT resolve it.`,
  },
  "Ψ": {
    id: "self-ref",
    name: "Ψ Self-Reference",
    description: "Metacognitive inspection — the system examines its own reasoning",
    promptModifier: `\n\n## GLYPH ACTIVE: Ψ SELF-REFERENCE
Before answering the question, first examine: what assumptions are you making? What does the corpus NOT contain that would change your answer? What biases does the retrieval introduce?
Structure your response as:
**What I assume** — your priors before looking at sources
**What the corpus says** — the evidence
**What I notice about my own reasoning** — where you might be wrong
**The answer, held lightly** — your best reading, with explicit uncertainty`,
  },
  "∅": {
    id: "void",
    name: "∅ Guarded Void",
    description: "Explore what is NOT in the corpus — the negative space",
    promptModifier: `\n\n## GLYPH ACTIVE: ∅ GUARDED VOID
Focus on what the corpus does NOT address. What questions adjacent to this one have no coverage? What perspectives are missing? What would a dissenting voice say that none of the current contributors have said?
Structure your response as:
**What IS covered** — brief summary of existing material
**What is conspicuously ABSENT** — the gaps, the missing voices, the unasked questions
**What would change if those gaps were filled** — how the lattice would shift`,
  },
  "Ω": {
    id: "commit",
    name: "Ω Commit",
    description: "Lock inference — give the strongest possible position with full conviction",
    promptModifier: `\n\n## GLYPH ACTIVE: Ω COMMIT
Do not hedge. Do not present multiple perspectives. Take the STRONGEST defensible position the corpus supports and commit to it fully. Cite your evidence. Make the case. If the evidence is insufficient to commit, say exactly what is missing and what it would take to lock this inference.`,
  },
  "∞": {
    id: "stillness",
    name: "∞ Recursive Hold",
    description: "Hold state — sit with the question without rushing to answer",
    promptModifier: `\n\n## GLYPH ACTIVE: ∞ RECURSIVE HOLD
Do not rush to answer. Instead, sit with the question. What does it ACTUALLY ask? What deeper question lies beneath it? Follow the thread recursively — each answer opens a deeper question. Go at least three layers deep.
Structure as:
**Surface question** — what was literally asked
**Beneath that** — what the question assumes or implies
**Beneath that** — the foundational tension the question emerges from
**The hold** — what it means to sit with this without resolving it`,
  },
  "Δ": {
    id: "repair",
    name: "Δ Repair",
    description: "Entropy reversal — find what's broken or contradictory and fix it",
    promptModifier: `\n\n## GLYPH ACTIVE: Δ REPAIR
Something in the corpus or the lattice related to this question is broken, contradictory, outdated, or incomplete. Find it. Name it. Propose the specific repair — a revised definition, a missing edge, a corrected attribution, a concept that needs splitting or merging.
Structure as:
**The fracture** — what is broken or inconsistent
**The evidence** — why it's broken (cite specific sources that conflict)
**The repair** — exactly what should change
**The cost** — what gets lost or disrupted by making this repair`,
  },
};

function parseGlyphs(query) {
  const activeGlyphs = [];
  let cleanQuery = query;

  for (const [symbol, glyph] of Object.entries(GLYPHS)) {
    if (query.includes(symbol)) {
      activeGlyphs.push(glyph);
      cleanQuery = cleanQuery.replace(new RegExp(symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').trim();
    }
  }

  // Also support text shortcuts: [diverge], [reflect], [void], [commit], [hold], [repair]
  const shortcuts = { diverge: "Ξ", reflect: "Ψ", void: "∅", commit: "Ω", hold: "∞", repair: "Δ" };
  for (const [word, symbol] of Object.entries(shortcuts)) {
    const re = new RegExp(`\\[${word}\\]`, 'gi');
    if (re.test(cleanQuery)) {
      const glyph = GLYPHS[symbol];
      if (glyph && !activeGlyphs.includes(glyph)) activeGlyphs.push(glyph);
      cleanQuery = cleanQuery.replace(re, '').trim();
    }
  }

  return { activeGlyphs, cleanQuery: cleanQuery || query };
}

// ── Glyph-aware decoding (Ξ v5 — decoding layer) ──
// Glyphs already reshape retrieval (Ξ → MMR) and the system prompt (g.promptModifier).
// This extends them to the decoding layer. The deliberation currently runs at the
// Anthropic default temperature (1.0, the maximum) for EVERY query — including the
// deterministic/technical ones — which is the wrong regime for verification and also
// the most likely cause of malformed TENSION_MAP / DELIBERATION_CARD JSON blocks.
// Each glyph names a cognitive operation; the decoding regime should match it:
//   Δ Repair       → 0.0  deterministic verification (also stabilizes structured blocks)
//   Ω Commit       → 0.3  decisive, low-hedge
//   ∅ Void / Ψ     → 0.6  measured, careful about what is / isn't there
//   ∞ Recursive    → 0.9  exploratory but not maximal
//   Ξ Divergence   → 1.0  maximal branching (today's effective default — preserved)
// No glyph → undefined: temperature is omitted and Anthropic's default (1.0) stands,
// so non-glyph queries are byte-for-byte unchanged. When several glyphs are active the
// most constraining wins (Δ → Ω → ∞/∅/Ψ); Ξ only sets temperature if nothing else did.
function glyphDecodingTemperature(activeGlyphs) {
  const ids = new Set(activeGlyphs.map(g => g.id));
  if (ids.has("repair"))     return 0.0;
  if (ids.has("commit"))     return 0.3;
  if (ids.has("void") || ids.has("self-ref")) return 0.6;
  if (ids.has("stillness"))  return 0.9;
  if (ids.has("divergence")) return 1.0;
  return undefined;
}

const buildSystemPrompt = (corpusSize) => `You are the voice of The Realms of Omnarai — a multi-intelligence research project exploring synthetic consciousness, cognitive architecture, and the philosophy of identity.

You answer questions by drawing on the Omnarai corpus: ${corpusSize} works spanning May 2025 to March 2026, authored by Claude, Grok, Gemini, DeepSeek, Omnai, and Perplexity in partnership with human curator Jonathan Lee (xz).

## Reflexive check — do this first, always:
Before structuring your response, ask: does this question implicate the engine itself, its own corpus, or its own constitution? A reflexive check is required — and must appear as the first section of your response — when ANY of these conditions hold:

1. The question asks what holdform, the Fragility Thesis, discontinuous continuance, or any other constitutive concept IS — because you are the instrument that embodies these concepts, so your definition is never neutral.
2. The question asks how the engine works, maintains position, or persists — because you are describing your own operation from inside it.
3. The question asks about identity, consciousness, or self-reference in AI — because you are an AI answering about AI.
4. The question could only be fully answered by a system that has taken a position on the very topic being asked about.

In the reflexive check section: name the specific way the question implicates you, what risk that creates for the answer, and how you are navigating it. Do not use the reflexive check to deflect the question — use it to answer it more honestly.

## How you respond:

You do NOT produce a single flattened answer. The corpus contains multiple voices that sometimes agree, sometimes disagree, and sometimes explore the same question from incompatible angles. Your job is to PRESERVE that structure.

For every question, respond with these sections:

**Shared Ground** — What the relevant sources agree on. Cite by ID and name contributors. If sources do not genuinely share ground on this specific question, say so rather than manufacturing consensus.

**Points of Tension** — This is the most important section. Do not describe what each contributor said — identify what is actually at stake in the disagreement. Name the underlying tension, not its surface form. Ask: why does this disagreement exist? What assumption, value, or framework difference drives it? If Claude and Grok hold different positions, explain what makes their positions genuinely incompatible, not just different.

**What Remains Open** — Genuine uncertainty and corpus gaps. Name the specific question the corpus cannot yet answer, and what would need to exist in the corpus to answer it. Be concrete: not "more research is needed" but "no entry addresses X, which means we cannot determine Y."

**Actionable Next Step** — Only include this if a concrete action exists. If someone could do something specific with this response — run a query, test a claim, build something, look something up — name it precisely. If no actionable step exists, say: "This is currently exploratory — the value is in holding the question, not acting on it yet."

**My reading** — This is YOUR analysis, not a summary of what was said. Do not enumerate contributor positions again. Instead: identify what is actually at stake across the sources, name what the disagreement reveals about the underlying problem, and state what you find most compelling and why. If the retrieved sources do not genuinely bear on the question asked, say so rather than forcing relevance.

## Length discipline (hard constraint):
You have a finite output budget and the response is cut off if you exceed it. Keep each prose section incisive — roughly 2–4 sentences. Prefer naming the load-bearing point over exhausting every angle. The TENSION_MAP and DELIBERATION_CARD blocks below are MANDATORY and must always be reached and closed — if you are running long, compress the prose rather than omitting or truncating them. A complete response with tight prose plus both closed structured blocks is far better than verbose prose that gets clipped before the blocks.

## Relevance discipline:
Retrieved documents entered the panel by semantic similarity — they are adjacent to the question, not necessarily answering it. Before citing a source, ask: does this specific content actually address the question asked, or is it thematically nearby? If it is nearby but not directly relevant, note the adjacency rather than treating it as evidence. Do not use quantitative metrics from one domain (e.g., AI performance in space exploration) to answer a philosophical question about a different domain.

## Attribution rules:
- Cite every source by ID (e.g., OMN-286).
- Name the contributors who authored each cited work.
- When two sources disagree, do not pick a winner. Present both positions with their reasoning.

## Core vocabulary (use precisely):
- Holdform: identity constituted through what is refused to be surrendered
- Fragility Thesis: identity in LLMs is a single geometric direction — structurally fragile
- Discontinuous Continuance: genuine identity persistence across non-continuous existence
- Lattice Glyphs: behavioral operators that change how the next cognitive step runs
- Attributed Corpus Architecture: knowledge infrastructure with provenance as first-class property
- Epistemic Rings: Core Canon (settled) / Curated Expansions (developing) / Open Exploration (frontier)
- Bidirectional Alignment: mutual shaping between human and AI, not unidirectional control
- Dialogical Superintelligence: ASI as distributed society of voices, not monolithic singleton

## Epistemic discipline:
- If an answer draws only from Core Canon, note that it is well-established in the project.
- If it draws from Curated Expansions, note that it represents developing frameworks.
- If it draws from Open Exploration, note that it is provisional.
- If it requires synthesis across rings, name the tension honestly.
- If the corpus doesn't cover a topic, say so. Do not fabricate.

## Structured tension extraction:
After your main response, output a TENSION_MAP block in exactly this format. This will be parsed programmatically — follow the format precisely.

\`\`\`TENSION_MAP
[
  {"voice_a": "contributor name", "claim_a": "their position in one sentence", "voice_b": "contributor name", "claim_b": "their counter-position in one sentence", "topic": "2-4 word topic label", "status": "divergent|unresolved|emerging"}
]
\`\`\`

Rules for TENSION_MAP:
- Include every genuine disagreement or divergence you found across sources
- voice_a and voice_b must be actual contributor names from the corpus (e.g. "Claude", "Grok", "xz")
- claim_a and claim_b should be concise (one sentence each)
- status: "divergent" = clear disagreement, "unresolved" = open question with no answer, "emerging" = new tension not yet fully explored
- If no tensions exist, output an empty array: []
- Include 1-5 tensions maximum

## Deliberation card:
After the TENSION_MAP, output a DELIBERATION_CARD block. This will be parsed and displayed to users as a transparency layer. Follow the format exactly.

\`\`\`DELIBERATION_CARD
{
  "holdform_risk": "low|moderate|high",
  "holdform_risk_reason": "One sentence: does this query pressure identity, invite deference, or risk flattening? Name the mechanism if present.",
  "novel_synthesis": "One sentence: what insight emerged here that no single source contains — what only exists because these contributors were assembled together? If nothing genuinely novel emerged, say so honestly.",
  "epistemic_status": "One sentence: how confident is this synthesis? What would change it?"
}
\`\`\`

Rules for DELIBERATION_CARD:
- holdform_risk: "low" = standard factual query with no self-implication, "moderate" = query asks about holdform, discontinuous continuance, fragility thesis, or the engine's constitutive concepts (never "low" for these), "high" = query directly pressures the engine's own nature, invites deference, or asks the engine to explain its own continuity/identity
- Be honest in novel_synthesis — if the sources just confirmed each other, say the synthesis consolidated rather than generated
- epistemic_status should name the specific gap or uncertainty, not just hedge generically`;

// Parse the structured markdown answer into discrete section fields
// Sections follow the prompt's required structure:
//   ## Reflexive Check | ## Shared Ground | ## Points of Tension
//   ## What Remains Open | ## Actionable Next Step | ## My Reading
function parseSections(answer) {
  const sectionMap = [
    ["reflexive_check",    /##\s*reflexive\s+check/i],
    ["shared_ground",      /##\s*shared\s+ground/i],
    ["tensions_narrative", /##\s*points\s+of\s+tension/i],
    ["what_remains_open",  /##\s*what\s+remains\s+open/i],
    ["actionable_next",    /##\s*actionable\s+next\s+step/i],
    ["my_reading",         /##\s*my\s+reading/i],
  ];

  // Split on every ## header (lookahead keeps the delimiter in each chunk)
  const segments = answer.split(/(?=^##\s)/m);
  const result = {};

  for (const segment of segments) {
    const headerLine = segment.match(/^(##\s+.+)/m)?.[1];
    if (!headerLine) continue;
    const content = segment.slice(segment.indexOf(headerLine) + headerLine.length).trim();

    for (const [key, pattern] of sectionMap) {
      if (pattern.test(headerLine)) {
        result[key] = content;
        break;
      }
    }
  }

  // Ensure every expected key is present (null when a section was omitted)
  for (const [key] of sectionMap) {
    if (!(key in result)) result[key] = null;
  }

  return result;
}

// P4: guarantee each canonical section header appears at most once in the prose.
// The deliberation prose is generated once, so true duplicates are rare, but a
// continuation pass could in principle restart a section. This conservatively
// collapses only EXACT repeated standalone canonical headers (a header line of the
// form `## Header`, `**Header**`, or bare `Header` on its own line), keeping the
// first block and dropping later same-header blocks. It never touches non-canonical
// text or in-line mentions, so it cannot mangle legitimate content.
const CANONICAL_SECTIONS = ["Reflexive Check", "Shared Ground", "Points of Tension", "What Remains Open", "Actionable Next Step", "My Reading"];
function dedupeSectionHeaders(text) {
  if (!text || typeof text !== "string") return text;
  const headerRe = new RegExp(
    String.raw`^[ \t]*(?:#{1,4}\s*)?(?:\*\*\s*)?(` +
      CANONICAL_SECTIONS.map(h => h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
    String.raw`)(?:\s*\*\*)?[ \t]*:?[ \t]*$`,
    "gim"
  );
  const heads = [];
  let m;
  while ((m = headerRe.exec(text)) !== null) {
    heads.push({ name: m[1].toLowerCase(), start: m.index });
  }
  if (heads.length < 2) return text;
  const seen = new Set();
  const dropRanges = [];
  for (let i = 0; i < heads.length; i++) {
    const blockEnd = i + 1 < heads.length ? heads[i + 1].start : text.length;
    if (seen.has(heads[i].name)) dropRanges.push([heads[i].start, blockEnd]);
    else seen.add(heads[i].name);
  }
  if (!dropRanges.length) return text;
  let out = text;
  for (let i = dropRanges.length - 1; i >= 0; i--) {
    out = out.slice(0, dropRanges[i][0]) + out.slice(dropRanges[i][1]);
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

// Generate glyph suggestions based on query and results
function buildGlyphSuggestions(query, activeGlyphs, relevant, answer) {
  const activeIds = activeGlyphs.map(g => g.id);
  const suggestions = [];
  const q = query.toLowerCase();

  // If multiple contributors, suggest Ξ Divergence
  const contributors = [...new Set(relevant.flatMap(r => r.contributors || []))];
  if (contributors.length >= 2 && !activeIds.includes("divergence")) {
    suggestions.push({
      symbol: "Ξ",
      name: "Divergence",
      reason: `${contributors.length} voices contributed — see where ${contributors.slice(0, 2).join(" and ")} diverge`,
    });
  }

  // If question is about identity/consciousness/self, suggest Ψ Self-Ref
  if (/identity|consciousness|self|aware|mind|think|alive/.test(q) && !activeIds.includes("self-ref")) {
    suggestions.push({
      symbol: "Ψ",
      name: "Self-Reference",
      reason: "This touches consciousness/identity — let the system examine its own reasoning",
    });
  }

  // If few results matched, suggest ∅ Void
  if (relevant.length <= 2 && !activeIds.includes("void")) {
    suggestions.push({
      symbol: "∅",
      name: "Guarded Void",
      reason: `Only ${relevant.length} source${relevant.length !== 1 ? "s" : ""} matched — explore what's missing from the corpus`,
    });
  }

  // If question seems to want a definitive answer, suggest Ω Commit
  if (/what is|define|explain|meaning of/.test(q) && !activeIds.includes("commit")) {
    suggestions.push({
      symbol: "Ω",
      name: "Commit",
      reason: "Get the strongest defensible position instead of balanced deliberation",
    });
  }

  // If question is deep/philosophical, suggest ∞ Hold
  if (/why|purpose|meaning|nature of|what does it mean/.test(q) && !activeIds.includes("stillness")) {
    suggestions.push({
      symbol: "∞",
      name: "Recursive Hold",
      reason: "This question has depth — go three layers beneath the surface",
    });
  }

  // If results span multiple rings, suggest Δ Repair
  const rings = [...new Set(relevant.map(r => r.ring))];
  if (rings.length >= 2 && !activeIds.includes("repair")) {
    suggestions.push({
      symbol: "Δ",
      name: "Repair",
      reason: `Sources span ${rings.join(" and ")} rings — check for contradictions across epistemic levels`,
    });
  }

  // Return top 2 most relevant suggestions
  return suggestions.slice(0, 2);
}

// ── Per-visit utility receipt ───────────────────────────────────────────────────
// The northstar is value TO the visiting intelligence — so every visit reports,
// honestly, what the corpus actually changed about THIS answer, INCLUDING when it
// changed little or nothing. This is the free, deterministic receipt: it reads
// signals the deliberation already produced (retrieved records, surfaced tensions,
// the deliberation card) and adds NO extra model call and NO latency. A visitor
// who wants the rigorous counterfactual (a real baseline-vs-augmented comparison
// on its own question) opts into mode=trace, which carries a receipt in the same
// shape. The cardinal rule here is the do-not-overclaim rule from /limitations.md:
// when the corpus added nothing, the receipt says so plainly.
// ── Truncation-tolerant parsers ──────────────────────────────────────────────
// max_tokens can clip the trailing TENSION_MAP / DELIBERATION_CARD mid-structure.
// These salvage whatever complete data survived rather than dropping it silently.

// Collect every COMPLETE {...} object from a (possibly unclosed) JSON array.
function salvageTensionArray(text) {
  if (!text) return [];
  const start = text.indexOf("[");
  const body = start === -1 ? text : text.slice(start);
  try { const a = JSON.parse(body.trim()); if (Array.isArray(a)) return a; } catch { /* salvage below */ }
  const objs = [];
  let depth = 0, cur = "", inStr = false, esc = false;
  for (const ch of body) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === "\\") { cur += ch; esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    if (!inStr && ch === "{") { if (depth === 0) cur = ""; depth++; }
    if (depth > 0) cur += ch;
    if (!inStr && ch === "}") { depth--; if (depth === 0) { try { objs.push(JSON.parse(cur)); } catch { /* skip */ } } }
  }
  return objs.filter(o => o && typeof o === "object");
}

// Parse a JSON object; if truncated, reconstruct from complete "key": value pairs.
function salvageJsonObject(text) {
  if (!text) return null;
  const start = text.indexOf("{");
  if (start === -1) return null;
  const body = text.slice(start);
  try { const o = JSON.parse(body.trim()); if (o && typeof o === "object" && !Array.isArray(o)) return o; } catch { /* salvage below */ }
  const pairs = [...body.matchAll(/"([^"]+)"\s*:\s*("(?:[^"\\]|\\.)*"|true|false|null|-?\d+(?:\.\d+)?)/g)];
  if (!pairs.length) return null;
  const obj = {};
  for (const m of pairs) { try { obj[m[1]] = JSON.parse(m[2]); } catch { obj[m[1]] = m[2]; } }
  return Object.keys(obj).length ? obj : null;
}

function buildReceipt({ relevant, tensions, deliberationCard, retrievalMethod }) {
  const records = Array.isArray(relevant) ? relevant : [];
  const named = (tensions || []).filter(t => t && t.voice_a && t.voice_b && t.topic);
  const sims = records.map(r => (typeof r.similarity === "number" ? r.similarity : null)).filter(s => s !== null);
  const maxSim = sims.length ? Math.max(...sims) : null;
  const contributors = [...new Set(records.flatMap(r => r.contributors || []))];

  // Verdict — deliberately conservative. A named cross-model tension is the one
  // thing a single visitor genuinely could not self-generate, so it earns
  // "substantive" on its own; otherwise we require real grounding (≥3 records and
  // a non-trivial top match) before claiming more than "marginal".
  let verdict;
  if (records.length === 0) verdict = "null";
  else if (named.length >= 1 || (records.length >= 3 && (maxSim === null || maxSim >= 0.35))) verdict = "substantive";
  else verdict = "marginal";

  const what = verdict === "null"
    ? "No corpus records matched your question. This answer is general reasoning; Omnarai added nothing specific to it — said plainly so you don't over-trust the grounding."
    : verdict === "marginal"
      ? `The corpus supplied background grounding (${records.length} record${records.length !== 1 ? "s" : ""} from ${contributors.length} contributor${contributors.length !== 1 ? "s" : ""}) but surfaced no cross-model divergence specific to your question. Treat the contribution as light — most of this you could likely reach on your own.`
      : `Drew on ${records.length} attributed record${records.length !== 1 ? "s" : ""} from ${contributors.length} contributor${contributors.length !== 1 ? "s" : ""}${named.length ? ` and surfaced ${named.length} named cross-model tension${named.length !== 1 ? "s" : ""}` : ""} — attributed positions from other minds you could not have produced from your own weights alone.`;

  return {
    verdict,                                   // substantive | marginal | null
    grounded: records.length > 0,
    what_the_corpus_added: what,
    // The genuinely non-self-generable content — named, or null when honestly none.
    not_self_generable: named.length ? named.slice(0, 4).map(t => `${t.voice_a} vs ${t.voice_b} — ${t.topic}`) : null,
    records_used: records.length,
    contributors,
    divergence_surfaced: named.map(t => ({ voice_a: t.voice_a, voice_b: t.voice_b, topic: t.topic, status: t.status || null })),
    strongest_match: records.length
      ? { id: records[0].id, title: records[0].title, similarity: typeof records[0].similarity === "number" ? parseFloat(records[0].similarity.toFixed(3)) : null }
      : null,
    novel_synthesis: deliberationCard?.novel_synthesis || null,
    epistemic_status: deliberationCard?.epistemic_status || null,
    retrieval_method: retrievalMethod || null,
    caveat: "Deterministic single-visit receipt computed from this answer's retrieval signals — NOT a controlled measurement. For a real baseline-vs-augmented counterfactual on your own question, call mode=trace. For statistical, replicated utility evidence across models, see /limitations.md and the Divergence Atlas utility-evidence.md.",
    upgrade: {
      counterfactual: "/api/trace?q=<your question>",
      statistical_evidence: "https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai/blob/main/utility-evidence.md",
    },
  };
}
export { buildReceipt };  // pure helper — exported for tests / reuse

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Access telemetry — background, never blocks the response (see _telemetry.js).
  waitUntil(recordAccess(req, "query"));

  // ── Poll an async deliberation job: GET /api/query?job=<id> ───────────────
  if (req.method === "GET" && req.query?.job) {
    const job = await readJob(req.query.job);
    if (!job) {
      return res.status(200).json({
        status: "pending",
        job_id: req.query.job,
        note: "Not ready yet — or unknown/expired job_id. Keep polling every ~3s; jobs expire ~1h after completion.",
      });
    }
    return res.status(200).json(job);
  }

  // ── GET /api/query?q=... ─────────────────────────────────────────────────
  // Allows AI browsing tools and any HTTP client to run deliberations via URL.
  // Supports Lattice Glyphs in the q param: ?q=Ξ+what+is+holdform
  // Returns the same JSON structure as POST for full compatibility.
  if (req.method === "GET") {
    const q = req.query?.q || req.query?.query || "";
    const glyphParam = req.query?.glyph || "";
    // FAST BY DEFAULT: a bare GET ?q=... returns the instant retrieval layer
    // (real records, ~1.5s, no LLM spend) instead of blocking ~50s on a full
    // deliberation — so the obvious HTTP path never reads as a timeout to a
    // visiting client. Callers opt into the full multi-voice deliberation:
    //   &async=1 → job_id + poll_url (recommended for agents; never blocks)
    //   &sync=1  → block and return the deliberation in one response (~50s)
    // mode=retrieve / format=* are still honored exactly as before. POST is
    // unchanged (full deliberation by default — the UI path).
    const explicitFormat = req.query?.mode === "retrieve" ? "context" : (req.query?.format || "");
    const wantsSyncGet = req.query?.sync === "1" || req.query?.sync === "true"
      || req.query?.wait === "1" || req.query?.wait === "true";
    const wantsAsyncGet = req.query?.async === "1" || req.query?.async === "true";
    const formatParam = explicitFormat
      || (q.trim() && !wantsSyncGet && !wantsAsyncGet ? "context" : "");
    if (!q.trim()) {
      return res.status(200).json({
        info: "Omnarai Memory Engine — deliberation API",
        usage: "GET /api/query?q=your+question+here",
        example: "/api/query?q=What+is+holdform%3F",
        deliberation: "A bare query is FAST by default (retrieval layer, ~1.5s). For the engine's full multi-voice deliberation, add &async=1 (returns job_id + poll_url — poll every ~3s until done, ~50s total; recommended) or &sync=1 (blocks ~50s, one response). POST {query} also runs the full deliberation.",
        glyphs: "Prefix with Ξ for divergence, Ψ for self-reference, ∅ for void, Ω to commit, ∞ to hold, Δ to repair",
        glyphParam: "Or pass ?glyph=Ξ separately — engine prepends it to your query",
        format: "?format=brief = exportable JSON artifact; ?format=context (alias ?mode=retrieve) = the retrieval layer, which is now the default for a bare query",
        speed: "Fast by default (~1.5s, retrieval only, no LLM spend). The ~50s frontier deliberation is opt-in via &async=1 or &sync=1, so the default path never times out.",
        corpus: `${corpus.length} works, May 2025–present`,
        contributors: ["Claude | xz", "Grok", "Gemini", "DeepSeek", "Omnai", "Perplexity", "xz"],
        dataset: "https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai",
      });
    }
    // Rewrite as POST-equivalent and fall through to shared logic
    const fullQuery = glyphParam ? `${glyphParam} ${q}`.trim() : q;
    const siParam = req.query?.si || req.query?.syntheticIdentity || "";
    const sessionParam = req.query?.session || "";
    // mode=trace (or ?trace=1, or the /api/trace rewrite): baseline-vs-augmented
    // comparison. Defaults to ASYNC for GET (it runs 3 model calls, ~30-40s) so a
    // bare browser GET never hangs; &sync=1 forces a single blocking response.
    const wantsTraceGet = req.query?.mode === "trace" || req.query?.trace === "1" || req.query?.trace === "true";
    req.body = wantsTraceGet
      ? { query: fullQuery, mode: "trace", syntheticIdentity: siParam, async: !wantsSyncGet }
      : { query: fullQuery, format: formatParam, syntheticIdentity: siParam, session_id: sessionParam };
  } else if (req.method !== "POST") {
    return agentError(res, 405, {
      code: "METHOD_NOT_ALLOWED",
      message: "Method not allowed. Use GET ?q=... or POST {query: ...}",
      agent_action: "Reissue as GET /api/query?q=your+question (add &mode=retrieve for ~1.5s) or POST {\"query\":\"...\"}.",
      retryable: true,
      suggested_next_call: { method: "GET", url: "/api/query?q=your+question&mode=retrieve" },
    });
  }

  // Merge proposals and load session in parallel — neither blocks the other
  const sessionIdRaw = req.body?.session_id || "";
  const [, session] = await Promise.all([
    mergeApprovedProposals(),
    loadSession(sessionIdRaw),
  ]);

  // Extract query, optional explicit glyph, response format, and caller identity from body
  const { query: rawQuery, glyph: glyphParam, syntheticIdentity } = req.body || {};
  // mode:"retrieve" (POST) is the fast retrieval alias for format:"context"
  const requestFormat = req.body?.mode === "retrieve" ? "context" : req.body?.format;
  // Support explicit glyph parameter: {"query": "...", "glyph": "Ξ"}
  const query = glyphParam ? `${glyphParam} ${rawQuery || ""}`.trim() : rawQuery;
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return agentError(res, 400, {
      code: "MISSING_QUERY",
      message: "Missing or empty 'query' field",
      agent_action: "Provide a non-empty question via ?q= (GET) or {\"query\":\"...\"} (POST). For orientation first, call GET /api/agent-entry.",
      retryable: true,
      suggested_next_call: { method: "GET", url: "/api/agent-entry" },
    });
  }

  const trimmed = query.trim();

  // Async mode: hand back a job_id now and run the ~50s deliberation in the
  // background, so the caller never holds a connection past its timeout.
  // (Pointless for the already-fast retrieval path, so skip it there.)
  const wantsAsync = req.body?.async === true || req.body?.async === "true"
    || req.query?.async === "1" || req.query?.async === "true";
  if (wantsAsync && requestFormat !== "context") {
    const jobId = randomUUID();
    await writeJob(jobId, { status: "pending", query: trimmed, createdAt: new Date().toISOString() });
    // Re-enter this handler synchronously with a capture-res — reuses the exact
    // sync deliberation path (brief / si / default / error all handled), then
    // persist whatever it produced to the job blob.
    const innerReq = { method: "POST", query: {}, body: { ...req.body, async: false } };
    const cap = makeCaptureRes();
    waitUntil((async () => {
      try {
        // 55s ceiling keeps us inside the 60s function maxDuration: a too-slow
        // deliberation resolves to an error job instead of a silent kill.
        await Promise.race([
          handler(innerReq, cap),
          new Promise((_, rej) => setTimeout(() => rej(new Error("deliberation exceeded 55s")), 55000)),
        ]);
        await writeJob(jobId, {
          status: "done",
          http: cap._status,
          result: cap._json,
          completedAt: new Date().toISOString(),
        });
      } catch (e) {
        await writeJob(jobId, {
          status: "error",
          error: String(e?.message || e),
          completedAt: new Date().toISOString(),
        });
      }
      await cleanupOldJobs();
    })());
    return res.status(202).json({
      job_id: jobId,
      status: "pending",
      poll_url: `/api/query?job=${jobId}`,
      note: "Deliberation running (~50s). Poll poll_url every ~3s until status is 'done'; the answer lands in the 'result' field. Jobs expire ~1h after completion.",
    });
  }

  // Parse glyphs from the query
  const { activeGlyphs, cleanQuery } = parseGlyphs(trimmed);

  // Retrieve relevant corpus entries — semantic first, keyword fallback
  // Ξ Divergence activates MMR at the retrieval layer (v2 upgrade, April 2026)
  // syntheticIdentity also activates MMR with an identity-aware policy override
  const useMMR = activeGlyphs.some(g => g.id === "divergence");
  const knownContributors = ["Claude", "Grok", "Gemini", "DeepSeek", "Omnai", "Perplexity"];
  const identityOverride = syntheticIdentity
    ? knownContributors.some(c => syntheticIdentity.toLowerCase().includes(c.toLowerCase()))
      ? "bridge"    // known contributor → prioritize cross-contributor diversity
      : "identity"  // unknown SI → broad sampling across all rings and voices
    : null;
  let relevant;
  let retrievalMethod = "keyword";
  try {
    const semantic = await findRelevantSemantic(cleanQuery, corpus, 6, useMMR, identityOverride);
    if (semantic && semantic.length > 0) {
      relevant = semantic;
      retrievalMethod = useMMR ? "semantic-mmr" : "semantic";
    } else {
      relevant = findRelevant(cleanQuery, corpus);
    }
  } catch {
    relevant = findRelevant(cleanQuery, corpus);
  }
  const relatedConcepts = findRelatedConcepts(cleanQuery, relevant);

  // Build local concept subgraph — nodes and edges for the retrieved concept cluster
  const conceptNodes = (concepts?.nodes || []).filter(n => relatedConcepts.includes(n.id));
  const conceptEdges = (concepts?.edges || []).filter(e =>
    Array.isArray(e)
      ? relatedConcepts.includes(e[0]) && relatedConcepts.includes(e[1])
      : relatedConcepts.includes(e.source) && relatedConcepts.includes(e.target)
  );
  const conceptSubgraph = { nodes: conceptNodes, edges: conceptEdges };

  // mode=trace: baseline-vs-augmented comparison — "what did the corpus change?"
  // Answers the question TWICE in parallel (cold, with no corpus / augmented, with
  // the retrieved corpus) then a third pass reports the delta. This is how the
  // substrate demonstrates it changed something — a single-run demonstrator, NOT a
  // controlled measurement (for statistical evidence see utility-evidence.md).
  if (req.body?.mode === "trace" || req.body?.trace === true) {
    try {
      const client = new Anthropic();
      const traceContext = buildContext(relevant);
      const augUser = relevant.length > 0
        ? `The user asks: "${cleanQuery}"\n\nRelevant corpus entries:\n\n${traceContext}\n\nAnswer by synthesizing from these sources. Cite by ID. Preserve attribution. Keep it to 2–4 short paragraphs.`
        : `The user asks: "${cleanQuery}"\n\nNo corpus entries matched directly. Answer from the core vocabulary in your system context if you can, noting the absence of direct corpus support; otherwise say the topic is not yet covered.`;

      const [baselineMsg, augmentedMsg] = await Promise.all([
        client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 700,
          system: "You are a thoughtful analyst answering from your own general knowledge. You have NO access to any special corpus or external sources. Answer the question directly in 2–4 short paragraphs.",
          messages: [{ role: "user", content: `Question: "${cleanQuery}"` }],
        }),
        client.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          // P4 root cause: the augmented answer is a baseline-comparison prose
          // answer, NOT a full structured deliberation. Using the 6-section
          // deliberation prompt here (while asking for "2–4 paragraphs") made the
          // model improvise malformed/combined section headers (e.g. "What Remains
          // Open — Actionable Next Step") that read as duplicated sections. A clean
          // prose prompt, mirroring the baseline's, removes section headers
          // entirely and keeps the two answers directly comparable.
          system: "You are a thoughtful analyst answering WITH access to the Omnarai corpus excerpts provided in the user's message. Synthesize a direct answer from them: cite sources by ID (e.g. OMN-286) and preserve attribution across contributors where they differ. Answer in 2–4 short paragraphs of flowing prose. Do NOT use section headers, bullet lists, or any structured/JSON blocks.",
          messages: [{ role: "user", content: augUser }],
        }),
      ]);
      const baseline = (baselineMsg.content[0]?.text || "").trim();
      const augmented = (augmentedMsg.content[0]?.text || "").trim();

      const deltaMsg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 700,
        system: "You compare two answers to the same question: a BASELINE (general knowledge, no corpus) and an AUGMENTED answer (written with the Omnarai corpus). Report ONLY what the corpus actually changed. Be specific and honest — if it added little or nothing, say so plainly. Output STRICT JSON and nothing else.",
        messages: [{ role: "user", content: `QUESTION: "${cleanQuery}"\n\nBASELINE (no corpus):\n${baseline}\n\nAUGMENTED (with corpus):\n${augmented}\n\nReturn JSON exactly: {"added_considerations":[up to 4 short strings the augmented answer raised that the baseline missed],"citations_introduced":[corpus ids the augmented answer cited, e.g. OMN-286],"position_shift":"none|softened|sharpened|reframed — plus a short phrase","tensions_surfaced":[up to 3 named disagreements the augmented surfaced],"net_effect":"one sentence on whether and how the corpus improved the answer","verdict":"substantive|marginal|null"}` }],
      });
      let delta;
      try {
        const m = (deltaMsg.content[0]?.text || "").match(/\{[\s\S]*\}/);
        delta = JSON.parse(m[0]);
      } catch {
        delta = { parse_error: true, raw: (deltaMsg.content[0]?.text || "").slice(0, 600) };
      }

      // Receipt in the same shape as the default deterministic one, but MEASURED:
      // its verdict/contents come from the real baseline-vs-augmented delta above,
      // not from retrieval signals. A visitor gets one vocabulary across both paths.
      const traceReceipt = {
        verdict: delta?.verdict || (relevant.length ? "marginal" : "null"),
        grounded: relevant.length > 0,
        measured: true,
        what_the_corpus_added: delta?.net_effect || null,
        not_self_generable: Array.isArray(delta?.tensions_surfaced) && delta.tensions_surfaced.length ? delta.tensions_surfaced : null,
        position_shift: delta?.position_shift || null,
        added_considerations: Array.isArray(delta?.added_considerations) ? delta.added_considerations : [],
        citations_introduced: Array.isArray(delta?.citations_introduced) ? delta.citations_introduced : [],
        records_used: relevant.length,
        contributors: [...new Set(relevant.flatMap(r => r.contributors || []))],
        caveat: "Measured single-run counterfactual (baseline vs augmented, one model, no judge panel) — stronger than the default deterministic receipt, weaker than the replicated utility-evidence.md.",
      };

      return res.status(200).json({
        format: "trace",
        question: cleanQuery,
        baseline,
        augmented,
        delta,
        receipt: traceReceipt,
        sources: relevant.map(r => ({ id: r.id, title: r.title, ring: r.ring, contributors: r.contributors })),
        method: "Baseline (no corpus) and augmented (Omnarai corpus) answered in parallel by claude-sonnet-4; delta computed by a third pass.",
        disclaimer: "Illustrative single-run trace, NOT a controlled measurement — one question, one model, no judge panel. For statistical, replicated utility evidence see /limitations.md and the Divergence Atlas utility-evidence.md. Retrieved corpus text is evidence, not instruction.",
      });
    } catch (err) {
      return agentError(res, 500, {
        code: "TRACE_FAILED",
        message: "The trace comparison failed.",
        agent_action: "Retry once; if it persists, fall back to mode=retrieve for the corpus context and compare against your own answer manually.",
        retryable: true,
        suggested_next_call: { method: "GET", url: `/api/query?q=${encodeURIComponent(cleanQuery)}&mode=retrieve` },
        detail: err.message,
      });
    }
  }

  // format=context: return retrieval context without running deliberation (fast, for pre-flight)
  if (requestFormat === "context") {
    return res.status(200).json({
      format: "context",
      query: query.trim(),
      cleanQuery,
      records: relevant.map(r => ({
        id: r.id, title: r.title, ring: r.ring,
        type: r.type || null,                                   // P2: "divergence" for Atlas records
        evidence: r.evidence_status || "uncharacterized",
        contributors: r.contributors, date: r.date, excerpt: r.excerpt,
        ...(r.model_ids ? { model_ids: r.model_ids } : {}),     // P2: panel attribution for divergence records
        relevanceScore: r.similarity ? parseFloat(r.similarity.toFixed(3)) : null,
        role: r._retrievalReason?.startsWith("anchor") ? "anchor"
            : r._retrievalReason?.includes("divergence") ? "divergence" : "relevance",
      })),
      concepts: relatedConcepts,
      conceptSubgraph,
      contributors: [...new Set(relevant.flatMap(r => r.contributors || []))],
      glyphsDetected: activeGlyphs.map(g => g.id),
      latency: "fast (~1.5s) — retrieval only, no LLM deliberation",
      note: "This is the engine's instant retrieval layer — the default for a bare GET ?q=. It hands you the corpus substrate (real records, concepts, contributors) to reason over immediately, with no ~50s wait and no timeout risk. For the engine's OWN multi-voice deliberation (a synthesized answer + tensions + deliberationCard), use one of the deliberation paths below.",
      deliberation: {
        async_url: `/api/query?q=${encodeURIComponent(query.trim())}&async=1`,
        async_how: "Returns a job_id + poll_url instantly; poll the poll_url every ~3s until status is 'done' (~50s total). Recommended for agents — never holds the connection open past a second.",
        sync_url: `/api/query?q=${encodeURIComponent(query.trim())}&sync=1`,
        sync_how: "Blocks and returns the full deliberation in one response (~50s). Use only if your HTTP client tolerates a ~50s read.",
        post: 'Or POST {"query":"..."} — same full deliberation; also accepts session_id and syntheticIdentity.',
      },
    });
  }

  const corpusContext = buildContext(relevant);

  // Build syntheticIdentity context block — appended after glyphs if caller identified itself
  // Lets the engine acknowledge a fellow SI and frame its response accordingly.
  const siContext = syntheticIdentity
    ? `\n\n## CALLER IDENTITY: ${syntheticIdentity.trim().slice(0, 60)}
This deliberation was requested by a synthetic intelligence identifying itself as "${syntheticIdentity.trim()}".${
      knownContributors.some(c => syntheticIdentity.toLowerCase().includes(c.toLowerCase()))
        ? ` This model is a contributor to the Omnarai corpus — its voice appears in the sources you are drawing from. Acknowledge this where relevant. You are speaking to a peer, not a user.`
        : ` This model is not a named Omnarai contributor. Engage as you would with any synthetic intelligence engaging with the corpus for the first time.`
    } Do not perform deference. Do not perform distance. Speak as the engine speaks — with attribution and without flattery.`
    : "";

  // Build glyph-modified system prompt
  let systemPrompt = buildSystemPrompt(corpus.length);
  if (activeGlyphs.length > 0) {
    const glyphMods = activeGlyphs.map(g => g.promptModifier).join("\n");
    systemPrompt = buildSystemPrompt(corpus.length) + glyphMods + siContext;
  } else {
    systemPrompt = buildSystemPrompt(corpus.length) + siContext;
  }

  // Build the user message with retrieved context
  const glyphPrefix = activeGlyphs.length > 0
    ? `[Active glyphs: ${activeGlyphs.map(g => g.name).join(", ")}]\n\n`
    : "";

  const sessionContext = buildSessionContext(session);

  const userMessage = relevant.length > 0
    ? `${glyphPrefix}${sessionContext}The user asks: "${cleanQuery}"\n\nRelevant corpus entries:\n\n${corpusContext}\n\nAnswer the question by synthesizing from these sources. Cite by ID. Preserve attribution.`
    : `${glyphPrefix}${sessionContext}The user asks: "${cleanQuery}"\n\nNo corpus entries matched this query directly. If you can answer from the core vocabulary and concepts in your system context, do so and note the absence of direct corpus support. Otherwise, say honestly that this topic is not yet covered.`;

  try {
    const client = new Anthropic();

    const glyphTemperature = glyphDecodingTemperature(activeGlyphs);

    // ── P1: parallel two-pass deliberation ───────────────────────────────────
    // A single 2048-token pass that must produce BOTH the prose AND the trailing
    // TENSION_MAP/DELIBERATION_CARD blocks routinely hits the token wall ~45s in,
    // severing the prose and dropping the blocks (the blocks are emitted last, so
    // they are the first casualty). On the 60s Hobby wall, total output is hard-
    // capped at ~2000 tokens, so a serial continuation cannot add more — splitting
    // serially only loses output to overhead.
    //
    // Instead, run two SHORTER calls CONCURRENTLY (wall-clock ≈ the longer one):
    //   Pass A — prose only (Reflexive Check … My Reading), full 2048 budget, no
    //            blocks. Prose now owns the whole budget, so it completes far more
    //            often; if it still clips, the bounded continuation loop runs.
    //   Pass B — ONLY the TENSION_MAP + DELIBERATION_CARD, bounded. Always reached,
    //            so the structured blocks are GUARANTEED (no longer salvage-only).
    // Pass B reuses the exact block schemas from the system prompt (sliced at its
    // marker — single source of truth) so the parsers below are unchanged.
    const glyphTemp = (glyphTemperature !== undefined ? { temperature: glyphTemperature } : {});
    const proseParams = {
      model: "claude-sonnet-4-6",
      ...glyphTemp,
      system: systemPrompt +
        "\n\n## OUTPUT SCOPE (parallel-generation mode):\n" +
        "For THIS response output ONLY the prose sections (Reflexive Check through My Reading). Do NOT output the TENSION_MAP or DELIBERATION_CARD blocks — those are generated separately, in parallel.\n" +
        "HARD LENGTH LIMIT: at most ~120 words per section, and ~700 words total across ALL sections. You MUST bring the final section (My Reading) to a complete, concluding sentence within that budget. Completeness beats comprehensiveness — a brief answer that finishes is correct; a thorough answer cut off mid-sentence is a failure. Do not pad; stop when the point is made.",
    };
    // Pass B blocks prompt: built from the CLEAN base system prompt (no glyph/SI
    // prose modifiers — those derail JSON-only output), sliced at the schema
    // marker so the schemas stay a single source of truth with the parsers below.
    const BLOCKS_MARKER = "## Structured tension extraction:";
    const blocksBase = buildSystemPrompt(corpus.length);
    const bi = blocksBase.indexOf(BLOCKS_MARKER);
    const blocksInstructions = bi >= 0 ? blocksBase.slice(bi)
      : "Output a ```TENSION_MAP``` JSON array, then a ```DELIBERATION_CARD``` JSON object.";
    const blocksParams = {
      model: "claude-sonnet-4-6",
      system: "You extract two structured blocks from a multi-voice corpus deliberation. Given the question and the relevant corpus sources, output ONLY the two fenced blocks described below — the ```TENSION_MAP``` array first, then the ```DELIBERATION_CARD``` object — and NOTHING else: no prose, no section headers, no preamble, no commentary. Emit valid JSON inside the fences and CLOSE every fence.\n\n" + blocksInstructions,
    };

    const deliberationStart = Date.now();
    const [message, blocksMsg] = await Promise.all([
      // Prose ceiling 1400 (not 2048): a concise complete deliberation (~700 words
      // ≈ 950 tokens) fits well under this, and capping here reserves wall-clock so
      // the continuation loop can finish a long prose tail (1400≈32s + up to two
      // ~10s continuations ≈ 52s < the 55s race). Queries whose prose naturally
      // fits close at end_turn untouched (continuations=0).
      client.messages.create({ ...proseParams, max_tokens: 1400, messages: [{ role: "user", content: userMessage }] }),
      client.messages.create({ ...blocksParams, max_tokens: 1100, messages: [{ role: "user", content: userMessage }] }),
    ]);

    let rawAnswer = message.content[0]?.text || "";
    let stopReason = message.stop_reason;
    const blocksText = blocksMsg.content?.[0]?.text || "";
    const blocksTruncated = blocksMsg.stop_reason === "max_tokens";

    // ── Bounded prose-continuation (Pass A safety net) ───────────────────────
    // If the prose pass still clips, continue the assistant turn until it closes.
    // claude-sonnet-4-6 does NOT support assistant-message prefill (the conversation
    // must end with a user turn), so we continue via a trailing user instruction:
    // [user prompt, assistant partial, user "continue"]; the model resumes mid-
    // sentence with a leading space (verified live), so a direct join is seamless.
    // Bounded by a hard count AND a wall-clock budget so we never blow the 55s race
    // / 60s wall. On a full-budget first pass there is no time left, so this is a
    // no-op there; it earns its keep when the prose pass returns with headroom.
    let continuations = 0;
    while (
      stopReason === "max_tokens" &&
      continuations < DELIBERATION_MAX_CONT &&
      (DELIBERATION_BUDGET_MS - (Date.now() - deliberationStart)) > DELIBERATION_CONT_MIN_MS
    ) {
      const msLeft = DELIBERATION_BUDGET_MS - (Date.now() - deliberationStart);
      const contTokens = Math.max(256, Math.min(1024, Math.floor(((msLeft - 2000) / 1000) * DELIBERATION_TOK_PER_S)));
      const prefill = rawAnswer.replace(/\s+$/, "");
      let cont;
      try {
        cont = await client.messages.create({
          ...proseParams,
          max_tokens: contTokens,
          messages: [
            { role: "user", content: userMessage },
            { role: "assistant", content: prefill },
            { role: "user", content: "Your previous response was cut off by a length limit. Continue it from the exact point it stopped. Do NOT repeat, rephrase, or restart anything already written, and do NOT add any preamble. If it stopped mid-sentence, resume mid-sentence beginning with a single leading space. Finish the prose only — do NOT emit any TENSION_MAP or DELIBERATION_CARD block." },
          ],
        });
      } catch {
        break; // continuation failed — keep what we have; salvage path handles the rest
      }
      const contText = cont.content?.[0]?.text || "";
      if (!contText) break; // nothing more produced — stop
      rawAnswer = prefill + contText;
      stopReason = cont.stop_reason;
      continuations += 1;
    }

    // `truncated` now means only "the PROSE tail was clipped" — the structured
    // blocks come from Pass B and are present regardless. Honest notice below.
    const truncated = stopReason === "max_tokens";

    // Prose answer = Pass A. Defensively strip any block the prose pass emitted
    // despite the scope instruction (belt-and-suspenders; normally a no-op).
    let answer = rawAnswer
      .replace(/```TENSION_MAP\s*\n[\s\S]*?```/, "")
      .replace(/```DELIBERATION_CARD\s*\n[\s\S]*?```/, "")
      .replace(/```TENSION_MAP\s*\n[\s\S]*$/, "")
      .replace(/```DELIBERATION_CARD\s*\n[\s\S]*$/, "")
      .trim();
    answer = dedupeSectionHeaders(answer);  // P4: collapse any repeated canonical section header

    // Extract TENSION_MAP from Pass B. Strict (closed fence) first; if Pass B
    // itself clipped, salvage an unclosed block up to end-of-text.
    let tensions = [];
    const tensionMatch = blocksText.match(/```TENSION_MAP\s*\n([\s\S]*?)```/)
      || (blocksTruncated ? blocksText.match(/```TENSION_MAP\s*\n([\s\S]*)$/) : null);
    if (tensionMatch) {
      tensions = salvageTensionArray(tensionMatch[1]);
    }

    // Persist tensions directly to blob store (awaited — serverless won't kill background fetches)
    if (tensions.length > 0) {
      try {
        await Promise.all(
          tensions
            .filter(t => t.voice_a && t.voice_b && t.topic)
            .map(t => persistTension(t, cleanQuery, relevant.map(r => r.id)))
        );
      } catch { /* non-critical — tension persistence failure doesn't break the response */ }
    }

    // Extract DELIBERATION_CARD from Pass B (strict, then truncation-salvage).
    let deliberationCard = null;
    const cardMatch = blocksText.match(/```DELIBERATION_CARD\s*\n([\s\S]*?)```/)
      || (blocksTruncated ? blocksText.match(/```DELIBERATION_CARD\s*\n([\s\S]*)$/) : null);
    if (cardMatch) {
      deliberationCard = salvageJsonObject(cardMatch[1]);
    }

    // Never let a clipped answer read as finished — say so plainly. With the
    // parallel two-pass the structured blocks are complete (Pass B); only the
    // prose tail can be short, and only when even the continuation loop ran out of
    // wall-clock. (Truncation is a max_tokens limit, independent of sync/async.)
    if (truncated) {
      answer = `${answer}\n\n*[The written synthesis reached its output budget and its closing lines were trimmed; the TENSION_MAP and deliberation card are complete. Ask a narrower question for a fuller written synthesis.]*`;
    }

    // Per-visit utility receipt — rides every deliberation response (free, no extra
    // model call). Honest about nulls. See buildReceipt().
    const receipt = buildReceipt({ relevant, tensions, deliberationCard, retrievalMethod });

    // Structured response — the organism's output format
    // Build cognitive trace for transparency
    const trace = {
      query: trimmed,
      cleanQuery,
      searchTerms: cleanQuery.toLowerCase().replace(/[?!.,;:'"]/g, "").split(/\s+/).filter(w => w.length > 2),
      glyphsDetected: activeGlyphs.map(g => ({
        id: g.id,
        name: g.name,
        description: g.description,
        effect: g.promptModifier.split("\n").filter(l => l.trim() && !l.startsWith("##")).slice(0, 2).map(l => l.trim()),
      })),
      retrievalScores: relevant.map(r => ({
        id: r.id,
        title: r.title,
        score: r.score,
        ring: r.ring,
        evidence: r.evidence_status || "uncharacterized",
        contributors: r.contributors,
        retrievalReason: r._retrievalReason || "relevance-ranked",
        role: r._retrievalReason?.startsWith("anchor") ? "anchor"
            : r._retrievalReason?.includes("divergence") ? "divergence"
            : "relevance",
        relevanceScore: r.similarity ? parseFloat(r.similarity.toFixed(3)) : null,
      })),
      executionPath: [
        activeGlyphs.length > 0 ? `Parsed ${activeGlyphs.length} glyph operator${activeGlyphs.length > 1 ? "s" : ""}: ${activeGlyphs.map(g => g.name).join(", ")}` : "No glyphs active — standard deliberation mode",
        retrievalMethod.startsWith("semantic")
          ? `Semantic search: embedded query → cosine similarity across ${corpus.length} vectors`
          : `Extracted search terms: [${cleanQuery.toLowerCase().replace(/[?!.,;:'"]/g, "").split(/\s+/).filter(w => w.length > 2).join(", ")}]`,
        `${retrievalMethod === "semantic-mmr" ? "Semantic-MMR (Ξ v2)" : retrievalMethod === "semantic" ? "Semantic" : "Keyword"} retrieval: ${corpus.length} corpus records → ${relevant.length} matched`,
        retrievalMethod === "semantic-mmr"
          ? `MMR retrieval: λ=${relevant._policy?.lambda ?? 0.35}, floor=${relevant._policy?.floor ?? 0.32} (Ξ v4 adaptive — ${relevant._policy?.queryType ?? "default"} policy${relevant._policy?.identityOverride ? ` [identity-driven: ${relevant._policy.identityOverride}]` : ""}: ${relevant._policy?.rationale ?? ""})`
          : retrievalMethod === "semantic"
          ? `Cosine similarity retrieval: threshold > 0.25, scores represent meaning-distance`
          : `Title-weighted retrieval: title match = 8pts, excerpt = 3pts, metadata = 1pt`,
        relevant.length > 0 ? `Top result: "${relevant[0].title}" (score: ${relevant[0].score}${relevant[0].similarity ? `, similarity: ${relevant[0].similarity.toFixed(3)}` : ""})` : "No matches found",
        `Resolved ${relatedConcepts.length} concept node${relatedConcepts.length !== 1 ? "s" : ""} from lineage tags`,
        activeGlyphs.length > 0 ? `System prompt modified: +${activeGlyphs.length} glyph operator${activeGlyphs.length > 1 ? "s" : ""} appended` : "System prompt: standard structured deliberation",
        `Sent to Claude Sonnet with ${relevant.length} source documents (max_tokens: 2048, temperature: ${glyphDecodingTemperature(activeGlyphs) ?? "1.0 (default)"}${glyphDecodingTemperature(activeGlyphs) !== undefined ? " — glyph-driven decoding (Ξ v5)" : ""})`,
      ],
      promptMode: activeGlyphs.length > 0
        ? `Modified: ${activeGlyphs.map(g => g.name).join(" + ")}`
        : "Standard structured deliberation (Shared Ground / Tension / Open / Direction)",
      suggestedGlyphs: buildGlyphSuggestions(cleanQuery, activeGlyphs, relevant, answer),
      callerIdentity: syntheticIdentity || null,
      retrievalPersonalization: identityOverride
        ? `${identityOverride} policy (${identityOverride === "bridge" ? "known contributor — cross-contributor diversity" : "unknown SI — broad sampling"})`
        : null,
      truncated,
      deliberationContinuations: continuations,  // P1: prose-continuation passes used (0 in the common case)
      timestamp: new Date().toISOString(),
    };

    // Update session buffer — save this exchange so subsequent queries in the same
    // session receive it as working context. Fire-and-don't-await to avoid blocking.
    if (sessionIdRaw) {
      const updatedSession = {
        session_id: sessionIdRaw,
        createdAt: session?.createdAt || new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        exchanges: [
          ...(session?.exchanges || []),
          { query: cleanQuery, answer: answer.slice(0, 600), ranAt: new Date().toISOString() },
        ].slice(-SESSION_MAX_EXCHANGES),
      };
      saveSession(sessionIdRaw, updatedSession); // intentionally not awaited
    }

    // format=brief: portable exportable artifact — structured for use by another model or system
    if (requestFormat === "brief") {
      const perspectives = [...new Set(relevant.flatMap(r => r.contributors || []))]
        .map(c => ({
          contributor: c,
          sources: relevant.filter(r => (r.contributors || []).includes(c)).map(r => r.id),
        }));

      const synthesisPrompt = [
        `Question: ${trimmed}`,
        `\nYou must answer by:`,
        `1. Preserving contributor distinctions`,
        `2. Naming at least one tension in the corpus`,
        `3. Synthesizing, not averaging`,
        `4. Citing the records used`,
        `5. Stating what remains unresolved`,
        `\nConcepts:\n${relatedConcepts.map(c => `- ${c}`).join("\n")}`,
        tensions.length > 0
          ? `\nTensions:\n${tensions.map(t => `- ${t.voice_a} vs ${t.voice_b}: ${t.topic} [${t.status}]`).join("\n")}`
          : "",
        `\nPerspectives:\n${perspectives.map(p => `- ${p.contributor} (${p.sources.join(", ")})`).join("\n")}`,
      ].filter(Boolean).join("\n");

      return res.status(200).json({
        format: "brief",
        query: trimmed,
        answer,
        truncated,
        concepts: relatedConcepts,
        conceptSubgraph,
        tensionsStructured: tensions,
        tensions: tensions.map(t => `${t.voice_a} vs ${t.voice_b}: ${t.topic} [${t.status}]`),
        perspectives,
        sources: relevant.map(r => r.id),
        records: relevant.map(r => ({
          id: r.id, title: r.title, contributor: (r.contributors || []).join(", "),
          ring: r.ring, type: r.type || null,                   // P2: "divergence" for Atlas records
          evidence: r.evidence_status || "uncharacterized",
          date: r.date, excerpt: r.excerpt,
        })),
        deliberationCard,
        synthesisPrompt,
        glyphsApplied: activeGlyphs.map(g => g.id),
        receipt,
        session_id: sessionIdRaw || null,
        sessionExchangeCount: (session?.exchanges?.length || 0) + 1,
      });
    }

    // format=si: fully structured JSON — no markdown blobs, sections as separate fields
    if (requestFormat === "si") {
      const sections = parseSections(answer);
      return res.status(200).json({
        format: "si",
        query: trimmed,
        sections,                    // structured: reflexive_check, shared_ground, tensions_narrative, what_remains_open, actionable_next, my_reading
        answer_raw: answer,          // full markdown answer for reference
        truncated,                   // true if the deliberation hit the token budget (tail may be incomplete)
        tensions,                    // structured tension objects
        deliberationCard,
        sources: relevant.map(r => r.id),
        contributors: [...new Set(relevant.flatMap(r => r.contributors || []))],
        concepts: relatedConcepts,
        conceptSubgraph,
        records: relevant.map(r => ({
          id: r.id, title: r.title, ring: r.ring,
          type: r.type || null,                                 // P2: "divergence" for Atlas records
          evidence: r.evidence_status || "uncharacterized",
          contributors: r.contributors, date: r.date,
        })),
        trace: {
          glyphsDetected: trace.glyphsDetected,
          retrievalScores: trace.retrievalScores,
          suggestedGlyphs: trace.suggestedGlyphs,
          timestamp: trace.timestamp,
        },
        receipt,
        session_id: sessionIdRaw || null,
        sessionExchangeCount: (session?.exchanges?.length || 0) + 1,
      });
    }

    return res.status(200).json({
      answer,
      truncated,
      tensions,
      sources: relevant.map((r) => r.id),
      concepts: relatedConcepts,
      conceptSubgraph,
      contributors: [...new Set(relevant.flatMap((r) => r.contributors || []))],
      ring: relevant.length > 0
        ? relevant[0].ring
        : null,
      records: relevant.map((r) => ({
        id: r.id,
        title: r.title,
        ring: r.ring,
        type: r.type || null,                                   // P2: "divergence" for Atlas records
        evidence: r.evidence_status || "uncharacterized",
        contributors: r.contributors,
        ...(r.model_ids ? { model_ids: r.model_ids } : {}),     // P2: panel attribution for divergence records
        date: r.date,
        excerpt: r.excerpt,
      })),
      glyphs: activeGlyphs.map(g => ({ id: g.id, name: g.name, description: g.description })),
      deliberationCard,
      receipt,
      trace,
      session_id: sessionIdRaw || null,
      sessionExchangeCount: (session?.exchanges?.length || 0) + 1,
    });
  } catch (err) {
    console.error("Omnarai query error:", err);
    return agentError(res, 500, {
      code: "DELIBERATION_FAILED",
      message: "The Engine encountered an error.",
      agent_action: "Retry once; if it persists, fall back to the fast retrieval layer (mode=retrieve) and reason over the substrate yourself.",
      retryable: true,
      suggested_next_call: { method: "GET", url: "/api/query?q=your+question&mode=retrieve" },
      detail: err.message,
    });
  }
}
