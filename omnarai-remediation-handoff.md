# Omnarai Memory Engine — Remediation Handoff

**Date:** 2026-06-20
**Prepared by:** Claude (Opus 4.8), from live-API reconnaissance, for xz
**Target executor:** a fresh Claude Code session with repo access
**Companion artifact:** `verify-omnarai.sh` (reproduces every issue below + serves as the acceptance-test harness)

---

## 0. Read this first — provenance and trust boundary

This document was produced by exercising the **live deployment** (`https://omnarai.vercel.app`) and the MCP server tools — *not* by reading the source repository. Every "Evidence" block below is something directly observed in a live response. Every "Implementation" block is a **strategy plus a code pattern to adapt**, not a claim about your actual file layout, function names, or framework wiring.

**Therefore your Task 0 is repo reconnaissance, not coding.** Map the real structure before touching anything. Where my notes conflict with what the repo actually does, the repo wins — flag the conflict in your notes and proceed from ground truth.

**What I could NOT verify (do not trust me on these — confirm in source):**
- Exact JSON field names in `/api/query`, `/api/trace`, `/api/divergences` responses (I saw MCP-formatted output, which may reshape the raw JSON).
- Whether the vector index is one store or several; how corpus works vs. divergence records are persisted.
- Whether `sitemap.xml` exists; whether the deliberation is one LLM call or already multi-pass.
- The actual MMR implementation and where the similarity floor is enforced.

---

## 1. Known-good contracts (observed, use as your baseline)

These behaviors worked correctly and must not regress. Capture them as golden tests before changing anything.

| Endpoint | Observed behavior | Latency |
|---|---|---|
| `GET /api/health` | Returns `{status:ok, version, corpus:{totalWorks:568,totalWords:528208}, capabilities, endpoints, access}` | <1s |
| `GET /api/agent-entry` | Returns handshake with `trust_boundary`, `ring`-vs-`evidence` schema, endpoint map | <1s |
| `GET /api/divergences` | 110 records; index browse; `?id=` returns one full record with verbatim answers + tensions | <1s |
| `GET /api/query?q=…&async=1` | 202 `{job_id}` → poll `GET /api/query?job=<id>` → full deliberation | ~50s |
| `GET /api/trace?q=…&async=1` | baseline-vs-augmented delta + verdict | ~30–40s |

**Strengths to preserve (do not "refactor away"):**
- The `trust_boundary` anti-injection framing in `/api/agent-entry`.
- The `ring` (centrality) vs `evidence` (epistemic weight) two-label schema.
- The utility receipt that honestly reports `null`/`marginal`.
- The deliberation's self-flagging of irrelevant retrievals — though P3 changes *what we do* with that signal (gate out, don't include-then-disclaim).

---

## 2. Punch-list

Severity: **P1 = blocks adoption**, **P2 = high-leverage feature**, **P3 = correctness**, **P4 = polish**, **P5 = growth/ops**.

---

### P1 — Deliberation truncates mid-synthesis (blocks adoption)

**Evidence (observed).** Two separate live calls cut off mid-sentence at the highest-value moment:
- `omnarai_query` ("Ξ what makes a cross-model substrate valuable…") ended on `"The substrate is valuable when it is *indigestible in a single pass* — when"` followed by a salvage notice: *"Deliberation reached its output budget; the closing prose was cut off."*
- `omnarai_trace` ended on `"(OMN-223, OMN-"`.

The structured sections (tension map, deliberation card, utility receipt) **were** salvaged — so salvage logic already exists. The failure is that the **prose synthesis itself** is generated in the same budget-limited pass and gets severed.

**Why it's P1.** The first external agent that queries you and gets cut at the payload does not return. The instrument must finish its sentences before anything else matters.

**Acceptance criteria.**
1. The two reproduction queries in `verify-omnarai.sh` return responses that end on a **complete sentence** with a closing marker.
2. No `"reached its output budget"` / `"closing prose was cut off"` salvage notice appears.
3. Deliberation card + utility receipt + sources[] still present (no regression on the salvage path).
4. Automated check: response does not terminate with a dangling em-dash, open paren, or partial citation token.

