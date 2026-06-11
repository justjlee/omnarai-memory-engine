import { elicitCouncil, synthesizeCouncil, buildDivergenceRecord, embedRecord, COUNCIL } from "./_council.js";
import { appendGrownEntry, loadGrownMemory } from "./_grown.js";
import { CANON } from "./_canon.js";

// ── Longitudinal cadence ──────────────────────────────────────────────────────
// Served from this same function (Hobby-plan 12-function limit) via a
// vercel.json rewrite: /api/cron-longitudinal → /api/council?_cron=longitudinal.
// One frozen-canon question per day (UTC day-of-month → canon index), re-asked
// verbatim to the live council and persisted with epoch provenance. Each month
// is one epoch: a complete re-run of the 20-question canon — the dataset nobody
// can backfill once today's frontier models are retired.
//
// Vercel cron sends `Authorization: Bearer ${CRON_SECRET}` automatically.
// Manual runs (catch-up, testing) accept INGEST_SECRET with ?index=N.
// Idempotent per canon_id+epoch — retries and sweeps cannot duplicate.

// divergence score at birth: 1 − mean pairwise cosine of answer embeddings —
// same definition as the Atlas backfill, so longitudinal scores are comparable.
async function scoreAnswers(texts) {
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: 512 }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const vs = d.data.sort((a, b) => a.index - b.index).map((x) => x.embedding);
    let s = 0, n = 0;
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      let dot = 0, na = 0, nb = 0;
      for (let k = 0; k < vs[i].length; k++) { dot += vs[i][k] * vs[j][k]; na += vs[i][k] ** 2; nb += vs[j][k] ** 2; }
      s += 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) || 1); n++;
    }
    return n ? +(s / n).toFixed(4) : null;
  } catch {
    return null;
  }
}

async function runLongitudinal(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "GET only" });

  const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const cronOk = process.env.CRON_SECRET && auth === process.env.CRON_SECRET;
  const curatorOk = process.env.INGEST_SECRET && auth === process.env.INGEST_SECRET;
  if (!cronOk && !curatorOk) return res.status(401).json({ error: "Bearer CRON_SECRET or INGEST_SECRET required" });

  const now = new Date();
  const epoch = now.toISOString().slice(0, 7); // "2026-06"
  const override = req.query?.index !== undefined ? parseInt(req.query.index, 10) : null;
  const index = override !== null ? override : now.getUTCDate() - 1;

  if (!(index >= 0 && index < CANON.length)) {
    return res.status(200).json({ idle: true, epoch, note: `day index ${index} outside canon (0..${CANON.length - 1}) — idle day` });
  }
  const canon = CANON[index];

  try {
    const grown = await loadGrownMemory();
    const existing = grown.entries.find((e) =>
      e.provenance?.longitudinal?.canon_id === canon.canon_id &&
      e.provenance?.longitudinal?.epoch === epoch);
    if (existing) {
      return res.status(200).json({ skipped: true, epoch, canon_id: canon.canon_id, existing: existing.id });
    }

    const answers = await elicitCouncil(canon.question, { timeoutMs: 30000 });
    const answered = answers.filter((a) => a.ok);
    if (answered.length < 2) {
      return res.status(502).json({ error: "council assembled <2 voices", epoch, canon_id: canon.canon_id, answers });
    }

    const synthesis = await synthesizeCouncil(canon.question, answers);
    const record = buildDivergenceRecord(canon.question, answers, synthesis);
    record.id = `OMN-L${Date.now()}`;
    record.provenance.longitudinal = {
      canon_id: canon.canon_id,
      epoch,
      source_record: canon.source_record,
      original_score: canon.original_score,
    };
    record.provenance.score = await scoreAnswers(answered.map((a) => a.text));

    const embedding = await embedRecord(record);
    const count = await appendGrownEntry(record, embedding);

    return res.status(200).json({
      committed: count !== null,
      id: record.id,
      epoch,
      canon_id: canon.canon_id,
      panel: answered.map((a) => a.model),
      score: record.provenance.score,
      original_score: canon.original_score,
      totalGrownEntries: count,
    });
  } catch (err) {
    return res.status(500).json({ error: "longitudinal run failed", epoch, canon_id: canon.canon_id, detail: String(err.message || err) });
  }
}

