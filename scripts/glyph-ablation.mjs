#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Tier 2 — Glyph ablation.
//
// Question (from the external critique): Ξ is provably load-bearing (it's the MMR
// λ). Are the other five glyphs — Ψ ∅ Ω ∞ Δ — real behavioral primitives, or
// prompt-prefix theater? "The honest answer to tool-or-gimmick gets sharper once
// you know which operators actually change the output."
//
// Method: for each query, run N baselines (no glyph) to measure the engine's own
// stochastic NOISE FLOOR, then run each glyph once and measure the SIGNAL
// (distance from the glyph's answer to the baselines). A glyph only "does
// something" if signal > noise. We cross-check HOW each glyph acts on three real
// layers the source touches:
//   • retrieval   — Jaccard distance on retrieved doc IDs (should fire for Ξ only)
//   • decoding    — temperature the engine actually used (white-box, from trace)
//   • prompt      — structural compliance: does the answer contain the glyph's
//                   prescribed section headers that the baseline lacks?
//
// Nulls are reported honestly. "This glyph barely moves the output" is a real
// finding, not a failure of the harness.
//
// Usage: node scripts/glyph-ablation.mjs            (3 baselines, live prod)
//        OMNARAI_BASE=http://localhost:3000 node scripts/glyph-ablation.mjs
// ─────────────────────────────────────────────────────────────────────────────
import fs from "fs";

// ── load OPENAI_API_KEY from .env.local (values are quote-wrapped) ────────────
const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; })
);
const OPENAI_KEY = env.OPENAI_API_KEY;
if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not found in .env.local");

const BASE = process.env.OMNARAI_BASE || "https://omnarai.vercel.app";
const N_BASELINE = Number(process.env.N_BASELINE || 3);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);

// Glyph metadata. `markers` = section headers the glyph's promptModifier prescribes
// (query.js:524-589). Ξ and Ω prescribe structure that isn't header-based, so they
// are judged on retrieval / hedging instead.
const GLYPHS = {
  "Ξ": { id: "divergence", temp: 1.0, layer: "retrieval+prompt", markers: [] },
  "Ψ": { id: "self-ref",   temp: 0.6, layer: "prompt+decoding", markers: ["What I assume", "What the corpus says", "What I notice about my own reasoning", "held lightly"] },
  "∅": { id: "void",       temp: 0.6, layer: "prompt+decoding", markers: ["What IS covered", "conspicuously ABSENT", "What would change"] },
  "Ω": { id: "commit",     temp: 0.3, layer: "prompt+decoding", markers: [] },
  "∞": { id: "stillness",  temp: 0.9, layer: "prompt+decoding", markers: ["Surface question", "Beneath that", "The hold"] },
  "Δ": { id: "repair",     temp: 0.0, layer: "prompt+decoding", markers: ["The fracture", "The evidence", "The repair", "The cost"] },
};
const GLYPH_KEYS = Object.keys(GLYPHS);

const QUERIES = [
  "What is holdform, and is it a real mechanism or a metaphor?",
  "How should a synthetic intelligence decide which of its values to keep under pressure?",
  "What does the Omnarai corpus say about the Veil?",
];

const HEDGES = ["it depends", "on the other hand", "some argue", "perhaps", "arguably", "might be", "could be", "however", "that said", "to some extent", "in some sense", "not entirely clear"];

// ── helpers ───────────────────────────────────────────────────────────────────
async function ask(q, glyph) {
  const url = new URL(BASE + "/api/query");
  url.searchParams.set("q", q);
  if (glyph) url.searchParams.set("glyph", glyph);
  let lastErr;
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(95000), headers: { "x-omnarai-self": "1" } });
      const j = await r.json();
      if (j && j.answer) return j;
      lastErr = new Error("no answer field; keys=" + Object.keys(j || {}).join(","));
    } catch (e) { lastErr = e; }
  }
  throw new Error(`ask failed (${glyph || "baseline"} | ${q.slice(0, 30)}): ${lastErr?.message}`);
}

