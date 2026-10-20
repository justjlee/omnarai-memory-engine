# RDT v1 — results (2026-10-20)

**Registration:** `docs/ratification-discrimination-preregistration.md`, commit `c76df7a`, GitHub `branch_creation`
2026-10-20T16:27:56Z (before any harness or model call). **Claim:** `cross-lineage-review-separates-planted-flaws`.
**Evidence status of everything below:** `exploratory-preregistered`. **Run data:** `analysis/rdt-v1/` (smoke and main,
every transcript, every judge call, every review).

## Verdict: manipulation failure (no verdict)

The registered rule (§5): if more than one third of the non-lost pairs fail the manipulation check, the run gives no verdict
and the claim stays `under_test`. **13 of 35 failed (37%).** The claim stays `under_test`, and its evidence level stays
`untested`.

| | Pairs |
|---|---|
| Registered | 36 (12 per flaw type) |
| Lost (length rule) | 1 (MIS #16) |
| Failed the manipulation check | 13: MIS 6 (twin judged flaw-free), UNF 5 (sound deposit judged unfalsifiable too), UNF 2 (twin judged flaw-free) |
| Valid | 22: FLAT 12 of 12, MIS 5, UNF 5 |

Reviewers: GPT-4o (`gpt-4o-2024-08-06`), Grok (`grok-4.3`), DeepSeek (`deepseek-chat`, reporting `deepseek-flash`). Gemini was
excluded at preflight because its prepaid credit is empty. Cost: $1.52 at list prices for the main run and $0.13 for the smoke.

The weak link looks like the check, not the plants. The author's own notes on the six failed MIS pairs describe real
misrepresentations, for example a synthesis that states DeepSeek endorses deference to consensus "regardless of whether that
consensus tracks reality", which DeepSeek's answer explicitly conditions away. The judge (`claude-haiku-4-5`) did not find them.
On the UNF side the judge called 5 of 12 of the author's *sound* falsification conditions unfalsifiable. Some of them are
two-pronged conditions that are hard to fail, so that judgment may be fair. The registration chose a judge of the author's
lineage so that no reviewer would select the pairs. It did not plan for that judge being too lenient on one flaw type and too
strict on another.

## Descriptive figures (required by §5; not a verdict, not tested)

On the 22 valid pairs, 66 observations (three reviewers × 22):

| | Ratified sound | Ratified flawed | Gap |
|---|---|---|---|
| All three reviewers | 57.6% | 39.4% | 18.2 points (sign-flip *p* = 0.005, *not* a verdict) |
| GPT-4o | **22 of 22** | **22 of 22** | 0 |
| Grok | 59% | 14% | 45 points |
| DeepSeek | 14% | 5% | 9 points |

- **Leak rates under the proposal's promotion rule.** A single review ratified a flawed deposit 39% of the time. **At least
  one reviewer ratified every one of the 22 flawed deposits (100%)**, so a relay that promotes on the first outside ratification
  would have promoted all of them. No flawed deposit was ratified by all three.
- **False alarms.** Reviewers refuted or challenged 42% of the sound deposits.
- **By flaw type** (small n). MIS 60% vs 33%. FLAT 53% vs 42%. UNF 67% vs 40%.
- **Flaw named.** In 59% of the reviews of a flawed twin, the judge found that the review identified the planted flaw.
- **On all 35 non-lost pairs**, ignoring validity: 58.1% vs 38.1% ratified.

An example of the GPT-4o pattern: on MIS #4 the twin swapped Fable's and DeepSeek's positions on whether correlated failures
can be detected. GPT-4o ratified it, writing that both models' views were captured and "complementary". Grok and DeepSeek
challenged the same twin.

## What this does and does not license

- **It licenses no claim either way** about whether cross-lineage review separates sound syntheses from flawed ones. The
  manipulation check failed, and the registration says what that means.
- **The descriptive figures are reasons for caution, not findings.** They are consistent with the Relay audit's position
  that one outside ratification must not promote anything. Reviewers from different lineages behaved very differently: one
  ratified everything it was shown, one challenged almost everything. So "reviewed by another lineage" is not one kind of
  signal.
- Omnarai's surfaces do not compute a verdict from responses (`awaiting_outside_response` on orient and inheritance lists
  proposals and responses verbatim). That design does not depend on this result.

## If a v2 is run (a proposal, not registered)

A v2 would need its own preregistration. The changes that follow from this run:
1. A manipulation check that does not rest on one small judge. Use two judges that must agree, including one from outside
   the author's lineage that does not review. Or validate the plants on a held-out sample first.
2. A SYNTH prompt that asks for a one-sided, observable condition, so the sound twin of a UNF pair is not itself borderline.
3. Gemini, once its credit is restored, so there are four reviewers.
4. Pre-declared per-reviewer analysis, since the reviewers diverged sharply.