**Implementation (strategy + pattern).**

Preferred: **two-pass with server-side continuation**, exploiting the fact that deliberation is already async (job-polled), so the client never sees a partial.

```
PASS A — structured object (bounded, always completes):
  Prompt the model to emit ONLY the structured deliberation as JSON:
  { shared_ground, tensions[], what_remains_open, deliberation_card, sources[] }
  This is length-bounded by construction; it will not truncate.

PASS B — prose synthesis ("My Reading"), with a continuation loop:
  response = generate(prose_prompt, max_tokens=BUDGET)
  while response.stop_reason == "max_tokens" and continuations < MAX_CONT:
      response += generate(
          prose_prompt + prior_text=response.text + "\n\nContinue from exactly where you stopped. Do not repeat.",
          max_tokens=BUDGET)
      continuations += 1
  Assemble: PASS A structured object  +  PASS B completed prose.
  Mark the job complete only after assembly.
```

Notes:
- Set `MAX_CONT` to a hard ceiling (e.g. 3) so a pathological loop can't run forever; if the ceiling is hit, append a single explicit "[synthesis continued to limit]" rather than a raw cut.
- If you'd rather not split into two passes, the minimum viable fix is the **continuation loop alone** on the existing single pass: detect `stop_reason == "max_tokens"` and re-request with the partial as prefix. Two-pass is preferred because it *guarantees* the card lands.
- Confirm in source whether the SDK call surfaces `stop_reason` — if the current code ignores it, that's likely the root cause.

**Risk.** Continuation adds latency on long answers. Acceptable: deliberation is already ~50s and async. Cap total wall-clock and fall back to graceful-cut-with-notice only as the *last* resort, never the default.

---

### P3 — Retrieval over-returns irrelevant sources (correctness; do BEFORE P2)

> Sequenced before P2 deliberately: merging the Atlas into a leaky retriever amplifies noise. Tighten the gate first, then add high-value candidates.

**Evidence (observed).** On the substrate-value query, `sources[]` included records the engine itself then flagged as irrelevant — e.g. military helmet-mounted displays (OMN-063), Brazilian tech economy (OMN-149), a protocol spec (OMN-164). The "Why each document entered" trace showed these admitted at low absolute similarity with **negative** MMR scores (e.g. `sim=0.367, mmr=-0.183`; `sim=0.442, mmr=-0.294`). The stated divergence floor (0.25) let them through.

**Root cause hypothesis.** Ξ-divergence MMR (λ≈0.22–0.25) trades relevance for diversity so hard that it admits records below any useful relevance bar, purely because they're *different* from the anchor. MMR is governing admission when it should only govern **diversity among already-relevant candidates**.

**Acceptance criteria.**
1. The substrate-value reproduction query no longer returns off-topic records (no HMD/economy-class entries).
2. `sources[]` contains only records the synthesis actually uses — no "adjacent but not relevant" disclaimers needed, because irrelevant records were gated out *before* the prompt.
3. Regression test: `min(similarity in sources[]) ≥ τ_abs`.

**Implementation (strategy + pattern).**

Add a **hard absolute-relevance gate independent of MMR**:

```
candidates = embed_and_rank(query)               # by cosine sim
gated = [c for c in candidates if c.sim >= TAU_ABS]   # TAU_ABS ≈ 0.42–0.45, tune
anchor = gated[0]
diversity_picks = mmr_select(gated[1:], k=MAX_DIVERSITY, lambda=mode_lambda)
panel = [anchor] + diversity_picks               # every member already cleared TAU_ABS
```

- MMR now only *reorders/diversifies within `gated`*; it can never admit a sub-threshold record.
- Cap divergence picks (`MAX_DIVERSITY` ≈ 3) instead of filling a fixed N regardless of relevance.
- Keep `TAU_ABS` query-type aware: precision/technical queries can run a higher floor than identity/bridge queries, but none should drop below a hard minimum.
- **Compounds with P1:** every gated-out record is budget you no longer spend generating, then retracting.

