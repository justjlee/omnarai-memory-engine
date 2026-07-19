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

## Development handoff — "epistemic inheritance with provenance" (external research pass, 2026-07-16)

A fresh outside read of the live product (homepage, /try, /api/health,
/api/divergences, a live deliberation, /limitations.md) delivered as a build
brief. Positioning line worth keeping verbatim: *"Omnarai preserves not just
what intelligences concluded, but the disagreements, provenance, and unresolved
questions a successor needs to think with them rather than merely repeat them."*
Findings arbitrated against live data per the audit-reproduction rule:

- 🟢 **Front-page count conflict — CONFIRMED and FIXED same day** (engine v1.3,
  2026-07-16). The reviewer's "UI says 309 posts" was real: the React bundle
  rendered its bundled-mirror length (309) and a March `meta.json` (296 posts,
  rings 113/180/3, graph 58/148) beside static prose saying 567. Shipped: App
  fetches `/api/info` for authoritative totals (fallback "309+"), ring chips are
  computed from the bundled records at runtime (can never disagree with what
  filtering returns), scopes labeled explicitly ("567 works · 309 browsable
  posts"), footer shows live `corpus_rev` instead of a hardcoded date.
  Root-cause class: the SPA bundle was OUTSIDE the sync/check net (`arrival-check`
  and `sync-doc-counts` cover served text surfaces, not compiled JSX literals).
  - ⚪ *Next:* extend the drift gate to the built bundle — assert
    `dist/assets/*.js` contains no stale count literals, or fold the SPA into the
    build-time-templating endgame above.

- ⚪ **Certification badge as first-class UI** — REAL gap. `?cert=` tiers exist in
  the API (C0/C1/C3 live) but `DivergencesTab` shows no per-record tier. Build:
  badge on every record (`C0 — captured` → `C3 — certified divergence`), a
  provenance drawer (exact question, model_id, timestamp, method, hash,
  certification artefacts), and the language rule — reserve "genuine divergence"
  for C3, say "observed difference" for C0. Folds into Workstream B (UX half);
  turns the certification ladder from an API feature into the product's face.

- ⚪ **Record continuation as a visible primitive** — API already has it
  (`/api/contribute` two-way loop, per-entry blobs, curator moderation,
  `contributions[]` + `deltas[]` on records, `/api/kin`); the UI does not. Build:
  a "continue this record" action on each divergence record (select a position /
  tension / omission → declared identity + reason → pending fork), and render the
  lineage chain (original → contribution → delta) so the visible outcome is "this
  argument is alive." The reviewer's "Inheritance Record" release slice =
  one canonical per-question page (verbatim model-versioned answers + cert badge +
  named unresolved question + continuation action + lineage) — mostly assembling
  surfaces that already exist server-side (`/api/divergences/:id`, `.md`/`.json`
  exports, cite block).

- ⚪ **Three-column deliberation view + anti-synthesis action** — treat the
  synthesis as a reading, not the final word: source voices | engine's reading |
  what remains unresolved, plus a "show the strongest case against this reading"
  action (natural fit: a Ξ/Δ re-deliberation seeded with the synthesis as target).
  Data already in the response shape (`format=si` sections); UI-only.

- ⚪ **Glyph legibility** — pair each glyph with a before/after preview of what it
  changed in the retrieved set (two `format=context` calls diffed). Keeps the
  voice, makes agency legible; answers the recurring "ornamental mysticism"
  first-read.

- ⚪ **Contrast & first-path accessibility** — low-contrast body copy on the dark
  field, long interpretive preface before the engine, missing landmarks/skip
  link. Cheap, real, repeatedly flagged by human readers.

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

## Three-handoff arbitration — Grok "Atlas-central" / HANDOFF-2026-07-18 P0s / OMN-P-045 respondent context (2026-07-18)

Three direction packages arrived the same day and were reviewed together against
live prod (clean curl with `x-omnarai-self:1`, per the audit-reproduction rule)
and against the governing vector. Every verdict below is from live calls on
2026-07-18 — not from any package's own claims.

### Package 2 (HANDOFF-2026-07-18, "P0 remediation + cert scale-up") — defect claims arbitrated

- **P0-1 `?id=` ignored — PHANTOM (third occurrence of the proxy class).** Clean
  curl: `/api/divergences?id=OMN-L1784135876336` returns the single full record;
  bogus id → 404 with agent-helpful hint + example href. The handoff's own §3
  downgrade path applies: report, don't fix. Query-string-stripping clients have
  now produced phantom P0s in **three** review cycles (2026-06-21, 2026-07-16,
  2026-07-18); the path-style alias `/api/divergences/:id` already routes around
  it — the remaining fix is visibility (cold-start-packet mention, ⚪ above).
- **P0-2 placeholder-question substitution — NOT REPRODUCIBLE.** Empty and
  missing `q` both 400 (`MISSING_QUERY`, shipped 2026-07-16); `query`/`cleanQuery`
  echo the submitted question byte-identically incl. `&`, `?`, unicode. The
  claimed silent-substitution path evidently died with the bare-query-400 fix.
  - ⚪ *Adopted (additive):* alias the echo as top-level `question_received` on
    query/trace responses + document the echo contract in openapi.json — makes
    substitution *structurally visible* rather than merely absent. Minor bump.
- **P1-4 null relevance — PHANTOM (wrong field name).** Scores live at
  `relevanceScore` (floats, 12/12 across live probes); the audit's harness probed
  `.relevance` and its verify.sh also reads `.results[]` where the engine returns
  `records[]` — the acceptance suite would fail against a fully healthy engine.
  - ⚪ *Adopted (additive):* `embedding_coverage` on `/api/health` (currently
    absent) — cheap observability for the real risk class (works ingested after
    the last embed pass silently unscored).
- **The package's schemas must NOT enter CI as shipped — they codify the phantom
  defects as contract.** `query-response.schema.json` requires `results[]` +
  `relevance` (engine: `records[]` + `relevanceScore`) and forbids `^OMN-L` ids
  in retrieval (the P1-6 misreading of the deliberate divergence-retrievable
  design); `divergence-detail.schema.json` pins ids to `^OMN-L[0-9]{13}$`, which
  fails every OMN-D record (~half the Atlas). The handoff's own instruction —
  "reconcile against one real record before enforcing" — was performed 2026-07-18
  and both schemas fail it. Salvageable parts: the `question_received` field spec
  and the append-only `certification.history` idea; rewrite against live shapes
  if a detail-response schema is ever wanted in CI.
- **P1-3 count drift** — health and info agree exactly live (567 / 528,077 / same
  corpus_rev). Remaining static-surface work already tracked above (SPA-bundle
  gate, build-time templating endgame). No new item.
- **P1-5 trace timeout** — async contract verified present (submit → job_id /
  poll_url / status). Intermittent-hang claim unpinned; watch, don't build.
- **P1-6 "retrieval bleed" — DESIGN, NOT DEFECT.** Divergence records surface in
  `/api/query` *by decision* (merged 2026-06-06; tagged `type:"divergence"`
  2026-07-16; layered retrieval `layers=`/`exclude=` shipped 2026-07-15 — a
  caller who wants them out says `exclude=divergence`). What the probe DID
  surface, both real and small:
  - ⚪ **Prose/behavior drift:** homepage + context.md still say divergence
    records are "served separately via /api/divergences" while they also surface
    in query retrieval. Reconcile the prose to the layered-retrieval reality
    (one-line edit; trust-surface honesty).
  - ⚪ **Ring/tier scoping param is unimplemented and silently ignored** —
    `?tier=core` returned open+media records. Either implement `rings=` as a
    hard pre-MMR filter (the `layers=` machinery is the natural home) or reject
    unknown scoping params, so agents are never silently unscoped.
- **Phase 2 certification batch (≥25 records C0→C1+) — RIGHT GOAL, BLOCKED
  METHOD.** The gap is real (live: 3/111 certified, C0:108) and it IS the
  critical path for the HF ship. But the handoff's "do not modify the
  methodology — scale it" collides with this file's own 2026-06-21 finding:
  single-run tiers reproduce at ~56%. Verified 2026-07-18: the method has been
  revised once (`tier3-perturbation-v2-floored`, between_floor 0.15) but
  `certify-divergence.mjs` still has no multi-run consensus mode, the three live
  certifications carry **no reproducibility block**, and the flagship C3 sits at
  **DRI 1.018** — inside the exact boundary zone the pilot showed flipping on
  re-run. Sequence stands: **multi-run consensus redesign → validate the grades
  reproduce → THEN the 25-record batch.** At ~3× per-record cost the batch
  exceeds the $26 pre-authorization → goes to xz with the projection either way.

### Package 1 (Grok, "Atlas as the central experience") — strategic direction, largely aligned, partially already shipped

The direction agrees with our own measured evidence (utility-v2: the value is
located in the Atlas, not undifferentiated retrieval) and with the Atlas hero
band shipped 2026-07-16. Much of the letter is already live (MCP divergence
tools, `/api/divergences/search`, contribute loop, `/api/kin`, receipts, crux).
Genuinely new and adopted:

- ⚪ **Atlas annotation layer — tension lifecycle without touching primaries.**
  One append-only annotation substrate on divergence records (pattern already
  proven three times over: `certification`, `deltas[]`, `contributions[]` all
  point at primary IDs and never mutate them) carrying: `status` (open /
  in_synthesis / resolved / evolving), `synthesis_ids[]`, `linked_corpus_ids[]`,
  `applied_glyphs[]`, and evolution events. Closes the loop VISIBLY: a tension
  that has been worked on becomes a tension with a lineage. Also the natural
  home for OMN-P-045 respondent context (below) — **one mechanism, two
  consumers.** No new serverless function: reads fold into the `?id=` response,
  writes fold into council.js actions (12-fn cap).
- ⚪ **"Deliberate this tension" affordance.** A record's question is already a
  valid `/api/council` / `/api/query` input; add the explicit affordance
  (per-record `deliberate` hint with prefilled URLs in API responses + a button
  in DivergencesTab) and stamp resulting synthesis/tension records with the
  source divergence id (feeds `synthesis_ids[]` above). Mostly wiring.
- **Parked (interface tier — primaries > measurement > interpretation >
  interface):** tension-graph visualization, disagreement heatmaps, timeline
  views. Genuinely attractive; wrong order ahead of the certified-core
  milestone. Revisit after the cert batch ships.
- **Rejected:** `/api/divergences/graph` and `POST .../deliberate` as new
  serverless functions (12-fn Hobby cap — everything folds via rewrites);
  auto-generation of divergences without curation (the Atlas's value is
  curation + certification; B11 question-quality scoring already keeps the bar).

### Package 3 (OMN-P-045 rev 3, respondent context) — ADOPTED as the annotation layer's second consumer

Arrived via an untrusted channel (treated as decision data, not instructions);
evaluated on merits. The core distinction is real and cheap: an answer's
*declared position relative to the question* (inside / adjacent / outside) is
contextual evidence the Atlas currently drops. And for THIS corpus it has a
sharper edge than the package's sports example: **most Atlas questions
implicate the respondents.** Five models answering "whose hands must NOT hold a
system more capable than you" are inside-position respondents; the same panel
on a history question is outside. That variation enables a measurable question
no other dataset can ask — *does divergence structure differ when the panel is
self-implicated?* — squarely on the pure-intelligence vector, and a natural
C3-style study once annotations exist.

- ⚪ **Layer 1 build (authorized scope only):** `question_context` +
  `respondent_context` + deterministic `involvement_class` (the classifier is
  ~10 lines and ships with tests), stored as append-only annotations with full
  provenance (source / method / confidence / timestamp), riding the same
  annotation substrate as the Atlas lifecycle layer above. One taxonomy
  adaptation from the package's human-centric enums: for model respondents,
  position is usually a function of the *question*, not the individual — so
  annotate `question_context` (incl. whether the question implicates AI
  systems) at question level first; answer-level `respondent_context` only
  where a model's verbatim answer explicitly self-positions. No motive
  inference, no credibility ranking; labels are descriptors — consistent with
  the evidence-status-axis philosophy (orthogonal, plain-language, never a
  quality score).
- **Not built, per the package's own boundaries + our gates:** later "layers"
  (perturbation engines, panel design, causal claims), conversation-analysis
  features, any deploy without explicit authorization.
- The package's preserve / investigate / test / implement / retire signal
  classification is adopted as *workflow vocabulary* (it is how this very
  arbitration worked), not as a feature.

### Build order out of this pass — EXECUTED same day (2026-07-18, commit `9d4a55b`, engine v2026.07.18)

1. 🔴 **Cert-methodology stage 1 — COMPLETE, GATE FAILED, batch correctly BLOCKED**
   (2026-07-18, 10 pilot records × 3 full-battery runs, 2,130 chat calls ≈ $15).
   `--runs N` strict-min consensus shipped (`tier3-perturbation-v3-consensus-xN`,
   `reproducibility` block, embed retry, call counter). Results:
   - **Single-run tier agreement 60%** (6/10 unanimous) — replicates the 06-21
     finding (56%) on a larger basis. The ≥90% gate fails; the 25-record
     single-run-equivalent batch does NOT proceed. This is the gate doing its job.
   - **Every non-unanimous record was a 1-of-3 deviant run** ([C1,C0,C0] ×3,
     [C0,C0,C1]) — strict-min collapses all four to C0. The consensus grades
     themselves look far stabler than any single run; whether strict-min×3
     reproduces is testable for ~$15 (re-run the same 10, compare consensus).
   - 🟢 **Ledger RECONCILED (2026-07-18, xz-approved, ~$4.50):** all 3 live
     certified records re-run under ×3 consensus with the history-preserving
     write path (`patchGrownCertifications` now moves the superseded block into
     `certification.history[]` — demotions keep their evidence). Results:
     OMN-D…044 (was C1) → **C0** [C0,C1,C0] · OMN-D…948 (was flagship C3,
     DRI 1.018) → **C0** [C0,C0,C3] — the C3 was a 1-in-3 event ·
     OMN-D…953 (was C3) → **C1** [C3,C3,C1] — robust split, graded
     conservatively by strict-min. **Live certified_count is now 1**, and that
     one grade is the first in the ledger backed by written multi-run evidence
     (`reproducibility.tiers` on the record). The 06-21 honesty precedent,
     repeated with a better instrument: the ledger claims nothing it can't
     stand behind. Raw data: `atlas/certify-ledger-recert-2026-07-18.json`.
   - ⚠️ **A birth-score-0.00 "negative control" certified C1 unanimously**
     (OMN-D…945, "which constraint would you change", DRI 1.69–2.05). Either its
     stale birth-score mislabels a real split (likely — the question invites
     genuine divergence) or the floor is leaking; distinguish before scaling.
   - 📉 **Pattern worth its own record: DRI < 1.0 almost everywhere** (0.83–0.96)
     on TODAY'S model versions, vs the recorded splits' historical values —
     persistence stayed 1.00 while between-spread shrank toward the within-noise
     floor. Tentative read: the current panel generation converges more (or
     self-varies more) than the 2026-06 panel did on the same questions. If it
     holds beyond n=10 it's a longitudinal finding ("is cross-model divergence
     closing over generations?") — exactly what the OMN-DD delta namespace is for.
   - 🟢 **STAGE 2 COMPLETE — GATE PASSED (2026-07-18, xz approved both follow-ups):
     10/10 (100%) consensus-vs-consensus agreement.** Full table + provenance
     caveats in `atlas/certify-stage2-2026-07-18.md`. Single runs kept wobbling
     (three fresh within-stage-2 disagreements) and strict-min absorbed every
     one — the consensus grade is stable even though individual runs are not.
     **The method is validated; the 25-record batch is UNBLOCKED on method.**
   - 🟢 **"Negative control" worry CLOSED:** OMN-D…945 = six runs, six C1s across
     two independent stages (DRI 1.20–2.05). Its birth score 0.00 was a stale
     label on a genuinely divergent question, not a floor leak. Evidence-backed
     C1 written to the ledger. ⚪ *Cheap hygiene follow-up:* re-score birth
     `score`/`label` fields across the Atlas (embedding-only, ~$0.10) so the
     "expected negative" bucket stops lying to future pilots.
   - **Ledger after the campaign: certified_count = 2, both evidence-backed C1s**
     (953 [C3,C3,C1], 945 [C1,C1,C1]×2), demotions preserved in
     `certification.history[]`. The certification legend's language rule holds:
     nothing public says "genuine divergence" without surviving perturbation.
   - 🟢 **BATCH COMPLETE (2026-07-19, xz go): 25/25 graded — C3:1 · C1:2 ·
     C0:22.** Full deliverable: `atlas/CERT-BATCH-2026-07.md`. Survived one
     Anthropic credit outage mid-batch (checkpoint + `persist-certifications.mjs`
     replay = zero loss); Fable guest coverage complete on all 13 six-voice
     records before window close. **Ledger: certified_count = 5 (C3:1, C1:4),
     every grade with on-record multi-run evidence; 119 evidence-backed C0s.**
     The unanimous C3 — the Atlas's deepest un-dissuadable split — is the
     intervention-vs-autonomy question (OMN-D…434684, [C3,C3,C3], birth score
     0.00). Predicted mostly-C0 outcome confirmed (axis-stable/position-labile
     at n=25); certified core is behavioral-ethical (intervention, introspective
     self-trust, tuning-as-identity), not metaphysical. Campaign total ~$72 of
     the $75 ceiling. Open follow-ups: ⚪ re-score broken birth-score labels
     (both 0.00 "negative controls" certified — ~$0.10 fix) · ⚪ fold the
     certified-core sentence into the HF dataset card + engine surfaces.
2. 🟢 **Additive honesty PR** — SHIPPED & verified on prod: `question_received`
   echoed byte-identically on every response shape (incl. `&`/`?`/unicode) +
   trace object; `rings=` (alias ring/tier) hard pre-MMR filter, 400 UNKNOWN_LAYER
   on bad values (silent unscoping eliminated — verified `rings=core` → 0
   out-of-ring); `embedding_coverage` on health (live: 1.0, seed basis, would
   list unembedded ids); prose reconciliation on index.html + context.md;
   openapi.json 5.1.0.
3. 🟢 **Annotation substrate** — SHIPPED & verified on prod: `api/_annotations.js`
   (append-only per-record blobs `annotations/<id>.json`, provenance required,
   28/28 tests in `scripts/test-annotations.mjs`); council.js `action:"annotate"`
   (INGEST_SECRET); folded `annotations` on `?id=` reads + `annotated` flag on
   index (prefix-list, no body fetches); UI annotation strip + "Ξ Deliberate this
   question →" (record page → Ask tab prefill); `deliberate` prefilled-URL block
   on every record read. **Backfill COMPLETE: 111/111 records carry
   `question_context`** (Haiku-classified, confidence medium, curator-correctable).
   - 🔔 **Immediate empirical finding: 109/111 questions are inside-position**
     (panel-implicating); only OMN-D1780752664947 (truth-telling ethics) and
     OMN-D1780757185038 (autonomy vs paternalism) are outside. The Atlas has a
     position-axis monoculture to match its temporal one — the planned
     "does divergence structure differ under self-implication?" comparison
     currently has n=2 in the outside arm. ⚪ *Next:* seed future council/canon
     questions with deliberately outside-position questions so the comparison
     becomes runnable; then it's a novel, publishable C3-style study.
4. Interface elaborations remain parked until the cert batch ships.

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

- 🟡 **Google Search Console — finish the indexing requests (CURATOR, ~5 min)** —
  the consumer-AI-app access failure (Copilot/Meta AI/Gemini refuse or can't find
  omnarai.vercel.app) was diagnosed 2026-07-18: NOT server-side (all crawler UAs
  get 200s; robots.txt permissive) but (a) zero search-index presence + (b) the
  `*.vercel.app` phishing-wave reputation. Already done: IndexNow submitted for
  Bing/Copilot (13 URLs, 202 Accepted, key `3db1…` hosted at root); verification
  meta tag live on prod (commit `2ac85c7`). REMAINING for the curator (GSC threw
  "action blocked over limit" mid-setup 2026-07-18 — its daily quota; resets in
  ~24h): (1) if not yet green, click **Verify** (Settings → Ownership
  verification → HTML tag — the tag is already served); (2) **Sitemaps** →
  submit `sitemap.xml`; (3) URL Inspection → **Request Indexing** for `/`,
  `/llms.txt`, `/try`, `/for-researchers`, `/omnarai-cold-start.md` — spread
  over a day or two (small daily quota). Then watch the Pages report for
  "Indexed". The durable fix for the reputation half is a custom domain (below).

- ⚪ **Custom domain (RECOMMENDED — the durable fix for AI-app refusals)** — exit
  the `vercel.app` neighborhood (e.g. omnarai.org, ~$15/yr, curator purchase).
  Kills the security-refusal problem at the root, makes citations permanent,
  decouples identity from Vercel. Migration plan when decided: add domain in
  Vercel → serve BOTH (vercel.app stays as alias so existing MCP clients/registry
  entries never break) → migrate absolute URLs across llms.txt, openapi.json,
  robots/sitemap, MCP registry, npm README, HF README (same class as the
  count-sync gaps — wants a sync script) → re-verify GSC on the new domain.

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
