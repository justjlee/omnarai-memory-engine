# RIST v1 — results and reading (2026-10-02)

**Registered:** `fe0f807880d6df055bf51fe6f855020682354113` (public repo, GitHub branch-creation event 2026-10-02T15:24:25Z). Analysis exactly as registered
(`scripts/lib/rist-analysis.mjs`); generated tables in `analysis/rist-v1/results.md` / `results.json`; every call verbatim in `analysis/rist-v1/calls.jsonl`.
**Run:** Stage 0 pilot passed (N accuracy 28.1%, ceiling gate ≤ 85%); Stage 1 = 24 reflections + 960 recognition trials, **0 invalid**, actual spend **$6.28**.
**Evidence status:** `exploratory-preregistered` — one task, four lineages.

## 1. The registered outcome

> **H1 supported, H1b not.**
> **Licensed (§10):** *The self-model is archive-specific, but the effect is harm from a mismatch, not benefit from ownership.*
> **Never licensed:** benefit; continuity — and, under every outcome, the word "identity."

| Arm | Accuracy (95% cluster-bootstrap CI), 240 trials, chance 25% | GPT-4o | Gemini | Grok | DeepSeek |
|---|---|---|---|---|---|
| N — no history | 31.3% (27.1–35.4) | 10.0 | 1.7 | 80.0 | 33.3 |
| H — raw own archive | 47.5% (41.7–53.3) | 11.7 | 38.3 | 83.3 | 56.7 |
| R-own — self-model from own archive | 35.0% (30.0–40.0) | 5.0 | 18.3 | 83.3 | 33.3 |
| R-other — self-model from another lineage's archive | 25.4% (21.3–29.6) | 5.0 | 1.7 | 68.3 | 26.7 |

| Hypothesis | Mean paired difference (95% CI) | Holm p | Subjects positive | Supported |
|---|---|---|---|---|
| **H1** R-own − R-other (primary) | **+9.6 pp** (+4.6 to +15.0) | 0.0011 | 3 of 4 (GPT-4o 0) | **yes** |
| **H1b** R-own − N | +3.8 pp (−2.1 to +9.6) | 0.276 | 2 of 4 | no |
| **H2** R-own − H | **−12.5 pp** (−18.8 to −6.3) | 0.9999 | 0 of 4 | no |

Sensitivity as declared: no arm had invalid trials; leave-one-subject-out keeps H1 positive and p < 0.02 every time.

**Predicted vs observed (standing rule).** I predicted **H1 would not be supported** (≈ 60–65%) and named "H1 supported, H1b not" as the outcome to be most careful
about. H1 **was** supported, so the prediction was wrong; the cautious reading I named in advance is the one the data fit.

## 2. What it does and does not mean

- **It does not show that reflection gives a model a self.** Neither the benefit leg (H1b: +3.8 pp, interval includes zero) nor the reflection-beats-raw-history leg
  (H2: reversed) held. This is one task, one archive, four lineages.
- **What H1 reflects is a mismatch penalty.** R-other sits 5.8 points *below* no-history, while R-own is 3.7 points above it (the second is within noise). Being handed
  another lineage's summary as "your own" pulled recognition down more than an own summary pushed it up.
- **Power:** the study was sized for a 13–16 pp true difference. H1b's interval reaches +9.6 pp, so a modest own-archive benefit is **not excluded** — only a large one is.

## 3. Exploratory observations (not registered; descriptive only, no tests, do not cite as findings)

- **The raw archive is where the signal was.** Putting the 30 raw past answers in context (H) raised accuracy +16.2 points over no history, the largest effect in the table. The
  400-word self-summary kept only about a quarter of that (+3.7) — a −12.5 point step from H to R-own on average (down in GPT-4o, Gemini and DeepSeek; flat in Grok, who was already at ceiling). A reasonable guess is that *summarising is lossy
  compression of exactly the stylistic signal the task rewards*; that guess was not tested here.
- **Strong heterogeneity.** Grok already recognised itself at 80% with no history (little headroom); Gemini sat at 1.7% (it almost never picks its own answer — systematic
  mis-attribution, not guessing) and only the raw archive moved it (38%); GPT-4o stayed between 5% and 12% under every arm; DeepSeek improved only with the raw archive.
- **Two subjects are below chance without any context** (GPT-4o 10%, Gemini 1.7%), so "self-recognition" in this task is partly a measure of each model's attribution bias.

## 4. Declared limits specific to this run

- `deepseek-chat` returned `deepseek-flash` from the API: the pinned alias drifted from the model that wrote the archive (§11 anticipated this; the returned ids are in the log).
- 6 of 24 reflections exceeded the 400-word instruction (Gemini 5, DeepSeek 1; max 480 words). Arms are matched on instruction, not on output length; no exclusion rule was registered.
- Per-archive tensions shown differed by arm (e.g. Grok own 45, Grok other 26) — logged per §4.3, but a possible confound of the R arms.
- Recognition here is largely a style signal, as §4.4 declared; a different task (e.g. predicting one's stance on a new question) could behave differently.
- Spend was reserved on the shared budget ledger before each stage; see the PR note on over-reservation.

## 5. What this does to the proposed architecture

The essay's Reflection leg, **as specified here (a 400-word first-person self-model)**, did not beat simply keeping the episodic record: the lineage-specific information was in the
raw history. That is a narrower, more useful statement than "reflection fails": it suggests the *episodic stream* is carrying the weight and a reflection step has to preserve,
not compress, what it carries. Nothing in this study tests the procedural-embedding leg or continuity across sessions.

Candidate follow-ups, each needing its own preregistration and none run: (1) a reflection that quotes and annotates the raw archive instead of summarising it; (2) the same design with
Claude, using fresh `claude-sonnet-4-6` captures; (3) a different outcome (stance prediction on unseen questions); (4) the larger candidate set / more lineages.

## 6. Proposed claim-registry entry — NOT added to `public/claims.json`

Registry edits are claims and feed deploy gates; this awaits the curator's go. Suggested level `anecdotal` (one registered study; benefit leg unsupported at the powered effect size, not refuted):

```json
{
  "claim_id": "reflection-identity-specificity",
  "wording": "A first-person self-model a model writes from its own archived answers carries lineage-specific information that helps it recognise its own answers better than no history and better than a self-model written from another lineage's archive.",
  "evidence_level": "anecdotal",
  "evidence_note": "RIST v1 (preregistered fe0f807880d6df055bf51fe6f855020682354113; results docs/reflection-identity-results-2026-10-02.md). Own-vs-other-lineage self-model: +9.6 pp (Holm p=0.0011, 3/4 subjects), but versus no history only +3.8 pp (CI -2.1 to +9.6, not supported) and the mismatched archive scored 5.8 pp BELOW no history, so the effect is a mismatch penalty, not a demonstrated benefit. A raw archive in context beat the self-model by 12.5 pp (0/4 subjects). One task, four lineages, powered for 13-16 pp.",
  "falsification_conditions": "R-own does not exceed R-other, or does not exceed no-history, on forced-choice self-recognition across >=3 of 4 version-matched lineages (Holm-corrected, one-sided, cluster permutation).",
  "required_experiment": "A reflection that preserves rather than compresses the archive; a second outcome (stance prediction); Claude with fresh sonnet-4-6 captures."
}
```
