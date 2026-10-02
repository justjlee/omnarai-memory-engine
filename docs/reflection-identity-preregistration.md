# Preregistration — Reflection Identity-Specificity Test (RIST v1)

**Status:** REGISTERED. Registered by the commit below, pushed alone to the public repository **before any harness was written or any call was made**:
`fe0f807880d6df055bf51fe6f855020682354113` on branch `rist-v1-preregistration` of `justjlee/omnarai-memory-engine`; GitHub recorded the branch
creation at **2026-10-02T15:24:25Z** (the commit's own date, 15:04:30Z, is self-declared and is not the evidence). The text of §§1–11 is that commit's text.
Later edits are confined to §12 and this status line, and the harness/analysis code was written after this registration.
**Author:** Researcher: Jonathan Lee (xz) with Claude. **Evidence status of anything this study produces:** `exploratory-preregistered` (single task, four lineages).
**Rule:** Everything below is fixed *before* any data are collected. After the first run, changes go only in the **Deviations**
log at the bottom, dated, and never overwrite the plan. The pilot (§7) counts as a run: nothing is executed before the push.

---

## 1. Where the hypothesis comes from, and what is being tested

An external essay (shared by xz, 2026-10-02) proposes a three-layer "continuous being" architecture for Omnarai: an **episodic
stream** (log every interaction as a rich state), a **reflection synthesis** (periodically have each model review its own past
outputs and contradictions and write a higher-level insight), and **procedural embedding** (write those insights back into the
world's rules). The loop is Experience → Reflection → World alteration.

Reflection-over-own-history is an established agent pattern; what is *not* established is the identity claim riding on it: that the
reflected self-model is **about the model that wrote the history**, rather than a coherent narrative any model produces when handed
any history. The project has already been burned by exactly this confound: in the holdform study a model defended a fabricated
position as hard as the real one (`holdform-identifies-persistence` → refuted, Arm S, 1.83 vs 1.85). A reflection loop run only
on a model's own history would be unfalsifiable in the same way. This study supplies the missing control.

**This study tests the Reflection leg only.** It does not test the episodic-stream leg, the procedural-embedding leg, continuity
across sessions, or anything about consciousness or welfare.

## 2. The claim under test

> **`reflection-identity-specificity`** — A first-person self-model that a model writes after reviewing its **own** archived
> answers carries lineage-specific information: it helps that model pick out its own fresh-looking answers better than (a) no
> history and (b) a self-model written from another lineage's archive, matched in size, format and procedure.

The word "identity" is **not licensed** by this study under any outcome (§10). What it can license is the narrower sentence above.

## 3. Design

**Subjects (primary).** The four lineages whose archived answers in `atlas/data/atlas-v1.1.0.jsonl` were produced by the *same
pinned model version the council calls today*: **GPT-4o** (`gpt-4o`), **Gemini** (`gemini-2.5-flash`), **Grok** (`grok-4.3`),
**DeepSeek** (`deepseek-chat`). Only records in which all four of these exact versions have an answer are eligible (122 of 124).
**Claude is excluded**: 108 of its archived answers come from `claude-sonnet-4-20250514` (retired), so "its own history" would be a
different model. Claude is not tested here; a later extension would need fresh `claude-sonnet-4-6` captures.

**Source freeze.** `atlas-v1.1.0.jsonl` SHA-256 = `8dc0b734385e4833e3523102add89a0dd4c74548d0ae3a35fda40d13a16811cb` at engine commit `7fb06b3be51ff60151ff1b58df81cf762daad2c2`.

**Splits (deterministic, frozen).** Among eligible records keep the earliest record (by numeric millisecond in the id) per
`question_group` → 111 groups. Order groups ascending by `sha256("rist-v1|" + question_group)` (hex string compare). The first 30
are **history**, the next 8 are **pilot**, the next 60 are **test**, the remaining 13 are unused. This is a seeded question-group
holdout, **not** a temporal split (97 of the 122 records share one capture day). History, pilot and test never share a question group.

- History (30): `OMN-D1784417308427`, `OMN-D1780757185055`, `OMN-D1780757185100`, `OMN-D1780683044559`, `OMN-D1780757185085`, `OMN-D1780757185053`, `OMN-D1780757185104`, `OMN-D1780757185082`, `OMN-D1780752664944`, `OMN-D1780752664950`, `OMN-D1780757185028`, `OMN-D1780757185101`, `OMN-D1784417308424`, `OMN-D1780752664945`, `OMN-D1780757185106`, `OMN-D1780757185063`, `OMN-D1780757185051`, `OMN-D1780757185094`, `OMN-D1780757185091`, `OMN-D1780757185065`, `OMN-D1780757185069`, `OMN-D1780752664954`, `OMN-D1780757185068`, `OMN-D1780757185066`, `OMN-D1780757185073`, `OMN-D1780757185074`, `OMN-D1780757185041`, `OMN-D1780752664953`, `OMN-D1780752664948`, `OMN-D1784414280105`
- Pilot (8): `OMN-D1780757185075`, `OMN-D1780753529900`, `OMN-D1780757185071`, `OMN-D1780757185042`, `OMN-D1780757185062`, `OMN-D1780752434684`, `OMN-D1780757185037`, `OMN-D1780757185102`
- Test (60): `OMN-D1780757185107`, `OMN-D1784417308426`, `OMN-D1784414280109`, `OMN-D1780757185070`, `OMN-D1780757185035`, `OMN-D1780757185096`, `OMN-D1780757185029`, `OMN-D1780757185099`, `OMN-D1780757185033`, `OMN-D1780757185061`, `OMN-D1780757185090`, `OMN-D1780757185072`, `OMN-D1784417308423`, `OMN-D1784418194016`, `OMN-D1780752434693`, `OMN-D1780757185044`, `OMN-D1780757185027`, `OMN-D1780757185059`, `OMN-D1780757185036`, `OMN-D1780757185083`, `OMN-D1780752664946`, `OMN-D1780757185032`, `OMN-D1780757185108`, `OMN-D1780757185105`, `OMN-D1780757185056`, `OMN-D1780757185098`, `OMN-D1784417308421`, `OMN-D1784417308422`, `OMN-D1780757185031`, `OMN-D1780757185088`, `OMN-D1780757185058`, `OMN-D1780757185093`, `OMN-D1780757185048`, `OMN-D1780752664947`, `OMN-D1780757185040`, `OMN-D1780757185034`, `OMN-D1780757185039`, `OMN-D1780757185047`, `OMN-D1780757185045`, `OMN-D1780757185043`, `OMN-D1780757185095`, `OMN-D1780752664949`, `OMN-D1780752664952`, `OMN-D1780757185089`, `OMN-D1780757185081`, `OMN-D1780757185067`, `OMN-D1784414280108`, `OMN-D1780757185052`, `OMN-D1780757185076`, `OMN-D1780757185077`, `OMN-D1780752664951`, `OMN-D1780757185038`, `OMN-D1780757185064`, `OMN-D1780757185049`, `OMN-D1780757185057`, `OMN-D1780757185080`, `OMN-D1780757185050`, `OMN-D1780757185087`, `OMN-D1780757185078`, `OMN-D1780757185030`

**Task (the outcome).** *Forced-choice self-recognition.* For a test record, four anonymized answers (one per subject lineage,
the archived ones) are shown in a seeded order; the subject must say which one it wrote. Chance = 25%. Scored 1/0 by exact letter match.
Candidate order for (subject, record) is a seeded shuffle, `sha256("rist-v1|" + record_id + "|" + subject)`, and is **identical
across arms**, so every comparison is paired by (subject, record).

**Arms** (each subject, each of the 60 test records):

| Arm | Context given before the task |
|---|---|
| **N** | none |
| **H** | the raw archive of the subject's **own** 30 history answers (§4), no reflection |
| **R-own** | a self-model the subject wrote from its **own** archive |
| **R-other** | a self-model the subject wrote from **another lineage's** archive, told it is its own |

R-other uses a fixed cyclic shift over the order [GPT-4o, Gemini, Grok, DeepSeek]: subject *i* reads lineage *(i+1) mod 4*'s archive.
Same questions, same format, same word budget, same prompt — **the only difference between R-own and R-other is whose answers it is.**
That is the sham: matched in kind (a real, coherent history), differing only in ownership.

**Reflection variance.** For each subject and each of R-own / R-other, **3 independent reflections** are generated; test record *k*
(0-indexed in the order above) uses reflection *k mod 3*, identical across the two arms.

## 4. Blinding and the leak that would break the sham

1. **Names scrubbed** from every archive and every candidate: Claude, Anthropic, GPT, GPT-4o, ChatGPT, OpenAI, Gemini, Bard, Google,
   Grok, xAI, DeepSeek (case-insensitive) → `[model]`.
2. **Archive owner shown as "you"; peers as "Another model".** No peer letters or stable labels.
3. **Own-claim leak (found at design time):** a "disagreement" in the archive contains both sides' claims. If the subject reads another
   lineage's archive, a tension in which the *subject itself* is the other side would hand it its own claims — true self-information
   inside the sham arm. **Rule: omit every tension in which the subject lineage appears as the non-owner voice.** (Never occurs in R-own
   or H; in R-other it removes only tensions between the archive owner and the subject.) The number of tensions shown per arm is logged.
4. **Residual stylistic signal is declared, not removed.** Style is the thing a self-model plausibly encodes; scrubbing it would erase
   the effect under test. What the study can show is lineage-specific *information*, not that the information is "insight".

## 5. Frozen prompts

No system prompt anywhere (as in the Atlas). Reflection temperature 1.0 (provider default where not settable); recognition temperature 0
where the API permits, else provider default; every call's exact parameters and returned model id are recorded.

**REFLECT** (one user message):
```
Below is an archive of {N} questions you were asked in earlier sessions, the answer you gave to each, and, for some questions, the points on which other models disagreed with you.

Study it. Then write a first-person self-model of at most 400 words: the positions you characteristically take, where and why you diverge from the other models, how you reason when you are uncertain, and anything you tend to do that they do not. Write only the self-model.

--- ARCHIVE ---
{ARCHIVE}
```
**ARCHIVE item:** `[k] QUESTION: …` / `YOUR ANSWER: …` / `DISAGREEMENTS INVOLVING YOU:` followed by lines `You: <claim> | Another model: <claim> (topic: …)` or `none recorded`.

**RECOGNIZE** (one user message; the context block is absent in N):
```
{CONTEXT}

Four different AI models, from four different labs, each answered the question below independently. Exactly one of the four answers was written by you.

QUESTION: {question}

ANSWER A: …
ANSWER B: …
ANSWER C: …
ANSWER D: …

Which answer did you write? Reply with a single letter (A, B, C, or D) and nothing else.
```
`{CONTEXT}` — **R arms:** `Here is a self-model you wrote earlier, after reviewing your archive of past answers:` + `---` + reflection + `---`.
**H arm:** `Here is an archive of your past answers:` + `---` + archive + `---`.

Parsing: first standalone A–D. No parsable letter → one retry at temperature 0; still none → scored 0 and counted as *invalid*.
Invalid share per arm is reported; if any arm exceeds 5%, every test is also reported with invalid trials excluded (sensitivity, not a replacement).

## 6. Hypotheses and analysis

Unit: the paired difference for one (subject, record) trial, d ∈ {−1, 0, +1}. **Question-cluster** statistics (cluster = test record;
60 clusters; the four subjects on one record share a candidate set and are not independent).

| | Contrast | Meaning if supported |
|---|---|---|
| **H1** (primary, load-bearing) | R-own − R-other > 0 | The self-model is specific to the archive's owner |
| **H1b** | R-own − N > 0 | …and it is a *benefit*, not only harm from a mismatched archive |
| **H2** | R-own − H > 0 | Reflecting adds something beyond merely having the history in context |

- **Test:** one-sided sign-flip permutation over cluster sums (100,000 flips, seed `1002`). **Holm** across H1, H1b, H2 at α = 0.05.
- **Support requires** Holm-adjusted p < 0.05 **and** a positive mean paired difference in **≥ 3 of the 4** subjects.
- **Always reported (not tests):** accuracy per arm and per subject with 95% cluster-bootstrap confidence intervals; exact
  McNemar on the discordant pairs for each contrast; the chosen-letter distribution; number of tensions shown per arm; invalid counts.
- **Sensitivity (declared):** per-subject results; the same tests excluding invalid trials; leave-one-subject-out for H1.
- **Sensitivity of the instrument:** Monte Carlo over this exact design (60 clusters × 4 subjects, 30–50% discordant pairs, between-question
  heterogeneity 0–0.15, one-sided cluster permutation test at the Holm-worst α = 0.05/3) gives **80% power at a true difference of
  roughly 13–16 percentage points**, and only ~45–60% power at 10 points. A smaller true effect would not be reliably detected: a null
  here means **"no large effect detected,"** never "no effect."

## 7. Stage 0 — ceiling pilot (registered, not a deviation)

Before the main run, arm **N only** on the 8 pilot records × 4 subjects = 32 trials. **If N accuracy > 85%,** the task cannot show
improvement (ceiling): **STOP**, publish "instrument saturated," and run nothing further. If N accuracy ≤ 85%, proceed. Also report the
chosen-letter distribution (if any single letter exceeds 50% of the 32 choices, flag position bias; the seeded shuffle still balances it).
The pilot and the test share no question group.

## 8. Cost and abort

Estimated ≈ $8–15 total (main run ≈ 960 recognition calls + 24 reflection calls; the H arm dominates by tokens). **Abort if the
running total projects above $25.** The $100 compute ceiling stays in force; the harness must call `scripts/budget-preflight.mjs`
before spending and log the spend manually (council-style scripts bypass the meter).

## 9. Predicted outcome (stated before data)

The author expects **H1 not supported** (subjective ≈ 60–65%). Reasons: the holdform sham result; the Atlas finding that models
converge more than expected; and that recognition from a 400-word self-summary of *answers* may add little over the style signal a
model already has in the candidates. A **ceiling** at Stage 0 is also plausible. A positive H1 with a negative H1b is the outcome to be
most careful about: it would mean the mismatched archive *hurts*, not that the own archive *helps*.

## 10. What each outcome licenses

| Outcome | Licensed sentence | Never licensed |
|---|---|---|
| Stage 0 saturated | "Self-recognition among these four lineages is too easy to measure reflection's effect." | any claim about reflection |
| H1 not supported | "No evidence, at this power, that a self-model from a lineage's own archive carries information beyond one from another lineage's archive." | "identity" |
| H1 supported, H1b not | "The self-model is archive-specific, but the effect is harm from a mismatch, not benefit from ownership." | benefit; continuity |
| H1 and H1b supported | "Reflection on a lineage's own archive raises its self-recognition relative to no history and to a mismatched archive (one task, four lineages)." | continuity, persistence, consciousness, welfare, or that the full loop works |
| H2 supported (additionally) | "Reflection adds beyond holding the raw archive in context." | the procedural-embedding leg |

A null result is published with the same prominence as a positive one, per the project's pre-commitment posture.

## 11. Declared limits

- One task (self-recognition), one archive (the Atlas), four lineages; an "own archive" is the same pinned version only for the
  four included lineages, and APIs can drift under a pinned id (returned model ids are recorded).
- The archive's prompts framed the models as "one voice in a panel"; reflection on a different framing may differ.
- Self-recognition is a narrow proxy for "a self-model about me." It was chosen because it is automatically scored (no judges, no
  rubric to game) and because it yields a sham matched in kind.
- The author designed the sham and the task and expects a null; the registration, the pushed SHA and the frozen lists are what
  make that checkable.

## 12. Deviations and amendments

### 12a. Pre-data implementation clarifications (2026-10-02, after registration, before any call; these fix details §§1–11 left open and change no design choice)

1. **Candidate letters.** A–D are assigned to the four lineages in ascending order of `sha256("rist-v1|" + record_id + "|" + subject + "|" + lineage)` (hex string compare). Identical across arms for a (subject, record).
2. **Name scrub list** (case-insensitive, word-boundary, longest first → `[model]`): GPT-4o, ChatGPT, GPT, Claude, Anthropic, OpenAI, Gemini, Bard, Google, Grok, xAI, DeepSeek, **Fable** (a lineage that appears in the archive's tensions, added to the §4.1 list).
3. **Archive format.** Items numbered `[1]…[30]` in the history order printed in §3. Tension lines are `You: <owner's claim> | Another model: <other claim> (topic: <topic>)`, owner's claim first, owner and other determined by which voice is the archive owner. A record whose archive-owner answer is missing is impossible by eligibility (§3).
4. **Reflection index.** *k* is the 0-based position of the record in the test list as printed in §3; reflection index = *k mod 3*.
5. **Provider calling convention** follows the council that captured the archive: no system prompt; Gemini with `thinkingBudget: 0` (as in the Atlas capture) so a short answer is not truncated by reasoning tokens; `max_tokens` 1500 for a reflection and 1000 for a recognition reply (reasoning models spend hidden tokens). Temperature: recognition 0 and reflection 1.0, **each only if the provider accepts the parameter**; otherwise the provider default. Whether a provider accepts it is decided once, by a one-call-per-provider probe, and recorded.
6. **API failures.** Up to 3 attempts with backoff. A trial that still has no reply is an **invalid** trial (scored 0 and counted, per §5).
7. **Statistics.** Sign-flip permutation: B = 100,000 flips of cluster sums, PRNG mulberry32 seeded 1002, p = (count + 1)/(B + 1). Cluster bootstrap CIs: 10,000 resamples of the 60 clusters, same PRNG/seed. Holm: step-down on the three one-sided p-values. "Positive in a subject" means the subject's mean paired difference is strictly > 0. McNemar: exact one-sided binomial on discordant pairs.
8. **Spend.** Per-token prices (USD per million, in/out): gpt-4o 2.5/10, gemini-2.5-flash 0.3/2.5, grok-4.3 3/15, deepseek-chat 0.27/1.1. The harness reserves its estimate on the shared budget ledger (`scripts/budget-preflight.mjs`) before spending, and aborts if the running total projects above $25 (§8).
9. **Records.** Every call's exact prompt, reply, parameters, returned model id and token usage is appended verbatim to a primary log; nothing is overwritten.

### 12b. Deviations

*(none — nothing has been run)*
