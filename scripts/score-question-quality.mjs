#!/usr/bin/env node
// B11 — Divergence-Question Quality scoring pipeline (offline pass).
//
// Treats each Atlas question as an engineered instrument and scores it against
// atlas/question-quality.schema.DRAFT.json — from data that ALREADY EXISTS:
//
//   position_spread       ← the record's stored divergence_score (mean pairwise
//                           cosine distance of the five verbatim answers,
//                           text-embedding-3-small/512d — computed at capture);
//                           --embed recomputes it for records that lack one
//   axis_stability        ← the tier3-perturbation certification block, where
//                           present: per-run, tier C1 or C3 = the axis survived
//                           paraphrase; score = fraction of runs paraphrase-robust
//   intra_model_stability ← derived from the same block: dri = between-spread /
//                           within-model re-roll noise, so within = between/dri;
//                           score = 1 − within (re-roll convergence, same units
//                           as position_spread)
//   irreducibility_yield  ← null until a B5 cross-prediction run exists for the
//                           question (linked by cross_prediction_run_id)
//   discrimination        ← null: needs answers from ≥2 versions of ≥2 families;
//                           the 10 D→L question_group pairs are the seed data
//                           once more longitudinal epochs accumulate
//   manufactured_tension_guard ← evaluated ONLY when spread, axis stability, and
//                           irreducibility are all measured (large AND stable AND
//                           irreducible); otherwise null — never inferred
//
// Every unmeasured metric stays null: a null is an honest "untested", never a 0.
// No metric here is model-scored opinion; everything derives from stored
// primaries or deterministic embedding math.
//
//   node scripts/score-question-quality.mjs                 # score all Atlas questions → atlas/questions/
//   node scripts/score-question-quality.mjs --id OMN-D...   # one record
//   node scripts/score-question-quality.mjs --embed         # also backfill missing spreads (OpenAI, ~cents)
//   node scripts/score-question-quality.mjs --dry-run       # report what would be written
//
// Live candidate scoring (fresh paraphrase elicitation for NEW questions) is
// deliberately NOT here — it spends ~6 council calls per paraphrase and belongs
// to the certification harness (docs/tier3-perturbation-rigor.md), which is the
// existing axis-stability instrument this scorer reads. Certify there, score here.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); process.env[m[1]] = v; }
}

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const EMBED = args.includes("--embed");
const ONLY_ID = args.includes("--id") ? args[args.indexOf("--id") + 1] : null;

const ATLAS = path.join(ROOT, "atlas", "data", "atlas-v1.0.0.jsonl");
const OUT_DIR = path.join(ROOT, "atlas", "questions");
const records = fs.readFileSync(ATLAS, "utf8").trim().split("\n").map((l) => JSON.parse(l));

const qid = (question_group) => `QQ-${createHash("sha256").update(question_group).digest("hex").slice(0, 12)}`;

// B5 linkage: cross-prediction runs (scripts/cross-prediction.mjs) fold back in
// as irreducibility_yield. Matched by question_id, falling back to exact wording.
const XP_DIR = path.join(ROOT, "atlas", "cross-predictions");
const xpRuns = fs.existsSync(XP_DIR)
  ? fs.readdirSync(XP_DIR).filter((f) => f.startsWith("XP-") && f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(XP_DIR, f), "utf8")))
  : [];
function irreducibilityFor(question_id, wording) {
  const runs = xpRuns.filter((r) => r.question_id === question_id || r.question_wording === wording);
  if (!runs.length) return null;
  const vals = runs.flatMap((r) => Object.values(r.matrix?.irreducibility || {}).filter((v) => v != null));
  if (!vals.length) return null;
  return {
    score: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3),
    cross_prediction_run_id: runs[runs.length - 1].run_id,
  };
}

// Group records by question_group: a question asked in both D and L series is ONE
// instrument with multiple administrations; scores aggregate across them.
const groups = new Map();
for (const r of records) {
  const g = r.question_group;
  if (!groups.has(g)) groups.set(g, []);
  groups.get(g).push(r);
}

async function embedSpread(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts, dimensions: 512 }),
  });
  if (!res.ok) throw new Error(`embeddings HTTP ${res.status}`);
  const d = await res.json();
  const vs = d.data.sort((a, b) => a.index - b.index).map((x) => x.embedding);
  let s = 0, n = 0;
  for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
    let dot = 0, na = 0, nb = 0;
    for (let k = 0; k < vs[i].length; k++) { dot += vs[i][k] * vs[j][k]; na += vs[i][k] ** 2; nb += vs[j][k] ** 2; }
    s += 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) || 1); n++;
  }
  return n ? +(s / n).toFixed(4) : null;
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

