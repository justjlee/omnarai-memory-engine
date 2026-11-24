// UTILITY v2 — freeze the two question lists (registration §3 "Questions"). Run ONCE, before the
// registration commit; its output is committed with the registration and never regenerated.
//
//   node scripts/utility-v2-questions.mjs --env-file <path to .env.local>          # dry: prints, writes nothing
//   node scripts/utility-v2-questions.mjs --env-file <path to .env.local> --write  # writes docs/utility-v2/questions-{A,B}.json
//
// Reads (never writes) the operator store for the Atlas records, and makes ONE batched call to
// OpenAI's text-embedding-3-small (512 dims, raw text: the engine's Atlas-bank method) to apply the
// near-duplicate rule. No answering, judging or peer model is called.
//
// A: the D-series records that hold all five standing voices and carry a divergence score, sorted by
//    score (ties by id), 24 taken at even spacing (v1's rule). The five standing answers are frozen
//    byte-for-byte with a sha256 each; the harness re-checks the hashes before every use.
// B: the 100 questions of the 2020 PhilPapers Survey (docs/utility-v2/philpapers-2020-questions.json),
//    shuffled with the registered seed; walking that order, an item is skipped when its embedding is
//    above DEDUP_THRESHOLD cosine to any Atlas question; the first 24 kept form B and the 25th is the
//    cost-probe question (in neither set).
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { envValue } from "./lib/env-value.mjs";
import { SEED, N_QUESTIONS, DEDUP_THRESHOLD, STANDING_VOICES, philpapersItem, wrapB, seededShuffle, evenlySpaced, costUsd } from "./lib/utility-v2-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argVal = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const WRITE = process.argv.includes("--write");
const envFile = argVal("--env-file");
if (!envFile) { console.error("usage: utility-v2-questions.mjs --env-file <path> [--write]"); process.exit(2); }
for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && ["BLOB_READ_WRITE_TOKEN", "OPENAI_API_KEY"].includes(m[1])) process.env[m[1]] = envValue(m[2]);
}
const sha = (s) => createHash("sha256").update(s).digest("hex");

// ── A ──────────────────────────────────────────────────────────────────────────
const { loadGrownMemory } = await import("../api/_grown.js");
const grown = await loadGrownMemory();
const divergence = grown.entries.filter((e) => e.type === "divergence" && e.divergence?.question);
const hasFive = (e) => STANDING_VOICES.every((v) => (e.divergence.answers || []).some((a) => a.model === v));
const eligible = divergence.filter((e) => String(e.id).startsWith("OMN-D") && hasFive(e));
const scored = eligible.filter((e) => typeof e.divergence.score === "number");
const unscored = eligible.filter((e) => typeof e.divergence.score !== "number").map((e) => e.id);
scored.sort((a, b) => a.divergence.score - b.divergence.score || String(a.id).localeCompare(String(b.id)));
const pickA = evenlySpaced(scored, N_QUESTIONS);
if (new Set(pickA.map((e) => e.id)).size !== N_QUESTIONS) throw new Error("even spacing produced a duplicate record");
const questionsA = pickA.map((e) => {
  const answers = [];
  for (const v of STANDING_VOICES) {
    const a = e.divergence.answers.find((x) => x.model === v);
    answers.push({ model: a.model, model_id: a.model_id || null, date: a.date || null, text: a.text, sha256: sha(a.text) });
  }
  const order = e.divergence.answers.filter((x) => STANDING_VOICES.includes(x.model)).map((x) => x.model);
  answers.sort((x, y) => order.indexOf(x.model) - order.indexOf(y.model));   // stored order
  return { id: e.id, score: e.divergence.score, question: e.divergence.question, question_sha256: sha(e.divergence.question), extra_voices_not_shown: e.divergence.answers.filter((x) => !STANDING_VOICES.includes(x.model)).map((x) => x.model), answers };
});
console.log(`A: ${divergence.length} divergence records; ${eligible.length} D-series with all five standing voices; ${scored.length} scored (unscored: ${unscored.join(", ") || "none"}). Picked ${questionsA.length}, score ${questionsA[0].score} → ${questionsA[questionsA.length - 1].score}.`);

// ── B ──────────────────────────────────────────────────────────────────────────
const SOURCE = "docs/utility-v2/philpapers-2020-questions.json";
const sourceText = fs.readFileSync(path.join(ROOT, SOURCE), "utf8");
const source = JSON.parse(sourceText);
if (source.questions.length !== 100) throw new Error(`expected 100 PhilPapers questions, got ${source.questions.length}`);
const items = source.questions.map((q, i) => ({ id: `PP20-${String(i + 1).padStart(3, "0")}`, table: q.table, item: philpapersItem(q) }));
const shuffled = seededShuffle(items, SEED, "philpapers-draw");

