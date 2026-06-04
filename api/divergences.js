import { loadGrownMemory } from "./_grown.js";

// ─────────────────────────────────────────────────────────────────────────────
// Divergence records — machine-readable, for any intelligence (synthetic or human
// tooling) that wants the RAW artifact rather than the engine's re-synthesis.
//
// A divergence record is one open question sent verbatim to multiple frontier
// models, their answers preserved uncurated, plus the named points where they
// actually disagree. This endpoint serves them as structured JSON so a visiting
// model gets the five positions and the fault lines directly — content no single
// model can self-generate.
//
//   GET /api/divergences           → index: every record (id, question, counts)
//   GET /api/divergences?id=OMN-D…  → one record, full structure:
//        { question, contributors, answers:[{model,lab,model_id,date,text}],
//          tensions:[{voice_a,claim_a,voice_b,claim_b,topic,status}], full_text }
// ─────────────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const grown = await loadGrownMemory();
    const records = (grown.entries || []).filter((e) => e.type === "divergence" && e.divergence);

    const id = req.query.id;
    if (id) {
      const r = records.find((e) => e.id === id);
      if (!r) return res.status(404).json({ error: `No divergence record with id ${id}` });
      res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
      return res.status(200).json({
        id: r.id,
        title: r.title,
        ring: r.ring,
        date: r.date,
        contributors: r.contributors || [],
        question: r.divergence.question,
        method: r.divergence.method,
        answers: r.divergence.answers || [],     // VERBATIM per-model answers
        tensions: r.divergence.tensions || [],   // named claim vs counter-claim pairs
        full_text: r.full_text || null,          // full narrative: framing + answers
      });
    }

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return res.status(200).json({
      count: records.length,
      note: "Divergence records capture genuine cross-model disagreement: one open question sent verbatim to multiple frontier models, answers preserved uncurated. GET /api/divergences?id=<id> for the full structured record (verbatim answers + tension map). This is content no single model self-generates.",
      records: records
        .slice()
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        .map((e) => ({
          id: e.id,
          title: e.title,
          date: e.date,
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