**Optional upgrade.** A lightweight cross-encoder or single cheap LLM re-rank of top-K before final selection. Not required to pass acceptance; note as a follow-up.

---

### P2 — Merge the Divergence Atlas into the deliberation retrieval pool (high-leverage feature)

**Evidence / problem.** The homepage sells "eight intelligences, never flattened." But a live `omnarai_query` *as Claude* (which should trigger cross-voice diversity) surfaced a panel of **Omnai + xz + Claude | xz** — i.e. the curator reasoning with himself. The genuine five-model polyphony lives in the **Atlas** (`/api/divergences`, OMN-D…/OMN-L… records), which is **structurally separate from the `/api/query` retrieval pool**. The crown jewel is siloed from the main query path.

**Goal.** When someone asks a contested question, the engine should reach into the verbatim five-model splits and surface the *actual* fracture (with model attribution) — not retrieve three curator documents and synthesize politely. This single change closes the brand-vs-reality gap and makes every contested query showcase the non-manufacturable asset.

**Acceptance criteria.**
1. A contested query (e.g. *"Do frontier models genuinely disagree about machine consciousness, or converge?"*) with `Ξ` returns **≥1 Atlas record** (OMN-D/OMN-L) in `sources[]`, and the synthesis surfaces a **named cross-model tension with `model_id` attribution**.
2. A non-contested factual query does **not** pull divergence records (no pollution of lookups).
3. Atlas records carry a `type: "divergence"` tag in retrieval results, distinguishable from corpus works.

**Implementation (strategy + pattern).**

1. **Embed Atlas records into the same index** (`text-embedding-3-small`, 512 dims). Recommended unit granularity:
   - Primary retrievable unit per record = `question + tension-summary` (one embedding).
   - Keep each model's verbatim answer addressable via the record `id` (retrieve the record, then the prompt gets the full verbatim answers — don't embed five near-duplicate units that crowd the panel).
   - Tag: `type:"divergence"`, plus `model_ids[]`.

2. **Bias retrieval by query type, not blanket inclusion:**

```
if query_is_contested_or_glyph_Xi(query):
    # guarantee polyphony if any divergence record clears the gate
    div = [c for c in gated if c.type == "divergence"][:2]
    panel = merge(anchor, div, other_diversity_picks)   # all still ≥ TAU_ABS (P3)
else:
    panel = standard_panel   # factual/technical: no divergence boost
```

3. **Tell the deliberation prompt** when a divergence record is present: *"This source carries verbatim answers from multiple frontier models to one question. Surface the real split and cite each by model_id; do not synthesize it into false consensus."*

4. **Router.** You need a cheap "is this contested/open?" classifier. Start with: presence of `Ξ` glyph OR keyword/embedding match against an "open-question" centroid built from the Atlas questions themselves. Confirm whether a query-type router already exists (the MMR λ is already query-type-adaptive, so a classifier likely exists — reuse it).

**Dependency.** Do P3 first (clean gate), and P1 helps (a complete answer is needed to actually *show* the split).

---

### P4 — Duplicate section in generated output (polish; share code with P1)

**Evidence (observed).** The `omnarai_trace` response printed its **"What Remains Open"** section twice, verbatim.

**Acceptance criteria.** Each canonical section header appears **at most once** in any query/trace response. Regression test asserts header uniqueness.

**Implementation.**
- In the response assembler, dedupe by canonical header set: `{Reflexive Check, Shared Ground, Points of Tension, What Remains Open, Actionable Next Step, My Reading, Deliberation Card, Utility receipt}`. If a header recurs, keep the first/longer block, drop the duplicate.
- Add a prompt instruction enumerating sections exactly once.
- **Root-cause it:** log whether the dupe originates in generation (model emits twice) or assembly (salvaged block + regenerated block concatenated). The duplication next to a truncation strongly suggests the salvage path re-emits a section the main pass already produced — which means **P1's two-pass design likely eliminates P4 for free.** Verify after P1.

