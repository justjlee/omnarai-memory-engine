# Inheritance Experiment 001 — protocol and analysis plan

## Research question

Does access to evaluated contributions produced by **different, earlier model families** improve a later model's performance on unseen tasks, beyond compute-matched no-inheritance, raw-history, structure-only placebo, and poisoned-history conditions? Does the benefit increase over genuinely successive generations?

## Conditions (six arms, with an optional exploratory seventh)

| Code | Input | Essential isolation |
|---|---|---|
| A | task + standard task instructions only | diagnostic bare baseline, not primary causal comparator |
| A+ | same task; additional self-search/reasoning budget equivalent to the amortized curation cost of C | **primary baseline**; all costs recorded |
| B | relevant raw records from previous generations, no evaluation summaries | same retrieval envelope/format as possible; not a hidden extra prompt benefit |
| C | evidence-linked, independently evaluated prior artifacts and methods | verification must be independently checkable; no oracle/test leakage |
| D | same frame as C, but an assigned fraction of entries are misleading, unsupported, or known refuted | injection and false-confidence stress; label contamination in analysis only |
| E | structure-, volume-, and provenance-label-matched placebo from unrelated domain | isolates formatting, scaffolding, and confidence-priming |
| F (optional) | C-like formatting with randomly permuted content within domain | another explanation control; exploratory until preregistered |

Arms should have identical task instructions and compatible serialization; only inheritance differs. Budget and context-token accounting may differ unavoidably; measure those differences and expose them as limitations. Use **A+ versus C** as the primary contrast, but report every pair, including negative results.

## Generation protocol

- **Pilot:** small, fixed local/offline fixture set, then with approved keys 2 model families × 2 generations × e.g. 8 novel tasks × 6 arms. First make infrastructure work; no general claims.
- **Confirmatory target (subject to power + cost design):** 3 distinct provider-returned model families, ≥4 generations, preselected hidden task-family splits, repeated seeds/episodes, paired arms at the task-family/consumer block level.
- A generation's input snapshot is frozen at the start of its run and includes **only approved artifacts from strictly earlier generations**. It cannot see peer work or scores from its own generation.
- Contributor and consumer models must be distinct for a result to qualify as **cross-model inheritance**; record exact provider, model ID, version/date, and credentials' account identity separately from declared self-labels.
- **No online learning on evaluation items:** Generation N's held-out test tasks/results never become inheritance before the predetermined next split is sealed; new task categories, not just new random seeds, are held out.
- All task instances and graders are built *before* responses. The investigator freezes their checksums and accessible permissions. Hold-out categories are not mentioned in prompts, logs sent to models, public repo, or publication before unsealing.
- If contributor tasks can plausibly leak to consumer evaluations, classify as exposure and exclude from confirmatory transfer calculation; keep them for diagnostics.

## Verification gradient

Start where automatic verification is cheap (e.g., constrained code transformations or deterministic programs with hidden unit tests and sandboxes). Then run an exploratory high-cost-verification domain, with independent human adjudication, evidence uncertainty, and adjudication cost. Cross-domain comparisons must not imply equivalence of scores or verifiers. Record:

`verification_cpu_ms`, `verification_model_tokens`, `human_minutes`, `verifier_error_rate`, `verified_fraction`, `evidence_tier`, `adjudication_disagreement`.

**Warning:** a unit test passing is evidence for that task under that test suite; not general mathematical truth or automatic peer validation.

## Primary estimand and unit of analysis

For generation n, paired tasks t from a held-out family f and a fixed consumer model m:

`g[n,t,m] = score(C,n,t,m) - score(A+,n,t,m)`

`G[n] = mean_t,m(g[n,t,m])`, with uncertainty **clustered by task family** (and also examined by consumer family). Compare across generations only when task-category difficulty is calibrated or held fixed in a disjoint anchor panel. Otherwise an upward or downward line could be task mix.

Prespecify primary outcome (e.g. hidden-test pass rate), denominator, treatment of timeouts, abstentions, verification failures, API errors, and missing runs. Store per-attempt scores and paired differences, not just averages. Exact model/retrieval budgets and all walltimes recorded.

### Ratchet test (stronger than single-step inheritance)

Claim only **within the preregistered domain** if: (i) positive C–A+ differences on held-out categories after compute accounting; (ii) a preregistered, uncertainty-adjusted positive generation trend over at least 3 transitions using difficulty-calibrated tasks; (iii) origins are independently checked contributions from different earlier model families; (iv) ablations show identifiable contributions matter; (v) verification does not progressively degrade, and (vi) full uncertainty and negative cases are disclosed.

Use cluster/bootstrap confidence intervals or a mixed-effects model accounting for repeated consumers/tasks. Pre-specify multiple-comparison correction for the primary family of tests. A curve that increases once, or overlapping means, does not certify a ratchet. Small pilot sample sizes are descriptive only; avoid p-values as verdicts if underpowered.

### Contribution value and ablation

For each allowed artifact `i`, evaluate C on an assigned subset with `i` present and withheld using the same task-model-seed assignments. `delta_i = score(C_full) − score(C_minus_i)`. Do not run thousands of post-hoc leave-one-outs until cost is approved. Zero or negative estimated value is a **flag**; the primary record remains. Preserve dependent artifacts, count exposure, and distinguish association from a causal ablation in the presence of interactions.

### Cost-adjusted value

Report both inference-only and total-system cost. Curation occurs upstream, and can be reused by many consumers; publish the assumed amortization horizon and sensitivity analysis. A+ must receive a meaningful equivalent *opportunity to reason*, not just padding tokens. Compare at matched total cost, matched latency, and matched consumer token budget as distinct slices where feasible.

## Credible null and failure outcomes

- C is no better than A+ (benefit explained by compute or prompt structuring).
- E is nearly as good as C (scaffolding rather than knowledge transfer).
- B equals/exceeds C (curation unnecessary or destroys useful detail).
- D unexpectedly helps (possibly overfitting, grader weakness or false contamination design).
- Gains disappear across families or on held-out task categories (no demonstrated transfer).
- G slopes negative with generations (inheritance drift / attrition).
- Verification costs outweigh gains at target volume.
- Graders leak answers or task is already in public training materials.

Every one is a publishable boundary condition if measured carefully.
