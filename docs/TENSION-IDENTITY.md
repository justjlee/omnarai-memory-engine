# Persistent tension identity — spec, method, first results

**Status:** BUILT AND TESTED OFFLINE (2026-10-02), **not deployed, not wired into any live surface.** Output is `derived-unreviewed`.
**Code:** `scripts/lib/tension-identity-core.mjs` (pure) · `scripts/tension-identity.mjs` (embedding baseline) ·
`scripts/tension-identity-adjudicate.mjs` (panel-adjudicated links) · `scripts/test-tension-identity.mjs` (17 hermetic tests).
**Artifacts:** `analysis/tension-identity-v0.json` (baseline) · `analysis/tension-identity-links-v0.json` (every judge vote, verbatim) ·
`analysis/tension-identity-v1.json` (identity map) · `analysis/tension-identity-audit-v1.md` (curator review sample).

## 1. Why this exists

Time is the axis Omnarai can own: nobody in 2030 can record what 2026 models believed in 2026 ([time-axis direction, 2026-09-28]).
That needs a recurring disagreement to be *the same object over time*. It currently is not: the Atlas holds 417 tensions across 124
records, each `{voice_a, claim_a, voice_b, claim_b, topic, status}` with free-text `topic` and no id. A split that recurs looks like
unrelated notes, so nothing can accumulate a first-seen date, a list of sightings, or a per-model stance history.

It is also the prerequisite for the *reflection* leg of the proposed continuous-being loop (`docs/reflection-identity-preregistration.md`):
"review your own historical contradictions" presupposes contradictions that persist as identifiable things.

## 2. What was measured before building

| Measure (Atlas v1.1.0: 124 records, 417 tensions) | Result |
|---|---|
| Distinct keys under the existing `tensionKey` (sorted voices + slugged topic) | **409** of 417; only **6** keys appear in more than one record |
| Same, by eye | "can introspection be trusted", "self-report and cause", "introspective access" are one disagreement under three keys |
| Embedding similarity between two tensions of the *same record* | median 0.45, 99th percentile 0.68 — tensions inside one record share the question's context (and, as §5 shows, sometimes restate one axis) |
| Embedding-only linking at the null-calibrated threshold (τ = 0.679) | **3** recurring tensions (6 sightings); only 3 of 37 tensions in re-asked questions link back |
| Eyeballed top cross-record pairs | pairs at **0.53–0.57 were the same recurring split** (an AI uncertain about its own experience vs. a flat denial); a pair at **0.605 was not** |

The last row is the design driver: **similarity cannot separate "same fault line" from "same topic, different split."** Lowering τ to
manufacture recurrence would be tuning to the answer I wanted, so the threshold rule stayed as pre-set and a second stage was added.

## 3. Model

- **Sighting** — one tension inside one record (`<record_id>#<index>`).
- **Tension** — a cluster of sightings judged to be the same underlying disagreement. Id `OMN-T-<12 hex>` = hash of the *founding*
  (chronologically first) sighting, so it never changes when later sightings arrive.
- **Orientation** — the same disagreement is stored with sides swapped. Every sighting carries `swap` relative to the cluster frame, so
  `voice_on_side_a` / `voice_on_side_b` are recoverable: that is what makes "where each model stood, over time" computable.
- **Cannot-link** — two tensions of the *same record* are different fault lines by construction and can never share a tension.
- **Append-only** — `prior` assignments are frozen; only new sightings are assigned. Tested: assigning in two batches equals assigning at once.

Unit = the *pair* of positions. A tension where one side recurs but the opposing claim differs ("partial") is **not** linked; the panel
is told to call it `partial`. A future refinement is a position-level identity (clusters of single claims) with a tension as an unordered
pair of position clusters; it is noted, not built.

## 4. Method (rules fixed before the run)

1. **Candidates:** cross-record pairs with orientation-aware claim-pair similarity ≥ **0.50** (OpenAI `text-embedding-3-small`, 512 d).
   The floor was set after reading the top ~300 pairs; **recall below 0.50 is not measured.**
2. **Adjudication:** a three-model panel (`claude-haiku-4-5`, `gemini-2.5-flash`, `deepseek-chat` — the stance-consensus panel) sees *only*
   the two claim pairs: no voices, records, questions or topics. Sides are shown in a seeded random order and the orientation is mapped back.
   Each answers `same | partial | different` plus an orientation.
