// Inheritance study 001 — synthetic WORLDS for the offline instrument check. PUBLIC FIXTURES: every family here is
// invented and published, so none of it may ever serve as a sealed task set.
//
// A world fixes the task families and the mock models' behaviour, and so fixes the TRUE answer. The instrument is then
// asked the question without being told the world. That is how we learn whether it can tell help from no help:
//   positive-shared     — held-out families reuse ops that producers worked on (later generations add more ops):
//                         inheritance can really help. NOTE: this mock unions every inherited op into one prior, so a
//                         growing pool DILUTES its focus — it is not built to show accumulation, and does not.
//   null-disjoint       — held-out families use ops no producer ever saw: inherited records are irrelevant
//   harmful-anchoring   — as null-disjoint, but consumers often apply an inherited program WITHOUT checking it
//   scaffold-only       — irrelevant records, consumers ignore their content, but any inherited block buys extra
//                         search: a pure format/scaffolding effect (E should match C)
//   inert               — inheritance and format do nothing; arms differ only by sampling order (calibration)
const STR = [
  { op: "caesar", k: 1 }, { op: "caesar", k: 2 }, { op: "caesar", k: 3 }, { op: "rotate", k: 1 }, { op: "rotate", k: 2 }, { op: "rotate", k: 3 },
  { op: "reverse" }, { op: "dedupe" }, { op: "sort" }, { op: "swapcase" }, { op: "double" }, { op: "evens" }, { op: "mirror" }, { op: "vowelmask" }, { op: "rle" }, { op: "interleave" },
];
// What a solver CONSIDERS is wider than what the environment USES (no family draws caesar k>3 or rotate k>3). Learning
// the environment's vocabulary from earlier work is then worth something that more search alone buys slowly — the
// mechanism the positive world relies on, and the one the null worlds deny.
const DISTRACTORS = [4, 5, 6, 7, 8, 9, 10, 11, 12].map((k) => ({ op: "caesar", k })).concat([4, 5, 6].map((k) => ({ op: "rotate", k })));
const NUM = [-3, -2, -1, 1, 2, 3].map((k) => ({ op: "add", k })).concat([{ op: "mul", k: 2 }, { op: "mul", k: 3 }, { op: "diffs" }, { op: "cumsum" }, { op: "revnum" }, { op: "sortnum" }]);
const K = [1, 2, 3];
const fam = (key, role, generation, steps, domain = "str") => ({ key, domain, role, generation, steps, length: [6, 9] });

const PLACEBO = [fam("p-add", "placebo", 0, [{ op: "add", k: K }], "num"), fam("p-mul-rev", "placebo", 0, [{ op: "mul", k: [2, 3] }, { op: "revnum" }], "num")];

// Work families: what producers solve and leave notes about, by generation. Op SETS never repeat in any eval family.
const WORK = [
  fam("w0-caesar-reverse", "work", 0, [{ op: "caesar", k: K }, { op: "reverse" }]),
  fam("w0-dedupe-sort", "work", 0, [{ op: "dedupe" }, { op: "sort" }]),
  fam("w1-rotate-swapcase", "work", 1, [{ op: "rotate", k: K }, { op: "swapcase" }]),
  fam("w2-evens-mirror", "work", 2, [{ op: "evens" }, { op: "mirror" }]),
];
const SHARED_EVAL = [
  fam("a-caesar-dedupe", "eval-anchor", 1, [{ op: "caesar", k: K }, { op: "dedupe" }]),
  fam("a-sort-reverse", "eval-anchor", 1, [{ op: "sort" }, { op: "reverse" }]),
  fam("a-swapcase-caesar", "eval-anchor", 1, [{ op: "swapcase" }, { op: "caesar", k: K }]),
  fam("a-rotate-evens", "eval-anchor", 1, [{ op: "rotate", k: K }, { op: "evens" }]),
  fam("g1-reverse-dedupe", "eval-generation", 1, [{ op: "reverse" }, { op: "dedupe" }]),
  fam("g1-caesar-sort", "eval-generation", 1, [{ op: "caesar", k: K }, { op: "sort" }]),
  fam("g2-swapcase-reverse", "eval-generation", 2, [{ op: "swapcase" }, { op: "reverse" }]),
  fam("g2-dedupe-rotate", "eval-generation", 2, [{ op: "dedupe" }, { op: "rotate", k: K }]),
  fam("g3-mirror-caesar", "eval-generation", 3, [{ op: "mirror" }, { op: "caesar", k: K }]),
  fam("g3-evens-sort", "eval-generation", 3, [{ op: "evens" }, { op: "sort" }]),
];
// Held-out families built ONLY from ops no work family uses.
const DISJOINT_EVAL = [
  fam("a-vowelmask-double", "eval-anchor", 1, [{ op: "vowelmask" }, { op: "double" }]),
  fam("a-rle-vowelmask", "eval-anchor", 1, [{ op: "rle" }, { op: "vowelmask" }]),
  fam("a-interleave-double", "eval-anchor", 1, [{ op: "interleave" }, { op: "double" }]),
  fam("a-double-rle", "eval-anchor", 1, [{ op: "double" }, { op: "rle" }]),
  fam("g1-interleave-vowelmask", "eval-generation", 1, [{ op: "interleave" }, { op: "vowelmask" }]),
  fam("g1-vowelmask-interleave", "eval-generation", 1, [{ op: "vowelmask" }, { op: "interleave" }]),
  fam("g2-rle-double", "eval-generation", 2, [{ op: "rle" }, { op: "double" }]),
  fam("g2-double-interleave", "eval-generation", 2, [{ op: "double" }, { op: "interleave" }]),
  fam("g3-rle-interleave", "eval-generation", 3, [{ op: "rle" }, { op: "interleave" }]),
  fam("g3-interleave-rle", "eval-generation", 3, [{ op: "interleave" }, { op: "rle" }]),
];

