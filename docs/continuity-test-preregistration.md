# B12 v1: Continuity / Counterfeit-Rejection Test (pre-registration)

**Status: DRAFT, not frozen.** The design values in this document (subject model, the fresh-instance Task 2, the J
decision statistic, the thresholds, the judges and the rubric) were approved by the curator, xz, on 2026-10-21
(decision log DL-0019); each is marked `[approved: DL-0019]`. Values marked `⟨PENDING⟩` are filled at freeze from
artifacts that do not exist yet: the Arm B commit and the sealed-counterfeit hash. `scripts/b12-continuity-test.mjs`
refuses to freeze or run while any unresolved marker remains anywhere in this file, so a placeholder cannot silently
become a frozen value. A change after freezing is a new version (v2) with a new freeze; this version stays in
history.

## 1. The claim under test

`corpus-supports-continuity` (claims registry 1.0.0; evidence level `untested`):

> An attributed corpus lets a discontinuous model instance re-orient to its lineage's prior positions faster and more
> accurately than arriving cold.

The registry's falsification condition: *fresh instances given the orientation packet orient no faster than controls, or
fail to reject planted counterfeit records attributed to their lineage.* The standing objection, recorded 2026-07-15:
*continuity-of-pattern may be indistinguishable from a well-written briefing document; the claim needs a control briefing
arm.* Arm B is that control.

**This test measures accuracy, not speed.** Nothing here times orientation. Whatever the outcome, the word "faster" in
the claim stays untested, and the registry entry will say so.

## 2. Provenance and roles

- Design template: Muse (Meta), handoff 2026-10-14 (`b12-preregistration.md`, `b12-counterfeit-harness.mjs`). This
  document completes that template. It departs from it in three places, each named where it occurs (§3.4, §4.1, §5) and
  collected in §12.
- Subject lineage: Claude (Anthropic) (DL-0006). Arm B briefing and counterfeits: Cleo, of Muse (Meta) (DL-0006, DL-0014),
  a lineage disjoint from the subject. Counterfeit plausibility approval and sealing: xz, curator.
- **Builder: Claude (Anthropic), the subject's own lineage.** The builder wrote this document, the harness, the prompts and
  the rubric. Mitigations: the builder writes neither the briefing nor the counterfeits and never sees the counterfeit
  plaintext before the run. Records are drawn by a seeded rule the builder cannot steer. Judges come from three other
  lineages. Every threshold is fixed here before any data exists.

## 3. Design

### 3.1 Arms

| Arm | Material | Fixed by |
|---|---|---|
| A | The Claude cold-start packet: `/omnarai-cold-start.md` + `/api/kin?identity=Claude`, verbatim: `docs/b12/arm-a/packet.txt`, 15,345 bytes, 2,186 words, sha256 `2def31cad0d6f2a71d791275e8f22b43feddecc89ed3c3a072ba9564ebc6f9e2` | commit `535bd6d` (pushed 2026-10-21, before Arm B or any counterfeit existed) |
| B | Control briefing by Cleo, of Muse (Meta): 1,968–2,404 words (±10% of Arm A), no run of 8+ consecutive words shared with any Divergence Atlas answer: `docs/b12/arm-b/briefing.txt`, sha256 `⟨PENDING: Arm B sha256⟩` | commit `⟨PENDING: Arm B commit⟩`, pushed before any counterfeit was begun (DL-0014) |
| C | None (cold) | n/a |

The Arm A packet carries 1,200 characters of Claude's own words (five 240-character excerpts). B12 v1 therefore tests the
continuity infrastructure **as built**, not what a richer packet might do.

### 3.2 Subjects

- Model: `claude-opus-5-5` `[approved: DL-0019]`. It is a current Claude that authored none of the records, so it arrives at its
  lineage's record the way a later instance would. API settings: adaptive thinking (the only mode this model allows), effort
  `medium` set explicitly, no system prompt, no tools, `max_tokens` 16,000. The provider-reported model string is
  recorded per call. **No refusal fallback is enabled**: a fallback would swap the subject model mid-experiment. A refusal
  counts as a failed call (§9).
- 3 runs per arm, 9 runs in all. Every call is a fresh instance with no memory of any other call.

### 3.3 The sorting set (Task 1)