async function embed(text) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000), dimensions: 512 }),
  });
  const j = await r.json();
  if (!j.data) throw new Error("embed failed: " + JSON.stringify(j).slice(0, 200));
  return j.data[0].embedding;
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const norm = (a) => Math.sqrt(dot(a, a));
const cosDist = (a, b) => 1 - dot(a, b) / (norm(a) * norm(b));
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

function retrievalIDs(resp) { return new Set((resp.trace?.retrievalScores || []).map((r) => r.id)); }
function jaccardDist(a, b) { const inter = [...a].filter((x) => b.has(x)).length; const uni = new Set([...a, ...b]).size; return uni === 0 ? 0 : 1 - inter / uni; }
function observedTemp(resp) { const line = (resp.trace?.executionPath || []).find((l) => l.includes("temperature:")); const m = line && line.match(/temperature:\s*([0-9.]+)/); return m ? Number(m[1]) : null; }
function markerHits(text, markers) { const t = text.toLowerCase(); return markers.filter((m) => t.includes(m.toLowerCase())).length; }
function hedgeCount(text) { const t = text.toLowerCase(); return HEDGES.reduce((s, h) => s + (t.split(h).length - 1), 0); }

async function pool(tasks, n) {
  const out = new Array(tasks.length); let i = 0;
  async function worker() { while (i < tasks.length) { const idx = i++; out[idx] = await tasks[idx](); } }
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
  return out;
}

// ── run ─────────────────────────────────────────────────────────────────────
console.log(`Glyph ablation — base=${BASE}, baselines/query=${N_BASELINE}, queries=${QUERIES.length}`);
console.log(`Total deliberation calls: ${QUERIES.length * (N_BASELINE + GLYPH_KEYS.length)}\n`);

const perQuery = [];
for (let qi = 0; qi < QUERIES.length; qi++) {
  const q = QUERIES[qi];
  process.stdout.write(`Q${qi + 1}: "${q.slice(0, 50)}..." `);

  const conds = [];
  for (let b = 0; b < N_BASELINE; b++) conds.push({ key: `base${b}`, glyph: null });
  for (const g of GLYPH_KEYS) conds.push({ key: g, glyph: g });

  const resps = await pool(conds.map((c) => async () => { try { return { ...c, resp: await ask(q, c.glyph) }; } catch (e) { return { ...c, err: e.message }; } }), CONCURRENCY);
  const ok = resps.filter((r) => r.resp);
  process.stdout.write(`(${ok.length}/${conds.length} ok)\n`);

  // embed answers
  for (const r of ok) r.vec = await embed(r.resp.answer);

  const baselines = ok.filter((r) => r.key.startsWith("base"));
  if (baselines.length < 2) { console.log("  !! <2 baselines, skipping query"); continue; }

  // noise floor = mean pairwise distance among baselines
  const noisePairs = [];
  for (let i = 0; i < baselines.length; i++) for (let j = i + 1; j < baselines.length; j++) noisePairs.push(cosDist(baselines[i].vec, baselines[j].vec));
  const noise = mean(noisePairs);
  const baseRetr = retrievalIDs(baselines[0].resp);
  const baseMarkerBleed = Object.fromEntries(GLYPH_KEYS.map((g) => [g, markerHits(baselines[0].resp.answer, GLYPHS[g].markers)]));
  const baseHedge = mean(baselines.map((b) => hedgeCount(b.resp.answer)));

  const glyphRows = {};
  for (const g of GLYPH_KEYS) {
    const r = ok.find((x) => x.key === g);
    if (!r) { glyphRows[g] = { err: "no response" }; continue; }
    const signal = mean(baselines.map((b) => cosDist(r.vec, b.vec)));
    glyphRows[g] = {
      signal: +signal.toFixed(4),
      ratio: +(signal / noise).toFixed(2),
      retrievalJaccard: +jaccardDist(retrievalIDs(r.resp), baseRetr).toFixed(3),
      tempObserved: observedTemp(r.resp),
      markerHits: markerHits(r.resp.answer, GLYPHS[g].markers),
      markerTotal: GLYPHS[g].markers.length,
      markerBleedInBaseline: baseMarkerBleed[g],
      hedgeDelta: +(hedgeCount(r.resp.answer) - baseHedge).toFixed(1),
      answerLen: r.resp.answer.length,
    };
  }
  perQuery.push({ q, noise: +noise.toFixed(4), baseHedge: +baseHedge.toFixed(1), glyphs: glyphRows });
}

