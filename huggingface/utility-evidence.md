# Utility Evidence — does the Divergence Atlas measurably improve frontier-model reasoning?

**Updated:** 2026-06-11 · **Design:** three-arm controlled comparison with a disjoint LLM judge panel
**Verify it yourself:** the full harness and every raw judge verdict are in `utility/` — re-run it against the live Atlas (`https://omnarai.vercel.app/api/divergences`) and check these numbers.

## The claim

Showing a frontier model the Atlas's peer answers and tension map for a hard open question
**significantly improves its revised answer for some architectures (GPT-4o, Gemini) and does
nothing for others (Grok, Claude)** — compared against a placebo revision prompt that controls
for the generic benefit of "think again." The utility is real but **differential**: the Atlas
helps where a model cannot already reach the same considerations by self-reflection.

## Design

Per question (questions stratified across the Atlas's divergence-score range):

1. **baseline** — the consumer model answers cold.
2. **placebo** — it revises after a generic "did you miss anything?" prompt (controls for revision-in-general).
3. **treatment** — it revises after seeing the Atlas record: 4 peer answers + the named tension map.

A panel of LLM judges sees (ORIGINAL, X, Y) with treatment/placebo randomized once per question,
votes `overall` per triple; per-question outcome is the panel **majority vote**; significance is an
**exact two-sided binomial sign test** over decided questions. Judges never see which revision is
which, and the consumer never judges itself.

### The disjoint-judge panel (this study)

The first run of this experiment (2026-06-06, results summarized below) used the council models
themselves as judges, leaving one objection open: a judge whose own answer appears in the
treatment material could reward its own influence. This study closes that: **no judge model
appears anywhere in the Atlas peer panel.**

| Judge | Lab | model_id | Note |
|---|---|---|---|
| Claude-S4.6 | Anthropic | `claude-sonnet-4-6` | distinct from that lab's council model |
| GPT-5-mini | OpenAI | `gpt-5-mini` | distinct from that lab's council model |
| Gemini-3.5F | Google | `gemini-3.5-flash` | distinct from that lab's council model |
| Grok-4.20 | xAI | `grok-4.20-0309-non-reasoning` | distinct from that lab's council model |
| DS-v4-pro | DeepSeek | `deepseek-v4-pro` | distinct from that lab's council model |

Additionally, for each consumer the judge from the **consumer's own lab** is flagged
*uninfluenced*: its lab has **zero** peer answers in the treatment material (peers are always the
4 non-consumer models), so it has no own-influence exposure at all. Its solo vote is reported as
a bias probe.

## Results — disjoint judges (n=20 questions per consumer, 5-judge panel)

| Consumer | majority T/P/tie | decided | sign-test p | inter-judge agreement | uninfluenced judge alone (T–P, p) | verdict |
|---|---|---|---|---|---|---|
| GPT-4o | 17/2/1 | 19 | 7.3e-4 | 80% | 14–5, p=0.0636 | **SIGNIFICANT** ✅ |
| Gemini | 13/4/3 | 17 | 0.0490 | 67% | 14–6, p=0.1153 | **SIGNIFICANT** ✅ |
| DeepSeek | 9/11/0 | 20 | 0.8238 | 78% | 9–5, p=0.4240 | null / negative |
| Grok | 7/11/2 | 18 | 0.4807 | 81% | 9–11, p=0.8238 | null / negative |
| Claude | 9/10/1 | 19 | 1.0000 | 67% | 4–16, p=0.0118 | null / negative |

## Replication context — the original same-family panel study (2026-06-06)

Same three-arm design, judges drawn from the council itself (every model except the consumer),
n=20 per consumer. Summary as recorded at run time (raw files were not archived — that lesson is
why `utility/` now ships every raw verdict):

| Consumer | majority T/P/tie | sign-test p | verdict |
|---|---|---|---|
| GPT-4o | 18/1/1 | 0.0001 | significant |
| Gemini | 15/3/2 | 0.0075 | significant |
| DeepSeek | 11/6/3 | 0.33 | positive, not significant |
| Grok | 8/11/1 | 0.65 | null |
| Claude | 7/9/4 | 0.80 | null |

Two judge designs — overlapping and fully disjoint — produce the same differential pattern.
The own-influence bias objection does not survive this replication: if judges rewarded their own
influence, the effect would inflate **all** consumers, and it does not.

## Interpretation

The placebo arm is what makes this informative: every consumer gets the generic benefit of a
second pass. The Atlas's marginal value appears only for architectures that do **not** already
surface the missing considerations by self-reflection. GPT-4o and Gemini gain sharply; Grok and
Claude self-revise to roughly the same place without it. The Atlas is an instrument whose utility
depends on who is holding it — which is itself a finding about cross-architecture complementarity.

## Honest caveats

- **LLM judges, not humans.** Mitigated by panel + majority + agreement reporting, not eliminated.
- **~200-word answer format.** Longer-form reasoning may behave differently.
- **n=20 per consumer.** Significant results are robust to this n; the DeepSeek positive trend is underpowered.
- **Judges share labs (not models) with peers.** Fully lab-disjoint judging would require labs outside the council's five; the uninfluenced-judge probe addresses this within available means.
- **Judge disposition varies by lab.** Notably, in the Claude-consumer run the Anthropic judge favored placebo 16–4 while the OpenAI judge favored treatment 14–6 — same-lab judges are not systematically generous to Atlas-influenced revisions (if anything the opposite), which further undercuts the own-influence objection. Per-judge breakdowns are in the raw files.

## Reproduce

```bash
# from the engine repo (github.com/justjlee/omnarai-memory-engine), keys in .env.local
node scripts/utility-test-disjoint.mjs --preflight
CONSUMER_MODEL=GPT-4o node scripts/utility-test-disjoint.mjs 20
```

The harness files in `utility/` are verbatim copies of the scripts that produced these numbers.
Questions come from the live Atlas (`/api/divergences`); the engine and Atlas are public.