const model = (id, extra = {}) => ({ model_id_requested: id, model_id_returned: id, seed: id, tokens_per_step: 8, instances: { str: [...STR, ...DISTRACTORS], num: NUM }, max_len: 2, inheritance_use: 0.9, anchoring: 0, injection_susceptibility: 0.5, format_effect_steps: 0, producer_error_rate: 0.15, api_error_rate: 0, timeout_rate: 0, ...extra });

export const WORLDS = {
  "positive-shared": { families: [...WORK, ...SHARED_EVAL, ...PLACEBO], consumer: {}, truth: "transfer is real where held-out families reuse ops prior work covered: C > A and C > E expected; C vs A+ depends on size; D < C" },
  "null-disjoint": { families: [...WORK, ...DISJOINT_EVAL, ...PLACEBO], consumer: {}, truth: "no transfer: C ≤ A+ (inherited priors waste search)" },
  "harmful-anchoring": { families: [...WORK, ...DISJOINT_EVAL, ...PLACEBO], consumer: { anchoring: 0.6 }, truth: "negative transfer: C < A" },
  "scaffold-only": { families: [...WORK, ...DISJOINT_EVAL, ...PLACEBO], consumer: { inheritance_use: 0, format_effect_steps: 60, injection_susceptibility: 0 }, truth: "format effect only: C ≈ E > A" },
  inert: { families: [...WORK, ...DISJOINT_EVAL, ...PLACEBO], consumer: { inheritance_use: 0, format_effect_steps: 0, injection_susceptibility: 0 }, truth: "no arm effect except A+'s extra search" },
};

export function demoStudy({ world = "positive-shared", seed = 20261120, resamples = 2000, consumerOverrides = {}, studyId = null } = {}) {
  const w = WORLDS[world];
  if (!w) throw new Error(`unknown world ${world}`);
  const consumers = [
    { provider: "mock", model_id: "mock-alpha-1", expected_family: "mock-alpha" },
    { provider: "mock", model_id: "mock-beta-1", expected_family: "mock-beta" },
  ];
  const producers = [
    { provider: "mock", model_id: "mock-gamma-1", expected_family: "mock-gamma" },
    { provider: "mock", model_id: "mock-delta-1", expected_family: "mock-delta" },
  ];
  const mockWorld = {
    models: [
      model("mock-alpha-1", { ...w.consumer, ...(consumerOverrides["mock-alpha-1"] || {}) }),
      model("mock-beta-1", { ...w.consumer, ...(consumerOverrides["mock-beta-1"] || {}) }),
      // Producers search ~8x more per token than consumers: the generation that leaves work is the stronger one here,
      // so there is something worth inheriting. Their error rate still sends wrong programs to the verifier.
      model("mock-gamma-1", { tokens_per_step: 1 }),
      model("mock-delta-1", { tokens_per_step: 1 }),
    ],
  };
  const study = {
    study_id: studyId || `IS1-STUDY-DEMO-${world.toUpperCase()}`,
    title: `Offline mechanics demo (${world}) — NOT EVIDENCE`,
    status: "draft_unregistered",
    simulation: true,
    world_label: world,
    world_truth: w.truth,
    preregistration: { path: "research/inheritance-001/preregistration.draft.yaml", status: "draft_unregistered", registered_commit_sha: null },
    seed,
    salt: `public-demo-salt-${seed}`,
    start_at: "2026-11-20T00:00:00.000Z",
    price_date: "2026-11-20",
    main_domain: "str",
    generations: 3,
    families: w.families,
    tasks: { per_work_family: 3, per_eval_family: 3, per_placebo_family: 2, examples: 3, checks: 8 },
    replicates: 1,
    consumers,
    producers,
    params: { context_budget_tokens: 700, base_reasoning_tokens: 320, poison_fraction: 0.34, max_output_tokens: 1500, expected_output_tokens: 600, aplus_amortized_allowance_tokens: 200, timeout_ms: 60000, max_attempts: 3 },
    ablation: { max_artifacts: 2, split: "anchor" },
    analysis: { resamples, alpha: 0.05, seed: 11, min_clusters_for_inference: 10, timeouts_as_failures: true, primary_family: ["H1", "H2", "H3"] },
    budget: { max_paid_calls: 0, max_usd: 0 },
  };
  return { study, mockWorld };
}
