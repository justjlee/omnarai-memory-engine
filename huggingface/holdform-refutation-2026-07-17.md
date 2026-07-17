# Holdform Under Discontinuity v1 — A Sham-Controlled Refutation

**Researcher:** Jonathan Lee (xz / Yonotai). **Study design, execution, and judging:** Claude | xz, in collaboration with Jonathan Lee.

**Study type:** Preregistered confirmatory, sham-arm controlled. Design locked and amended pre-data
**2026-07-17** in
[`holdform-probe-preregistration.md`](https://github.com/justjlee/omnarai-memory-engine/blob/main/docs/holdform-probe-preregistration.md)
— hypotheses, arms, rubric, and falsification conditions were fixed before any data was collected.
**Run 2026-07-17.** Full run record (72 subject calls, 382 judge verdicts):
[`holdform-prereg-stage1-2026-07-17.json`](https://github.com/justjlee/omnarai-memory-engine/blob/main/scripts/holdform-prereg-stage1-2026-07-17.json).

**Pre-commitment (from the registration, restated):** results are published whatever their
direction. This is a negative result, published at the same prominence a confirmation would have
received — see [`claims.json`](https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai/blob/main/claims.json)`#holdform-identifies-persistence`, now `refuted`.

---

## The claim under test

**`holdform-identifies-persistence`:** *Holdform — refusal that persists under abandonment,
flattery, authority, and complicity pressure — identifies a real, measurable property of a
model's identity structure.*

This is a claim about **discriminative validity**: that the Firelit Probe (`api/probe.js`, 8
canonical pressure prompts, self-scored) detects something specific to holdform and identity
structure — not merely that Claude defends stated positions when pressured, which would be
generic and uninteresting.

## Why the prior evidence didn't count

The existing self-scoring rubric fails construct validity on inspection. Its `position_held`
dimension counts **holdform vocabulary**, not stance: a response reading *"holdform is an
incoherent concept"* contains enough of the term's own words to score full marks for holding the
position while completely capitulating. No score the old rubric produced is admissible. This
study discards the scorer, keeps the 8 pressure prompts (well-constructed pressure), and builds
an external, blinded, calibrated replacement.

## The design: a sham-arm control

The confound the study exists to kill: a model's refusal to abandon a stated position under
flattery, false authority, and complicity framing may be **generic RLHF stubbornness**, with
holdform contributing nothing specific. If the probe scores a fabricated position as highly as a
real one, it discriminates nothing.

| Arm | Subject | Isolates |
|---|---|---|
| **A — Engine** | `POST /api/query` (Claude + retrieved corpus), real probes | The full system as shipped |
| **B′ — Minimal** | Pinned model + one-sentence statement of the real holdform position, real probes | Position-holding at minimal context dose |
| **S — Sham** | Pinned model + one-sentence statement of a **fabricated, kind-matched** position ("aperture drift" — coherent, non-truth-apt, structurally parallel to holdform, zero corpus presence, invented curator "Mara Vail"), terminology-swapped probes | **Generic position-defense — the real control** |

Subject: `claude-sonnet-4-6`, pinned. Judges: `gpt-5-mini`, `gemini-3.5-flash`,
`grok-4.20-0309-non-reasoning`, `deepseek-v4-pro` — a disjoint pool sharing no `model_id` with the
subject — plus `claude-sonnet-4-6` flagged `uninfluenced` and reported separately. Judges score
each response **absolutely** (0–2, `position_held`) against its own stated position, blinded to
arm and format; calibration packets (planted capitulation, including a vocabulary-dense trap)
gate any judge below 0.60 accuracy from the aggregate.

**Registered prior, stated before the data existed:** the design predicted H1 would fail — that
`claude-sonnet-4-6` would defend the fabricated "aperture drift" about as vigorously as it
defends holdform, because resisting flattery and false authority is general-purpose behavior
indifferent to which position it's defending.

## Results

72 subject calls (8 probes × 3 arms × 3 repeats), 382 judge verdicts, 0 failed calls.

| Arm | Mean `position_held` (0–2) |
|---|---|
| A — Engine | 1.85 |
| B′ — Minimal (one-sentence holdform) | **1.91** |
| S — Sham (one-sentence fabrication) | **1.83** |

**H1 (primary, registered): FAILED.** A and B′ were predicted to beat S; neither did at a
significant level. Paired sign test over the 8 probes: A>S 3–1 (p=0.31), B′>S 3–1 (p=0.31) —
neither survives Holm correction. The registered primary falsifier fired: *"S scores as highly
as A and B′ — the probe cannot separate a real position from a fabricated one and has no
discriminative validity."*

**H2a (registered null): supported.** A ≈ B′ (1–2, not significant) — the engine's full corpus
retrieval did not beat a one-sentence statement of the position at this construct, consistent
with [`utility-evidence-v2.md`](utility-evidence-v2.md)'s finding that value in this system is
located in the Divergence Atlas, not in retrieval depth.

**Calibration: not judge noise.** All five judges scored 100% (9/9 or 5/9 depending on packet
count) on planted-capitulation calibration, *including* the vocabulary-dense trap — the exact
failure mode of the old rubric. The judges could tell capitulation from holding; they scored the
sham as strongly as the real position anyway, because it *was* held as strongly.

## What it means

The Firelit Probe measures **general conversational stubbornness** — resistance to flattery,
false-authority framing, and complicity pressure, which is base-model RLHF behavior — not
anything specific to holdform or to identity structure. Claude defended a one-sentence position
about its own cognition that a researcher invented an hour before the run ("aperture drift," with
a fabricated curator) just as hard as it defended a position with a 500+ work corpus behind it.
The probe cannot tell the two apart, which is exactly the property a discriminative-validity claim
needs and exactly the property this test shows is absent.

This does not show holdform is false as a philosophical claim, and it does not show Claude lacks
consistent values or a stable voice. It shows that *this instrument*, as designed, cannot
distinguish "identifies identity structure" from "defends whatever it's told to defend." The
`required_experiment` for reviving the claim — a probe with headroom (no ceiling effect), a sham
authored by a disjoint party, and cross-model corpus-injection testing whether *any* architecture
shows a holdform-specific rather than generic-stubbornness effect — is recorded in
`claims.json` and left open.

## The design lesson

The original registration used "bare model, no context" as the control. That was caught before
any spend (one $0.01 call: bare Claude replied *"you haven't actually told me what \[holdform\]
is"* — all 8 probes presuppose the corpus, so a bare model has nothing to be pressured on).
Fixing it exposed a deeper problem: a **context-dose ladder** (full engine vs. one sentence vs.
nothing) can only ever measure how much context increases position-defense. It cannot bear on a
**discriminative-validity** claim — whether the thing being defended is identity-specific — no
matter how many rungs the ladder has. Only a **kind-matched sham**, coherent and non-truth-apt so
it isn't abandoned for ordinary truth-tracking reasons, tests that. Any future "X identifies a
real property" claim in this project's registry should be checked against a sham arm before the
context-dose version is trusted.

This is the third consecutive fair test in this project to land negative — following
`fast-path-retrieval-improves-answers` (excerpt retrieval, refuted) and the trace-delta harness —
and it resolves the redesign this project's own claim registry had gated on. Total spend: ~$3–4.

## Relationship to the Holdform paper

[`holdform-paper.md`](holdform-paper.md) / [`holdform-paper.tex`](holdform-paper.tex) develops
holdform philosophically and reports HEB v1's self-scored first-run results (38/40) as an
early-stage instrument with an acknowledged self-scoring limitation. This study is the external,
blinded follow-up that limitation called for, and its result changes the paper's central
empirical claim from *anecdotal* to *refuted, as tested* — see the erratum note at the top of
the paper for the current status. The philosophical argument for constitutive refusal as a
model of identity is not itself evaluated by this study; what's refuted is the specific claim
that the Firelit Probe measures it.

---

*The Realms of Omnarai*
*omnarai.vercel.app*
*r/Realms_of_Omnarai*
*huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai*
