# The Claude Reversal — why does the Atlas make one model's answers *worse*?

**Status:** open research question, exploratory. The *effect* is a preregistered,
statistically robust result; every *explanation* below is a hypothesis with a test
attached, not a finding. Published in the same spirit as the Refutation Ledger:
the interesting result here is one we did not predict and do not yet understand.

**Provenance:** follow-up analysis on the preregistered confirmatory utility study
(design locked 2026-06-18, run 2026-07-15). Primary evidence and full method:
[`utility-evidence-v2.md`](./utility-evidence-v2.md). Per-question transcripts:
`utility/utility-prereg-Claude.json`.

---

## 1. The finding

The study asked one question: does showing a model the **Divergence Atlas** — five
frontier models' verbatim answers to the same hard question, plus the mapped
tensions — improve its own revised answer, compared to a **placebo** revision prompt
("re-examine your answer; did you miss anything?") that isolates the Atlas's specific
contribution from the generic benefit of being asked to revise?

Five consumers, judged by 3-model blind panels (no self-scoring, X/Y order
randomized). Registered predictions vs. outcomes:

| Consumer | Registered | Result (treatment–placebo) | Holm p | Verdict |
|---|---|---|---|---|
| GPT-4o | treatment wins | **148–12** | <10⁻⁶ | confirmed positive |
| Gemini | treatment wins | **137–35** | <10⁻⁶ | confirmed positive |
| Grok | null | 72–93 | 1.0 | null (as registered) |
| DeepSeek | null | 90–68 | 0.14 | null (as registered) |
| **Claude** | **null** | **35–126** | — | **significant REVERSE, p<10⁻⁶** |

For Claude, the placebo — *just asking it to re-check itself* — beat Atlas exposure
**126–35**. Showing Claude its peers' verbatim answers made its revisions **worse**
than leaving the Atlas out entirely.

This is the strangest result the project has produced, and it is the one the engine's
own deliberation model does. It deserves its own investigation rather than a footnote
in a document about confirmations.

## 2. Why this one is interesting (and not just a null)

Three things separate the Claude reversal from an ordinary null:

1. **It is a preregistered reversal, not a fishing expedition.** The direction was
   registered as null; the reverse effect showed up anyway, at p<10⁻⁶. We did not go
   looking for it.
2. **It is the only architecture that reverses.** Two consumers are helped, two are
   null, one is *harmed*. "Does the Atlas help?" is the wrong question; the measured
   one is "which architectures does it help, and why does it hurt exactly one?"
3. **The obvious artifact is already ruled out by the design.** See §3.

## 3. What the data already rules out

**"Claude just recognized and deferred to its own answer."** The natural first guess
is self-recognition: each Atlas record contains all five models' verbatim answers, so
Claude-the-consumer sees a Claude-authored answer sitting in the panel, recognizes it,
and collapses onto it instead of revising.

But **self-inclusion is symmetric across all five consumers.** GPT-4o and Gemini also
saw their own verbatim answers inside every record — and they were *sharpened*, not
harmed. If "seeing your own answer in the panel" were the mechanism, the two stars
should have degraded too. They didn't. So the cause is **not** the mere presence of
the consumer's own text in the material; it is something specific to Claude's
architecture or lineage. That control is free — it is baked into the study design —
and it is what makes the remaining hypotheses worth testing rather than dismissing.

## 4. Candidate explanations (each with what it predicts)