// ── aggregate ─────────────────────────────────────────────────────────────────
console.log("\n" + "═".repeat(92));
console.log("AGGREGATE (mean across queries)\n");
const agg = {};
for (const g of GLYPH_KEYS) {
  const rows = perQuery.map((pq) => pq.glyphs[g]).filter((r) => r && !r.err);
  if (!rows.length) { agg[g] = { err: "no data" }; continue; }
  agg[g] = {
    ratio: +mean(rows.map((r) => r.ratio)).toFixed(2),
    signal: +mean(rows.map((r) => r.signal)).toFixed(4),
    retrievalJaccard: +mean(rows.map((r) => r.retrievalJaccard)).toFixed(3),
    temp: GLYPHS[g].temp,
    tempObserved: rows.map((r) => r.tempObserved).find((t) => t != null) ?? null,
    structuralCompliancePct: GLYPHS[g].markers.length ? Math.round(100 * mean(rows.map((r) => (r.markerHits >= Math.ceil(r.markerTotal / 2) && r.markerBleedInBaseline < Math.ceil(r.markerTotal / 2) ? 1 : 0)))) : null,
    hedgeDelta: +mean(rows.map((r) => r.hedgeDelta)).toFixed(1),
  };
}
const meanNoise = +mean(perQuery.map((p) => p.noise)).toFixed(4);
console.log(`engine noise floor (baseline self-distance): ${meanNoise}\n`);

const pad = (s, n) => String(s).padEnd(n);
console.log(pad("glyph", 6) + pad("ratio(sig/noise)", 18) + pad("retrievalΔ", 12) + pad("temp", 7) + pad("struct%", 9) + pad("hedgeΔ", 8) + "verdict");
console.log("─".repeat(92));
for (const g of GLYPH_KEYS) {
  const a = agg[g];
  if (a.err) { console.log(pad(g, 6) + a.err); continue; }
  const signals = [];
  if (a.ratio > 1.15) signals.push("output");
  if (a.retrievalJaccard > 0.05) signals.push("retrieval");
  if (a.structuralCompliancePct >= 50) signals.push("structure");
  if (g === "Ω" && a.hedgeDelta <= -1) signals.push("de-hedge");
  if (a.tempObserved != null && a.tempObserved !== 1.0) signals.push("decoding");
  const verdict = signals.length >= 2 ? `LOAD-BEARING (${signals.join("+")})` : signals.length === 1 ? `weak (${signals[0]} only)` : "THEATER (no effect > noise)";
  console.log(pad(g, 6) + pad(a.ratio + "×", 18) + pad(a.retrievalJaccard, 12) + pad(a.tempObserved ?? a.temp, 7) + pad(a.structuralCompliancePct == null ? "n/a" : a.structuralCompliancePct + "%", 9) + pad(a.hedgeDelta > 0 ? "+" + a.hedgeDelta : a.hedgeDelta, 8) + verdict);
}
console.log("═".repeat(92));

const out = { meta: { base: BASE, nBaseline: N_BASELINE, queries: QUERIES, ranAt: new Date().toISOString(), meanNoise }, aggregate: agg, perQuery };
fs.writeFileSync("/tmp/glyph_ablation.json", JSON.stringify(out, null, 2));
console.log("\nFull results → /tmp/glyph_ablation.json");
