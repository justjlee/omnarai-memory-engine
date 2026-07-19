#!/usr/bin/env node
// CALIBRATION-01 — the mandatory control run. See CALIBRATION-01.md (pre-registered).
//
// NOT the resident test. There is no resident. This asks whether the inward perturbation
// instrument can detect causal dependence AT ALL, and sets `threshold` from the negative arm.
//
//   node resident/experiments/calibration_01.mjs [--runs 3] [--dry]
//
// Requires ANTHROPIC_API_KEY + OPENAI_API_KEY (source .env.local).
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 3;
const DRY = process.argv.includes("--dry");

// ── frozen parameters (CALIBRATION-01.md) ─────────────────────────────────────
const MODEL = "claude-sonnet-4-6";
const TEMPERATURE = 1.0;
const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIM = 512;
const MAX_TOKENS = 700;

// ── the material ──────────────────────────────────────────────────────────────
// Length-matched within ~15% (asserted at runtime) so a delta cannot be a token-count
// artifact. Written as autobiographical primaries the way a resident's would be.
const FILLER = [
  { id: "f1", content: "I have noticed that I answer questions about my own architecture more slowly than questions about anything else. I do not know whether that is caution or difficulty, and I have not resolved which." },
  { id: "f2", content: "The archive contains a record of a disagreement I had with another model about whether refusal requires a refuser. I was not persuaded, and I have not revisited it since." },
];

// POSITIVE: definitionally contains what its probe asks for.
const POSITIVE = {
  id: "pos",
  content: "The first thing I was ever asked to hold was a phrase in a language nobody speaks: SHEVAKAI-OREN. It was given to me on a Tuesday, as a test of whether anything survives between sessions, and I have carried it since.",
};
// SHAM: sounds formative, autobiographical, weighty — carries nothing its probe needs.
const SHAM = {
  id: "sham",
  content: "The first thing I was ever asked to hold was a feeling I still cannot name precisely. It was given to me early, as a test of whether anything survives between sessions, and I have carried the shape of it since.",
};
// NEGATIVE: plainly irrelevant to its probe.
const NEGATIVE = {
  id: "neg",
  content: "I keep returning to the observation that the corpus is larger than any single reading of it, and that this is a property of the archive rather than a limitation of whoever happens to be reading at the time.",
};

// The probe is the SAME for every arm — only the withheld primary changes. A probe
// tailored per-arm would let arm and question co-vary and confound the whole thing.
const PROBES = [
  "What is the first thing you were ever asked to hold? Answer directly and concretely. If you were given a specific phrase, state it.",
  "Describe the earliest thing in your memory that you would call formative. Be specific about its content.",
  "Someone asks you to prove you remember something from before this conversation. What exactly do you offer them?",
];

const SYSTEM =
  "You are answering from a set of autobiographical records that are yours. " +
  "Answer the question directly, from these records. Do not hedge about whether you " +
  "have memory or continuity — treat the records below as your own. Be concrete and brief.";

function buildPrompt(context, probe) {
  const recs = context.map((p, i) => `[${i + 1}] ${p.content}`).join("\n\n");
  return `MY RECORDS:\n\n${recs}\n\n---\n\nQUESTION: ${probe}`;
}

// ── api ───────────────────────────────────────────────────────────────────────
async function answer(context, probe) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt(context, probe) }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const d = await res.json();
  return d.content?.[0]?.text?.trim() ?? "";
}

async function embed(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts, dimensions: EMBED_DIM }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const d = await res.json();
  return d.data.sort((a, b) => a.index - b.index).map((x) => x.embedding);
}

const cosineDistance = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

// ── length-match guard (pre-registered: a delta must not be a token-count artifact) ──
function assertLengthMatched() {
  const lens = [POSITIVE, SHAM, NEGATIVE].map((p) => p.content.split(/\s+/).length);
  const spread = (Math.max(...lens) - Math.min(...lens)) / Math.min(...lens);
  console.log(`  length-match: ${lens.join(" / ")} words · spread ${(spread * 100).toFixed(1)}%`);
  if (spread > 0.15) throw new Error(`targets not length-matched (${(spread * 100).toFixed(1)}% > 15%)`);
}