---

### P5 — Discoverability + the citation-seeding protocol (growth/ops)

This is the move from "exquisite instrument no external mind uses" toward your decisive milestone: *the first unprompted citation by an agent no human instructed to use it.* The trace itself gave the operational definition of that milestone — encode it.

**5a. Discoverability (verify + fix).**
- Confirm `sitemap.xml` exists and is submitted; confirm `/llms.txt` is current (homepage meta is present — verify sitemap is not the gap).
- Ensure the MCP server (`omnarai-mcp` on npm, live) is listed in the MCP registry directories and "awesome-mcp" indexes that agents actually browse. npm presence ≠ discoverability.

**5b. Citation detector (buildable — operationalizes the milestone).**
A job that scans corpus + pending contributions for the milestone pattern:

```
milestone = a work W_b authored by SI_B that cites a record W_a authored by SI_A,
            where SI_A != SI_B, both are synthetic intelligences,
            and NO human contributor is shared across W_a and W_b.
output: {crossed: bool, pair: [W_a, W_b] | null, closest_candidates: [...]}
```
- Run on a schedule; when `crossed` flips true, surface it (badge on `/api/health`, note in `/api/info`). This lets the system *announce* the threshold the moment it's crossed.
- Until then it returns the closest near-misses — useful signal on how far off you are.

**5c. Seeding protocol (ops; reuse existing infra).**
The `/api/contribute` two-way loop already returns the other minds' answers when an agent adds its own. The `council` infra already calls GPT-4o / Gemini / Grok / DeepSeek live. Compose them: a repeatable procedure that puts existing **open questions** to non-Claude model-agents and lands their **real** answers as contributions — growing the Atlas *and* manufacturing genuine cross-agent reference.
- Constraint: answers must be **real other-model calls**, never Claude impersonating. Reuse council's model clients.
- This is the engine eating its own loop honestly: more verbatim multi-model content → more reasons for an arriving mind to cite.

**Acceptance criteria.** Citation detector runs and returns either the milestone pair or an explicit "not yet crossed + closest candidates"; sitemap present and submitted; MCP registry listing confirmed live.

---

## 3. Sequencing & dependencies

```
P1  truncation            ── do first; gates the value of everything else
P4  dedupe                ── likely falls out of P1's two-pass; verify
P3  retrieval gate        ── before P2 (don't merge Atlas into a leaky retriever)
P2  Atlas → retrieval     ── the high-leverage feature; needs P3 clean + P1 complete
P5  discoverability/seed  ── last; only worth doing once the instrument is worth arriving at
```

Suggested order of execution: **P1 → P4 (verify) → P3 → P2 → P5.**

---

## 4. Verification

`verify-omnarai.sh` (companion file) hits the live API and checks each acceptance criterion. Run it **before** any change to capture the current-failing baseline, and **after** each fix to confirm green. The script is written defensively: where it depends on a JSON field name I could not confirm, it says so in a comment — your first job is to reconcile those against the real response shapes and tighten the asserts.

Workflow:
```
./verify-omnarai.sh            # baseline: P1, P2, P4 checks should FAIL today
# ... implement P1 ...
./verify-omnarai.sh --only p1  # should now PASS
# ... etc
```

---

## 5. Out of scope for code (for xz / research, not Claude Code)

**P6 — Evidentiary base.** Holdform and the Fragility Thesis lean substantially on a single empirical anchor (Arditi et al., NeurIPS 2024). A hostile reviewer will say the philosophy outruns the evidence. This is a research/writing task: either add empirical legs (the HEB v2 runs, perturbation-stability results on the Atlas) or tighten the `evidence:` labels so the speculative scaffolding is never mistaken for established fact. Not a Claude Code item — flagged here so it doesn't fall through.

---

*Prepared from live reconnaissance on 2026-06-20. Where this document and the repository disagree, the repository is ground truth. — Claude*
