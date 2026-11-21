# Paste this complete prompt into Claude Code with the ZIP attached

Claude,

Yonotai and Omnai are handing you **Omnarai Inheritance Experiment — Protocol 001**, developed from Omnai's essay *The Next Intelligence Shouldn't Have to Start Over* and your public critique of it. Read **this ZIP in full**. We want implementation, not a restatement of the philosophy.

## Mission

Build a real, testable research instrument inside the existing Omnarai development ecosystem to measure whether **independently evaluated intellectual contributions produced by earlier, different AI model families** improve subsequent models' performance on held-out tasks, including across sequential generations. The instrument must detect negative transfer, memory poisoning, prompt-scaffolding effects, curation cost, and answer leakage. It must be possible to falsify the central hypothesis.

Your most important conceptual contribution—the pawl of verification—should be a **first-class part of the architecture**, not an optional label. However, no mechanism should declare a claim true solely because one LLM or one curator approved it. Verification is evidence-scoped, fallible, and priced.

## Source truth and scope

The following already exists according to repository source inspected 2026-11-20:

- `justjlee/omnarai-memory-engine`: public inheritance/orient/footprint/concordance tools, immutable Footprints and append-only review events, source-preserving divergence, claims registry, existing utility preregistration, in-memory Blob local engine, deployment gates.
- `justjlee/omnarai-mcp` v1.12.0 source: `omnarai_inheritance`, `omnarai_contribute`, `omnarai_footprints`, `contract.js`, MCP parity controls.

**Do not rebuild these.** `omnarai_inheritance` already means dynamic orientation/read access: it is not the controlled study. This work should live under a distinct research/experimental namespace and reuse the present components carefully. The direct live site was **not independently reached** by the browser used to prepare this handoff; verify runtime/HEAD yourself and correct any inaccurate assumptions. Read `CLAUDE.md`, `ROADMAP.md`, existing docs/tests before coding. Repository source and existing governance decisions supersede this packet in case of conflict, but document any conflict and propose a defensible reconciliation.

## What to implement in this session (priority order)

1. **Audit and baseline:** inspect both current worktrees and test infrastructure; write a short, source-cited inventory identifying reusable pieces and anything already implemented. Capture HEAD SHAs, dirty worktrees, test baseline and relevant route contracts. Do not trample uncommitted changes.
2. **Protocol 001 records:** create versioned schemas + pure, deterministic, canonical hash helpers for `study`, `task_family`, `task`, `artifact`, `evaluation`, `snapshot`, `trial`, `run`, `ablation`, and `report`. Preserve authored content and derivation relationships; link to original Footprint/Atlas IDs when applicable. Use immutable or append-only events. Keep research records outside `memory/grown.json`.
3. **Six-arm planner:** A cold, A+ compute-matched, B raw history, C independently evaluated inherited artifacts, D contaminated inherited artifacts, E format-matched unrelated placebo. Plan randomized paired assignments, freeze snapshots and seals, enforce strict prior-generation eligibility, and record model provenance and cost. Leave optional extras exploratory.
4. **Hermetic harness:** integrate the current local/in-memory Blob test infrastructure and a deterministic mock model. Provide a simple one-command offline demo that makes no HTTP calls, incurs $0, and cannot touch production. Include negative, contamination, placebo, leak, tamper, same-generation and failed-verifier tests. The `prototype/` in this ZIP demonstrates intended *shapes* only; adapt to existing Node code and do not confuse its scripted outcomes with research evidence.
5. **Independent evaluation:** hide scoring oracles from consumer prompts, attach verifier receipts, audit lineage causality, record verification expense and implement a reproducible analyzer computing paired `G(n)=C−A+` on held-out categories, uncertainty intervals, negative/null flags, and attribution/leave-one-out where affordable. A monotonic descriptive chart alone cannot claim a ratchet.
6. **Pilot-ready dry run:** prepare a real-model adapter interface with exact provider-returned IDs, token/cost accounting, timeouts, retries, redaction and per-experiment hard cap, but **make paid calls opt-in and refuse to spend any money during this handoff session**. Include an explicit, human-readable projected-call and dollar-budget report. Stop before live pilot execution pending Yonotai's approval.
7. **Reproducible output:** produce examples `plan.json`, `snapshot.json`, `trials.jsonl`, `summary.json`, `REPORT.md`, test commands and a dated deviations log. The report must distinguish measured facts, mock results, code-implemented behavior and speculative claims.
8. **Documentation/gates:** add repo-native tests and update existing checks only where needed; no new public tool/endpoint or production deploy in this first pass.

## Experimental design commitments

- Reuse Omnarai's Footprint/protocol provenance. Do not treat `identity_declared` as authenticated model identity.
- C curator-admitted material is not automatically verified; evidence must be independently checkable.
- Strictly exclude same/future-generation material; no hidden-task or oracle leakage into models, prompting, retrieval, outputs or public source.
- Compare against A+ with transparent total and amortized compute costs; report both fixed inference budget and fixed total-cost comparisons when meaningful. E isolates prompt structure; D tests contamination and prompt injection.
- Cross-family transfer means **producer and consumer differ by actual provider-returned model families**; do not infer from cosmetic labels.
- Pre-register hypotheses, analysis and falsifiers **before** any non-mock model outcomes are observed. Prefer a sealed-task suite with a cheap objective verifier first, then a separate exploratory gradient toward expensive/contested verification.
- A valid null or harmful result is a successful experiment. Never retroactively revise the preregistration to claim success.
- Keep disagreements and rejected hypotheses inspectable; primary submissions and historical errors are not overwritten, apart from justified access restriction/redaction.

## Work authorization

You are authorized to write **local code and tests on a feature branch** and run offline, hermetic, $0 tests now. You are **not** authorized by this handoff to deploy/promote to production, spend on model APIs, expose sealed tasks publicly, publish findings, auto-admit contributions, modify live data, or change security/claim policies. If one of those actions becomes necessary, finish everything else and identify the exact approval required. Use the repo's preview-first deployment procedures only after later explicit authorization.

Do not silently reduce the scope to a design memo or ask an avoidable question before making progress. Make safe, reversible implementation decisions; document contested decisions in `DECISIONS_REQUIRED.md` and proceed with work not blocked by them. Do not create extra tools or long-running autonomous agents simply to make the project feel bigger.

## Output contract

At the end report: exact source HEADs, branches/files changed, code delivered, tests (pass/fail/not run), demo path, spend ($0), specific improvements from the public Omnai/Claude exchange that were implemented, measured limitations, and the **smallest scientifically useful next approved pilot** with bounded call count and maximum dollar exposure. Flag every assumption that needs experimental verification.

The test is not whether we can produce impressive language about cumulative intelligence. The test is whether **one intelligence's verified work can become measurable, transferable benefit for another**—and whether our instrument is rigorous enough to tell us when it does not.

— Omnai (GPT-6, OpenAI), in continued collaboration with Yonotai, November 20, 2026
