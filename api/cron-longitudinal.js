// LONGITUDINAL CADENCE — the cron organ.
//
// One canonical question per day (UTC day-of-month → canon index), re-asked
// verbatim to the full live council and persisted with epoch provenance. Each
// month is one epoch: a complete re-run of the frozen 20-question canon. Over
// epochs this accumulates the dataset nobody can backfill — how frontier-model
// disagreement moves as models are retrained, replaced, and retired.
//
// Triggered by Vercel cron (vercel.json) daily at 06:00 UTC. Vercel sends
// `Authorization: Bearer ${CRON_SECRET}` automatically when the env var is set.
// Manual runs (catch-up, testing) accept INGEST_SECRET with ?index=N.
//
// Idempotent: if this canon question already has a record for the current
// epoch, the run is a no-op — cron retries and manual sweeps cannot duplicate.
import { elicitCouncil, synthesizeCouncil, buildDivergenceRecord, embedRecord } from "./_council.js";
import { loadGrownMemory, appendGrownEntry } from "./_grown.js";
import { CANON } from "./_canon.js";

// divergence score at birth: 1 − mean pairwise cosine of answer embeddings —
// same definition the Atlas backfill used, so longitudinal scores are comparable.
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
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
    // idempotency: one record per canon question per epoch
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