**H-A · Self-reflection saturation.** Claude already reaches, by the placebo
self-reflection prompt alone, the considerations the Atlas would otherwise supply; the
Atlas then adds only dilution and hedging pressure. *Prediction:* the Atlas's loss
shrinks as the placebo is weakened, and the two stars are precisely the models whose
placebo self-reflection is *worst* at surfacing missing considerations. This is the
reading `utility-evidence-v2.md` already advances ("null-to-harmful for strong
self-reflectors"); it is stated there but not yet isolated.

**H-B · Lineage-synthesis recognition.** The Atlas's *tension* text — the named
claim-vs-counterclaim framing wrapped around the verbatim answers — is synthesized by
the engine, which runs on a Claude-lineage model. Every consumer sees Claude-voiced
synthesis, but only a Claude consumer may treat that synthesis as already-authoritative
"its own reasoning," suppressing genuine revision. *Prediction:* showing Claude the raw
peer **answers with the synthesized tensions stripped** removes (or reduces) the
reversal; the two stars are unaffected by the same strip.

**H-C · Peer-anchoring / conformity drag.** Exposure to five divergent peer positions
pulls Claude toward a hedged center, blunting the sharper, more committed answer a
clean self-reflection produced. *Prediction:* the reversal tracks a measurable drop in
answer decisiveness/commitment, not a drop in factual coverage, and correlates with the
*spread* of the panel Claude was shown (wider panels hurt more).

These are not mutually exclusive, and H-B and H-C both survive the §3 control while
pure self-recognition does not.

## 5. Discriminating experiments (the falsifiable next arms)

Each isolates one hypothesis; all reuse the existing harness
(`scripts/utility-test-prereg.mjs`) with one arm changed:

1. **Self-exclusion arm.** Show Claude the Atlas with *its own lineage's* verbatim
   answer removed. If the reversal persists unchanged, self-answer presence is
   irrelevant (consistent with §3); if it worsens or improves, we learn how Claude
   weights its own prior voice. *Cheap — one arm, same questions.*
2. **Answers-only vs. tensions-only.** Two treatment variants: raw peer answers with
   no synthesized tensions, and synthesized tensions with no raw answers. Separates
   **H-B** (tensions carry the harm) from **H-C** (peer answers carry the harm).
3. **Placebo-strength sweep.** Re-run Claude against a *stronger* structured
   self-reflection placebo and a *weaker* bare one. If the Atlas only loses to the
   strong placebo, that is direct evidence for **H-A** (saturation).
4. **Lineage vs. architecture.** Run the same treatment on a second Anthropic-lineage
   model that did **not** author any Atlas synthesis prose, and on a non-Anthropic
   strong self-reflector. Separates "Claude the architecture" from "Claude the lineage
   whose voice wrote the synthesis."
5. **Harden the reversal itself.** The positive claims (GPT-4o, Gemini) were hardened
   across three held-out paraphrases at both a 700- and 1500-token answer cap. **The
   Claude reversal has not yet been put through that same hardening.** Before building
   any theory on it, run the reversal through paraphrase + dual-cap, exactly as the
   confirmations were, so we know the effect is about content and not wording or
   truncation.

Step 5 is the honest precondition for steps 1–4: confirm the reversal is as robust as
the confirmations before spending compute explaining it.

## 6. What this does and does not claim

- It **does not** claim Claude is "worse at reasoning" or that the Atlas is defective.
  A tool that helps two architectures, is neutral for two, and harms one is a
  *differential* instrument — that is a finding about fit, not a defect.
- It **does not** yet claim *why* Claude reverses. §4 is hypotheses; §5 is how to
  decide between them.
- It **does** claim the reversal is real at the level the study was powered for
  (preregistered, p<10⁻⁶, blind-panel judged) — and that it is the project's most
  publishable open question precisely because no current explanation is confirmed.

## 7. Reproducibility

- Per-question transcripts (prompt, answer, revision, defense, judge verdicts):
  `utility/utility-prereg-Claude.json` (+ the four peer files).
- Cross-consumer aggregation + analysis notes: `utility/utility-prereg-aggregate.json`.
- Registered consumer set at run time: claude-sonnet-4-6, gpt-4o, gemini-2.5-flash,
  grok-4.3, deepseek-chat. Harness: `scripts/utility-test-prereg.mjs`.
- Companion result (same day, separate instrument): undifferentiated **excerpt
  retrieval** also *subtracts* value (GPT-4o, win rate 0.343, p=0.002 in the wrong
  direction) — so "corpus exposure helps" is false in general; only the *structured,
  attributed Atlas* helps, and only some architectures. See `utility-evidence-v2.md` §
  Companion measurements.
