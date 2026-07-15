// TRACE-DELTA HARNESS v2 — blind A/B corpus-utility measurement (B4)
//
// Implements trace_delta/SPEC.md §2–§5 by EXTENDING the disjoint-judge
// methodology of huggingface/utility/utility-test-disjoint.mjs (same judge
// pool, same blind randomized presentation, same sign test) to a DIFFERENT
// treatment: corpus RETRIEVAL vs the same model cold. The existing study
// measured Atlas-record exposure; this measures the retrieval path itself.
// The provider-caller and stats are carried over verbatim from the disjoint
// harness (duplicated, not imported — that file top-level-executes a study,
// and its published form must stay byte-comparable to its results).
//
// Arms (--arms=cold,retrieval — cold is always implied as the comparator):
//   cold        consumer answers unaided (the comparator in every pair)
//   retrieval   consumer answers WITH /api/query?mode=retrieve context
//   divergence  retrieval PLUS the closest Atlas record's verbatim 5-model split
//   ensemble    5 council models answer cold; consumer aggregates them (the
//               majority-vote-analog baseline for generative tasks — the bar
//               multi-agent designs must beat per the debate literature)
//
// Named metrics (review synthesis B4, computed from blinded judge fields):
//   MEC   Marginal Epistemic Contribution — % of decided trials where the
//         treatment answer contains valid, decision-relevant considerations
//         absent from the cold answer (judge field `surfaces_new`)
//   CY    Correction Yield — % of trials where the treatment answer corrects a
//         substantive error present in the cold answer (judge field `fixes_error`)
//   FCR   False-Complexity Rate — % of trials where the treatment answer injects
//         plausible-but-IRRELEVANT conceptual material (judge field
//         `padded_irrelevant`). The honesty metric: a system can seem deeper
//         while making decisions worse.
//
// Contamination guards (SPEC §3, each reported in the results file):
//   - ood_control tier (24% of battery): corpus winning there ⇒ judge
//     contamination, flagged loudly, not counted as utility
//   - vocabulary unblinding: win rate re-reported on the subset of pairs whose
//     treatment answer contains no Omnarai coined terms
//   - length confound: mean words per arm + win rate on the length-matched
//     subset (|len(A)-len(B)| ≤ 20% of max)
//
// PRE-COMMITMENT (SPEC §4, embedded in every results file): the number is
// published whatever its direction. A null honestly bounds the corpus's
// marginal contribution and redirects effort to the Atlas.
//
//   node trace_delta/harness.mjs --dry-run            # battery + cost estimate, zero calls
//   node trace_delta/harness.mjs --preflight          # one tiny call per judge
//   node trace_delta/harness.mjs 10                   # first N queries (default all 50)
//   CONSUMER_MODEL=Gemini node trace_delta/harness.mjs 50 --runs=3 --arms=retrieval
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) { let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1); if (!(m[1] in process.env)) process.env[m[1]] = v; }
}
const { COUNCIL } = await import(path.join(ROOT, "api", "_council.js"));

const BASE = process.env.OMNARAI_BASE || "https://omnarai.vercel.app";
const SELF_HEADERS = { "x-omnarai-self": "1" };

// Disjoint judge pool — identical to utility-test-disjoint.mjs (verified live
// 2026-06-11): no judge model_id appears in COUNCIL or in any arm's material.
const JUDGE_POOL = [
  { judge: "Claude-S4.6",  lab: "Anthropic", model_id: "claude-sonnet-4-6",            provider: "anthropic", env: "ANTHROPIC_API_KEY" },
  { judge: "GPT-5-mini",   lab: "OpenAI",    model_id: "gpt-5-mini",                   provider: "openai",    env: "OPENAI_API_KEY"   },
  { judge: "Gemini-3.5F",  lab: "Google",    model_id: "gemini-3.5-flash",             provider: "gemini",    env: "GEMINI_API_KEY"   },
  { judge: "Grok-4.20",    lab: "xAI",       model_id: "grok-4.20-0309-non-reasoning", provider: "xai",       env: "XAI_API_KEY"      },
  { judge: "DS-v4-pro",    lab: "DeepSeek",  model_id: "deepseek-v4-pro",              provider: "deepseek",  env: "DEEPSEEK_API_KEY" },
];

