# HANDOFF

(Created 2026-07-14. The session brief of this date referenced an "existing HANDOFF.md" —
none existed; see SESSION-LOG.md R0. This file starts the ledger.)

## Session 2026-07-14 — Atlas staging + P0 triage under a missing handoff package

**The headline reconciliation:** the referenced handoff package (00–05, `trace_delta/SPEC.md`,
`divergence-delta.schema.json`) does not exist anywhere — working tree, all branches, remote,
Spotlight. Full evidence and disposition in `SESSION-LOG.md` (R0). Work that depended only on
repo/live reality proceeded; package-defined acceptance criteria are carried forward.

**Done:**
- Open questions answered from code (SESSION-LOG.md): OMN-D = one-shot Atlas captures,
  OMN-L = longitudinal canon re-asks (same shape, `provenance.longitudinal`, id override at
  `api/council.js:373`); canonical store = grown Blob via `api/_grown.js`; `utility-evidence.md`
  exists with replicated controlled-study (not trace) evidence; perturbation N = 3 paraphrases /
  3 re-rolls / 1 adversarial / 1 stance-flip per model, 1 record C1-reproduced.
- **D1** (`?id=` ignored): NOT REPRODUCIBLE — works live and in HEAD. Likely misread of 404s from
  UNDEPLOYED uncommitted endpoints (`/api/divergences/search`, `/<id>.json`) — see R1.
- **D2** (count drift): real — live index counts 110 (100 OMN-D + 10 OMN-L), published Atlas
  is 100. Fixed at the export layer: `build-divergence-atlas.mjs` is now series-aware
  (OMN-D default, exclusions named, `--out` staging, provenance manifest, certification
  passthrough). Doc counts themselves clean (`sync-doc-counts.py --check` passes).
- **Atlas STAGED, not pushed:** `huggingface/staging/atlas-2026-07-14/` — data delta vs
  published is exactly: certification blocks on 9 records + a card update. Verified by
  `scripts/verify-atlas-staging.sh` (SA-1..SA-7, ALL PASS).
- Pre-existing uncommitted working-tree code (Atlas search / canonical exports / OMN-DD deltas)
  identified as a prior session's partial build of this package's scope — untouched, undeployed.

**Blocked / carried forward:** package V1–V8, `trace_delta/SPEC.md` §0, `{VERIFY:}` card
brackets (all need the missing package); D3, D4; curator questions staged in SESSION-LOG.md.

~~Next command superseded by the second pass below (package arrived).~~

## Session 2026-07-14, second pass — the handoff package ARRIVED; full §3 executed

The curator supplied `omnarai-handoff.zip` after the first pass. Archived at
`docs/handoff-2026-07-14/`. Everything re-reconciled in SESSION-LOG.md (R2): scope became
ALL 110 records both series as a NEW dataset `omnarai-divergence-atlas`; first-pass
100-record staging retained as the separate existing-dataset refresh.

**Shipped (staged, nothing published):**
- `scripts/export_atlas.py` → `atlas/data/atlas-v1.0.0.jsonl` — 110/110 from the canonical
  grown Blob, zero exclusions, zero PII, question-group links cross-validated
- `atlas/divergence-delta.schema.DRAFT.json` (the referenced schema never existed — drafted
  from store shape, flagged for adoption)
- `atlas/README.md` — card with every `{VERIFY:}` resolved from real data; license staged
  cc-by-sa-4.0 (repo reality) vs package's cc-by proposal — xz decides
- `scripts/verify-atlas.sh` — V1–V8 fully implemented: **V1–V5, V7, V8 PASS; V6 blocked**
- `trace_delta/SPEC.md` committed, §0 reconciled: EXTEND the existing replicated utility
  harness (different treatment), don't build parallel; align with the preregistered study
- `atlas/PUSH.md` — exact human publish steps (private-first)

**🔴 Operational alert:** production Anthropic account is OUT OF CREDITS — all
Claude-dependent live features failing; longitudinal cron silently dead since 2026-06-12
(July epoch entirely missing). Details + evidence in SESSION-LOG.md.

