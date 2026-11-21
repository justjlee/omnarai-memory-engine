// Inheritance study 001 — Pilot 002, PROPOSED (built 2026-11-21; not drawn, not registered, not approved, never run).
//
// Why a second pilot: Pilot 001 (registered d24005d, plan 4a2364af…) ran all 344 calls but could not test inheritance. Its
// producers were never told the program step language, so 0 of 51 producer records could be verified and arm C was empty
// (an instrument finding, not a null). The fix is params.producer_language (lib/language.mjs): the producers' contribution
// request now states the language. Producer probes checked it before any pilot: gemini-4-carbon left verifiable records
// (probe 3), deepseek-v4-pro with thinking off did not (probe 3), gpt-6.1-sol did (probe 4). Verified shares stay private.
//
// Panel (xz, 2026-11-21: "Yes, Gemini + GPT"): producers gemini-4-carbon and gpt-6.1-sol; claude-sonnet-5-5 the ONLY
// consumer. With one consumer family the held-out families carry 6 tasks each, so the pilot keeps 48 paired blocks. Its
// results speak only to Claude Sonnet 5.5 as an inheritor; a confirmatory study needs more consumer families.
//
// Everything else follows Pilot 001: one transition, 4-step families, 6 work × 4 tasks, 8 held-out × 6 tasks, 2 placebo × 2,
// six arms per block, 600 s timeout, provider-enforced caps (lib/caps.mjs). pilot-001.mjs is untouched: its registered
// plan must keep reproducing.
import { drawFamilySet } from "../lib/families.mjs";

export const STUDY_ID = "IS1-STUDY-PILOT-002";
export const PREREGISTRATION_PATH = "research/inheritance-001/preregistration-002.draft.yaml";

export const PILOT_MODELS = {
  // No producer family is the consumer's family, so every C record a consumer sees is cross-family.
  producers: [
    { provider: "gemini", model_id: "gemini-4-carbon", expected_family: "google-gemini" },
    { provider: "openai", model_id: "gpt-6.1-sol", expected_family: "openai-gpt" },
  ],
  consumers: [
    { provider: "anthropic", model_id: "claude-sonnet-5-5", expected_family: "anthropic-claude" },
  ],
};

// Same shape as Pilot 001's draw. The sealed draw (lab.mjs draw-sealed --study pilot-002) uses a FRESH secret seed and
// excludes every calibration probe's op set (lib/probe.mjs calibrationOpSets), and, when given, an earlier sealed set's.
export const SEALED_DRAW = Object.freeze({ nWork: 6, nAnchor: 8, nPlacebo: 2, steps: 4, generations: 1 });

export function pilotStudy({ families, salt, seed = 20261202 }) {
  return {
    study_id: STUDY_ID,
    title: "Inheritance Study 001 — pilot 002 (single transition, cross-family, producers told the program language)",
    status: "draft_unregistered",
    simulation: false,
    world_label: null,
    preregistration: { path: PREREGISTRATION_PATH, status: "draft_unregistered", registered_commit_sha: null },
    seed,
    salt,
    start_at: "2026-12-01T00:00:00.000Z",
    price_date: "2026-12-01",
    main_domain: "str",
    generations: 1,
    families,
    // 6 tasks per held-out family (Pilot 001: 3 with two consumers): 8 × 6 × 1 consumer = 48 paired blocks, as before.
    tasks: { per_work_family: 4, per_eval_family: 6, per_placebo_family: 2, examples: 3, checks: 8 },
    replicates: 1,
    consumers: PILOT_MODELS.consumers,
    producers: PILOT_MODELS.producers,
    // producer_language: producers' contribution request states the program language (lib/language.mjs); consumer frames
    // (arms A to E) are unchanged.
    // max_output_tokens: provider-enforced on all billed output (lib/caps.mjs); 3000, gemini-4-carbon 4500 (probe 2's rule).
    // expected_output_tokens_by_model: measured mean output, rounded up to 100: claude-sonnet-5-5 from probe 2 (arm A,
    // 4-step); gemini-4-carbon from probe 3 and gpt-6.1-sol from probe 4 (both as producers, given the language; calls that
    // stopped at the cap counted at the cap). input_token_factor_by_model: largest real ÷ estimated input measured per
    // model on the frame it will see here (Claude: probe 2's consumer frame; Gemini, GPT: probes 3 and 4's producer frame,
    // which states the language), rounded up to 0.05.
    params: {
      context_budget_tokens: 1500, base_reasoning_tokens: 1024, poison_fraction: 0.34, producer_language: true,
      max_output_tokens: 3000, max_output_tokens_by_model: { "gemini-4-carbon": 4500 },
      expected_output_tokens: 1400, expected_output_tokens_by_model: { "claude-sonnet-5-5": 900, "gemini-4-carbon": 1700, "gpt-6.1-sol": 500 },
      input_token_factor_by_model: { "claude-sonnet-5-5": 1.6, "gemini-4-carbon": 1.25, "gpt-6.1-sol": 1.15 },
      aplus_amortized_allowance_tokens: 300, timeout_ms: 600000, max_attempts: 2,
    },
    ablation: { max_artifacts: 0, split: "anchor" },
    analysis: { resamples: 2000, alpha: 0.05, seed: 11, min_clusters_for_inference: 10, timeouts_as_failures: true, primary_family: ["H1", "H2", "H3"] },
    budget: { max_paid_calls: 0, max_usd: 0 },
  };
}

// Public, shape-alike families for PROJECTION ONLY: the same public stand-in Pilot 001 projects with.
export const projectionFamilies = () => drawFamilySet({ seed: "public-projection-only", ...SEALED_DRAW });

// Stage 0 for this pilot: producer probes 3 and 4 (public families, producers only, results never enter the study).
// Claude Sonnet 5.5's difficulty at 4 steps was measured as a consumer in probe 2.
export const CALIBRATION = { probes: ["IS1-PROBE-CAL-002", "IS1-PROBE-CAL-003", "IS1-PROBE-CAL-004"], note: "public calibration families, never reused in the sealed set" };

// The study a live pilot runs: the sealed families, the approved caps (part of the plan, so the hash xz approves is the
// hash the run records) and, once registered, the registration. A sealed set drawn for another study, or a registration
// of another study, is never accepted.
export function sealedPilotStudy(sealed, { maxCalls = 0, maxUsd = 0, registration = null } = {}) {
  if (sealed.study_id !== STUDY_ID) throw new Error(`SEALED_SET_FOR_ANOTHER_STUDY: drawn for ${sealed.study_id ?? "an unnamed study (Pilot 001)"}, not ${STUDY_ID}`);
  const base = pilotStudy({ families: sealed.families, salt: sealed.salt });
  const registered = registration?.status === "registered" && registration.study_id === STUDY_ID && /^[0-9a-f]{7,40}$/.test(registration.registered_commit_sha || "");
  return {
    ...base,
    budget: { max_paid_calls: maxCalls, max_usd: maxUsd },
    ...(registered ? { status: "registered", preregistration: { ...base.preregistration, status: "registered", registered_commit_sha: registration.registered_commit_sha } } : {}),
  };
}
