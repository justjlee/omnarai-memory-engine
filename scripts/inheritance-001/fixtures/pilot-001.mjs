// Inheritance study 001 — the PROPOSED first live pilot (not approved, not registered, never run).
//
// Smallest design that can say anything about H1–H3: one transition (generation-0 producers → generation-1 consumers),
// two producer families, two DIFFERENT consumer families, eight held-out families. It cannot test a ratchet (that needs
// ≥3 transitions) and with 8 clusters it is descriptive by preregistration (min_clusters_for_inference = 10).
//
// The real held-out families are drawn at registration from a SECRET seed (lib/families.mjs) kept outside the
// repository; `projectionFamilies` below is a public stand-in with the same shape, used ONLY to project tokens and cost.
//
// Panel (revised 2026-11-20, after probe IS1-PROBE-CAL-001): every model must have an output bound that its provider
// documents as covering ALL billed output, reasoning included (lib/caps.mjs, research/inheritance-001/pilot/PROVIDER-CAPS.md).
// grok-4.7 has none (xAI: max_completion_tokens excludes reasoning; reasoning cannot be disabled), so it left the panel;
// gpt-6.1-sol moved from producer to consumer, and gemini-4-carbon joined as a producer through the Interactions API.
import { drawFamilySet } from "../lib/families.mjs";

export const PILOT_MODELS = {
  // Producers leave work; consumers inherit it. The two panels share no family, so every C record is cross-family.
  producers: [
    { provider: "deepseek", model_id: "deepseek-v4-pro", expected_family: "deepseek" },
    { provider: "gemini", model_id: "gemini-4-carbon", expected_family: "google-gemini" },
  ],
  consumers: [
    { provider: "anthropic", model_id: "claude-sonnet-5-5", expected_family: "anthropic-claude" },
    { provider: "openai", model_id: "gpt-6.1-sol", expected_family: "openai-gpt" },
  ],
};

// The sealed draw (lab.mjs draw-sealed) and the projection stand-in share this shape. 4-step families: probe 1's
// pre-committed rule read 3-step families as too easy for the one consumer it fully measured (rates stay private).
export const SEALED_DRAW = Object.freeze({ nWork: 6, nAnchor: 8, nPlacebo: 2, steps: 4, generations: 1 });

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
    // max_output_tokens: a bound each provider enforces on all billed output (lib/caps.mjs); 3000 per call, except
    // gemini-4-carbon at 4500: probe 2's pre-committed output-cap rule fired for it (2 of its 4 calls stopped at 3000 at its
    // lowest thinking level), and xz chose "Gemini only" (2026-11-20). expected_output_tokens_by_model: probe 2's measured
    // mean output per model (arm A, 4-step), rounded up to 100; Gemini's two cap-stopped calls counted at 4500.
    // input_token_factor_by_model: probe 2's largest real-input ÷ estimated-input ratio per model, rounded up.
    // expected_output_tokens (1400, from probe 1) is only the fallback for a model without a measurement.
    // timeout_ms: 600 s; a call that times out is still charged at its worst case (adapters.mjs assume()).
    params: {
      context_budget_tokens: 1500, base_reasoning_tokens: 1024, poison_fraction: 0.34,
      max_output_tokens: 3000, max_output_tokens_by_model: { "gemini-4-carbon": 4500 },
      expected_output_tokens: 1400, expected_output_tokens_by_model: { "claude-sonnet-5-5": 900, "gpt-6.1-sol": 600, "deepseek-v4-pro": 600, "gemini-4-carbon": 2600 },
      input_token_factor_by_model: { "claude-sonnet-5-5": 1.6, "gpt-6.1-sol": 1.0, "deepseek-v4-pro": 1.0, "gemini-4-carbon": 1.15 },
      aplus_amortized_allowance_tokens: 300, timeout_ms: 600000, max_attempts: 2,
    },
    ablation: { max_artifacts: 0, split: "anchor" },
    analysis: { resamples: 2000, alpha: 0.05, seed: 11, min_clusters_for_inference: 10, timeouts_as_failures: true, primary_family: ["H1", "H2", "H3"] },
    budget: { max_paid_calls: 0, max_usd: 0 },
  };
}

// Public, shape-alike families for PROJECTION ONLY (same counts, step counts and lengths as the sealed draw).
export const projectionFamilies = () => drawFamilySet({ seed: "public-projection-only", ...SEALED_DRAW });

// Stage 0 (before registration): difficulty probes on separate, public calibration families, arm A only, so the sealed
// tasks can be pitched off the floor and the ceiling. Their results never enter the study, and their op sets are excluded
// from the sealed draw (lib/probe.mjs calibrationOpSets). Probe 2 (IS1-PROBE-CAL-002) runs this exact panel.
export const CALIBRATION = { probe: "IS1-PROBE-CAL-002", arm: "A", note: "public calibration families, never reused in the sealed set" };

// The study a live pilot runs: the sealed families, the approved caps (they are part of the plan, so the plan hash xz
// approves is the hash the run records), and, once registered, the registration (the analysis reads it). Registration
// does not change the plan hash.
export function sealedPilotStudy(sealed, { maxCalls = 0, maxUsd = 0, registration = null } = {}) {
  const base = pilotStudy({ families: sealed.families, salt: sealed.salt });
  const registered = registration?.status === "registered" && /^[0-9a-f]{7,40}$/.test(registration.registered_commit_sha || "");
  return {
    ...base,
    budget: { max_paid_calls: maxCalls, max_usd: maxUsd },
    ...(registered ? { status: "registered", preregistration: { ...base.preregistration, status: "registered", registered_commit_sha: registration.registered_commit_sha } } : {}),
  };
}