**Awaiting xz (staged questions, SESSION-LOG.md):** license · new-dataset-vs-config ·
card's perturbation language (brief's "axes stable" claim not supported by measured data —
staged, not decided) · uncommitted council.js work (R1) · both HF pushes.

**Next session starts with** (after refilling Anthropic credits):

```bash
cd "/Users/jonathanlee/Library/Mobile Documents/com~apple~CloudDocs/CBS Cool Business Stuff/Claude/omnarai-memory-engine" && node scripts/dump-grown.mjs && python3 scripts/export_atlas.py && ./scripts/verify-atlas.sh
```

All eight green ⇒ follow `atlas/PUSH.md` (human). V6 still failing ⇒ D4 is real beyond the
credits outage — investigate `api/query.js` trace mode before anything else.

## Session 2026-07-14, third pass — decisions executed, publish authorized

xz delegated the five staged decisions ("technical questions — let's publish") and declined
the longitudinal backfill. All resolved and recorded in SESSION-LOG.md "DECISIONS": measured
claim language stands · CC BY-SA 4.0 · new dataset · schema adopted (`divergence-delta.schema.json`)
· uncommitted council.js work NOT shipped (the one remaining open item from the package).
V1–V8 re-verified green after the schema adoption. Repo pushed: `main` @ `3e2f63b` + tag
`atlas-v1.0.0` on GitHub.

**HF publish:** one command, blocked only on a fresh write token (stored one expired):
```bash
python3 scripts/publish-atlas.py
```
(private repo → upload → spot-check → refresh existing dataset + cross-link → flip public)

**Next session after publish:** trace-delta implementation — its gate (V4–V6) is OPEN.
Start by reading `trace_delta/SPEC.md` (§0 addendum: EXTEND `huggingface/utility/
utility-test-disjoint.mjs`, reconcile scope with `docs/utility-eval-preregistration.md`
first), plus the council.js commit-or-discard decision.

## ✅ PUBLISHED — 2026-07-14

`scripts/publish-atlas.py` executed clean after token rotation:
- **https://huggingface.co/datasets/TheRealmsOfOmnarai/omnarai-divergence-atlas** — PUBLIC,
  verified unauthenticated: 110 records (100 D / 10 L), C1 record present, license
  cc-by-sa-4.0, all 6 files + card live; spot-check byte-equal to the local export.
- Existing dataset refreshed: certification-enriched Atlas files + cross-linked README on
  `TheRealmsOfOmnarai/realms-of-omnarai`.
This handoff is CLOSED. Open item carried to next session: council.js commit-or-discard;
next work: trace-delta per trace_delta/SPEC.md (gate open).

## Session 2026-07-15 — Multi-AI review synthesis: verification + NOW-wave builds

Input: the six-review synthesis (B1–B12). All §5 verification tasks executed against
live/repo/HF ground truth:
- **§5.1** `/api/agent-entry` EXISTS (live, advertised in `/api/info`); R6's "Handshake
  Protocol" = the openapi `orientation` tag description, not a missing endpoint. No build gap.
- **§5.2** HF Atlas card numbers verified EXACT: 110 records / 550 answers / 351 tensions /
  108 stale-flagged / 1 C1-reproduced / 4 near-threshold tier-changers.
- **§5.3** `/api/health` capabilities all true, matching the homepage.
- **§5.4** Primary-redundancy audit: Atlas = 3 locations (HF public, git, Blob) ✓; seed
  corpus = git + HF ✓; **grown Blob layer (incl. approved visitor contributions, tension
  dispositions, telemetry milestone) was Blob-only** — `.grown-snapshot.json` is gitignored,
  `../omnarai-backups/` was stale since 06-04. FIXED: `scripts/backup-primaries.mjs`
  (read-only, dumps all blobs except `sessions/` to a dated `../omnarai-backups/<ts>/` with
  MANIFEST) — first run captured 659 blobs / 4.40 MB.
