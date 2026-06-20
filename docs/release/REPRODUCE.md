# Reproduce the Divergence Atlas utility result

The claim: *showing a frontier model the Atlas's peer answers + tension map for a hard
open question measurably improves its revised answer — significantly for GPT-4o and Gemini,
not for Grok/Claude — versus a placebo "think again" prompt.* Here's how to check it yourself,
at two levels of effort. **Tier 0 needs no API keys.**

---

## Tier 0 — look at the evidence (no keys, ~2 min)

Everything that produced the published numbers is open.

```bash
# 1. The live Atlas — the questions and verbatim answers under test
curl -s "https://omnarai.vercel.app/api/divergences" | head -c 2000
curl -s "https://omnarai.vercel.app/api/divergences?id=OMN-L1781275070811"   # one full record

# 2. The raw judge verdicts behind the headline numbers (HuggingFace)
#    https://huggingface.co/datasets/TheRealmsOfOmnarai/realms-of-omnarai/tree/main
#    -> utility/  : every per-question verdict, per consumer, verbatim
#    -> utility-evidence.md : the design + result tables
```

Load the dataset directly:

```python
from datasets import load_dataset
ds = load_dataset("TheRealmsOfOmnarai/realms-of-omnarai")   # includes the Atlas configs
```

If you only want to confirm the result is real and self-consistent, Tier 0 is enough: the
verdicts in `utility/` are the actual judge outputs; recompute the sign tests from them.

---

## Tier 1 — re-run the experiment (needs council API keys, ~5–15 min for one consumer)

This regenerates the three-arm comparison live. It calls models, so it needs keys.

**Prereqs**
```bash
git clone https://github.com/justjlee/omnarai-memory-engine
cd omnarai-memory-engine && npm install
# create .env.local with the API keys you have (see "Keys" below)
```

**Keys.** The experiment uses a *consumer* model (the one being helped) and a *judge panel*
(every council model except the consumer). You need keys for the models you want to exercise:
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`.
The questions and peer answers come from the public Atlas — you are not generating those.

**Run it**
```bash
# preflight checks which keys are live and which judges are available
node scripts/utility-test-disjoint.mjs --preflight

# one consumer, small n for a fast taste (the published runs used n=20)
CONSUMER_MODEL=GPT-4o node scripts/utility-test-disjoint.mjs 5
```

You'll get, per consumer: treatment/placebo/tie counts, decided n, the exact binomial
sign-test p, and mean inter-judge agreement — the same shape as the published tables. Expect
GPT-4o and Gemini to favor treatment; Grok and Claude to come out ~even.

**Other harnesses**
- `scripts/utility-test-panel.mjs` — the same-family panel edition (judges include peers).
- `scripts/utility-test.mjs` — the original single-judge version.
- `scripts/utility-test-prereg.mjs` — the **preregistered confirmatory** harness (dual length
  caps, 3 paraphrases, adversarial follow-up, human-subset export, n=25 fixed stop). This is
  the full, hardened study; see `docs/utility-eval-preregistration.md`. It's a few thousand
  model calls — run consumers one at a time.

---

## What counts as reproducing it

- **Direction:** treatment > placebo for GPT-4o and Gemini; no advantage for Grok/Claude.
- **Significance:** the GPT-4o/Gemini sign test stays significant at reasonable n (≥~15 decided).
- **Honesty check:** the *placebo* arm should beat baseline for everyone (a second pass helps in
  general) — the Atlas's claim is specifically treatment **over placebo**. If you only compare
  treatment to baseline you'll overstate it; that's the mistake the placebo arm exists to prevent.

Found something different? That's useful — open an issue on the repo with your run's raw output.
