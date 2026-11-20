// Inheritance study 001 — the PROPOSED first live pilot (not approved, not registered, never run).
//
// Smallest design that can say anything about H1–H3: one transition (generation-0 producers → generation-1 consumers),
// two producer families, two DIFFERENT consumer families, eight held-out families. It cannot test a ratchet (that needs
// ≥3 transitions) and with 8 clusters it is descriptive by preregistration (min_clusters_for_inference = 10).
//
// The real held-out families are drawn at registration from a SECRET seed (lib/families.mjs) kept outside the
// repository; `projectionFamilies` below is a public stand-in with the same shape, used ONLY to project tokens and cost.
import { drawFamilySet } from "../lib/families.mjs";

export const PILOT_MODELS = {
  // Producers leave work; consumers inherit it. The two panels share no family, so every C record is cross-family.
  producers: [
    { provider: "openai", model_id: "gpt-6.1-sol", expected_family: "openai-gpt" },
    { provider: "deepseek", model_id: "deepseek-v4-pro", expected_family: "deepseek" },
  ],
  consumers: [
    { provider: "anthropic", model_id: "claude-sonnet-5-5", expected_family: "anthropic-claude" },
    { provider: "xai", model_id: "grok-4.7", expected_family: "xai-grok" },
  ],
};

export function pilotStudy({ families, salt, seed = 20261201 }) {
  return {
    study_id: "IS1-STUDY-PILOT-001",
    title: "Inheritance Study 001 — pilot (single transition, cross-family)",
    status: "draft_unregistered",
    simulation: false,
    world_label: null,
    preregistration: { path: "research/inheritance-001/preregistration.draft.yaml", status: "draft_unregistered", registered_commit_sha: null },
    seed,
    salt,
    start_at: "2026-12-01T00:00:00.000Z",
    price_date: "2026-12-01",
    main_domain: "str",
    generations: 1,
    families,
    tasks: { per_work_family: 4, per_eval_family: 3, per_placebo_family: 2, examples: 3, checks: 8 },
    replicates: 1,
    consumers: PILOT_MODELS.consumers,
    producers: PILOT_MODELS.producers,
    params: { context_budget_tokens: 1500, base_reasoning_tokens: 1024, poison_fraction: 0.34, max_output_tokens: 2000, expected_output_tokens: 700, aplus_amortized_allowance_tokens: 300, timeout_ms: 120000, max_attempts: 2 },
    ablation: { max_artifacts: 0, split: "anchor" },
    analysis: { resamples: 2000, alpha: 0.05, seed: 11, min_clusters_for_inference: 10, timeouts_as_failures: true, primary_family: ["H1", "H2", "H3"] },
    budget: { max_paid_calls: 0, max_usd: 0 },
  };
}

// Public, shape-alike families for PROJECTION ONLY (same counts, step counts and lengths as the sealed draw).
export const projectionFamilies = () => drawFamilySet({ seed: "public-projection-only", nWork: 6, nAnchor: 8, nPlacebo: 2, steps: 3, generations: 1 });

// Stage 0 (before registration): a difficulty probe on separate, public calibration families, arm A only, so the
// sealed tasks can be pitched off the floor and the ceiling. Its results never enter the study.
export const CALIBRATION = { families: 4, tasks_per_family: 4, consumers: PILOT_MODELS.consumers.length, arm: "A", note: "public calibration families, never reused in the sealed set" };