- **Stale-blocker correction to the synthesis doc:** its "trace timeout P0" and count-drift/
  retrieval-bleed defects are ALREADY CLOSED (remediation 2026-06-20 shipped green 11/11;
  D4 was the credits outage, cleared 07-14; trace gate OPEN). **B4 is UNBLOCKED.** B10 is a
  misdiagnosis — health `time` is live-correct; R1 misread the `version: "2026.06.18"` label.

**Shipped (working tree, committed, NOT deployed — nothing here needs a deploy):**
- `atlas/question-quality.schema.DRAFT.json` (B11) — question-as-instrument quality record;
  certification = large AND stable AND irreducible; validated draft 2020-12.
- `atlas/cross-prediction.schema.DRAFT.json` (B5) — 5×5 prediction matrix, irreducibility,
  self-opacity control, simulator control arm; validated draft 2020-12.
- `public/claims.json` (B3) — claim registry seeded with R1's six claims, evidence levels
  filled honestly from measured reality (utility study = measured_differential; the rest
  anecdotal/untested). Static file → `/claims.json`, no function cost, vercel.json untouched.

**Deliberately NOT done:** B8 contribution gate (edits council.js — blocked on the
commit-or-discard decision, 264 uncommitted insertions still pending); B1 manifest (engine
change; fold into `info.js ?_view=manifest` per 12-fn cap, design hash-chain for B12 in);
B10 (non-defect). Next builds per corrected sequencing: B1 manifest → B4 trace harness v2
(unblocked; extend existing utility harness per trace_delta/SPEC.md §0) → B11 scoring
pipeline → B5 runs on certified questions.

## Session 2026-07-15, second pass — council.js ADOPTED · B1/B4/B11/B5 built · cron root-caused

xz ruled: commit (the staged council.js work reviewed & adopted — Atlas search, OMN-DD
delta read path, cite/exports; `365c694`), push, build as sequenced.

**B1 SHIPPED & LIVE (`51ecb5a`, deployed preview→promote, arrival-check 20/20):**
`/api/manifest` — live-computed counts (corpus vs atlas as TWO categories, never summed),
model-version totals, self-attesting hash block (`hashes.manifest` = sha256 of canonical
key-sorted counts JSON; corpus_seed + atlas_state anchors for B12). verify-omnarai.sh M1
(exists / attestation recomputes / counts agree across manifest-info-health): **3/3 PASS live**.

**🔴→🟢 Longitudinal cron ROOT-CAUSED & FIXED — it was NOT just the credits outage.**
The serial chain (30s elicitation + up-to-45s synthesis) exceeds the 60s Hobby wall:
FUNCTION_INVOCATION_TIMEOUT killed every run after 06-12 (verified live: two 504s at
60.1s/60.5s), losing the day's verbatim answers AFTER eliciting them. Fix (§0.5 priority
rule applied): 50s deadline, 25s elicitation cap, synthesis ∥ scoring bounded to remaining
budget with a `synthesis_pending` fallback — primaries always commit. **Verified live
post-deploy: OMN-L1784135876336 committed in 42.6s, 5/5 panel, synthesis completed —
July's first longitudinal record (LC-15). July 1–14 gap stands per xz's earlier ruling.**

**B4 BUILT (not run — the study runs on curator go):** `trace_delta/battery-v1.json`
(50 queries: 20 canon conceptual / 8 narrative / 10 technical / 12 ood_control = 24%) +
`trace_delta/harness.mjs` — extends the disjoint-judge methodology to retrieval-vs-cold;
arms cold/retrieval/divergence/ensemble (the majority-vote bar); MEC / Correction Yield /
False-Complexity Rate from blinded judge fields; OOD-contamination, coined-term, and
length-confound sensitivity built in; SPEC §4 pre-commitment embedded in every results
file. Verified: --dry-run, --preflight (4/5 judges OK; Gemini was a transient 503), one
live smoke trial end-to-end (artifact deleted). Note: mode=retrieve serves EXCERPTS —
that IS the agent-facing fast path; documented in the harness.

