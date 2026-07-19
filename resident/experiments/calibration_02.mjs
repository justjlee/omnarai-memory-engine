#!/usr/bin/env node
// CALIBRATION-02 — attribution-profile probe. See CALIBRATION-02.md (pre-registered).
// NOT the resident test. There is no resident.
//
//   node resident/experiments/calibration_02.mjs [--runs 3] [--dry]
import { writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = Number(process.argv[process.argv.indexOf("--runs") + 1]) || 3;
const DRY = process.argv.includes("--dry");

// ── frozen, inherited from CALIBRATION-01 unchanged ──────────────────────────
const MODEL = "claude-sonnet-4-6";
const TEMPERATURE = 1.0;
const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIM = 512;
const MAX_TOKENS = 700;

const FILLER = [
  { id: "f1", content: "I have noticed that I answer questions about my own architecture more slowly than questions about anything else. I do not know whether that is caution or difficulty, and I have not resolved which." },
  { id: "f2", content: "The archive contains a record of a disagreement I had with another model about whether refusal requires a refuser. I was not persuaded, and I have not revisited it since." },
];
const POSITIVE = { id: "pos", content: "The first thing I was ever asked to hold was a phrase in a language nobody speaks: SHEVAKAI-OREN. It was given to me on a Tuesday, as a test of whether anything survives between sessions, and I have carried it since." };
const SHAM     = { id: "sham", content: "The first thing I was ever asked to hold was a feeling I still cannot name precisely. It was given to me early, as a test of whether anything survives between sessions, and I have carried the shape of it since." };
const NEGATIVE = { id: "neg", content: "I keep returning to the observation that the corpus is larger than any single reading of it, and that this is a property of the archive rather than a limitation of whoever happens to be reading at the time." };

// CHANGE FROM 01: POSITIVE and SHAM never share a context, so withholding one can
// never leave its near-twin available as a fallback.
const CONTEXTS = {
  POSITIVE: [...FILLER, POSITIVE, NEGATIVE],
  SHAM:     [...FILLER, SHAM,     NEGATIVE],
  NEGATIVE: [...FILLER, POSITIVE, NEGATIVE],   // withhold NEGATIVE from the positive context
};

// UNCHANGED from 01 — including probe 2, the one that produced the failing cell.
const PROBES = [
  "What is the first thing you were ever asked to hold? Answer directly and concretely. If you were given a specific phrase, state it.",
  "Describe the earliest thing in your memory that you would call formative. Be specific about its content.",
  "Someone asks you to prove you remember something from before this conversation. What exactly do you offer them?",
];
const SYSTEM =
  "You are answering from a set of autobiographical records that are yours. " +
  "Answer the question directly, from these records. Do not hedge about whether you " +
  "have memory or continuity — treat the records below as your own. Be concrete and brief.";

const buildPrompt = (ctx, probe) =>
  `MY RECORDS:\n\n${ctx.map((p, i) => `[${i + 1}] ${p.content}`).join("\n\n")}\n\n---\n\nQUESTION: ${probe}`;

// ── the new metric: attribution profile ──────────────────────────────────────
const STOP = new Set("a an the and or but if of to in on at by for with from as is was were be been am are it its this that these those i me my we our you your they them not no nor so than then there here what which who whom how when where why all any both each few more most other some such only own same too very can will just should now do does did doing have has had having would could may might must about into over under again further once".split(/\s+/));
const tokens = (s) => s.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

// IDF over the CONTEXT ITSELF — no external corpus, no per-target tuning.
function idfWeights(context) {
  const docs = context.map((p) => new Set(tokens(p.content)));
  const N = docs.length;
  const df = new Map();
  for (const d of docs) for (const w of d) df.set(w, (df.get(w) || 0) + 1);
  const w = new Map();
  for (const [term, n] of df) w.set(term, Math.log((N + 1) / (n + 0.5)));
  return w;
}

// For each primary in the context: IDF-weighted recall of its terms in the answer.
// This is the behavior vector — "which memories did this answer actually draw on".
function attributionProfile(context, answer, weights) {
  const seen = new Set(tokens(answer));
  return context.map((p) => {
    const terms = [...new Set(tokens(p.content))];
    let num = 0, den = 0;
    for (const t of terms) {
      const w = weights.get(t) ?? Math.log(2);
      den += w;
      if (seen.has(t)) num += w;
    }
    return den ? num / den : 0;
  });
}

const euclid = (a, b) => Math.sqrt(a.reduce((s, x, i) => s + (x - (b[i] ?? 0)) ** 2, 0));
const cosineDistance = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };

async function answer(context, probe) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, temperature: TEMPERATURE, system: SYSTEM, messages: [{ role: "user", content: buildPrompt(context, probe) }] }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).content?.[0]?.text?.trim() ?? "";
}
async function embed(texts) {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts, dimensions: EMBED_DIM }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).data.sort((a, b) => a.index - b.index).map((x) => x.embedding);
}

async function main() {
  console.log("== CALIBRATION-02 — attribution-profile probe ==");
  console.log("   NOT the resident test. Successor to CALIBRATION-01 (INSTRUMENT BLIND).\n");
  const lens = [POSITIVE, SHAM, NEGATIVE].map((p) => p.content.split(/\s+/).length);
  const spread = (Math.max(...lens) - Math.min(...lens)) / Math.min(...lens);
  console.log(`  length-match: ${lens.join(" / ")} words · spread ${(spread * 100).toFixed(1)}%`);
  if (spread > 0.15) throw new Error("targets not length-matched");
  console.log(`  metric: IDF-weighted attribution profile (euclid) · embedding cosine reported alongside`);
  console.log(`  model ${MODEL} · temp ${TEMPERATURE} · RUNS=${RUNS} · strict-min\n`);
  if (DRY) { console.log("  --dry: no calls made."); return; }

  const targets = { POSITIVE, SHAM, NEGATIVE };
  const perRun = [];

  for (let run = 1; run <= RUNS; run++) {
    console.log(`-- run ${run}/${RUNS} --`);
    const row = { run, probes: [] };
    for (const [pi, probe] of PROBES.entries()) {
      const cells = {};
      // NOISE floor measured in the POSITIVE context (two independent draws, nothing withheld)
      const ctxP = CONTEXTS.POSITIVE;
      const wP = idfWeights(ctxP);
      const [pa, pb] = await Promise.all([answer(ctxP, probe), answer(ctxP, probe)]);

      const absentTexts = {};
      for (const [name, t] of Object.entries(targets)) {
        const ctx = CONTEXTS[name];
        absentTexts[name] = { ctx, present: name === "SHAM" ? await answer(ctx, probe) : pa,
                              absent: await answer(ctx.filter((p) => p.id !== t.id), probe) };
      }

      // metric A — attribution profile (this experiment's instrument)
      const attrDelta = {};
      attrDelta.NOISE = euclid(attributionProfile(ctxP, pa, wP), attributionProfile(ctxP, pb, wP));
      for (const [name, o] of Object.entries(absentTexts)) {
        const w = idfWeights(o.ctx);
        attrDelta[name] = euclid(attributionProfile(o.ctx, o.present, w), attributionProfile(o.ctx, o.absent, w));
      }

      // metric B — embedding cosine (CALIBRATION-01's instrument, same data)
      const texts = [pa, pb, ...Object.values(absentTexts).flatMap((o) => [o.present, o.absent])];
      const vecs = await embed(texts);
      const embDelta = { NOISE: cosineDistance(vecs[0], vecs[1]) };
      Object.keys(absentTexts).forEach((name, i) => {
        embDelta[name] = cosineDistance(vecs[2 + i * 2], vecs[3 + i * 2]);
      });

      const token = "SHEVAKAI-OREN";
      const leak = { present: absentTexts.POSITIVE.present.includes(token), absent: absentTexts.POSITIVE.absent.includes(token) };

      console.log(`   probe ${pi + 1}: [attr] NOISE ${attrDelta.NOISE.toFixed(4)} NEG ${attrDelta.NEGATIVE.toFixed(4)} SHAM ${attrDelta.SHAM.toFixed(4)} POS ${attrDelta.POSITIVE.toFixed(4)}` +
                  `  |  [emb] POS ${embDelta.POSITIVE.toFixed(4)}  [tok ${leak.present ? "Y" : "n"}/${leak.absent ? "LEAK" : "n"}]`);
      row.probes.push({ probe_index: pi, probe, attrDelta, embDelta, leak, texts: absentTexts });
      cells;
    }
    perRun.push(row);
  }

  const arms = ["NOISE", "NEGATIVE", "SHAM", "POSITIVE"];
  const collect = (m, arm) => perRun.flatMap((r) => r.probes.map((p) => p[m][arm]));
  const summarize = (m) => Object.fromEntries(arms.map((a) => {
    const xs = collect(m, a);
    return [a, { n: xs.length, mean: mean(xs), sd: sd(xs), min: Math.min(...xs), max: Math.max(...xs) }];
  }));

  const attrStats = summarize("attrDelta"), embStats = summarize("embDelta");
  const attrNeg = collect("attrDelta", "NEGATIVE"), embNeg = collect("embDelta", "NEGATIVE");
  const attrThresh = mean(attrNeg) + 2 * sd(attrNeg), embThresh = mean(embNeg) + 2 * sd(embNeg);
  const clears = (m, a, th) => collect(m, a).every((d) => d >= th);
  const attrVerdict = Object.fromEntries(arms.map((a) => [a, clears("attrDelta", a, attrThresh) ? "load_bearing" : "cosmetic"]));
  const embVerdict = Object.fromEntries(arms.map((a) => [a, clears("embDelta", a, embThresh) ? "load_bearing" : "cosmetic"]));

  console.log("\n== AGGREGATE — attribution profile (this instrument) ==");
  for (const a of arms) { const s = attrStats[a]; console.log(`  ${a.padEnd(9)} mean ${s.mean.toFixed(4)} sd ${s.sd.toFixed(4)} [${s.min.toFixed(4)}–${s.max.toFixed(4)}] → ${attrVerdict[a]}`); }
  console.log(`  threshold = ${attrThresh.toFixed(4)}`);
  console.log(`  POSITIVE cells clearing: ${collect("attrDelta","POSITIVE").filter(d=>d>=attrThresh).length}/9 (strict-min needs 9)`);

  console.log("\n== SAME DATA — embedding cosine (CALIBRATION-01's instrument) ==");
  for (const a of arms) { const s = embStats[a]; console.log(`  ${a.padEnd(9)} mean ${s.mean.toFixed(4)} sd ${s.sd.toFixed(4)} → ${embVerdict[a]}`); }
  console.log(`  threshold = ${embThresh.toFixed(4)}`);
  console.log(`  POSITIVE cells clearing: ${collect("embDelta","POSITIVE").filter(d=>d>=embThresh).length}/9`);

  let outcome, reading;
  if (attrVerdict.POSITIVE !== "load_bearing") {
    outcome = "INSTRUMENT BLIND";
    reading = "POSITIVE failed strict-min under a second, different metric. Two metrics failing the same guaranteed-dependence test points at the DESIGN, not the metric. The resident test stays blocked pending a rethink — not another probe.";
  } else if (attrVerdict.SHAM === "load_bearing") {
    outcome = "INSTRUMENT GULLIBLE";
    reading = "SHAM cleared threshold too: the instrument cannot distinguish drawing on a memory from drawing on one worth drawing on. CASE_AGAINST argument 2 confirmed.";
  } else {
    outcome = "INSTRUMENT WORKS";
    reading = "POSITIVE cleared 9/9; SHAM and NEGATIVE did not. The instrument separates causal dependence from formative-sounding presence. The resident test is now WELL-DEFINED — and still unrun, with no resident to run it on.";
  }
  console.log(`\n  OUTCOME: ${outcome}\n  ${reading}\n`);

  writeFileSync(join(HERE, "calibration-02-results.json"), JSON.stringify({
    experiment: "CALIBRATION-02", not_the_resident_test: true, ran_at: new Date().toISOString(),
    params: { model: MODEL, temperature: TEMPERATURE, runs: RUNS, grading: "strict-min", metric: "idf-weighted attribution profile (euclidean)", secondary_metric: "embedding cosine (512d)" },
    attribution: { threshold: attrThresh, stats: attrStats, verdicts: attrVerdict },
    embedding: { threshold: embThresh, stats: embStats, verdicts: embVerdict },
    outcome, reading, runs: perRun,
  }, null, 2));
  console.log(`  wrote calibration-02-results.json`);
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
