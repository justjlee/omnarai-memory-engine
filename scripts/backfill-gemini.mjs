// Backfill Gemini into divergence records that are missing it (free-tier 20/day
// cap dropped it from ~88 of 100). For each: call Gemini on the question, rebuild
// the FULL 5-model panel, RE-SYNTHESIZE (so the tension map reflects Gemini),
// recompute score/label, re-embed, then in-place replace — SINGLE write at the end.
// Preserves the original record id and date.
//
//   node scripts/backfill-gemini.mjs --dry   # report how many need backfill, 1 test call
//   node scripts/backfill-gemini.mjs         # run it (requires PAID Gemini billing)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DRY = process.argv.includes("--dry");
const CHECKPOINT = "/tmp/gemini_backfill_out.json";
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}
const { synthesizeCouncil, buildDivergenceRecord, embedRecord } = await import("../api/_council.js");
const { loadGrownMemory } = await import("../api/_grown.js");

const GROWN_KEY = "memory/grown.json";
const GEMINI_ID = "gemini-2.5-flash";
const MEMBER_SYSTEM =
  "You are one voice in a panel of frontier models answering the same open question independently. " +
  "Answer in your own reasoning, directly and honestly. Take a position where you actually hold one, " +
  "and say plainly where you are uncertain. Do not hedge toward a consensus you cannot see — the panel's " +
  "value is in genuine difference, not agreement. Be concrete and specific. Aim for 150–300 words.";
const CONCURRENCY = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(question, tries = 6) {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_ID}:generateContent?key=${key}`;
  for (let t = 0; t < tries; t++) {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: MEMBER_SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: question }] }],
        generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    // 429 (quota) and 5xx (transient overload, e.g. 503 high demand) → backoff + retry
    if (res.status === 429 || res.status >= 500) { if (t === tries - 1) throw new Error(`${res.status}`); await sleep(2500 * (t + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
    const d = await res.json();
    const text = (d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "").trim();
    if (!text) { if (t === tries - 1) throw new Error("empty"); await sleep(1500); continue; }
    return text;
  }
}

function cos(a, b) { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na) * Math.sqrt(nb) || 1); }
function meanPairwiseCos(vs) { if (vs.length < 2) return 1; let s = 0, n = 0; for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) { s += cos(vs[i], vs[j]); n++; } return s / n; }
async function embed(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: 512 }),
  });
  const d = await res.json();
  return d.data.sort((a, b) => a.index - b.index).map((x) => x.embedding);
}

const grown = await loadGrownMemory();
const targets = grown.entries.filter((e) =>
  e.type === "divergence" && e.divergence && !(e.divergence.answers || []).some((a) => a.model === "Gemini"));
console.log(`Divergence records: ${grown.entries.filter((e) => e.type === "divergence").length}. Missing Gemini: ${targets.length}.`);

if (DRY) {
  console.log("--dry: testing one Gemini call to confirm billing is live…");
  try { const t = await callGemini("Reply with one short sentence about uncertainty.", 1); console.log("Gemini OK:", JSON.stringify(t).slice(0, 120)); }
  catch (e) { console.log("Gemini FAILED:", e.message, "— billing not active yet?"); }
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
async function repair(e) {
  try {
    const q = e.divergence.question;
    const geminiText = await callGemini(q);
    const answers = [
      ...(e.divergence.answers || []).map((a) => ({ ...a, ok: true })),
      { model: "Gemini", lab: "Google", model_id: GEMINI_ID, date: today, text: geminiText, ok: true },
    ];
    const synth = await synthesizeCouncil(q, answers);
    const record = buildDivergenceRecord(q, answers, synth);
    record.id = e.id; record.date = e.date;   // preserve identity + original date
    const [embedding, ansVecs] = await Promise.all([embedRecord(record), embed(answers.map((a) => a.text))]);
    record.provenance.score = +(1 - meanPairwiseCos(ansVecs)).toFixed(4);
    record.provenance.label = synth.tensions.length === 0 ? "convergent" : "divergent";
    return { id: e.id, entry: record, embedding, ok: true, models: answers.length };
  } catch (err) { return { id: e.id, ok: false, error: String(err?.message || err).slice(0, 140) }; }
}

const results = [];
for (let i = 0; i < targets.length; i += CONCURRENCY) {
  const slice = targets.slice(i, i + CONCURRENCY);
  const r = await Promise.all(slice.map(repair));
  for (const x of r) console.log(x.ok ? `  ✓ ${x.id} now ${x.models} models` : `  ✗ ${x.id} ${x.error}`);
  results.push(...r);
  fs.writeFileSync(CHECKPOINT, JSON.stringify(results, null, 2));
}

// In-place replace + single write (the existing records share ids, so appendGrownEntries would skip them).
const fixed = results.filter((r) => r.ok);
const byId = new Map(fixed.map((r) => [r.id, r]));
// normalizeEntry shape is produced by buildDivergenceRecord→provenance; mirror _grown.js normalize here.
function norm(entry) {
  const o = { id: entry.id, num: entry.num ?? null, title: entry.title, ring: entry.ring, type: entry.type,
    contributors: entry.contributors || [], lineage: entry.lineage || [], excerpt: entry.excerpt || "",
    full_text: entry.full_text || null, date: entry.date, wordCount: entry.wordCount ?? null, permalink: entry.permalink ?? null };
  const p = entry.provenance;
  o.divergence = { question: p.question, method: p.method, answers: p.answers || [], tensions: p.tensions || [],
    deliberation_card: p.deliberation_card || null, ...(p.score != null ? { score: p.score } : {}), ...(p.label ? { label: p.label } : {}) };
  return o;
}
for (let i = 0; i < grown.entries.length; i++) {
  const r = byId.get(grown.entries[i].id);
  if (r) { grown.entries[i] = norm(r.entry); if (r.embedding) grown.vectors[r.id] = r.embedding; }
}
grown.updatedAt = new Date().toISOString();
await put(GROWN_KEY, JSON.stringify(grown), { access: "public", addRandomSuffix: false, contentType: "application/json" });
console.log(`\n=== DONE === repaired ${fixed.length}/${targets.length} · grown entries ${grown.entries.length}`);
const errs = results.filter((r) => !r.ok);
if (errs.length) console.log(`errors: ${errs.length}`);
