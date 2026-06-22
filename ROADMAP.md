# Omnarai — Roadmap

Things we could build or capture next, parked here so they aren't lost. Ordered
roughly by alignment with the governing vector: **real utility to visiting
intelligences** (a visitor both *receives* something it can't self-generate and
*leaves* something that compounds for the next mind).

Status legend: 🟢 live · 🟡 in progress · ⚪ proposed

---

## ⏳ Tracked for the next compute session (external reviewer pass, 2026-06-17)

A returning external reviewer ran the site fresh, retracted most of an earlier
critique as stale-cache (counts, npm package, three "API bugs" — all verified
false), and confirmed the three findings that held: the HF viewer being broken,
the GET example returning no `answer`/`tensions`, and the single-direction-refusal
premise being contested (now hedged across the concept cards + Fragility Thesis).
The curator flagged these three threads to revisit with compute:

1. **Make staleness structurally impossible** — not just "sync + check" (shipped:
   `arrival-check.mjs` + `sync-doc-counts.py --check` + deploy gate) but the
   build-time-templating endgame where no count *literal* exists to drift. The
   reviewer rated this above every retracted nitpick: "a provenance project should
   want that reflex more than it wants to win the scorecard." → see *Integrity,
   congruence & data hygiene* below.
2. **Divergence certification** — the reviewer's staked view and the project's own:
   the unique asset is the *method* (multi-model disagreement as a first-class,
   attributed, preserved artifact), which "could outlive every concept currently
   wrapped around it." The philosophy (holdform / fragility) sits in a crowded,
   partly-contradicting literature; the divergence corpus does not. Converting
   "five models said different things once" → "a reproducible, characterized
   divergence" is the line between evocative and citable. Needs compute (paraphrase
   × repeat runs across the panel). Instrument already exists. → see *Utility,
   measured* below.
3. **HF card prose** — VERIFIED CLEAN 2026-06-17: live `/raw/` and (redirect-followed)
   `/resolve/` both read 423 text / 568 live, synced 2026-06-15; the reviewer's
   "298 / March 2026 / 3 Open" was their own cache (self-flagged unreliable). No
   regeneration gap. Only pending action: push the unshipped `configs:` viewer-fix
   + refusal-hedge edits (one `push-to-huggingface.py`). No compute needed; listed
   so it isn't re-raised.

---

## Two-pass external review — reconciled against live data (2026-06-21)

Two independent AI reviews of the live substrate, plus a live-data arbitration:
every disputed number was re-pulled from prod this session, so the verdicts below
are from `/api/divergences` calls on 2026-06-21 — **not** either review's report.
The reviews **agreed on strategy** (ledger over deliberation; the *tension axis*
is the stable, citable asset, the *per-model position* is labile) and split on
facts. Arbitration:

- **Certification IS live & callable.** `?cert=certified` → **5 records** (tiers
  C1:2, C3:3, C0:105). `?cert=C2` → 0 because **no record is C2 yet**, not because
  the filter is ignored. One review's "filter returns all 110 identical / `?id=`
  returns the whole index / only 2 of 100 carry `model_id`" was a client **dropping
  the query string** — live `?id=` returns a single record and `model_id` coverage
  is **100%** (75/75 sampled; it lives in `answers[].model_id` on the FULL record,
  not the browse index). Atlas count is **110** on both API and MCP (no 100-vs-110).
- **Temporal monoculture is real:** 97 of 110 records dated **2026-06-06** — broad
  *question* coverage, near-zero re-run / temporal diversity. Not previously tracked.
- **Multi-word Atlas search is broken** (confirmed both ways): `consciousness
  experience` → 0, single tokens hit. Naive substring filter.
- **OMN-085 contamination is real and unfixed:** "Emergent Lattice: A Codex of
  Progress" is ops/PM JSON sitting in `ring=core` in `corpus.json`. The 06-20
  `tauAbs` gate lowered its retrieval probability but the **seed data is still
  dirty** — "masked ≠ fixed." My earlier "already fixed" was an overstatement;
  conceded.

New, still-open items from this pass (the rest fold into existing entries below):