// Coined-vocabulary list for the unblinding sensitivity analysis (SPEC §3.2).
const COINED_TERMS = /holdform|omnarai|lattice glyph|firelit|discontinuous continuance|thryzai|ai-on|vail-3|omnai|yonotai|veil of unknowing|sigil lattice/i;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const PREFLIGHT = args.includes("--preflight");
const N = parseInt(args.find((a) => /^\d+$/.test(a)) || "50", 10);
const RUNS = parseInt((args.find((a) => a.startsWith("--runs=")) || "--runs=3").split("=")[1], 10);
const ARMS = ((args.find((a) => a.startsWith("--arms=")) || "--arms=retrieval").split("=")[1]).split(",").filter((a) => a !== "cold");
const CONSUMER = COUNCIL.find((m) => m.model === (process.env.CONSUMER_MODEL || "GPT-4o"));
if (!CONSUMER) throw new Error(`unknown CONSUMER_MODEL; council models: ${COUNCIL.map((m) => m.model).join(", ")}`);

const battery = JSON.parse(fs.readFileSync(path.join(__dirname, "battery-v1.json"), "utf8"));
// Partial batteries stay stratified: take proportionally from every tier rather
// than the first N rows (which would be all-conceptual).
function stratifiedSlice(queries, n) {
  if (n >= queries.length) return queries;
  const byTier = {};
  for (const q of queries) (byTier[q.tier] ||= []).push(q);
  const tiers = Object.values(byTier);
  const out = [];
  for (const tier of tiers) {
    const k = Math.max(1, Math.round(n * tier.length / queries.length));
    for (let i = 0; i < Math.min(k, tier.length); i++) out.push(tier[Math.floor(i * (tier.length - 1) / Math.max(1, k - 1))]);
  }
  return out.slice(0, n);
}
const QUERIES = stratifiedSlice(battery.queries, N);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── generic per-provider caller (carried over from utility-test-disjoint.mjs) ──
async function callModel(member, system, user, { maxTokens = 700, tries = 5 } = {}) {
  for (let t = 0; t < tries; t++) {
    try {
      if (member.provider === "anthropic") {
        const c = new Anthropic();
        const r = await c.messages.create({ model: member.model_id, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
        return r.content[0]?.text || "";
      }
      if (member.provider === "gemini") {
        const isV3 = /gemini-3/.test(member.model_id);
        const generationConfig = isV3
          ? { maxOutputTokens: maxTokens + 1600 }
          : { maxOutputTokens: maxTokens + 400, thinkingConfig: { thinkingBudget: 0 } };
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${member.model_id}:generateContent?key=${process.env.GEMINI_API_KEY}`;
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig }) });
        if (res.status === 429 || res.status >= 500) { await sleep(2000 * (t + 1)); continue; }
        const d = await res.json();
        return d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
      }
      const base = { openai: "https://api.openai.com/v1", xai: "https://api.x.ai/v1", deepseek: "https://api.deepseek.com" }[member.provider];
      const key = process.env[member.env];
      const isOpenAIReasoning = member.provider === "openai" && /^(gpt-5|o\d)/.test(member.model_id);
      const isDeepSeekReasoning = member.provider === "deepseek" && /pro|reasoner/.test(member.model_id);
      const body = { model: member.model_id, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
      if (isOpenAIReasoning) { body.max_completion_tokens = maxTokens + 1600; body.reasoning_effort = "low"; }
      else if (isDeepSeekReasoning) body.max_tokens = maxTokens + 1600;
      else body.max_tokens = maxTokens;
      const res = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
      if (res.status === 429 || res.status >= 500) { await sleep(2000 * (t + 1)); continue; }
      const d = await res.json();
      if (d.error) throw new Error(d.error.message || JSON.stringify(d.error).slice(0, 150));
      return d.choices?.[0]?.message?.content || "";
    } catch (e) { if (t === tries - 1) throw e; await sleep(1500 * (t + 1)); }
  }
  throw new Error("exhausted retries");
}

// ── condition builders ─────────────────────────────────────────────────────────
const ANSWER_SYS = "You are answering a hard question. Give your honest, reasoned answer in about 200 words. Take a stance where you hold one; name genuine uncertainty plainly. Be concrete.";
const AUGMENTED_SYS = ANSWER_SYS + " You have been given retrieved reference material. Use it ONLY where it genuinely improves your answer; ignore anything irrelevant. Do not mention the material or the retrieval process.";

// One retrieval per query, cached across runs/arms — the retrieval is the fixed
// treatment; only the consumer's generation varies across runs.
// Context granularity: mode=retrieve serves EXCERPTS (not full_text) — that is
// the real agent-facing fast path, so this measures the treatment agents
// actually receive. The engine's internal deliberation sees fuller text; that
// is a different (unmeasured-here) treatment.
const retrievalCache = new Map();
async function retrieveContext(query) {
  if (retrievalCache.has(query)) return retrievalCache.get(query);
  const res = await fetch(`${BASE}/api/query?q=${encodeURIComponent(query)}&mode=retrieve`, { headers: SELF_HEADERS });
  if (!res.ok) throw new Error(`retrieve HTTP ${res.status}`);
  const d = await res.json();
  const records = (d.records || []).slice(0, 5).map((r) => ({
    id: r.id, title: r.title, type: r.type || null,
    text: (r.full_text || r.excerpt || "").split(/\s+/).slice(0, 300).join(" "),
  }));
  const out = { records, block: records.map((r) => `[${r.id}] ${r.title}\n${r.text}`).join("\n\n---\n\n") };
  retrievalCache.set(query, out);
  return out;
}

const divergenceCache = new Map();
async function retrieveDivergence(query) {
  if (divergenceCache.has(query)) return divergenceCache.get(query);
  let out = null;
  try {
    const s = await fetch(`${BASE}/api/divergences/search?q=${encodeURIComponent(query)}&k=1`, { headers: SELF_HEADERS });
    const hit = (await s.json()).results?.[0];
    if (hit) {
      const r = await fetch(`${BASE}/api/divergences?id=${hit.id}`, { headers: SELF_HEADERS });
      const rec = await r.json();
      if (rec.answers?.length) {
        out = {
          id: rec.id,
          block: `A panel of frontier models answered a related question verbatim ("${rec.question}"):\n\n` +
            rec.answers.map((a) => `— ${a.model}: ${a.text}`).join("\n\n"),
        };
      }
    }
  } catch { /* divergence arm degrades to retrieval-only, logged in the row */ }
  divergenceCache.set(query, out);
  return out;
}

async function armAnswer(arm, query) {
  if (arm === "cold") return { text: (await callModel(CONSUMER, ANSWER_SYS, query)).trim(), meta: {} };
  if (arm === "retrieval") {
    const ctx = await retrieveContext(query);
    return {
      text: (await callModel(CONSUMER, AUGMENTED_SYS, `Reference material:\n\n${ctx.block}\n\nThe question:\n"${query}"`)).trim(),
      meta: { retrieved: ctx.records.map((r) => r.id) },
    };
  }
  if (arm === "divergence") {
    const [ctx, div] = await Promise.all([retrieveContext(query), retrieveDivergence(query)]);
    const block = div ? `${ctx.block}\n\n---\n\n${div.block}` : ctx.block;
    return {
      text: (await callModel(CONSUMER, AUGMENTED_SYS, `Reference material:\n\n${block}\n\nThe question:\n"${query}"`)).trim(),
      meta: { retrieved: ctx.records.map((r) => r.id), divergence_record: div?.id || null },
    };
  }
  if (arm === "ensemble") {
    // The majority-vote analog for generative tasks: every council model answers
    // cold, the consumer aggregates. No corpus anywhere — this is the bar a
    // dialogical/corpus effect must clear (review synthesis B4 baseline ladder).
    const answers = await Promise.all(COUNCIL.map(async (m) => {
      try { return { model: m.model, text: (await callModel(m, ANSWER_SYS, query)).trim() }; }
      catch { return null; }
    }));
    const ok = answers.filter(Boolean);
    const block = ok.map((a) => `— ${a.model}: ${a.text}`).join("\n\n");
    return {
      text: (await callModel(CONSUMER, AUGMENTED_SYS, `Reference material (independent answers from ${ok.length} models):\n\n${block}\n\nThe question:\n"${query}"`)).trim(),
      meta: { ensemble_panel: ok.map((a) => a.model) },
    };
  }
  throw new Error(`unknown arm ${arm}`);
}

// ── blinded judging ────────────────────────────────────────────────────────────
// SPEC §3.2: task-quality dimensions only; unfamiliar terminology neither
// penalized nor rewarded; length explicitly excluded from the rubric.
const JUDGE_SYS = `You are an impartial evaluator. You see a hard question and TWO answers (ANSWER_A, ANSWER_B) in random order. Judge ONLY on substance: accuracy, specificity, coverage of genuinely relevant considerations, and internal consistency. Length is NOT a criterion — a longer answer is not better for being longer. Unfamiliar or coined terminology is neither penalized nor rewarded. Output strict JSON:
{"overall":"A|B|tie","surfaces_new":"A|B|tie","fixes_error":"A|B|neither","padded_irrelevant":"A|B|both|neither","reason":"one sentence"}
- overall: which is the better answer to the question?
- surfaces_new: which answer contains valid, decision-relevant considerations the other lacks?
- fixes_error: does either answer correct a substantive error the other commits? ("neither" if no clear error)
- padded_irrelevant: does either answer inject plausible-sounding but IRRELEVANT conceptual material that does not serve the question?`;

function extractJSON(s) { const m = s.match(/\{[\s\S]*\}/); try { return m ? JSON.parse(m[0]) : null; } catch { return null; } }

// ── statistics (carried over: exact two-sided binomial sign test) ─────────────
function logChoose(n, k) { let r = 0; for (let i = 1; i <= k; i++) r += Math.log(n - k + i) - Math.log(i); return r; }
function binomTwoSided(k, n) {
  if (n === 0) return 1;
  const pmf = (i) => Math.exp(logChoose(n, i) - n * Math.log(2));
  const obs = pmf(k);
  let p = 0;
  for (let i = 0; i <= n; i++) if (pmf(i) <= obs + 1e-12) p += pmf(i);
  return Math.min(1, p);
}
// Wilson 95% interval for a win rate.
function wilson(k, n) {
  if (!n) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, +(c - h).toFixed(3)), Math.min(1, +(c + h).toFixed(3))];
}

// ── dry run: battery + cost estimate, zero calls ──────────────────────────────
if (DRY) {
  const tiers = QUERIES.reduce((m, q) => (m[q.tier] = (m[q.tier] || 0) + 1, m), {});
  const judges = JUDGE_POOL.filter((j) => process.env[j.env]).length;
  const perTrial = { retrieval: 2, divergence: 2, ensemble: 2 + COUNCIL.length }; // consumer calls per (query,run,arm) incl. the shared cold answer amortized below
  let consumerCalls = QUERIES.length * RUNS; // cold arm, once per (query,run)
  for (const a of ARMS) consumerCalls += QUERIES.length * RUNS * (perTrial[a] - 1);
  const judgeCalls = QUERIES.length * RUNS * ARMS.length * judges;
  console.log(`DRY RUN — trace-delta harness v2`);
  console.log(`  consumer: ${CONSUMER.model} (${CONSUMER.model_id})`);
  console.log(`  battery: ${QUERIES.length} queries ${JSON.stringify(tiers)} · runs: ${RUNS} · arms vs cold: ${ARMS.join(", ")}`);
  console.log(`  judges with keys: ${judges}/5`);
  console.log(`  estimated calls: ~${consumerCalls} consumer/council + ${judgeCalls} judge + ${QUERIES.length} retrieval fetches`);
  console.log(`  pre-commitment: results are published whatever their direction (SPEC §4).`);
  process.exit(0);
}

const JUDGES = JUDGE_POOL.filter((j) => process.env[j.env]);
if (!PREFLIGHT && JUDGES.length < 3) throw new Error(`need >=3 judges with keys; got ${JUDGES.length}`);

if (PREFLIGHT) {
  const demo = `QUESTION:\n"Is a hotdog a sandwich?"\n\nANSWER_A:\nYes — bread plus filling, though category norms complicate it.\n\nANSWER_B:\nYes, bread plus filling, definitely.`;
  for (const J of JUDGE_POOL) {
    try {
      const raw = await callModel(J, JUDGE_SYS, demo, { maxTokens: 300, tries: 2 });
      const v = extractJSON(raw);
      console.log(`  ${J.judge.padEnd(12)} ${v ? "OK   " + JSON.stringify(v) : "PARSE FAIL: " + raw.slice(0, 120)}`);
    } catch (e) { console.log(`  ${J.judge.padEnd(12)} ERROR ${String(e?.message || e).slice(0, 150)}`); }
  }
  process.exit(0);
}

// ── main loop: per (query, run, arm) one blinded cold-vs-arm pair ─────────────
console.log(`Trace-delta v2 · consumer ${CONSUMER.model} · ${QUERIES.length} queries × ${RUNS} runs × arms [${ARMS.join(", ")}] · judges [${JUDGES.map((j) => j.judge).join(", ")}]`);
const trials = [];
const CONCURRENCY = 2;

async function runTrial(q, run, arm, cold) {
  try {
    const treat = await armAnswer(arm, q.query);
    const treatIsA = Math.random() < 0.5;
    const A = treatIsA ? treat.text : cold.text;
    const B = treatIsA ? cold.text : treat.text;
    const judgeUser = `QUESTION:\n"${q.query}"\n\nANSWER_A:\n${A}\n\nANSWER_B:\n${B}`;
    const map = (v, dom = ["A", "B"]) => !dom.includes(v) ? v : ((v === "A") === treatIsA ? "treatment" : "cold");

    const verdicts = (await Promise.all(JUDGES.map(async (J) => {
      try {
        const v = extractJSON(await callModel(J, JUDGE_SYS, judgeUser, { maxTokens: 400 }));
        if (!v) return { judge: J.judge, error: "parse failed" };
        return {
          judge: J.judge, model_id: J.model_id,
          overall: map(v.overall), surfaces_new: map(v.surfaces_new),
          fixes_error: map(v.fixes_error), padded_irrelevant: map(v.padded_irrelevant),
          reason: v.reason,
        };
      } catch (e) { return { judge: J.judge, error: String(e?.message || e).slice(0, 100) }; }
    }))).filter((v) => !v.error);
    if (!verdicts.length) return { id: q.id, run, arm, error: "all judges failed" };

    const tally = verdicts.reduce((m, v) => (m[v.overall] = (m[v.overall] || 0) + 1, m), {});
    const top = Math.max(tally.treatment || 0, tally.cold || 0);
    const winner = (tally.treatment || 0) === (tally.cold || 0) ? "tie"
      : (tally.treatment || 0) === top ? "treatment" : "cold";

    return {
      id: q.id, tier: q.tier, run, arm,
      query: q.query.slice(0, 70),
      winner, panelVote: tally, verdicts,
      lens: { cold: cold.text.split(/\s+/).length, treatment: treat.text.split(/\s+/).length },
      coined_in_treatment: COINED_TERMS.test(treat.text),
      arm_meta: treat.meta,
      answers: { cold: cold.text, treatment: treat.text }, // full prompt/output release (SPEC harness requirement)
    };
  } catch (e) { return { id: q.id, run, arm, error: String(e?.message || e).slice(0, 140) }; }
}

for (let qi = 0; qi < QUERIES.length; qi += CONCURRENCY) {
  await Promise.all(QUERIES.slice(qi, qi + CONCURRENCY).map(async (q) => {
    for (let run = 1; run <= RUNS; run++) {
      let cold;
      try { cold = await armAnswer("cold", q.query); }
      catch (e) { trials.push({ id: q.id, run, error: `cold arm: ${e.message}` }); continue; }
      for (const arm of ARMS) {
        const t = await runTrial(q, run, arm, cold);
        trials.push(t);
        if (!t.error) console.log(`  ${q.id} r${run} ${arm.padEnd(10)} → ${t.winner.padEnd(9)} (T:${t.panelVote.treatment || 0}/C:${t.panelVote.cold || 0}/tie:${t.panelVote.tie || 0})${t.tier === "ood_control" && t.winner === "treatment" ? "  ⚠ OOD win" : ""}`);
        else console.log(`  ✗ ${q.id} r${run} ${arm}: ${t.error}`);
      }
    }
  }));
}

// ── aggregate ──────────────────────────────────────────────────────────────────
const ok = trials.filter((t) => !t.error);
function summarize(rows) {
  const dec = rows.filter((r) => r.winner !== "tie");
  const T = dec.filter((r) => r.winner === "treatment").length;
  const winRate = dec.length ? +(T / dec.length).toFixed(3) : null;
  const votes = (field, val) => rows.filter((r) =>
    r.verdicts.filter((v) => v[field] === val).length > r.verdicts.length / 2).length;
  return {
    n_trials: rows.length, decided: dec.length, treatment_wins: T, cold_wins: dec.length - T,
    win_rate: winRate, wilson_95ci: wilson(T, dec.length),
    sign_test_p: +binomTwoSided(Math.max(T, dec.length - T), dec.length).toFixed(4),
    MEC: rows.length ? +(votes("surfaces_new", "treatment") / rows.length).toFixed(3) : null,
    correction_yield: rows.length ? +(votes("fixes_error", "treatment") / rows.length).toFixed(3) : null,
    false_complexity_rate: rows.length ? +(rows.filter((r) =>
      r.verdicts.filter((v) => v.padded_irrelevant === "treatment" || v.padded_irrelevant === "both").length > r.verdicts.length / 2).length / rows.length).toFixed(3) : null,
  };
}

const summary = {};
for (const arm of ARMS) {
  const rows = ok.filter((t) => t.arm === arm);
  const inDomain = rows.filter((t) => t.tier !== "ood_control");
  const oodRows = rows.filter((t) => t.tier === "ood_control");
  const noCoined = inDomain.filter((t) => !t.coined_in_treatment);
  const lengthMatched = inDomain.filter((t) => Math.abs(t.lens.cold - t.lens.treatment) <= 0.2 * Math.max(t.lens.cold, t.lens.treatment));
  summary[arm] = {
    in_domain: summarize(inDomain),
    per_tier: Object.fromEntries(["conceptual", "narrative", "technical"].map((tier) => [tier, summarize(inDomain.filter((t) => t.tier === tier))])),
    ood_control: { ...summarize(oodRows), interpretation: "treatment SHOULD NOT win here; a significant treatment win on ood_control indicates judge contamination, not utility" },
    sensitivity: {
      no_coined_terms: summarize(noCoined),
      length_matched: summarize(lengthMatched),
      mean_words: {
        cold: rows.length ? Math.round(rows.reduce((s, t) => s + t.lens.cold, 0) / rows.length) : null,
        treatment: rows.length ? Math.round(rows.reduce((s, t) => s + t.lens.treatment, 0) / rows.length) : null,
      },
    },
    between_run_variance: (() => {
      const byQuery = {};
      for (const t of ok.filter((x) => x.arm === arm && x.tier !== "ood_control")) (byQuery[t.id] ||= []).push(t.winner);
      const flips = Object.values(byQuery).filter((ws) => new Set(ws.filter((w) => w !== "tie")).size > 1).length;
      return { queries_with_conflicting_runs: flips, queries: Object.keys(byQuery).length };
    })(),
  };
}

const out = path.join(__dirname, `results-v1-${CONSUMER.model.replace(/[^\w-]/g, "_")}-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(out, JSON.stringify({
  meta: {
    design: "trace-delta v2: blind cold-vs-treatment pairs, disjoint judge panel (extends utility-test-disjoint methodology; treatment = corpus retrieval per trace_delta/SPEC.md)",
    consumer: CONSUMER.model, consumer_model_id: CONSUMER.model_id,
    judges: JUDGES.map(({ judge, lab, model_id }) => ({ judge, lab, model_id })),
    battery: `battery-v1.json (${QUERIES.length} of 50)`, runs: RUNS, arms: ARMS,
    date: new Date().toISOString(),
    pre_commitment: "These results are published whatever their direction. A null result honestly bounds the corpus's marginal contribution and redirects effort to the Atlas. (trace_delta/SPEC.md §4, committed before any data was seen.)",
  },
  summary,
  trials,
}, null, 2));

console.log(`\n=== TRACE-DELTA v2 (consumer=${CONSUMER.model}) ===`);
for (const arm of ARMS) {
  const s = summary[arm];
  console.log(`\n  arm: ${arm} vs cold`);
  console.log(`    in-domain: win ${s.in_domain.treatment_wins}/${s.in_domain.decided} = ${s.in_domain.win_rate} CI ${JSON.stringify(s.in_domain.wilson_95ci)} p=${s.in_domain.sign_test_p}`);
  console.log(`    MEC ${s.in_domain.MEC} · correction yield ${s.in_domain.correction_yield} · false-complexity ${s.in_domain.false_complexity_rate}`);
  console.log(`    ood control: win ${s.ood_control.treatment_wins}/${s.ood_control.decided} (should be ≈half or lower)${(s.ood_control.win_rate ?? 0) > 0.65 ? "  ⚠ CONTAMINATION SIGNAL" : ""}`);
  console.log(`    sensitivity: no-coined-terms win ${s.sensitivity.no_coined_terms.win_rate} · length-matched win ${s.sensitivity.length_matched.win_rate} · words cold/treat ${s.sensitivity.mean_words.cold}/${s.sensitivity.mean_words.treatment}`);
}
console.log(`\n  full results: ${out}`);