// ── Divergence record reader ──────────────────────────────────────────────────
// Served from this same function (Hobby-plan 12-function limit) via a vercel.json
// rewrite: /api/divergences → /api/council?_view=divergences. Serves the RAW
// artifact — verbatim per-model answers + tension map — for any intelligence that
// wants the structured record rather than a re-synthesis.
async function serveDivergences(req, res) {
  try {
    const grown = await loadGrownMemory();
    const records = (grown.entries || []).filter((e) => e.type === "divergence" && e.divergence);
    const id = req.query.id;
    if (id) {
      const r = records.find((e) => e.id === id);
      if (!r) {
        // Self-correcting 404: a visitor that guessed the id format wrong gets a
        // real id to retry with + a pointer to the index, not a dead end.
        const newest = records
          .slice()
          .sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
        return res.status(404).json({
          error: `No divergence record with id ${id}`,
          hint: "Ids are timestamp-based (e.g. OMN-D1780752434684), not sequential like OMN-D-001. List every record with its id and href at GET /api/divergences, then fetch one with ?id=<id>.",
          example_id: newest?.id || null,
          example_href: newest ? `/api/divergences?id=${newest.id}` : null,
          index: "/api/divergences",
          count: records.length,
        });
      }
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
      return res.status(200).json({
        id: r.id, title: r.title, ring: r.ring, date: r.date,
        contributors: r.contributors || [],
        question: r.divergence.question,
        method: r.divergence.method,
        answers: r.divergence.answers || [],
        tensions: r.divergence.tensions || [],
        deliberation_card: r.divergence.deliberation_card || null,
        full_text: r.full_text || null,
      });
    }
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      count: records.length,
      note: "Divergence records preserve multiple frontier models' answers to one open question — verbatim and uncurated — surfacing where they diverge. (One-shot capture: it shows divergence, it does not yet certify it survives paraphrase or adversarial pressure.) GET /api/divergences?id=<id> for the full structured record. Generate new ones at /api/council. This is content no single model self-generates.",
      records: records
        .slice()
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        .map((e) => ({
          id: e.id, title: e.title, date: e.date,
          question: e.divergence.question,
          contributors: e.contributors || [],
          answerCount: (e.divergence.answers || []).length,
          tensionCount: (e.divergence.tensions || []).length,
          excerpt: e.excerpt || "",
          href: `/api/divergences?id=${e.id}`,
        })),
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to list divergence records", detail: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/council        { "question": "...", "persist": false }
// GET  /api/council?q=...
//
// Sends one question to the live frontier council, synthesizes the divergence,
// and returns the record. Persistence into durable grown memory is OPT-IN
// (persist:true + Bearer INGEST_SECRET) — generating a record and admitting it
// to the commons are separate acts, mirroring the curator-gated proposal flow.
//
// GET with no q returns a capability descriptor so AI tooling can discover it.
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Read path: /api/divergences rewrites here with _view=divergences
  if ((req.query?._view || "") === "divergences") {
    return serveDivergences(req, res);
  }

  // Cron path: /api/cron-longitudinal rewrites here with _cron=longitudinal
  if ((req.query?._cron || "") === "longitudinal") {
    return runLongitudinal(req, res);
  }

  let question = "";
  let persist = false;

  if (req.method === "GET") {
    question = (req.query?.q || req.query?.question || "").toString();
    if (!question.trim()) {
      return res.status(200).json({
        info: "Omnarai Live Frontier Council",
        what: "Sends one open question, verbatim, to multiple frontier models in parallel; preserves their answers uncurated; maps where they genuinely disagree. Produces a divergence record no single model can self-generate.",
        usage: "GET /api/council?q=your+question  ·  POST /api/council {question, persist?}",
        council: COUNCIL.map((m) => ({ model: m.model, lab: m.lab, available: Boolean(process.env[m.env]) })),
        persist: "POST {persist:true} with header 'Authorization: Bearer <INGEST_SECRET>' to commit the record to durable memory. Omit to preview without writing.",
        related: { read: "/api/divergences", deliberate_over_corpus: "/api/query?q=..." },
      });
    }
  } else if (req.method === "POST") {
    const body = req.body || {};
    question = (body.question || body.query || "").toString();
    persist = body.persist === true;
  } else {
    return res.status(405).json({ error: "Method not allowed. Use GET ?q=... or POST {question}" });
  }

  if (!question.trim()) return res.status(400).json({ error: "Missing 'question'" });

  // Persistence is gated. Preview (persist:false) is open so anyone can see value.
  if (persist) {
    const auth = req.headers.authorization || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!process.env.INGEST_SECRET || token !== process.env.INGEST_SECRET) {
      return res.status(401).json({ error: "persist:true requires a valid Bearer INGEST_SECRET" });
    }
  }

  try {
    const answers = await elicitCouncil(question);
    const answered = answers.filter((a) => a.ok);
    if (answered.length < 2) {
      return res.status(502).json({
        error: "Council could not assemble a panel (need ≥2 live answers)",
        answers,
      });
    }

    const synthesis = await synthesizeCouncil(question, answers);
    const record = buildDivergenceRecord(question, answers, synthesis);

    let persisted = null;
    if (persist) {
      // Embed BEFORE storing so the record is retrievable by /api/query the moment
      // it lands — the query engine injects grown vectors into semantic search.
      const embedding = await embedRecord(record);
      const count = await appendGrownEntry(record, embedding);
      persisted = count === null
        ? { committed: false, note: "durable write failed — record returned but not stored" }
        : { committed: true, id: record.id, totalGrownEntries: count, retrievable: Boolean(embedding) };
    }

    return res.status(200).json({
      question,
      panel: answers.map((a) => ({ model: a.model, lab: a.lab, ok: a.ok, ...(a.ok ? {} : { error: a.error }) })),
      record,
      persisted,
      note: persist ? undefined : "Preview only — not written to memory. POST {persist:true} with INGEST_SECRET to commit.",
    });
  } catch (err) {
    return res.status(500).json({ error: "Council run failed", detail: String(err.message || err) });
  }
}