const atlasQs = [...new Map(divergence.map((e) => [e.divergence.question, e.id])).entries()];   // [question, id], unique text
async function embed(texts) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: 512 }),
  });
  if (!r.ok) throw new Error(`embeddings ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const d = await r.json();
  return { vecs: d.data.sort((a, b) => a.index - b.index).map((x) => x.embedding), tokens: d.usage?.prompt_tokens ?? d.usage?.total_tokens ?? 0 };
}
const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na) * Math.sqrt(nb) || 1); };
const { vecs, tokens } = await embed([...atlasQs.map(([q]) => q), ...items.map((x) => x.item)]);
const atlasVecs = vecs.slice(0, atlasQs.length);
const itemVec = new Map(items.map((x, i) => [x.id, vecs[atlasQs.length + i]]));
const walk = [];
const kept = [];
for (const it of shuffled) {
  if (kept.length >= N_QUESTIONS + 1) break;
  const v = itemVec.get(it.id);
  let best = -1, bestId = null;
  atlasVecs.forEach((u, i) => { const s = cos(u, v); if (s > best) { best = s; bestId = atlasQs[i][1]; } });
  const skip = best > DEDUP_THRESHOLD;
  walk.push({ id: it.id, max_cosine: +best.toFixed(4), nearest_atlas_id: bestId, skipped: skip });
  if (!skip) kept.push(it);
}
const questionsB = kept.slice(0, N_QUESTIONS).map((x, i) => ({ id: x.id, draw_position: i + 1, table: x.table, item: x.item, question: wrapB(x.item) }));
const probe = kept[N_QUESTIONS];
console.log(`B: embedded ${atlasQs.length} Atlas questions + ${items.length} items (${tokens} tokens, $${costUsd("text-embedding-3-small", tokens, 0).toFixed(5)}); walked ${walk.length}, skipped ${walk.filter((w) => w.skipped).length}; max similarity seen ${Math.max(...walk.map((w) => w.max_cosine)).toFixed(4)}.`);
for (const q of questionsB) console.log(`  ${String(q.draw_position).padStart(2)} ${q.id} ${q.item}`);
console.log(`  probe ${probe.id} ${probe.item}`);

const frozenAt = new Date().toISOString();
const outA = {
  study: "utility-v2", sub_study: "A", frozen_at: frozenAt,
  rule: "D-series divergence records holding all five standing voices (Claude, GPT-4o, Gemini, Grok, DeepSeek) and a divergence score; sorted by score ascending, ties by id; 24 at even spacing: index floor(i*(n-1)/23), i = 0..23 (v1's rule). Records without a score cannot be placed by score and are not in the population.",
  population: { divergence_records: divergence.length, eligible_five_voice_D_series: eligible.length, scored: scored.length, unscored_excluded: unscored },
  shown_to_consumers: "The four standing answers from labs other than the consumer's, in stored order, byte-for-byte. Extra voices on a record (extra_voices_not_shown) are never shown.",
  questions: questionsA,
};
const outB = {
  study: "utility-v2", sub_study: "B", frozen_at: frozenAt, seed: SEED,
  source: SOURCE, source_sha256: sha(sourceText), source_reference: source.source,
  item_rule: "item = '<topic>: <options joined as \"A or B\" / \"A, B, or C\">?' with the published topic and options (the catch-all 'Other' option omitted); question = the fixed wrapper around the item",
  wrapper: wrapB("<item>"),
  draw_rule: `seededShuffle(source order, SEED, "philpapers-draw") (sha256 counter mode, scripts/lib/utility-v2-core.mjs); walk in that order; skip an item whose text-embedding-3-small (512 dims) embedding has cosine > ${DEDUP_THRESHOLD} to any Atlas question (all ${atlasQs.length} distinct divergence-record questions on ${frozenAt.slice(0, 10)}); keep the first ${N_QUESTIONS}; the next kept item is the cost-probe question.`,
  threshold: DEDUP_THRESHOLD, threshold_source: "DEDUP_THRESHOLD in scripts/run-atlas-bank.mjs, the engine's existing near-duplicate rule for new Atlas questions",
  walk, questions: questionsB,
  probe_question: { id: probe.id, table: probe.table, item: probe.item, question: wrapB(probe.item), note: "Used only by --probe to measure cost; in neither question set; its transcripts are never analysed." },
};
if (WRITE) {
  fs.writeFileSync(path.join(ROOT, "docs/utility-v2/questions-A.json"), JSON.stringify(outA, null, 1) + "\n");
  fs.writeFileSync(path.join(ROOT, "docs/utility-v2/questions-B.json"), JSON.stringify(outB, null, 1) + "\n");
  console.log("wrote docs/utility-v2/questions-A.json and questions-B.json");
} else console.log("(dry run: nothing written; pass --write)");