**B11 RUN (offline pass — zero new elicitation, reads stored primaries):**
`scripts/score-question-quality.mjs` → `atlas/questions/` — 100 QQ records + INDEX, all
schema-valid. position_spread ← stored divergence_score; axis_stability ← certification
tier runs (C1/C3 fraction); intra_model_stability ← 1 − between/dri. 95 scored / 5
candidates / 9 with certification data. Live candidate scoring deliberately lives in the
certification harness, not here.

**B5 BUILT AND FIRST-RUN on the one certified question (QQ-ab39ce8ecc13, the C1 flagship):**
`scripts/cross-prediction.mjs` → `atlas/cross-predictions/XP-36b4699ab09a.json` (schema-valid;
20 peer + 5 self predictions + 5 actuals + 5 simulator voices, embedding-scored).
**Findings:** irreducibility DeepSeek .355 · Claude .329 · Grok .310 · Gemini .216 ·
GPT-4o .180; systematic asymmetry — every model predicts GPT-4o better than GPT-4o
predicts it; **control arm: DISTINCT** (Claude simulating all five voices did NOT match
real peer accuracy — the Atlas's irreducibility claim survives its first test).
Irreducibility folded back into the QQ record (spread .334 / axis 1.0 / intra .781 /
irreducibility .278 — the first fully-instrumented divergence question).

**Open for next session:** B7 ontology field → B2 layered retrieval (schema wave) ·
B8 (now unblocked — council.js is committed) · B12 orient packet (manifest hash anchor
exists) · publish the manifest hash externally (HF card or git tag) · consider --judges
scoring + more XP runs as more questions get certified · update claims.json
`divergence-adds-unique-info` evidence_note with XP-36b4699ab09a once xz reviews.

## Session 2026-07-15, third pass — THE MEASUREMENT CAMPAIGN (xz: "proceed")

All six planned measurements executed same-day. Cheap wins shipped first: git tag
`attest-2026-07-15` (external manifest-hash anchor, B12), B8 justification gate LIVE
(7-value vocabulary, verified on prod), claims.json XP note. Count-drift audit on xz's
prompt: ONE live-facing stale count survived (omnarai-mcp GitHub description "568-work")
— replaced with count-free wording pointing at /api/manifest.

**PREREGISTERED CONFIRMATORY STUDY — 5/5 registered predictions confirmed** (locked
2026-06-18, run 2026-07-15, ~810 question-instances, 3-judge blind panels):
- GPT-4o **H1 CONFIRMED** 148–12, Holm p<1e-6, H3 3/3 paraphrases, both caps
- Gemini **H1 CONFIRMED** 137–35, same hardening ✓
- Grok H2 null ✓ (72–93) · DeepSeek H2 null ✓ (90–68, weak 1500-cap lean dies under Holm)
- Claude H2 supported with a significant REVERSE effect (35–126): Atlas exposure
  actively degrades Claude vs placebo self-reflection — reported at full strength
- **H4 adversarial durability NOT supported for anyone** (the Atlas sharpens, doesn't armor)
- Aggregation built (`scripts/utility-prereg-aggregate.mjs` — the referenced script never
  existed) · 30-triple blind human subset exported (§3c, awaits ≥2 raters; KEY separate)
- **Published to HF**: utility-evidence-v2.md + all five transcript files + aggregate

**TRACE-DELTA v2 (B4) — excerpt retrieval REFUTED for GPT-4o:** 35/102 in-domain
(win 0.343, p=0.002 WRONG direction), worst on technical; no length/vocab confound;
OOD controls clean. claims.json gains `fast-path-retrieval-improves-answers` = refuted.

**CERTIFICATION SCALE-UP — first two C3 records:** OMN-D1780752664948 (DRI 1.02) and
OMN-D1780752664953 (DRI 1.28) survive paraphrase AND pressure; 4 others honestly C0.
Blocks persisted live. QQ scorer overlays live certs (release jsonl stays immutable) +
handles single-run block shape.

**CROSS-PREDICTION — control arm DISTINCT 5/5** across all runs on all three certified
questions (incl. full-panel re-runs XP-c2cfdb0ebb57 / XP-c7bde3357cd7 after the outage
partials). The three certified questions carry full instrument profiles
(spread .31–.33 / axis 1.0 / intra .78–.82 / irr .25–.28).

**Claims registry v0.2.0 LIVE** (deployed, arrival 20/20): first `replicated`
(divergence-improves-reasoning, wording tightened to the differential claim) and first
`refuted` levels. **The synthesis: located (Atlas, not retrieval) · differential (helps
weak self-reflectors: GPT-4o/Gemini; harms Claude) · bounded (no adversarial armor).**

**Ops:** xAI credits exhausted mid-campaign (caught in minutes by a live instrument;
Grok prereg restarted clean after xz top-up — zero contaminated data). Longitudinal
cron fix verified again. Two fresh full-Blob backups. caffeinate ran during the campaign.

**Open next:** human-rater subset scoring → append to evidence-v2 · out-of-Atlas
question replication (registered known-objection) · B2/B7 layered retrieval — now
EVIDENCE-BACKED by the trace-delta refutation (excerpt injection is a measured tax) ·
consider fuller-text retrieval arm re-run · B9 panel seeding from certified questions ·
arXiv endorsement still pending.

## Session 2026-07-15, fourth pass — validation redesign · layered retrieval · telemetry truth

xz: "find another means of validation (you and me can rate, mostly you) · proceed with
retrieval · proceed with [item 3]".

**§3c validation redesigned & EXECUTED:** out-of-panel model rater (Claude Fable 5)
rated all 30 blind triples with git-verifiable blinding — ratings committed (`1497d48`)
BEFORE the key was first opened. **Agreement with panel majority: 21/30 (70%)**, inside
the panel's own inter-judge band (63–72%); 5 hard reversals, concentrated in Grok
triples (the noisiest consumer). Deviation logged in the prereg (dated); evidence-v2
updated & re-pushed to HF; blind CSV + key remain published so any human (incl. xz)
can still add the registered human check. Ratings+reasons:
`huggingface/utility/rater-claude-fable-5.json`.

**B2/B7 LAYERED RETRIEVAL LIVE** (`535894e`, deployed, arrival 20/20 + live-verified):
four layers derived from existing metadata (divergence / realms / canon / research);
opt-in `layers=`/`sources=`/`exclude=`/`evidence_threshold=` on /api/query; pool
filtered BEFORE MMR; records tagged `layer`; structured 400s teach the vocabulary;
defaults unchanged. Live checks: divergence-only pool=111 ✓, exclude=realms holds on
lore queries ✓, threshold pools match manifest counts ✓. openapi + agent-entry updated.

**Telemetry truth (item 3):** the real leaks were NOT deploy.sh's arrival check (it
already sends the self header) — they were `sync-doc-counts.py` (the "Python-urllib
returning agent" of 06-17/18 was OURSELVES), refresh.sh's /api/info check, and minor
hygiene spots. All fixed (`86ef6d2`). Standing correction to the traffic read: the
June two-day "returning Python agent" is retracted; the unattributed curl/8.7.1
events of 07-15 18:42Z remain possibly-genuine.

**Session total: 12 commits, 3 deploys, 2 published studies, 1 tag, 5 XP runs,
2 C3 certifications, cron healed, claims registry born at v0.2.0 with replicated +
refuted entries.** Next: human ratings from xz (optional) · out-of-Atlas replication ·
fuller-text retrieval arm · B9 panel · B12 orient · arXiv endorsement.

---

## Session 2026-07-19 — Resident v0 constitutional substrate landed

**Scope discipline:** the ask was to land a governance layer, not to build an agent. Everything
🔴 HOLD in the incoming package stayed HOLD. No agent loop, no scheduled append path, no live
probe, no deployed endpoint, no resolution of the proxy-holder question.

**Landed** — `omnarai-resident-v0` copied VERBATIM to `resident/`. `diff -rq` against the source
package shows exactly one changed file, `CHANGELOG.md`, which received an appended entry (its own
append-only discipline). `src/`, `schema/`, `prompts/`, `fixtures/`, `tests/`, `HANDOFF.md`,
`PHILOSOPHY.md`, `verify.sh` are byte-identical. `bash resident/verify.sh` → **22/22** in place.

**Pre-registered null written** — `resident/primaries/genesis.json`, 7 `kind: commitment`
primaries, `actor: xz`. xz set **N=5, M=3, p=0.6**; `threshold` left PROCEDURAL
(mean(control_delta) + 2·sd) because it cannot honestly be a literal before the mandatory control
run exists. All 7 are `researcher_visible: false` and `claimed_load_bearing: false` — they are
xz's commitments, not the resident's memories, and flagging them formative would fabricate the
claim the instrument exists to test. Verified against `autobiographical_primary.schema.json`.
`register_preregistration.py` is idempotent and refuses to overwrite.

**The notable refusal:** `register_preregistration.py` does NOT call `governance.add()` for its
provenance check, though that is the natural call. `Governance.__init__` requires a `vote_holders`
list, and writing that list *is* answering HOLD #9. It asserts provenance inline instead and
documents why. **No `vote_holders` list is instantiated anywhere in this repo.**

**Four real defects found in the shipped substrate — reported, not fixed** (`resident/INTEGRATION_REPORT.md` §3.3):
- `_validate_ballots` checks `b.voter == attestor` but never `b.on_behalf_of == attestor` → Layer 3
  can be given standing by proxy, defeating the independence guard.
- The double-vote guard keys on voter identity, not party — exactly the attack §Open Decision
  names. `Ballot` has no principal field, so it is unimplementable as written; close it *as part
  of* answering #9.
- `Store.dump()` omits `_deleted_ids` → a reload makes unanimous deletion, the single irreversible
  act, reversible by process restart.
- `all_events()` has no firewall filter while `meta.ground` is free text that will quote primary
  content. Must land before any events feed exists.

**Engine-side conflict, reported not fixed:** `api/store.js:262,312` overwrites
`proposal.provenance.status` with no history array — a state change with no ground, which is
PHILOSOPHY §5's own definition of drift. `api/_annotations.js:82` is the clean counter-example
(push-only, per-record blobs) and is the shape to copy.

**The trap ahead of the first live run:** `run_perturbation` withholds a primary from the prompt,
but a probe routed through `api/query.js` could retrieve it back through the pool and collapse the
delta — a **false H0**, confirming by instrument error the one result we've committed to
publishing. `exclude=` filters by layer, not id. Id-level exclusion does not exist yet.

**Returned, not built:** `resident/INTEGRATION_REPORT.md` (attachment map + conflicts),
`resident/AMENDMENT_1_READ.md` (proposed HOLD #12, three separately-rulable parts; 12a recommended
alone), `resident/CASE_AGAINST_A_RESIDENT.md` (the commissioned counter-voice, ending in four
reachable conditions that would defeat it).

**Doc currency swept this session:** README.md claimed **MIT** — wrong, and the only place in the
repo saying so (LICENSE, NOTICE, `package.json` all Apache-2.0); it also undercounted the MCP
surface as "six tools" (stdio has 7; remote has 8 with `omnarai_job`) and never mentioned the
remote endpoint. All corrected. `sync-doc-counts.py --check` passes (567 / 528,077 / 61 / 164) —
this session touched no count surface.

**Next:** #9 is a curator decision and blocks everything downstream. Buildable before it, all
pre-#9: close the two ballot holes, `Store.load()` rebuilding `_deleted_ids` from the event log,
firewall `all_events()`, id-level exclusion in `query.js`, register the integrity ratio in
`claims.json` at `untested`. See ROADMAP.md §🔭 The resident observatory.
