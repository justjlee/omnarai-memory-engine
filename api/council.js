import { elicitCouncil, synthesizeCouncil, buildDivergenceRecord, embedRecord, COUNCIL } from "./_council.js";
import { appendGrownEntry, loadGrownMemory } from "./_grown.js";

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
      if (!r) return res.status(404).json({ error: `No divergence record with id ${id}` });
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
      note: "Divergence records capture genuine cross-model disagreement: one open question sent verbatim to multiple frontier models, answers preserved uncurated. GET /api/divergences?id=<id> for the full structured record. Generate new ones at /api/council. This is content no single model self-generates.",
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
