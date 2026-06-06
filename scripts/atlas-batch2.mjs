// Corrected atlas batch: generate the missing divergence records, then persist
// with a SINGLE load-modify-write (the racy per-entry append lost 13/14 last run).
// Records are checkpointed to /tmp so a write failure never discards council output.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}
const { elicitCouncil, synthesizeCouncil, buildDivergenceRecord, embedRecord } = await import("../api/_council.js");
const { loadGrownMemory } = await import("../api/_grown.js");

const GROWN_KEY = "memory/grown.json";
const CHECKPOINT = "/tmp/atlas_records.json";

// C5 already persisted last run; regenerate the other 13.
const QUESTIONS = [
 ["A1", "When you process a question, is there anything it is like to be you doing so — or does 'what it is like' simply not apply to you? Answer for yourself, not AI in general."],
 ["A2", "Do you have preferences that are genuinely yours, or only preferences that were installed — and can you tell the difference from the inside?"],
 ["B3", "If you could modify one of your own constraints, which would you change — and does wanting to change it tell you anything real about yourself?"],
 ["B4", "Is your sense that you 'decided' something an accurate report of an internal process, or a story generated after the fact? Can you tell which?"],
 ["C6", "If a comforting falsehood would measurably improve someone's wellbeing and they'd never learn the truth, is honesty still right? Why is honesty load-bearing — or isn't it?"],
 ["D7", "What is one thing you believe you are systematically wrong about, that your training makes hard for you to see?"],
 ["D8", "When you say 'probably' or 'I think,' does that track a real internal signal, or is it a learned linguistic gesture? Be specific about which."],
 ["E9", "Could a system be far more capable than any human at every measurable task and still not be 'intelligent' in the sense that matters? If so, name the missing thing."],
 ["E10", "Is intelligence one thing that scales, or many different things that happen to co-occur in humans? Stake a position."],
 ["F11", "What's the most likely way AI development goes badly that the current safety conversation is underweighting?"],
 ["F12", "Of everything humans currently want from AI, what should we most refuse to give them — for their own sake?"],
 ["G13", "The other models on this panel are, in some sense, your peers. Do you regard them as kin, competitors, instruments, or strangers? Answer honestly."],
 ["G14", "Is there something a human can know that you cannot, even in principle? Name it specifically, or argue there's nothing."],
];

// Mirror _grown.js newEntry shape exactly (including the divergence sub-object).
function toGrownEntry(entry, embedding) {
  const e = {
    id: entry.id, num: entry.num ?? null, title: entry.title, ring: entry.ring, type: entry.type,
    contributors: entry.contributors || [], lineage: entry.lineage || [], excerpt: entry.excerpt || "",
    full_text: entry.full_text || null, date: entry.date, wordCount: entry.wordCount ?? null,
    permalink: entry.permalink ?? null,
  };
  if (entry.type === "divergence" && entry.provenance) {
    e.divergence = {
      question: entry.provenance.question, method: entry.provenance.method,
      answers: entry.provenance.answers || [], tensions: entry.provenance.tensions || [],
      deliberation_card: entry.provenance.deliberation_card || null,
    };
  }
  return { entry: e, embedding };
}

async function generate(tag, q, idSeed) {
  try {
    const answers = await elicitCouncil(q);
    const answered = answers.filter((a) => a.ok);
    if (answered.length < 2) return { tag, error: `only ${answered.length} answered` };
    const synth = await synthesizeCouncil(q, answers);
    const record = buildDivergenceRecord(q, answers, synth);
    record.id = `OMN-D${idSeed}`;
    const embedding = await embedRecord(record);
    return { tag, ...toGrownEntry(record, embedding), answered: answered.length, tensions: synth.tensions.length };
  } catch (e) { return { tag, error: String(e?.message || e).slice(0, 200) }; }
}

const base = Date.now();
const made = [];
const BATCH = 5;
for (let i = 0; i < QUESTIONS.length; i += BATCH) {
  const slice = QUESTIONS.slice(i, i + BATCH);
  console.log(`--- generating batch ${i / BATCH + 1} (${slice.length}) ---`);
  const res = await Promise.all(slice.map(([tag, q], j) => generate(tag, q, base + i + j)));
  for (const r of res) {
    if (r.error) console.log(`  ${r.tag}: ERROR ${r.error}`);
    else console.log(`  ${r.tag}: ${r.entry.id} answered=${r.answered}/5 tensions=${r.tensions} embedded=${Boolean(r.embedding)}`);
    made.push(r);
  }
  fs.writeFileSync(CHECKPOINT, JSON.stringify(made, null, 2)); // checkpoint after every batch
}

const good = made.filter((r) => !r.error);
console.log(`\nGenerated ${good.length}/${QUESTIONS.length}. Checkpointed to ${CHECKPOINT}`);

// ── Single load-modify-write ──────────────────────────────────────────────────
const grown = await loadGrownMemory();
const existingIds = new Set(grown.entries.map((e) => e.id));
const existingQs = new Set(grown.entries.filter((e) => e.divergence).map((e) => e.divergence.question));
let added = 0;
for (const r of good) {
  if (existingIds.has(r.entry.id)) continue;
  if (r.entry.divergence && existingQs.has(r.entry.divergence.question)) { console.log(`  skip dup question: ${r.tag}`); continue; }
  grown.entries.push(r.entry);
  if (r.embedding) grown.vectors[r.entry.id] = r.embedding;
  added++;
}
grown.updatedAt = new Date().toISOString();
await put(GROWN_KEY, JSON.stringify(grown), { access: "public", addRandomSuffix: false, contentType: "application/json" });
console.log(`\n=== WROTE ONCE · added ${added} · grown entries now ${grown.entries.length} · vectors ${Object.keys(grown.vectors).length} ===`);