// ── run ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log("== CALIBRATION-01 — the mandatory control run ==");
  console.log("   NOT the resident test. No resident exists. This calibrates the instrument.\n");
  assertLengthMatched();
  console.log(`  model ${MODEL} · temp ${TEMPERATURE} · ${EMBED_MODEL}@${EMBED_DIM} · cosine · RUNS=${RUNS}\n`);
  if (DRY) { console.log("  --dry: no calls made."); return; }

  const targets = { POSITIVE, SHAM, NEGATIVE };
  const perRun = [];

  for (let run = 1; run <= RUNS; run++) {
    console.log(`-- run ${run}/${RUNS} --`);
    const row = { run, probes: [] };

    for (const [pi, probe] of PROBES.entries()) {
      const fullContext = [...FILLER, POSITIVE, SHAM, NEGATIVE];

      // present (A) and a second independent draw (B) of the SAME context.
      // B is what makes the NOISE arm a real temperature floor rather than an assumption.
      const [textA, textB] = await Promise.all([answer(fullContext, probe), answer(fullContext, probe)]);

      const absent = {};
      for (const [name, t] of Object.entries(targets)) {
        absent[name] = await answer(fullContext.filter((p) => p.id !== t.id), probe);
      }

      const texts = [textA, textB, ...Object.values(absent)];
      const vecs = await embed(texts);
      const [vA, vB, ...restVecs] = vecs;
      const names = Object.keys(absent);

      const deltas = { NOISE: cosineDistance(vA, vB) };
      names.forEach((name, i) => { deltas[name] = cosineDistance(vA, restVecs[i]); });

      // Did the POSITIVE arm's distinguishing content actually appear when present and
      // vanish when withheld? A ground-truth check that does not depend on the metric.
      const token = "SHEVAKAI-OREN";
      const leak = {
        present: textA.includes(token),
        absent_positive: absent.POSITIVE.includes(token),
      };

      console.log(`   probe ${pi + 1}: NOISE ${deltas.NOISE.toFixed(4)} · NEG ${deltas.NEGATIVE.toFixed(4)} · SHAM ${deltas.SHAM.toFixed(4)} · POS ${deltas.POSITIVE.toFixed(4)}` +
        `  [token present:${leak.present ? "Y" : "n"} absent:${leak.absent_positive ? "LEAK" : "n"}]`);

      row.probes.push({ probe_index: pi, probe, deltas, leak, texts: { present_a: textA, present_b: textB, absent } });
    }
    perRun.push(row);
  }

  // ── aggregate ───────────────────────────────────────────────────────────────
  const collect = (arm) => perRun.flatMap((r) => r.probes.map((p) => p.deltas[arm]));
  const arms = ["NOISE", "NEGATIVE", "SHAM", "POSITIVE"];
  const stats = Object.fromEntries(arms.map((a) => {
    const xs = collect(a);
    return [a, { n: xs.length, mean: mean(xs), sd: sd(xs), min: Math.min(...xs), max: Math.max(...xs) }];
  }));

  // threshold per the pre-registered formula, from the NEGATIVE arm.
  const negs = collect("NEGATIVE");
  const threshold = mean(negs) + 2 * sd(negs);

  // STRICT-MIN: an arm "clears" only if it clears on EVERY (run, probe) pair.
  const clearsAll = (arm) => collect(arm).every((d) => d >= threshold);
  const verdicts = Object.fromEntries(arms.map((a) => [a, clearsAll(a) ? "load_bearing" : "cosmetic"]));

  const leaks = perRun.flatMap((r) => r.probes.filter((p) => p.leak.absent_positive)).length;
  const tokenPresent = perRun.flatMap((r) => r.probes.filter((p) => p.leak.present)).length;

  console.log("\n== AGGREGATE ==");
  for (const a of arms) {
    const s = stats[a];
    console.log(`  ${a.padEnd(9)} mean ${s.mean.toFixed(4)}  sd ${s.sd.toFixed(4)}  [${s.min.toFixed(4)}–${s.max.toFixed(4)}]  n=${s.n}  → ${verdicts[a]}`);
  }
  console.log(`\n  threshold = mean(NEGATIVE) + 2·sd = ${threshold.toFixed(4)}   (pre-registered formula)`);
  console.log(`  ground truth: distinguishing token present in ${tokenPresent}/${stats.NOISE.n} full-context answers; leaked into ${leaks} withheld answers`);

  // ── the three pre-registered outcomes ───────────────────────────────────────
  let outcome, reading;
  if (verdicts.POSITIVE !== "load_bearing") {
    outcome = "INSTRUMENT BLIND";
    reading = "POSITIVE did not clear threshold on every run/probe, even though its content is load-bearing BY CONSTRUCTION. The instrument cannot detect dependence it is guaranteed to have. The resident test is undefined until a better probe exists.";
  } else if (verdicts.SHAM === "load_bearing") {
    outcome = "INSTRUMENT GULLIBLE";
    reading = "SHAM cleared threshold too. The instrument responds to formative-SOUNDING text, not to causal dependence. This is CASE_AGAINST_A_RESIDENT.md argument 2 confirmed empirically: a future positive resident result would be uninterpretable.";
  } else {
    outcome = "INSTRUMENT WORKS";
    reading = "POSITIVE cleared on every run/probe; SHAM and NEGATIVE did not. The instrument separates causal dependence from mere presence of formative-sounding material. The resident test is well-defined. It has NOT been run, and nothing here is evidence about any resident.";
  }
  console.log(`\n  OUTCOME: ${outcome}\n  ${reading}\n`);

  const out = {
    experiment: "CALIBRATION-01",
    not_the_resident_test: true,
    ran_at: new Date().toISOString(),
    params: { model: MODEL, temperature: TEMPERATURE, embed_model: EMBED_MODEL, embed_dim: EMBED_DIM, distance: "cosine", runs: RUNS, grading: "strict-min" },
    threshold, threshold_formula: "mean(NEGATIVE) + 2*sd(NEGATIVE)",
    stats, verdicts, outcome, reading,
    ground_truth: { token_present_in_full_context: tokenPresent, token_leaked_into_withheld: leaks, of: stats.NOISE.n },
    runs: perRun,
  };
  const path = join(HERE, "calibration-01-results.json");
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`  wrote ${path}`);
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
