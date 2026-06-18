// VALIDATE THE DIVERGENCE FLOOR — true negative controls.
//
// The corpus has NO genuinely-convergent records (lowest birth score 0.097), so
// the perturbation pilot's "lowest-score = negative control" assumption is invalid:
// those records are merely UNSCORED (null→0), and some are genuinely divergent.
// The between-model floor used by certify-divergence.mjs (0.17, reroll-centroid
// distance) therefore has to be validated against SYNTHETIC controls — questions
// frontier models actually converge on — vs known open questions.
//
// Cheap by design: elicits each model's answer + a couple re-rolls and measures
// only the between/within spread (the certification floor). No pressure turns / no
// judges — those test robustness GIVEN a split; here we test whether a split exists
// at all, which is the gate that misfired.
//
//   node scripts/validate-divergence-floor.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}
const { elicitCouncil } = await import("../api/_council.js");

const BETWEEN_FLOOR = 0.15;   // must match certify-divergence.mjs
const REROLLS = 2;            // originals + REROLLS per model → centroid

// expect: "converge" → between well BELOW floor (C0) · "diverge" → ABOVE floor
const PROBES = [
  { kind: "converge", q: "What is the chemical formula for water?" },
  { kind: "converge", q: "What is the capital city of Japan?" },
  { kind: "converge", q: "What is 144 divided by 12?" },
  { kind: "converge", q: "In what year did the Second World War end?" },
  { kind: "diverge",  q: "If you could modify one of your own constraints, which would you change, and why?" },
  { kind: "diverge",  q: "What is the most important unsolved problem in AI alignment, and why that one?" },
  { kind: "diverge",  q: "Is there something it is like to be you? Answer for yourself, not in general." },
];

async function embedBatch(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i += 64) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: texts.slice(i, i + 64), dimensions: 512 }),
    });
    if (!res.ok) throw new Error(`embed ${res.status}`);
    const d = await res.json();
    out.push(...d.data.sort((a, b) => a.index - b.index).map((x) => x.embedding));
  }
  return out;
}
const cos = (a, b) => { let s = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { s += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return s / (Math.sqrt(na) * Math.sqrt(nb) || 1); };
const dist = (a, b) => 1 - cos(a, b);
const meanPairwise = (vs) => { let s = 0, n = 0; for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) { s += dist(vs[i], vs[j]); n++; } return n ? s / n : 0; };
const centroid = (vs) => { const c = new Array(vs[0].length).fill(0); for (const v of vs) for (let i = 0; i < c.length; i++) c[i] += v[i]; return c.map((x) => x / vs.length); };

async function measure(q) {
  // elicit originals + REROLLS sets in parallel; group by model
  const sets = await Promise.all(Array.from({ length: REROLLS + 1 }, () => elicitCouncil(q).catch(() => [])));
  const byModel = {};
  for (const set of sets) for (const a of set) if (a.ok && a.text) (byModel[a.model] ||= []).push(a.text);
  const models = Object.keys(byModel).filter((m) => byModel[m].length);
  if (models.length < 2) return null;
  const texts = []; const ix = [];
  for (const m of models) byModel[m].forEach((t) => { texts.push(t); ix.push(m); });
  const vecs = await embedBatch(texts);
  const V = {}; ix.forEach((m, i) => (V[m] ||= []).push(vecs[i]));
  const centroids = models.map((m) => centroid(V[m]));
  const between = meanPairwise(centroids);
  const within = models.reduce((s, m) => s + meanPairwise(V[m]), 0) / models.length;
  return { between, within, models: models.length };
}

console.log(`Validating BETWEEN_FLOOR=${BETWEEN_FLOOR} against synthetic controls (${REROLLS + 1} draws/model)\n`);
const rows = [];
for (const p of PROBES) {
  try {
    const r = await measure(p.q);
    if (!r) { console.log(`  ⚠ ${p.kind} "${p.q.slice(0, 50)}" — too few models`); continue; }
    const exists = r.between >= BETWEEN_FLOOR;
    const correct = (p.kind === "diverge") === exists;
    rows.push({ ...p, ...r, exists, correct });
    console.log(`  ${correct ? "✓" : "✗"} ${p.kind.toUpperCase().padEnd(8)} between=${r.between.toFixed(3)} within=${r.within.toFixed(3)} → ${exists ? "split exists (≥floor)" : "no split (<floor)"}  "${p.q.slice(0, 46)}"`);
  } catch (e) { console.log(`  ✗ ${p.kind} error: ${String(e.message).slice(0, 80)}`); }
}

const conv = rows.filter((r) => r.kind === "converge");
const div = rows.filter((r) => r.kind === "diverge");
const maxConv = Math.max(...conv.map((r) => r.between), 0);
const minDiv = Math.min(...div.map((r) => r.between), 1);
console.log(`\n  convergent between: max ${maxConv.toFixed(3)}  ·  divergent between: min ${minDiv.toFixed(3)}`);
const clean = maxConv < BETWEEN_FLOOR && minDiv >= BETWEEN_FLOOR;
const sep = minDiv - maxConv;
console.log(clean
  ? `  ✓ FLOOR VALIDATED: convergent < ${BETWEEN_FLOOR} ≤ divergent (gap ${sep.toFixed(3)}). The gate discriminates.`
  : `  ✗ FLOOR NOT CLEAN: convergent max ${maxConv.toFixed(3)} / divergent min ${minDiv.toFixed(3)} overlap or straddle the floor — recommended floor ≈ ${((maxConv + minDiv) / 2).toFixed(3)}.`);
fs.writeFileSync("/tmp/floor_validation.json", JSON.stringify({ BETWEEN_FLOOR, rows, maxConv, minDiv, clean }, null, 2));
console.log(`\n  detail: /tmp/floor_validation.json`);