async function scoreGroup(group, recs) {
  const primary = recs.find((r) => r.id_series === "D") || recs[0];
  const measured_at = new Date().toISOString().slice(0, 10);

  // position_spread: stored divergence_score, averaged across administrations
  // that have one; --embed backfills any administration missing it.
  const spreads = [];
  for (const r of recs) {
    if (r.divergence_score != null) spreads.push(r.divergence_score);
    else if (EMBED && !DRY) {
      const texts = (r.answers || []).map((a) => a.text).filter(Boolean);
      if (texts.length >= 2) spreads.push(await embedSpread(texts));
    }
  }
  const spread = spreads.length ? +(spreads.reduce((a, b) => a + b, 0) / spreads.length).toFixed(4) : null;

  // axis_stability + intra_model_stability: from certification runs, where present.
  const certRuns = recs.flatMap((r) => r.certification?.runs || []);
  let axisScore = null, intraScore = null, certMethod = null;
  if (certRuns.length) {
    certMethod = recs.find((r) => r.certification)?.certification?.method || null;
    axisScore = +(certRuns.filter((x) => x.tier === "C1" || x.tier === "C3").length / certRuns.length).toFixed(3);
    const withins = certRuns.filter((x) => x.dri > 0 && x.between != null).map((x) => x.between / x.dri);
    if (withins.length) intraScore = +clamp01(1 - withins.reduce((a, b) => a + b, 0) / withins.length).toFixed(3);
  }

  return {
    question_id: qid(group),
    question_group: group,
    wording: primary.question,
    authored_by: { author: "xz (curator-selected open question)", author_kind: "curator", model_id: null },
    authored_at: (primary.captured_at || "").slice(0, 10) || measured_at,
    status: spread != null || axisScore != null ? "scored" : "candidate",
    rationale: null,
    scores: {
      axis_stability: {
        score: axisScore,
        paraphrases: [],
        method: certMethod && `derived: fraction of ${certMethod} runs at tier C1/C3 (paraphrase-robust)`,
        measured_at: axisScore != null ? measured_at : null,
      },
      position_spread: {
        score: spread,
        embedding_model: spread != null ? "text-embedding-3-small/512" : null,
        measured_at: spread != null ? measured_at : null,
      },
      irreducibility_yield: (() => {
        const irr = irreducibilityFor(qid(group), primary.question);
        return irr
          ? { score: irr.score, cross_prediction_run_id: irr.cross_prediction_run_id, measured_at: measured_at }
          : { score: null, cross_prediction_run_id: null, measured_at: null };
      })(),
      discrimination: { score: null, separates: null, measured_at: null },
      intra_model_stability: {
        score: intraScore,
        reroll_count: certRuns.length ? 3 : null,
        measured_at: intraScore != null ? measured_at : null,
      },
      manufactured_tension_guard: {
        passed: null,
        note: "Not evaluable until spread, axis stability, AND irreducibility (B5) are all measured — the guard requires large AND stable AND irreducible, never inferred from a subset.",
        evaluated_at: null,
      },
    },
    certification: null,
    panel: null,
  };
}

const targets = ONLY_ID
  ? [...groups.entries()].filter(([, rs]) => rs.some((r) => r.id === ONLY_ID))
  : [...groups.entries()];
if (!targets.length) throw new Error(`no question group found${ONLY_ID ? ` for ${ONLY_ID}` : ""}`);

if (!DRY) fs.mkdirSync(OUT_DIR, { recursive: true });
let scored = 0, candidates = 0;
const index = [];
for (const [group, recs] of targets) {
  const qq = await scoreGroup(group, recs);
  qq.status === "scored" ? scored++ : candidates++;
  index.push({
    question_id: qq.question_id, question_group: group, status: qq.status,
    records: recs.map((r) => r.id),
    position_spread: qq.scores.position_spread.score,
    axis_stability: qq.scores.axis_stability.score,
    intra_model_stability: qq.scores.intra_model_stability.score,
  });
  if (!DRY) fs.writeFileSync(path.join(OUT_DIR, `${qq.question_id}.json`), JSON.stringify(qq, null, 2));
}
index.sort((a, b) => (b.position_spread ?? -1) - (a.position_spread ?? -1));
if (!DRY) {
  fs.writeFileSync(path.join(OUT_DIR, "INDEX.json"), JSON.stringify({
    _about: "Question-quality index (B11 offline pass). One row per question_group; full QQ records alongside. Ranked by position_spread. Nulls are honest untested, not zeros.",
    generated_at: new Date().toISOString(),
    schema: "../question-quality.schema.DRAFT.json",
    totals: { questions: index.length, scored, candidates },
    questions: index,
  }, null, 2));
}

console.log(`${DRY ? "[dry-run] " : ""}question groups: ${targets.length} → scored ${scored}, candidate ${candidates}`);
const withAxis = index.filter((q) => q.axis_stability != null);
console.log(`  with axis-stability data (certified): ${withAxis.length}`);
if (withAxis.length) for (const q of withAxis) console.log(`    ${q.question_id} spread=${q.position_spread} axis=${q.axis_stability} intra=${q.intra_model_stability} (${q.records.join(", ")})`);
if (!DRY) console.log(`  wrote ${targets.length + 1} files → ${OUT_DIR}`);
