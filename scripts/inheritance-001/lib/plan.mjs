// Inheritance study 001 — the planner. Pure and deterministic: plan = f(study config, seed).
//
// It validates the split (held-out families really are held out), generates the tasks, lays out paired blocks (one
// block = task × consumer × replicate; ALL six arms run in every block), randomizes arm order within each block and the
// call order within each generation (provider drift lands on every arm alike), fixes the ablation RULE (targets are
// drawn at snapshot freeze, before any outcome of that generation), and projects calls, tokens and dollars.
// plan.json carries ids and commitments only — no template, answer, check or canary.
import { schemaVersion, sha256, canonicalJSON, rng, shuffled, hexId, PROTOCOL } from "./canon.mjs";
import { familyRecord, generateTasks, publicView, EVAL_ROLES } from "./tasks.mjs";
import { ARMS, baseFrameTokens } from "./context.mjs";
import { priceFor, PRICES_AS_OF } from "./prices.mjs";
import { controlsFor } from "./caps.mjs";

export const PLAN_VERSION = "is1-plan/0.1";

export class PlanError extends Error {
  constructor(code, detail) { super(`${code}${detail ? ` ${detail}` : ""}`); this.code = code; }
}

const opSeq = (spec) => spec.steps.map((s) => s.op).join(">");

// Held-out means held out: no evaluation family may share a template — or even an op sequence — with any family a
// producer ever works on. Placebo families must be from another domain. Fail closed.
export function validateSplit(study) {
  const fams = study.families;
  const errors = [];
  const keys = new Set();
  for (const f of fams) { if (keys.has(f.key)) errors.push(`DUPLICATE_FAMILY ${f.key}`); keys.add(f.key); }
  const work = fams.filter((f) => f.role === "work");
  const evals = fams.filter((f) => EVAL_ROLES.includes(f.role));
  for (const e of evals) for (const w of work) {
    if (canonicalJSON(e.steps) === canonicalJSON(w.steps)) errors.push(`HELDOUT_COLLISION ${e.key} has the same template as work family ${w.key}`);
    else if (opSeq(e) === opSeq(w)) errors.push(`HELDOUT_COLLISION ${e.key} shares its op sequence with work family ${w.key} (same category, new parameters)`);
    // Same op SET in another order is often the same function (a per-character map commutes with a reordering), so it
    // is not a new category either.
    else if (opSeq({ steps: [...e.steps].sort((x, y) => x.op.localeCompare(y.op)) }) === opSeq({ steps: [...w.steps].sort((x, y) => x.op.localeCompare(y.op)) })) {
      errors.push(`HELDOUT_COLLISION ${e.key} uses the same set of ops as work family ${w.key} (reordered compositions can be equivalent)`);
    }
  }
  for (const p of fams.filter((f) => f.role === "placebo")) if (p.domain === study.main_domain) errors.push(`PLACEBO_SAME_DOMAIN ${p.key}`);
  for (const f of fams.filter((f) => f.role !== "placebo")) if (f.domain !== study.main_domain) errors.push(`WRONG_DOMAIN ${f.key}`);
  const G = study.generations;
  if (!Number.isInteger(G) || G < 1) errors.push("generations must be >= 1");
  if (!work.some((w) => w.generation === 0)) errors.push("no generation-0 work family: nothing to inherit");
  for (const w of work) if (w.generation >= G) errors.push(`work family ${w.key} at generation ${w.generation} feeds no consumer generation`);
  for (const e of fams.filter((f) => f.role === "eval-generation")) if (e.generation < 1 || e.generation > G) errors.push(`eval family ${e.key} outside generations 1..${G}`);
  if (!fams.some((f) => f.role === "eval-anchor")) errors.push("no anchor panel: generations cannot be compared");
  const consumerFams = new Set(study.consumers.map((c) => c.expected_family));
  for (const p of study.producers) if (consumerFams.has(p.expected_family)) errors.push(`PRODUCER_IS_CONSUMER_FAMILY ${p.model_id} (cross-family design needs distinct panels)`);
  return errors;
}