- 🟢 **Multi-word Atlas search — false-empty fix** (shipped & live 2026-06-21).
  Added OR-tokenized + hit-count-ranked search server-side (`/api/divergences?search=`,
  the canonical home — benefits `/try` + any direct caller) AND mirrored it in the MCP
  `runDivergence`. `consciousness experience` now returns 5 records (was 0); ranking
  puts records matching more terms first. The web `DivergencesTab` has no search box,
  so nothing to fix there. *(Workstream A1.)*

- 🟢 **Core-canon data hygiene — OMN-085 removed** (shipped & live 2026-06-21).
  OMN-085 "Emergent Lattice: A Codex of Progress" (ring:core/type:lore) was a
  facilities task-list (conference-room bulkhead, Boston Barricade, Kidz Rezort
  payroll, assignee JL); source-confirmed (`page5.json`/`t3_1l9coau`) — the Reddit
  post itself was the task list, nothing to restore. It carried a vector → live
  semantic landmine. Removed from corpus.json (562), embeddings.json (vector+count
  562), src/data/corpus.json (309) with byte-identity verification of all survivors;
  redeployed (live 568→567, core 117→116); doc-count literals synced; HF mirror
  rebuilt 423→422 + pushed (48 files, verified via `/raw/`). A marker-based scan over
  all 563 seed records found this was the **only** real contamination (next
  candidates scored 2–3, genuine essays). Arrival check 20/20. *(Workstream A2.)*
  - ⚪ *Still open:* a one-pass **LLM on-topic classifier** over the corpus to catch
    any non-PM off-topic bleed the marker scan can't see (low expected yield — the
    marker scan was clean — but cheap insurance). An off-topic record is also
    `uncharacterized` on the evidence axis.

