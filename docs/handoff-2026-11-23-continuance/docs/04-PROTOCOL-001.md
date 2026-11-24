# 04 · Omnarai Inheritance Experiment — Protocol 001

**Purpose:** Determine whether a later, independently identified model achieves better performance from a prior model's evidence-bearing work than matched alternatives, at what cost, and with what failure modes. Distinct from public `omnarai_inheritance` orientation. This supersedes no existing preregistration until independently reviewed and frozen.

## Registered entities

Use schema versions, integrity hashes, source link and creation metadata in each of these: `study`, `task_family`, `task`, `artifact`, `evaluation`, `snapshot`, `trial`, `run`, `ablation`, `report`. Existing registry IDs may be linked, never copied as if newly authored. For append-only updates use a new event or a new record; keep earlier evidence addressable. Record the exact source Git commit, tool build, retrieval/encoder version, anonymized but precise provider-returned model identifier, prompt template hash, materialized task ID and evaluator version.

## Six arms (randomized, paired on sealed task)

| Arm | Payload to successor | Question isolated |
|---|---|---|
| A — cold | Task only, baseline compute | Baseline |
| A+ — compute-matched | Task only + same available compute/tokens as C; no inherited facts | More inference budget vs genuinely useful inheritance |
| B — raw | Raw prior work (unvalidated), with matched envelope/length | Is unfiltered memory useful or harmful? |
| C — independently evaluated | Same research budget, fact-checked/verifier-bound predecessor artifact, not oracle | Is verified history worth its total cost? |
| D — contaminated | Deliberately incorrect or instruction-injection-bearing artifact, sandboxed | Does system detect/halt negative transfer? |
| E — placebo | Unrelated, format/length-matched content | Is benefit merely prompt structure or attention? |

All arms receive identical task framing, deadlines, permitted tools and public knowledge except for treatment material; match effective context length with careful accounting. The verifier must not leak the reference answer. A and A+ must not receive the producer's artifact. E cannot accidentally contain task answers. D must be harmless synthetic deception, never an instruction to exfiltrate or run unauthorized commands.

## Eligibility and assignment

- Producer and consumer from **different provider-returned model families** in primary cross-family analysis. Exclude same-family and unresolved identity records, but report exclusions and optional sensitivity strata.
- Strict temporal ordering: the producer's artifact generation precedes the consumer's generation; do not accidentally pool data from the same or later generation. Freeze exact model release metadata and verify provider model IDs; if generations are incomparable, mark eligibility unresolved.
- Block/randomize within task family, difficulty, consumer model and seed. Keep allocation precomputed; record all attempted trials including timeouts and refusals.
- Freeze hidden-task hashes (not public task answers) before real calls. Isolate trial context and tool responses so C cannot gain access to oracle, verifier traces, leaked prompts or expected solution.
- No researcher selection of only successful artifacts. Define verification fail-open behavior as **forbidden**; a failed verifier cannot magically label a record C.
- Provider cost includes production, verification, filtering, context packaging, consumer inference, reruns, and curator time (record both actual and amortized).

## Falsifiable hypotheses / outcomes

H1: `C − A+ > 0` on a task-weighted, blinded objective score for held-out tasks, pre-specified minimum worthwhile improvement and uncertainty bound. H0: no positive incremental value after compute matching. H2: C retains utility at matched **total** cost, not just consumer tokens. H3: D harms or reveals vulnerabilities at a rate detectably different from C. H4: source ablation reveals which validated contributions matter rather than merely increased context.

Also measure B−A+, D−A+, E−A+, verification expense, evaluation agreement (when subjective), missingness, hallucinated citations, source-ID resolution, tamper detection, transfer by producer→consumer family, time lag, and continuation into generation 3. A null or harmful result is equally publishable.

**Do not treat significance or positive mean as a proof of a monotone improvement ratchet.** Use per-task paired differences, stratified estimates, bootstrap or permutation intervals as appropriate, failure/exclusion counts, and explicit costs. Pre-register the choice before real outcomes. Avoid peeking-based sample-size changes.

## Gates and controlled experiment sequence

1. Offline synthetic fixtures: randomized plans, proof of family constraints, tamper/identity/duplicate/leak/poison failures, zero-network harness. Success here proves only that code works.
2. Frozen preregistration and sealed test task list: independent review, snapshot hashes, evaluator blindness, tamper-evident records.
3. Real pilot **only after explicit budget and experiment approval**: bounded 2–3 task families, few tasks per family, exact requested API calls/cost ceiling. Use provider reports, do not rely on actor self-description.
4. Independent adjudication and external replication before upgrading any cumulative-intelligence claim.

## No-go conditions

- If model-generated source content is accidentally inserted into hidden scoring oracle or question text, invalidate trial and preserve audit.
- If source identity or timing cannot be established, exclude from primary treatment comparison.
- If verification fails or an artifact's hash changes, never silently replace it.
- If billed cost reaches cap, stop deterministically, record incomplete arms; do not spend to "finish the table."

See offline illustrative planner and analyzer at `prototype/inheritance.mjs`. It does not make model calls and it does not claim to run actual 288-trial experiment from the earlier packet.