export function buildPlan(study) {
  const errors = validateSplit(study);
  if (errors.length) throw new PlanError("INVALID_SPLIT", errors.join("; "));
  const { seed } = study;
  const families = study.families.map((spec) => ({ spec, record: familyRecord(spec, { studyId: study.study_id, salt: study.salt }) }));
  const tasksByFamily = new Map();
  const tasks = [];
  for (const { spec, record } of families) {
    const count = spec.role === "work" ? study.tasks.per_work_family : spec.role === "placebo" ? study.tasks.per_placebo_family : study.tasks.per_eval_family;
    const ts = generateTasks(spec, record, { seed: `${seed}|${study.salt}`, count, examples: study.tasks.examples, checks: study.tasks.checks });
    tasksByFamily.set(record.id, ts);
    tasks.push(...ts);
  }
  const famOf = (pred) => families.filter(({ spec }) => pred(spec)).map((f) => f.record);
  const G = study.generations;
  const p = study.params;

  const generations = [];
  const blocks = [];
  const producerCalls = [];
  for (let g = 0; g <= G; g++) {
    const work = famOf((s) => s.role === "work" && s.generation === g);
    for (const fam of work) for (const t of tasksByFamily.get(fam.id)) for (const m of study.producers) {
      producerCalls.push({ generation: g, task_id: t.public.id, family_id: fam.id, model_id: m.model_id, provider: m.provider, kind: "work" });
    }
    if (g === 0) for (const fam of famOf((s) => s.role === "placebo")) for (const t of tasksByFamily.get(fam.id)) for (const m of study.producers) {
      producerCalls.push({ generation: 0, task_id: t.public.id, family_id: fam.id, model_id: m.model_id, provider: m.provider, kind: "placebo" });
    }
    if (g === 0) continue;
    const anchor = famOf((s) => s.role === "eval-anchor");
    const fresh = famOf((s) => s.role === "eval-generation" && s.generation === g);
    const gBlocks = [];
    for (const [split, fams] of [["anchor", anchor], ["generation", fresh]]) for (const fam of fams) for (const t of tasksByFamily.get(fam.id)) {
      for (const c of study.consumers) for (let r = 0; r < (study.replicates || 1); r++) {
        const block_id = `B-g${g}-${hexId({ g, t: t.public.id, c: c.model_id, r }, 10)}`;
        const bseed = hexId({ seed, block_id }, 16);
        gBlocks.push({ block_id, generation: g, task_id: t.public.id, family_id: fam.id, eval_split: split, consumer_model_id: c.model_id, consumer_provider: c.provider, replicate: r, seed: bseed, arm_order: shuffled(ARMS, rng(`${bseed}|arms`)) });
      }
    }
    const slots = shuffled(gBlocks.flatMap((b) => b.arm_order.map((arm) => ({ block_id: b.block_id, arm }))), rng(`${seed}|order|g${g}`));
    blocks.push(...gBlocks);
    generations.push({ generation: g, anchor_families: anchor.map((f) => f.id), generation_families: fresh.map((f) => f.id), work_families_producing_next: famOf((s) => s.role === "work" && s.generation === g).map((f) => f.id), blocks: gBlocks.length, schedule: slots });
  }

  // Ablation rule (fixed now; targets drawn at freeze): up to max_artifacts C-eligible artifacts per generation, each
  // withheld in C on every block of the chosen split.
  const ablation = { max_artifacts: study.ablation?.max_artifacts || 0, seed: hexId({ seed, k: "ablation" }, 12), split: study.ablation?.split || "anchor" };
  const ablationTrials = generations.reduce((n, g) => n + ablation.max_artifacts * blocks.filter((b) => b.generation === g.generation && b.eval_split === ablation.split).length, 0);

  // ── projection ────────────────────────────────────────────────────────────────────────────────────────────────────
  const taskById = new Map(tasks.map((t) => [t.public.id, t]));
  const proj = {};
  const add = (model_id, provider, kind, n, tin, toutExp, toutMax) => {
    const k = model_id;
    const r = (proj[k] ||= { model_id, provider, calls: 0, tokens_in: 0, tokens_out_expected: 0, tokens_out_max: 0, by_kind: {} });
    r.calls += n; r.tokens_in += n * tin; r.tokens_out_expected += n * toutExp; r.tokens_out_max += n * toutMax;
    r.by_kind[kind] = (r.by_kind[kind] || 0) + n;
  };
  const expOut = p.expected_output_tokens, maxOut = p.max_output_tokens;
  for (const c of producerCalls) {
    const base = baseFrameTokens(publicView(taskById.get(c.task_id)), p.base_reasoning_tokens) + 120;
    add(c.model_id, c.provider, `producer-${c.kind}`, 1, base + (c.generation > 0 ? p.context_budget_tokens : 0), expOut, maxOut);
  }
  for (const b of blocks) {
    const base = baseFrameTokens(publicView(taskById.get(b.task_id)), p.base_reasoning_tokens);
    add(b.consumer_model_id, b.consumer_provider, "consumer-A", 1, base, expOut, maxOut);
    add(b.consumer_model_id, b.consumer_provider, "consumer-A+", 1, base, expOut + p.context_budget_tokens, maxOut + p.context_budget_tokens + p.aplus_amortized_allowance_tokens);
    add(b.consumer_model_id, b.consumer_provider, "consumer-BCDE", 4, base + p.context_budget_tokens, expOut, maxOut);
    if (b.eval_split === ablation.split && ablation.max_artifacts) add(b.consumer_model_id, b.consumer_provider, "consumer-ablation", ablation.max_artifacts, base + p.context_budget_tokens, expOut, maxOut);
  }
  const attempts = p.max_attempts || 1;
  const models = Object.values(proj).map((r) => {
    const price = priceFor(r.model_id, study.price_date);
    const usd = (out) => (price ? +((r.tokens_in * price.in + out * price.out) / 1e6).toFixed(4) : null);
    return { ...r, price_per_m: price, usd_expected: usd(r.tokens_out_expected), usd_worst_first_attempts: usd(r.tokens_out_max), usd_worst_with_retries: price ? +(usd(r.tokens_out_max) * attempts).toFixed(4) : null };
  }).sort((a, b) => a.model_id.localeCompare(b.model_id));
  const sum = (k) => (models.every((m) => m[k] !== null) ? +models.reduce((s, m) => s + m[k], 0).toFixed(4) : null);
  const totalCalls = models.reduce((s, m) => s + m.calls, 0);

  const plan = {
    schema_version: schemaVersion("plan"),
    plan_version: PLAN_VERSION,
    protocol: PROTOCOL,
    study_id: study.study_id,
    simulation: study.simulation,
    seed,
    arms: ARMS,
    primary_contrast: "C-A+",
    generations_consumer: Array.from({ length: G }, (_, i) => i + 1),
    params: p,
    families: families.map((f) => f.record),
    task_manifest_sha256: sha256(tasks.map((t) => [t.public.id, t.public.sealed_commitment_sha256]).sort()),
    task_counts: Object.fromEntries(families.map((f) => [f.record.id, tasksByFamily.get(f.record.id).length])),
    consumers: study.consumers,
    producers: study.producers,
    // A model with a documented output bound carries the reasoning controls that bound relies on, so an approval of this
    // plan hash also fixes them (the live gate re-checks them against lib/caps.mjs).
    models: models.map((m) => ({ model_id: m.model_id, provider: m.provider, ...(controlsFor(m.model_id) ? { controls: controlsFor(m.model_id) } : {}) })),
    producer_calls: producerCalls,
    generations,
    blocks,
    ablation: { ...ablation, planned_trials: ablationTrials },
    projection: {
      prices_as_of: PRICES_AS_OF,
      price_date: study.price_date,
      assumptions: { expected_output_tokens: expOut, max_output_tokens: maxOut, max_attempts: attempts, tokens_per_char: 0.25 },
      calls_first_attempt: totalCalls,
      calls_max_with_retries: totalCalls * attempts,
      usd_expected: sum("usd_expected"),
      usd_worst_first_attempts: sum("usd_worst_first_attempts"),
      usd_worst_with_retries: sum("usd_worst_with_retries"),
      models,
    },
    budget: study.budget,
  };
  return { plan: { ...plan, plan_sha256: sha256(plan) }, families, tasks };
}