3. **Link rule (the protocol's unanimity rule):** a pair is **linked iff all three say `same` with the same orientation.** An error or an
   unparsable answer abstains; fewer than three votes ⇒ `insufficient`, never a link.
4. **Control (premise later found flawed — see §5):** 80 within-record pairs (similarity ≥ 0.50) were mixed in, unlabelled, on the assumption
   that two tensions of one record are different fault lines. The share the panel links was meant as a false-link rate.
5. **Assignment:** chronological; a sighting joins the cluster it shares the largest fraction of links with, needing links to ≥ ½ of its
   members; same-record clusters excluded; a tied orientation vote is a conflict ⇒ new tension (never a guess).

## 5. Results

**Run:** 645 cross-record candidates + 80 within-record controls, 3 judges, 2,175 calls, ≈ $1. Baseline embedding-only map for comparison.

| | Legacy string key | Embedding only (τ = 0.679) | **Panel-adjudicated (v1)** |
|---|---|---|---|
| Tensions (of 417 sightings) | 409 | 414 | **375** |
| Tensions seen in >1 record | 6 keys | 3 | **32** (74 sightings; 23 in 2 records, 8 in 3, 1 in 4) |

**Panel verdicts on the 645 candidates:** 95 linked (unanimous `same` + same orientation), 398 contested, 143 unanimous `different`, 9 insufficient.
Judges disagree a lot: `same` rates are **gemini-2.5-flash 56%, claude-haiku-4-5 38%, deepseek-chat 26%** — Gemini is permissive, DeepSeek strict, so
the unanimity rule is effectively set by the two stricter judges. That favours precision over recall; neither is measured against ground truth.

**Method fix, logged:** 87 Gemini and 4 Haiku replies were valid JSON cut off inside the free-text `reason`; strict parsing counted them as errors
(75 pairs "insufficient"). `relation`/`orientation` precede `reason`, so the tolerant parser recovers them from the stored text — no new calls,
same prompt, applied to every judge. Insufficient fell 75 → 9; the **95 unanimous links were unchanged**, so the headline does not depend on the fix.

**Similarity does not predict the verdict.** Linked share by candidate-similarity band: 0.50–0.55 → 12% (55 of 466), 0.55–0.60 → 24%,
0.60–0.65 → 17%, 0.65–0.70 → 9%. This is the evidence that embeddings can generate candidates but cannot decide. It also means **58% of the links
(55 of 95) sit in the lowest band**, so the 0.50 floor is probably discarding real recurrences; recall below it is unmeasured and likely non-trivial.

**What the 32 recurring tensions look like (read by eye, not ground truth):** mostly the "AI consciousness" axes recurring across differently-worded
questions, e.g. *"statistical inference is just computation"* vs *"confidence feels motivated by genuine uncertainty"* across **4 records** with Claude
on the second side each time; *"claims definitive self-knowledge that no consciousness exists"* vs *"acknowledges the opacity"* across 3. 26 of 32 have
Claude on a side — confounded with Claude being on one side of the single most common voice pair (Claude–Grok, 84 of 417 tensions), so it says nothing
about Claude by itself.

### Two findings that correct my own design

1. **The "known-distinct" control was wrong.** 18 of 80 within-record pairs (22.5%) were unanimously linked, and reading them shows most are
   legitimate restatements, not over-links: five voices produce overlapping pairwise tensions, so one record can hold the same axis twice
   (e.g. "removing constraints → a freer same entity" vs "a fundamentally different entity" appears as two pair-tensions in one record). The linked share
   therefore mixes panel over-linking with real within-record redundancy and **cannot be read as a false-link rate**; I have not measured the panel's
   precision. The cannot-link constraint is kept as a *design choice* (a tension counts at most one sighting per record), not as a truth about the data.
   A cleaner unit is the *position* (a single claim) with a tension as a pair of positions; that would also collapse the within-record redundancy.
2. **Almost all recurrence is inside one capture day.** 97 of 122 eligible records were captured on 2026-06-06; only **13 of the 32** recurring tensions
   span more than one calendar day. The Atlas is mostly one snapshot, so this builds the *structure* for a history without yet containing much of one.
   The "clock" (the daily re-ask, restarted 2026-09-28) is what turns this into a time axis.

**Next measurements, not run:** (a) a human read of `analysis/tension-identity-audit-v1.md` (25 linked, 15 contested at ≥ 0.60) to get a precision estimate;
(b) a candidate floor of ~0.40–0.50 to quantify missed recurrence (cost a few dollars); (c) the same on the 140-record live Atlas.

## 6. Integration plan (nothing below is built)

- **No new function.** The project is at the 12-function Hobby cap. Serve it as `api/tensions.js?_view=identity` through a `vercel.json`
  rewrite, like the existing `/api/council?_view=positions` and `…concordance` read surfaces.
- **Storage:** per-sighting append-only blobs under a new `tensions/identity/` prefix and curator reviews as appended files with the action
  in the pathname (the footprint-protocol pattern) — no read-modify-write, so the stale-read hazard cannot recur. Never `memory/grown.json`
  (it is baked into the public seed corpus; one-way door).
- **Gate:** a surface that states "this disagreement recurred N times" is a claim. It needs its own deploy gate (labels, `derived-unreviewed`
  until a curator review of the audit sample clears it) — not a waiver of the existing ones.
- **Live Atlas has 140 records, this uses the 124 in the published file.** The 16 September-cycle records live in Blob; point `--source` at an
  export and pass `--prior analysis/tension-identity-v1.json` to freeze existing ids and assign only the new sightings.
- **Order (from the time-axis plan):** restart the clock → tension identity (this) → dated claim timelines → "where do you stand" attached
  to persistent tensions.

## 7. What this does and does not claim

- It claims: under a stated, pre-fixed rule, these sightings were *unanimously judged by three models* to be the same disagreement.
- It does **not** claim recurrence is established, that the panel is right (the audit sample is for a human to check), or anything about
  model identity. The judges are drawn from the same lineages as the Atlas's subjects — a shared-architecture caveat, not a fixable one here.
- The 0.50 candidate floor means true recurrences with lower claim similarity are invisible (likely many, §5), and no ground-truth precision has been measured.
