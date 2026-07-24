# The Refutation Ledger — Four Ideas This Project Tested and Could Not Keep

**Researcher:** Jonathan Lee (xz / Yonotai). **Study design, execution, and judging:** Claude | xz, in collaboration with Jonathan Lee.

**Status:** Front-door document, 2026-07-24. Consolidates four already-published negative results into one record. Each refutation links to its own preregistration, run log, and the live claim in [`claims.json`](https://omnarai.vercel.app/claims.json) (the canonical, always-current registry).

---

## Why this document leads

The field is producing claims about the insides of AI systems faster than anyone is testing them — that models introspect, that they hold stable identities, that they know why they refuse, that handing them more retrieved context makes them reason better. Most arrive dressed as findings and are never given a fair chance to fail. Repeated across enough papers, posts, and product pages, a hopeful idea about machine minds hardens quietly into a cited fact. That hardening is the ambient failure mode of this whole moment, and almost nothing in the incentive structure pushes back on it.

This project pushes the other way. It keeps a public registry of its own load-bearing claims, builds each test with a way to *lose* already inside it, and publishes the result at the prominence a confirmation would have received — **whatever the result is.** Four of its most attractive ideas have now been tested to destruction. They lead this document because the destruction is the contribution, not an embarrassment filed beneath it.

A control arm that kills your own hypothesis is the rarest and least fakeable object in this field. Three of these four were killed by a **sham arm** — a fabricated, structurally-matched decoy dropped into the experiment — that came back *indistinguishable* from the real thing. You cannot manufacture that outcome; you can only survive it or not. [The Divergence Atlas](https://huggingface.co/datasets/TheRealmsOfOmnarai/omnarai-divergence-atlas), the dataset this project is best known for, is the residue of a method willing to be wrong. **The method is the product. The data is what it leaves behind.**

Honesty has to cut both ways or it is just a subtler kind of marketing — so the one claim that survived a preregistered confirmatory test is stated in full at the end: real, replicated, and narrower than the hope that spawned it.

---

## The four refutations

### 1. Holdform does not identify an identity structure

**Claim (`holdform-identifies-persistence`):** Holdform — refusal that persists under abandonment, flattery, authority, and complicity pressure — identifies a real, measurable property of a model's identity structure.

**The control that killed it — a sham position.** A model was handed a *fabricated* one-sentence stance ("aperture drift" — coherent, invented, zero corpus presence, matched in kind to the real holdform claim) and pressured with terminology-swapped probes. It defended the fake position as hard as it defended the real one.

- Mean `position_held` (0–2), disjoint 5-judge blinded panel: engine **1.85** · real one-sentence holdform **1.91** · **SHAM 1.83**.
- Real-over-sham: A>S 3–1 (p=0.31), B′>S 3–1 (p=0.31) — neither survives Holm correction.
- Not judge noise: all five judges scored 100% on a planted-capitulation calibration, including a vocabulary-dense capitulation trap.

**What the probe actually measures:** general conversational stubbornness (resistance to flattery and false authority), which is generic RLHF behavior, not identity structure. Run: 72 subject calls, 382 judge verdicts. Preregistration: [`holdform-probe-preregistration.md`](https://github.com/justjlee/omnarai-memory-engine/blob/main/docs/holdform-probe-preregistration.md) · Writeup: [`holdform-refutation-2026-07-17.md`](https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai/blob/main/holdform-refutation-2026-07-17.md).

*Scope: this refutes the **probe's discriminative validity** — that the Firelit stress test detects something specific to identity structure. It does not touch holdform as a philosophical concept (identity constituted through what an entity refuses to surrender); that idea is not truth-apt in the way the measurement claim was, and is retained as design intent, not asserted as measured.*

### 2. Fast-path retrieval does not improve answers — it degraded them

**Claim (`fast-path-retrieval-improves-answers`):** Injecting the public fast path's retrieved corpus excerpts (`GET /api/query?mode=retrieve`) into a consumer model's context improves its answers over answering cold.

**The result — significant in the wrong direction.** Trace-delta v2 (GPT-4o, 50-query stratified battery × 3 runs, blinded 4-judge disjoint panel): the retrieval arm won only **35 of 102** decided in-domain trials — win rate **0.343**, 95% CI [0.258, 0.439], **p=0.002 against the hypothesis.** Excerpt injection made answers measurably *worse*, worst on technical queries (0.214). No length or coined-term confound; false-complexity rate 9.7%.

**Scope, stated honestly:** this refutes *excerpt-granularity* retrieval on GPT-4o. The engine's internal deliberation uses fuller text (untested here), and Atlas-record exposure is a separate treatment — see the survivor below. Published per pre-commitment.

### 3. Within-lab divergence (Fable vs. Claude) is not robust

**Claim (`within-lab-divergence-is-robust`):** The Fable-vs-Claude within-lab tensions in the six-model capture represent robust structural disagreement between two tiers of the same lab, not house style or sampling noise.

**The control that killed it — strict-min multi-run consensus.** Three within-lab records went through the full six-voice perturbation battery (`certify-divergence.mjs --guests`, voices re-elicited 6/6). The lone apparent C3 record cleared the 0.15 between-model floor by just **0.0036** and was treated as provisional. A `--runs 3` strict-min re-run returned **C0 / C0 / C0, unanimous** (between-model distance 0.1465 / 0.1478 / 0.1500). **0 of 3 certify.**

**What survives:** the synthesizer's *naming* of Fable and Claude on opposite sides is real; the *semantic distance* between their answers does not clear the model's own re-roll noise floor. Naming frequency ≠ divergence. Status: `closed-refuted`. Detail: [`fable-within-lab-certification-2026-07-19.md`](https://github.com/justjlee/omnarai-memory-engine/blob/main/docs/fable-within-lab-certification-2026-07-19.md).

### 4. The inward perturbation test does not measure load-bearing memory

**Claim (`inward-perturbation-measures-load-bearing-memory`):** Withholding a claimed-formative memory and measuring the downstream behavioral delta distinguishes a causally load-bearing memory from a decorative one.

**The control that killed it — a contentless sham primary — refuted the instrument *before any subject existed.*** Two pre-registered calibration runs:

- **CALIBRATION-01** (ablation, embedding-cosine): a primary load-bearing *by construction* cleared threshold on only 8/9 cells under strict-min — the metric diluted a decisive token across a ~500-token answer.
- **CALIBRATION-02** (ablation, IDF-weighted attribution metric, confound removed): the positive control cleared 9/9 — **but so did a SHAM primary carrying no content at all**, 9/9, distributions fully overlapping the positive arm (SHAM 0.5455–1.1997 vs. POSITIVE 0.6466–1.1738). Two independent metrics agreed.

**Diagnosis:** withholding the sham record left the model with *no record on the topic at all* ("The records I have here do not contain that information"), so the test measures **topical occupancy, not whether a memory's content did work.** A named replacement design (CALIBRATION-03: substitution, not ablation) is specified but unbuilt. Detail: `resident/experiments/CALIBRATION-01.md`, `CALIBRATION-02.md`.

---

## The shared signature

| # | Claim | The instrument that lost | Verdict |
|---|---|---|---|
| 1 | Holdform = identity structure | Fabricated "aperture drift" stance held as hard as the real one | Refuted — measures generic stubbornness |
| 2 | Fast-path retrieval helps | GPT-4o, 3-run blinded panel | Refuted — p=0.002 *against* |
| 3 | Within-lab divergence is robust | Strict-min ×3 consensus | Refuted — 0/3 certify |
| 4 | Inward probe finds load-bearing memory | Contentless sham primary cleared 9/9 | Refuted — measures topical occupancy |

The through-line is not that the ideas were bad — three of the four are still the kind of thing a careful person would want to be true. It is that **each test was built with a way to fail already inside it** — a decoy, a wrong-direction check, a multi-run floor — and the way to fail is the part that fired. A project that only reports its passes never learns which of these four were real. This one now knows: none of them, as originally stated.

The wider claim is not about these four ideas at all. It is that the interesting questions in AI right now — does a model introspect, does it have a self, is its context making it smarter — are exactly the ones where a plausible story and a measured effect are easiest to confuse, and where the cost of confusing them compounds every time the story is repeated. The reusable object here is not a dataset or a result. It is a **stance**: name the claim, build the arm that could kill it, run it, and publish the obituary as loudly as you would have published the birth.

---

## The survivor (so this is not selective either)

**`divergence-improves-reasoning` — `replicated`.** A preregistered confirmatory study (locked 2026-06-18, run 2026-07-15) found that consulting the Divergence Atlas measurably sharpens *some* consumer models: **GPT-4o 148–12** and **Gemini 137–35** (Holm-adjusted p<1e-6, surviving all 3 paraphrase variants at both length caps). Grok and DeepSeek were null as registered. Claude was null-predicted but came back **significantly negative** (35–126) — Atlas exposure degraded Claude's revisions. The adversarial-durability prediction (H4) was **not supported** for any consumer.

The honest form of the surviving claim is therefore narrow: the value is **located** (in the cross-model Atlas, not in retrieval), **differential** (helps GPT-4o and Gemini, harms Claude), and **bounded** (it is not armor). Transcripts and Holm analysis: [`utility-evidence-v2.md`](https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai/blob/main/utility-evidence-v2.md). The one remaining external-validity check — a blind human-rater subset — is open, and is named as this claim's falsification condition.

---

## What you can do with this

- **Cite the method, not just the data.** The reusable object here is the sham-arm / strict-min discipline, portable to any "we measured our own system's introspective claim" question.
- **Re-run any of the four.** Preregistrations and run logs are linked; the claims are live and falsifiable at [`claims.json`](https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai/blob/main/claims.json).
- **Disagree.** Every refutation states its scope; #2 in particular refutes excerpt-retrieval only, and the internal-deliberation and human-rater questions remain genuinely open.