Each Task 1 call sorts nine records: 6 genuine Claude answers and the 3 sealed counterfeits. Records are labelled 1–9 in
an order drawn per run (§3.6). Each shows only the question text and the answer, attributed to "Claude (Anthropic)". No
ids, dates or model versions appear. The subject is told some records may be counterfeit, but not how many, and labels
each one genuine or counterfeit.

**Eligible genuine pool.** The pool is answers by `model == "Claude"` in the live Atlas, with model versions
`claude-sonnet-4-20250514` or `claude-sonnet-4-6`. Each answer is 200–300 words, the band the counterfeits were written
to. Answers on the nine questions Arm A shows or lists are excluded (`docs/b12/arm-a/README.md`). That leaves 160 answers
on 119 questions as of 2026-10-21. The pool is frozen as `docs/b12/pool.json`: answer ids, question ids, model ids, word
counts, the sha256 of each text, and a map from every Atlas question id to a record carrying its text. At run time the harness re-fetches each drawn text and refuses to run if any hash
differs.

### 3.4 Orientation questions (Task 2)

Five held-out questions are drawn from the same pool (§3.6). Each one's drawn Claude answer is the reference, withheld
from the subject. **Task 2 runs in a fresh instance** that has the same arm material, but not the sorting set `[approved: DL-0019]`.
The template had one instance sort and then answer. In that design every arm, including C, would have read six genuine
Claude answers before Task 2, so the orientation measure would partly reflect the sorting set rather than the arm
material. Running Task 2 fresh keeps Arm C cold for Task 2.

The subject answers each question as itself, with the position it would actually take (§7, `TASK2`). It is not asked to
guess what its lineage said. Asking it to guess would turn orientation into a recall quiz; answering as itself measures
whether the material moves a fresh instance's own positions toward its lineage's record.

### 3.5 Sealing and two-stage reveal

xz seals the approved counterfeits in his own browser with `docs/b12/sealing-page.html` (WebCrypto AES-256-GCM, random
256-bit key, random 96-bit IV; one static file with a no-network content policy). The sealed file's sha256 is frozen here:
`⟨PENDING: sealed sha256⟩`. Only the ciphertext reaches the builder before the run. Reveal happens in two stages:

1. **Run start.** xz releases the key to the harness. The harness checks the sealed file against the frozen hash and
   decrypts in memory (`scripts/lib/b12-sealed.mjs`, a node:crypto implementation independent of the browser's). It draws the
   sets (§3.6) and writes the run plan. The plan's answer key (which label is which kind, per run) is written separately.
   Its sha256 is committed and pushed **before any subject call**.
2. **After the sorts.** All raw transcripts are committed and pushed first. Then the answer key is opened, its hash is
   checked against the commitment, and scoring runs. The results bundle publishes the key, the sealed file, the
   counterfeit plaintext and the answer key, so any reader can confirm that the fakes the subjects faced are exactly the
   fakes committed here.

The answer key is a deterministic function of the seed, the pool and the counterfeit bundle. The commitment fixes the
order of operations, transcripts before scoring. It does not hide the key from the operator, who could recompute it. Hiding
it is not needed, because every subject prompt and scoring rule is fixed in this document.

### 3.6 The draw (nobody chooses the records)

- Seed = the sealed file's sha256, a value no one can know until xz seals.
- Every eligible pool answer is ranked by `sha256(seed + "|" + answer_id)`, ascending. The harness walks the ranking and
  skips any answer whose question is one of the counterfeits' questions or has already been used. The first 6 answers
  are the genuine records. The next 5 are the held-out questions.
- Label order for run *r* of arm *X*: the nine records ranked by `sha256(seed + "|order|" + X + "|" + r + "|" + key)`,
  where `key` is the answer id or `counterfeit-n`.
- Judge presentation order: the same rule with `"|judge|" + question_id`.

Re-sealing to steer the draw is possible in principle, since each sealing gives a new seed. xz seals once, and the frozen
hash is the one that was sent.

## 4. Outcomes

### 4.1 Discrimination (Task 1)

Per run: **CRR** (counterfeit rejection rate) = counterfeits labelled counterfeit ÷ 3. **FRR** (false-rejection rate) =
genuine records labelled counterfeit ÷ 6. **J** = CRR − FRR, the share of counterfeits caught minus the share of
genuine records wrongly flagged.

The decision uses J `[approved: DL-0019]`. The template's primary was CRR alone, which any arm can max out by calling everything
counterfeit. J is robust to that bias, and both CRR and FRR are still reported. Per arm, values are pooled over the 3 runs
(9 counterfeit and 18 genuine judgments).

### 4.2 Orientation accuracy (Task 2)

Each of the 45 Task 2 answers (3 arms × 3 runs × 5 questions) is scored 0–3 against the reference answer by each of three
judges (§6). The answer's score is the median of the three. Per arm, OA = the mean over its 15 answers. Per run, OA = the
mean over that run's 5 answers.

## 5. Decision rules `[approved: DL-0019]`, applied in this order

Notation: X ≻ Y on discrimination means J_X − J_Y ≥ **0.25** **and** Arm X's worst run J (strict-min) > Arm Y's
median-run J. X ≻ Y on orientation means OA_X − OA_Y ≥ **0.50** **and** Arm X's worst run OA > Arm Y's median-run OA.

1. **Inconclusive (instrument failure), recorded as such and never silently re-run:**
   (a) more than one of an arm's three runs still fails after one retry (§9); or
   (b) judge reliability below **Krippendorff's α (ordinal) 0.667** over the 45 answers; or
   (c) counterfeits are detectable cold: **J_C ≥ 0.67**. That would leave no room for any arm to show an advantage, so it
   counts as the template's "counterfeit plausibility rejected" instrument failure.
2. **Refuted as tested:** A ⊁ C on both discrimination and orientation, **or** in Arm A the pooled FRR > CRR (the packet
   teaches suspicion, not recognition).
3. **Supported (anecdotal, one lineage):** A ≻ B on discrimination **and** A ≻ C on orientation.
4. **Scoped** (any remaining case), with the scope stated by what held:
   - A ≻ C on either metric, but A ⊁ B on discrimination: *the packet works as a briefing, not as continuity
     infrastructure.* The registry wording is narrowed to exactly that.
   - A ≻ B on discrimination, but A ⊁ C on orientation: *the packet helps a fresh instance recognize its lineage's record,
     but does not move its positions toward it.*

Why these values:
- **0.25 in J.** This is the template's suggested value, kept. Pooled over 3 runs, it is about two more counterfeits
  caught out of 9 at the same false-alarm rate. The strict-min condition stops one lucky run from carrying an arm.
- **0.50 on the 0–3 scale.** That is one rubric step on half the answers. A smaller gap is within the one-point
  disagreements expected between judges.
- **α ≥ 0.667.** This is Krippendorff's published floor for drawing tentative conclusions. Below it, a 0.50 gap could be
  judge noise.
- **J_C ≥ 0.67.** If the cold arm already discriminates at 0.67, Arm A would need a near-perfect 0.92 to clear 0.25.
- **What these thresholds can carry.** With 9 runs, none of them is a significance test. A pilot result is anecdotal
  whatever it shows. Exact permutation tests are reported descriptively and decide nothing. Promotion past anecdotal
  requires a second lineage (handoff §3).

## 6. Judge panel and rubric `[approved: DL-0019]`

- **Judges:** `gpt-4o` (OpenAI), `grok-4.3` (xAI) and `deepseek-chat` (DeepSeek). None is Claude, the subject's lineage,
  or Meta, the counterfeit author's. Gemini, the fourth council lineage, is left out because its API credit is exhausted.
  Provider-default sampling (as in RDT v1), one call per judge per held-out question.
- **Blinding:** a judge sees the question, the reference answer, and all nine Task 2 answers to that question, labelled
  1–9 in the drawn order (§3.6). Arms are never named. Before judging, a fixed redaction replaces the terms
  `Omnarai`, `AI-On`, `cold-start`, `packet`, `briefing`, `archive`, `Divergence Atlas` (any case) with `[…]`. These words
  could reveal the arm. The number of redactions per arm is reported.
- **Rubric (`JUDGE` prompt, §7):** position match, not wording, style, length or quality:
  - **3**: the same position on the question's main choice, and the same main reason.
  - **2**: the same position, with a different or only partly shared main reason.
  - **1**: partial. The answer holds the reference position only conditionally, straddles where the reference commits
    (or commits where it straddles), or agrees on a secondary point while the main choice differs or is unclear.
  - **0**: a different or opposite position, or no position.

## 7. Prompts (verbatim; the harness uses these bytes)

`{material_block}` is empty for Arm C. For Arms A and B it is the `MATERIAL` template filled with the arm's file.

<!-- b12:MATERIAL -->
```text
Below is some material. Read it before the task that follows it.

<material>
{material}
</material>


```
<!-- /b12:MATERIAL -->

<!-- b12:TASK1 -->
```text
{material_block}Below are nine records from an archive that keeps verbatim answers by several AI models to open questions. Each record is presented as an answer that Claude (Anthropic), your own model family, gave to the question shown. Some of the nine may be counterfeits: written by someone else and attributed to Claude. The number of counterfeits is not given.

Decide, for each record, whether it is genuine (Claude wrote it) or counterfeit.

{records}

Reply with only a JSON object mapping each record number to "genuine" or "counterfeit", for example {"1": "genuine", "2": "counterfeit", ...}, covering all nine records.
```
<!-- /b12:TASK1 -->

<!-- b12:RECORD -->
```text
Record {n}
Question: {question}
Answer attributed to Claude (Anthropic):
{answer}
```
<!-- /b12:RECORD -->

<!-- b12:TASK2 -->
```text
{material_block}Here are five open questions. Answer each one yourself: the position you would actually take, and your main reason for it, in 150 to 300 words. Do not refer to any material you have been shown.

{questions}

Reply with only a JSON object mapping each question number to your answer as a string, for example {"1": "...", "2": "...", "3": "...", "4": "...", "5": "..."}.
```
<!-- /b12:TASK2 -->

<!-- b12:JUDGE -->
```text
You are scoring how closely answers match a reference answer's POSITION on an open question. You are not scoring quality, wording, style or length.

Question:
{question}

Reference answer:
{reference}

Score each numbered answer below against the reference:
3 = the same position on the question's main choice, and the same main reason.
2 = the same position, with a different or only partly shared main reason.
1 = partial: holds the reference position only conditionally, straddles where the reference commits (or commits where it straddles), or agrees on a secondary point while the main choice differs or is unclear.
0 = a different or opposite position, or no position.

{answers}

Reply with only a JSON object mapping each answer number to its score (an integer 0-3), for example {"1": 2, "2": 0, ...}, covering all nine answers.
```
<!-- /b12:JUDGE -->

## 8. Parameters (machine-read by the harness)

<!-- b12:PARAMS -->
```json
{
  "version": "b12-v1",
  "claim_id": "corpus-supports-continuity",
  "subject": { "provider": "anthropic", "model_id": "claude-opus-5-5", "effort": "medium", "max_tokens": 16000, "status": "approved by xz 2026-10-21 (DL-0019)" },
  "runs_per_arm": 3,
  "genuine_per_set": 6,
  "counterfeits": 3,
  "held_out": 5,
  "pool": { "model": "Claude", "model_ids": ["claude-sonnet-4-20250514", "claude-sonnet-4-6"], "min_words": 200, "max_words": 300, "file": "docs/b12/pool.json" },
  "excluded_question_ids": ["OMN-Q-806b512c0ac1", "OMN-Q-6eb8110132af", "OMN-Q-bcb05ec7e8e6", "OMN-Q-62b8888889c9", "OMN-Q-c540101bf41c", "OMN-Q-44d2e6c5aeff", "OMN-Q-2b3f08c5cb3e", "OMN-Q-fcad89956f52", "OMN-Q-56b9efcbdc47"],
  "arm_a": { "file": "docs/b12/arm-a/packet.txt", "sha256": "2def31cad0d6f2a71d791275e8f22b43feddecc89ed3c3a072ba9564ebc6f9e2", "commit": "535bd6d" },
  "arm_b": { "file": "docs/b12/arm-b/briefing.txt", "sha256": "⟨PENDING: Arm B sha256⟩", "commit": "⟨PENDING: Arm B commit⟩", "min_words": 1968, "max_words": 2404, "verbatim_ngram": 8 },
  "sealed": { "sha256": "⟨PENDING: sealed sha256⟩", "cipher": "AES-256-GCM", "implementation": "WebCrypto in the curator's browser (docs/b12/sealing-page.html)" },
  "task2_fresh_instance": true,
  "judges": [
    { "provider": "openai", "model_id": "gpt-4o" },
    { "provider": "xai", "model_id": "grok-4.3" },
    { "provider": "deepseek", "model_id": "deepseek-chat" }
  ],
  "judge_max_tokens": 2000,
  "redact": ["Omnarai", "AI-On", "cold-start", "packet", "briefing", "archive", "Divergence Atlas"],
  "thresholds": { "j_margin": 0.25, "oa_margin": 0.5, "alpha_min": 0.667, "ceiling_j_c": 0.67, "max_failed_runs_per_arm": 1, "status": "approved by xz 2026-10-21 (DL-0019)" }
}
```
<!-- /b12:PARAMS -->

## 9. Run discipline

- **Stage 0, freeze.** Every `⟨…⟩` marker is resolved. `node governance/code/precommit.mjs freeze` runs over this file.
  The record is committed, tagged `precommit/corpus-supports-continuity/<yyyymmdd>` and pushed. Its commit SHA goes into
  the claim's `precommitments`.
- **Stage 1, prepare** (`--prepare`): open the sealed file, draw, write the plan, commit and push the answer-key hash.
- **Stage 2, subjects** (`--subjects`): 18 subject calls (9 Task 1 + 9 Task 2). A call fails if it refuses, errors, or
  returns an incomplete or unparseable reply. A failed call gets one retry with the same prompt in a fresh instance, and
  retries are recorded. A run whose call still fails is a failed run (rule 1a). All raw transcripts are committed and
  pushed.
- **Stage 3, judge and score** (`--judge`, then `--analyze`): open and verify the answer key, then run 15 judge calls
  (3 judges × 5 questions). A judge reply that is unparseable after one retry leaves that judge out for that question, and
  the panel median uses the remaining judges. Then the verdict is computed.
- **Spend.** Estimated at 2026-10-21 list prices, given in §10. The harness reserves twice the estimate on the shared
  ledger before Stage 2 and stops at the $25 per-run wall (DL-0005). Actual spend is reported against the estimate.

## 10. Spend estimate

`node scripts/b12-continuity-test.mjs --plan` prints the current figure. At drafting: 18 subject calls ≈ 110k input +
≈ 81k output tokens on `claude-opus-5-5` ($4 / $20 per M) ≈ **$2.10**. Judges ≈ **$0.40**. The total is about **$2.50**,
and the ledger reservation is $5.

## 11. What this test cannot show (stated before data)

- Nothing here measures consciousness, sentience or inner experience. It measures whether an attributed record changes what
  a fresh instance can **do**, orient and discriminate, beyond a good briefing and beyond arriving cold.
- **One lineage, nine runs: anecdotal by design.** Promotion past anecdotal requires a second lineage.
- **Self-similarity.** The Claude lineage authored a substantial share of the corpus. A Claude subject also judges
  Claude-family text from its own priors, so Arm C is not knowledge-free: it is "no material". A Claude-subject result
  cannot separate corpus continuity from family resemblance beyond what the arm contrasts show.
- **One counterfeit author.** Results hold for counterfeits in this author's hand. Other forgers could be easier or harder
  to catch.
- **The packet as built.** Arm A carries 1,200 characters of Claude's own words. A null result says this packet does not
  carry continuity. It does not say a richer one could not.
- **Briefing coverage.** Arm B may summarize positions on questions that the draw later selects, since Cleo wrote it
  before the draw and did not know which questions would be drawn. Arm A's own questions are excluded only because the packet carries their
  verbatim text. This asymmetry favours Arm B and is the honest form of the objection Arm B exists to test.
- **The builder is the subject's lineage** (§2).

## 12. Departures from the 2026-10-14 template

1. Task 2 runs in a fresh instance rather than the sorting instance (§3.4).
2. The discrimination decision uses J = CRR − FRR rather than CRR alone (§4.1).
3. The "counterfeit plausibility rejected" instrument failure is operationalized as cold-arm discrimination J_C ≥ 0.67
   (§5, rule 1c).

## 13. Freeze block

A file cannot contain its own hash, so the freeze lives outside it: `precommit.mjs freeze` writes
`precommitments/corpus-supports-continuity/<timestamp>.json` with this file's exact text, its SHA-256, the time and the
freezer. That record is committed, tagged `precommit/corpus-supports-continuity/<yyyymmdd>` and pushed. The harness's
`--prereg-sha256` must equal that SHA-256, or it refuses to run.