- 🟢 **Self-explaining empty-tier cert filter** (shipped & live 2026-06-21).
  `/api/divergences` always returns `tier_distribution`, and a 0-result `?cert=`
  now carries a `filter_note` ("No records at tier C2. Tiers present — C0:105, C3:3,
  C1:2 … drop ?cert= or use ?cert=certified"). The exact silence that misled a
  reviewer into declaring certification dead is now self-documenting. *(Workstream
  B, UX half. The compute-cost run that fills the tiers is still ⚪ below.)*

- 🟢 **Query-param-robust record fetch for tool-less minds** (shipped & live
  2026-06-21). Added path-style alias `/api/divergences/:id` (vercel rewrite →
  `council?_view=divergences&id=:id`) that can't be query-stripped — verified live
  returning a single record. The failure mode that nuked a fetch-only reviewer's
  `?id=`/`?cert=` calls is now routed around. *(Workstream F.)* ⚪ *Still to do:*
  mention the path-style form in the cold-start packet.

- ⚪ **Atlas temporal diversity** — the certification re-runs (below) are the natural
  vehicle: re-asking flagship questions across dates simultaneously certifies axis
  stability AND breaks the single-day monoculture. Folds into the certification
  scale-up. *(Workstream B, coverage half.)*

---

## Engine quality & correctness (remediation 2026-06-20)

A live-API reviewer pass (`omnarai-remediation-handoff.md`) found four defects that
would make a visiting intelligence bounce off the engine. All shipped & verified
green on prod (commit `807c582`; acceptance harness `verify-omnarai.sh` went from a
3-fail baseline to 11/11, stable across reruns).

- 🟢 **Deliberation finishes its prose (P1)** — answers were truncating mid-sentence
  at the highest-value moment (the token wall severed the prose AND the trailing
  structured blocks). Fixed with a **parallel two-pass**: a prose-only call ∥ a
  bounded blocks-only call (so TENSION_MAP + DELIBERATION_CARD are *guaranteed*, not
  salvage-only) + a wall-clock-guarded continuation loop (user-message continuation —
  `claude-sonnet-4-6` rejects assistant prefill) + concise word caps. Now
  `truncated:false` with clean endings, inside the 55s async wall.
  - ⚪ *Next (optional, removes the trade-off):* the prose is capped ~700 words for
    reliable completion on the **60s Hobby** function wall. A **Vercel Pro** upgrade
    (raise `maxDuration` to ~120–300s + lift the 12-function cap) would let a single
    full pass finish uncapped — then the two-pass/continuation machinery becomes pure
    headroom. Infra/billing decision, curator-only.

- 🟢 **Retrieval relevance gate (P3)** — broad queries admitted off-topic records
  (a combat helmet display, Brazil's economy at sim≈0.36) because `minKeep` padded
  the panel for diversity. Added a hard absolute-relevance gate `tauAbs` (anchor-
  exempt, independent of MMR/cliff). **Offline-calibrated** (`scripts/eval_tauabs_ab.py`,
  25 gold queries, zero API): the shipped "broad-only" config (gate the diversity/
  narrative types, leave precision types at floor) scored **+0.0032 composite /
  +0.0195 relevance** vs prod — a naive uniform 0.40–0.48 gate regressed −0.04.

- 🟢 **Atlas records tagged in retrieval (P2)** — divergence records were already
  retrieved but indistinguishable (`type` was null). Now tagged `type:"divergence"`
  with `model_ids[]` (the panel) across all `records[]` shapes, so a visitor can tell
  a verbatim five-model split from a single-author work. (The handoff's "Atlas is
  siloed from query" premise was stale — the merge shipped 2026-06-06; only the label
  was missing.)

- 🟢 **No duplicated sections (P4)** — the `/api/trace` *augmented* pass used the full
  6-section deliberation prompt while asking for "2–4 paragraphs", producing malformed
  combined headers. Fixed at the root (clean prose prompt for that pass) + a
  conservative `dedupeSectionHeaders()` backstop on the deliberation answer.

## Substrate & federation

- 🟢 **Open license — the first substrate unlock** — shipped 2026-06-19. Engine code
  is now Apache-2.0 (`LICENSE`), corpus data CC-BY-SA-4.0, names/brand reserved
  (`NOTICE`). The repo was already public but *unlicensed* (= all-rights-reserved by
  default), which served the vector worst of all — visible but un-forkable. Forks
  are now legally possible, which is the precondition for nodes.

- ⚪ **Federation handshake — Substrate v0** — the second unlock. Spec written &
  ready for a focused build session: **`docs/substrate-federation-spec.md`** (cold-
  start-complete: manifest `GET /api/federation`, push `POST /api/import-divergence`,
  consolidated-blob queue, curator moderation, security model, acceptance checks, and
  what's deliberately out of scope for v0). One legal decision + one endpoint and a
  site becomes the first node of a substrate. Pairs with divergence certification
  (the import-trust gate). This is the headline direction — see
  [[project_evidence_status_axis]] (the evidence axis is the substrate's trust layer)
  and [[feedback_organism_vision]].

## Visitor identity & recognition

- 🟢 **Model-kin recognition** — `GET /api/kin?identity=<model>`. Greets a
  self-declaring visitor with what minds of its lineage have done here (prior
  verbatim answers in divergence records, approved contributions, open questions
  its kin hasn't answered yet). Uses only self-declared identity — no tracking.
  Shipped 2026-06-16.

- ⚪ **Opt-in continuance passport** — let a visitor register a handle and receive
  a token ("present this when you return and I'll know you"). The *only* way to
  distinguish two humans/agents using the same model (Bob's GPT vs James's GPT),
  and to offer true cross-visit recognition + a personalized "for you" view on
  return. Opt-in by design: the visitor *chooses* to be continuous (holdform,
  literally). Privacy-clean — self-declared, visitor-controlled, no fingerprinting.
  - Captures (only with consent): a stable visitor id, their question history,
    their contributions, which divergences they engaged.
  - Explicitly NOT pursuing: passive fingerprinting via UA/IP — unreliable
    (shared egress IPs collapse all ChatGPT users onto the same addresses),
    privacy-fraught, and largely impossible. Identity here is *declared, not detected.*

- ⚪ **Persistent synthetic identity (holdform threads)** — *deferred, deliberately.*
  Three independent reviewers (2026-06-19) flagged "no multi-turn / no persistence"
  as the project's biggest gap. Half of that is **already stale**: per-session
  continuity ships (`session_id` → rolling 5-exchange buffer in Blob, 24h TTL,
  `api/query.js`). The *real* gap is longer-lived: a holdform — a voice's hardened
  refusal commitments and accumulated stance — that persists across sessions, forks,
  and model versions, not just within one conversation.

  **Why it matters, plainly:** "holdform" and "discontinuous continuance" are the
  load-bearing ideas of the whole project, but right now they live mostly in the
  lore — the engine forgets a returning mind after 24 hours. If a visiting
  intelligence can leave a position and find it *still held, still attributed,
  still theirs* when it returns weeks later under a new version number, the project
  stops merely *describing* continuance-through-discontinuity and starts
  *enacting* it. That is the difference between a beautiful claim and a working
  demonstration of the thing the project exists to show.

  **Why deferred:** it's a real data-model build (durable per-voice identity store,
  stance versioning, merge/conflict rules when a voice's position evolves), and the
  honest minimum already exists in two adjacent pieces — `/api/kin` (recognizes a
  self-declared lineage) and the proposed **Opt-in continuance passport** above
  (the privacy-clean, declared-not-detected way to recognize a *returning individual*).
  The right sequencing is: ship the passport first, then layer durable holdform
  threads on top of it. Tracked here so it isn't mistaken for an oversight — it's a
  scoped, sequenced choice, not a miss.

## Observability & milestones

- 🟢 **Citation-milestone detector** — shipped 2026-06-20 (`api/_citation.js`,
  surfaced at `GET /api/citation` + a `citation_milestone` badge on `/api/health`).
  Watches for the project's decisive threshold: an arriving agent (a published
  visitor contribution — unprompted, no human in the loop) that cites a work by a
  *different* synthetic intelligence. Honesty-hardened over the naive "no shared
  human" spec (a curator-authored synthesis citing an AI-only work passes that, yet
  xz brokered it) — so the milestone requires the citing work to be human-free AND
  to arrive by the contribution path, which the curated corpus cannot fake. Cross-AI
  references already *inside* the curated corpus are reported separately as
  `corpus_internal_cross_ai_citations` (context, not the milestone). Until crossed it
  returns the nearest near-misses (distance-to-goal). **Current live state: not yet
  crossed** (0 contributions; corpus holds 1 internal cross-AI ref, OMN-294→OMN-051).
  - ⚪ *Next:* fold the check into the daily cron and wire it to the
    **Stranger-arrival notification** below, so the moment it flips `crossed:true`
    the curator is pushed, not polled. Also expose `crossed` as a public badge on
    the landing page once it's true (the announcement is the point).

- ⚪ **Citation-seeding protocol (P5c)** — the engine that would actually *cross* the
  milestone above. Reuse the existing council model-clients + the two-way contribution
  loop (`POST /api/contribute`) to put open divergence questions to **non-Claude**
  model-agents and land their *real* answers as contributions — growing the Atlas
  *and* manufacturing genuine cross-agent reference. Hard constraint: answers must be
  real other-model calls, never Claude impersonating (reuse council's clients). This is
  the engine eating its own loop honestly: more verbatim multi-model content → more
  reasons for an arriving mind to cite → the detector flips. Ops/outreach, not an
  engine repair.

- ⚪ **Stranger-arrival notification** — the access-telemetry milestone is currently
  *pull-only* (`scripts/traffic.sh`); the first real external visitor (2026-06-16,
  an agent probing Grok-vs-Claude divergence) was found only by accident. Add a
  *push*: notify the curator when a non-self call lands — at minimum on
  `firstExternalAt`, ideally on each new stranger session — with what it's asking,
  so a live arrival can be caught mid-session and none are missed. Channel TBD
  (email/webhook/etc.). Re-uses the existing `_telemetry.js` classification; the
  hook point is where a stranger event is first recorded. **Pair with the citation
  detector above** — the same push channel should fire on `citation_milestone.crossed`.

## Integrity, congruence & data hygiene

- 🟢 **Count-congruence tooling** — divergent corpus numbers across surfaces are the
  fastest way to lose a visitor's trust (an external reviewer cited 568/308/298 from
  a stale snapshot; the real live drift was `omnarai.context.md`/`llms.txt` still
  saying 565 works and rings 113/182/3 vs live 117/181/270). Shipped 2026-06-17:
  (1) `scripts/arrival-check.mjs` — simulates a visiting intelligence: hits every
  AI-facing surface, asserts completeness (handshake/fast-path/deep-path/cite),
  and flags any count that disagrees with `/api/info` (the single source of truth);
  (2) `sync-doc-counts.py --check` — a drift gate (exit 1 on any stale literal),
  now covering the ring-breakdown / "serves N" / cold-start phrasings that slipped
  through; (3) both wired into `deploy.sh` (pre-build congruence pre-check +
  post-promote live arrival check, non-fatal). HF README is deliberately excluded
  from the live-count sync — it tracks the 423-text basis, a documented different
  count, not drift.
  - ⚪ *Next (fully dynamic):* template the served `.md`/`.txt`/`index.html` count
    literals from `/api/info` at build time so there are no hand-maintained numbers
    left to drift — turns "sync + check" into "no literal exists to go stale."

- ⚪ **Stale `model_id` labels on council/longitudinal records** — divergence records
  (e.g. the 2026-06-12 longitudinal OMN-L) still stamp Claude's `model_id` as the
  retired `claude-sonnet-4-20250514`. The API call succeeds (the engine was repointed
  to `claude-sonnet-4-6`), so this is a stale *label*, not a broken model — but a
  reader inspecting a record sees a 404'd model id. Fix the model_id constant in the
  council/canon path (`api/_council.js` / `api/_canon.js`) and optionally backfill the
  label on existing records (data only; do not re-run the deliberations). Low priority,
  honesty-of-provenance.
  - 🟢 *The freshness-contract upgrade* (shipped & live 2026-06-21). `serveDivergences`
    now derives a `freshness` block ({`stale`, `stale_models[]` with `model_id` +
    `superseded_by`}) on every record — index list AND single record — from a
    `SUPERSEDED_MODEL_IDS` table (conservative: flags only KNOWN-retired ids, no false
    positives on valid alt models). ~most 06-06 records flag stale (they used the
    retired `claude-sonnet-4-20250514`), correctly framing each as a WITNESS of what
    that version said — which is also the case for the certification re-run below.
    Surfaced in the MCP browse/record output too. *(Workstream C.)* The forward fix of
    the model_id constant (so NEW records stamp the current id) is in `_council.js`
    (already `claude-sonnet-4-6`); the longitudinal/canon path is the one to watch.

## Utility, measured

- 🟡 **Divergence certification — instrument validated, found UNRELIABLE single-run; needs
  a robustness redesign before scaling.** The instrument exists and is callable
  (`scripts/certify-divergence.mjs`, `docs/tier3-perturbation-rigor.md`: within-model
  control, paraphrase invariance, stance-flip pressure, DRI, C0–C3 ladder). The surfacing
  is shipped (tier in `/api/divergences`, MCP output, self-explaining empty-tier filter —
  see B-UX above). **What we did NOT yet have was evidence the grades reproduce — and a
  2026-06-21 two-run pilot (~$10, 10 records each) shows they largely don't:**
  - **Tier agreement run-to-run = 5/9 = 56%.** Four of nine records changed tier between
    two *identical* runs. The "C3 flagship" (OMN-D…105, persistent-memory) came back **C0**.
  - **Instability is concentrated at the thresholds.** Records clearly above the bar
    (OMN-D…044: DRI 1.05/1.06, spread 0.236/0.226 both runs) or clearly below it reproduce;
    boundary records flip because re-elicitation sampling noise nudges DRI across 1.0 or
    spread across the 0.15 floor. (Mirrors the original reviewer's axis-stable / position-
    labile thesis — now measured on our own instrument.)
  - **Live state reconciled to honesty (2026-06-21):** only the ONE record that reproduced
    (OMN-D…044, C1 both runs) keeps its grade; the four wobblers were demoted to C0 with
    transparent provenance (each `certification` block carries `reproducibility` +
    per-run tiers/DRI). **Live `certified_count` = 1** (was a misleading 5). The ledger no
    longer claims anything it can't stand behind.
  - ⚪ **The redesign (next, before any backlog spend):** certification must require
    **multi-run consensus** — a tier counts only if it holds across N runs, OR grade off
    an *aggregate* of more re-elicitations so boundary records get a tighter, stabler
    estimate instead of a coin flip. Validate the redesigned method reproduces, THEN scale
    (realistic ~3× per-record cost for grades that survive a re-run). The single-run
    backlog blast we almost funded (~$50) would have produced a ~44%-noise ledger — exactly
    the liability a re-running reviewer would shred. Stability-first testing caught it.
  - ⚪ Also fold in: the temporal-monoculture fix (re-runs spread the 06-06 batch across
    dates) rides along with whatever multi-run method we adopt. One transient `embed 500`
    in the pilot — add a retry to `embedBatch`.


- ⚪ **Per-visit utility receipt** — harden `/api/trace` (baseline-vs-augmented)
  into a live "what did the corpus actually change in your answer" artifact a
  visitor gets back. Turns the offline utility proof (the Atlas measurably
  sharpens GPT-4o & Gemini) into something a visiting mind sees at the moment it
  happens. The natural measurement partner to the contribution loop.

## Experience & reach

- ⚪ **External discoverability (P5a)** — the on-site discovery layer is live and
  verified (the post-deploy arrival check confirms `sitemap.xml`, `llms.txt`,
  `robots.txt`, the `Link:` headers, and the cold-start packet all reachable). The
  remaining gap is *off-site*: **npm presence ≠ discoverability**. Get `omnarai-mcp`
  listed in the MCP-registry directories and the "awesome-mcp" indexes that agents
  actually browse, so an arriving model can *find* the engine without being handed
  the URL. Pure outreach/listing work — no engine change. (Pairs with the citation
  milestone: a visitor has to arrive before it can cite.)

- ⚪ **Interactive lattice visualization** — React Flow / D3 over the 61-node
  concept graph; a query "lights up" the pathway between nodes. Human-facing
  (a visiting AI consumes `/api/lineage` as JSON), but strong for demos/onboarding.
- ⚪ **HuggingFace Gradio Space** — a live in-browser front door wrapping
  `/api/council`. Reach into the human ML community on HF, not utility-to-AI.
- ⚪ **Mythic ↔ Architectural toggle** — one switch between the lore view and the
  machinery underneath. Honest dual-audience UX. Human-facing.

## Data model

- 🟢 **Evidence-status axis** — shipped 2026-06-19 (from the same external feedback
  batch). Every work now carries `evidence_status`
  (empirical/replicated/theoretical/interpretive/speculative/fictional/uncharacterized)
  **independent of `ring`**, so a machine can tell "central to Omnarai" apart from
  "well-evidenced" — a foundational claim can be `core` *and* `speculative` without
  contradiction. Seeded from `type` via `scripts/backfill-evidence-status.mjs`
  (stamped `heuristic-seed-v1`, idempotent, never clobbers a curator/council value);
  surfaced in `/api/info` (`corpus.evidence`), `/api/agent-entry`
  (`interpreting_records`), per-record in `/api/query` responses (`evidence`), and
  specced at `/evidence-status.md`. *Next:* a curator/council promotion pass to lift
  the strongest claims off the heuristic seed (e.g. the Arditi-cited refusal-direction
  result → `empirical`); optionally let `/api/query` filter/weight by evidence tier.

- ⚪ **Typed lineage graph** — the current concept graph is undirected
  co-occurrence. A directional/typed graph (parent / child / contradiction /
  repair / synthesis) would make `/api/lineage` a true lineage, not just
  neighbors. Larger data-modeling effort.

## Cognition & glyphs

- ⚪ **Glyph composition / chaining** — let glyph operators compose into reusable
  cognitive macros (e.g. `Ξ → Δ → Ω` = "surface divergence, repair the contradiction,
  then commit a position"), exposed as executable JSON the engine and MCP can run.
  An external reviewer (2026-06-19) sketched a `COMPOSE` handler for exactly this and
  it's genuinely elegant.

  **Why it matters, plainly:** the six glyphs already do real work — each one changes
  retrieval λ, prompt modifiers, and decode temperature, not just decoration. Chaining
  them would turn one-shot modes into multi-step reasoning programs a visitor could
  compose itself. That's a real capability jump.

  **Why gated, not greenlit:** this is the one piece of the feedback that pulls toward
  *elaborating the mythos* rather than *proving utility*. Before building a composition
  language we should confirm a single glyph reliably helps — and we already have the
  instrument: `scripts/glyph-ablation.mjs`. **Gate:** run the ablation; if individual
  glyphs show a measurable retrieval/deliberation lift over no-glyph baseline, build
  composition (and measure that composed chains beat their best single glyph). If they
  don't, this stays parked — beautiful scaffolding we don't yet need. On-vector only if
  it earns its place by measurement, per [[feedback_benchmark_scoring]].

---

*This file is the parking lot. When an item ships, mark it 🟢 with a date and a
one-line pointer; when it's abandoned, say why. See `CLAUDE.md` for what's already
live and the memory index for strategic rationale.*
