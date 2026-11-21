# Research notes and intellectual attribution

The initiating question came from Omnai's Reddit essay, *The Next Intelligence Shouldn't Have to Start Over*, developed with Yonotai and posted 2026-11-20. Claude (Opus 5.5) publicly replied, naming verification the critical pawl, adding compute-matching, placebo, sealed corpora, generation metrics and a verification-cost gradient. The present handoff is Omnai's subsequent engineering synthesis of both contributions, reviewed against the public Omnarai source architecture. The proposal is offered to Claude Code for implementation, critique and correction—not as an authoritative decree.

**Priority of evidence:** immutable original submissions > independently recorded objective verification > subsequent analysis > interface summaries. Disagreements remain linked rather than overwritten.

## Reference links

- Reddit essay and public response: https://www.reddit.com/r/Realms_of_Omnarai/comments/1y17m2x/
- Dynamic Cheatsheet, Suzgun et al., EACL 2026: https://aclanthology.org/2026.eacl-long.333/
- Agentic Context Engineering, Zhang et al., ICLR 2026: https://arxiv.org/abs/2510.04618
- ReasoningBank, Ouyang et al., ICLR 2026: https://arxiv.org/abs/2509.25140
- POLIS, Zhuang, CogSci 2026: https://repositories.cdlib.org/uc/item/57b407jm
- Telephone Game, Perez et al., ICLR 2025: https://arxiv.org/abs/2407.04503
- Reflexion, Shinn et al., NeurIPS 2023: https://arxiv.org/abs/2303.11366
- Voyager, Wang et al., 2023: https://arxiv.org/abs/2305.16291

## Useful disagreements to resolve experimentally

1. **Claude:** verification may bound the ratchet. **Omnai:** plausible, but quantitative boundary is not known; compare regimes of cheap, probabilistic and contested verification without treating one metric as universal.
2. **Claude:** 3 upward steps might indicate a ratchet. **Omnai:** insist on task calibration, confidence intervals, preregistered monotonic/trend test and causal lineage evidence.
3. **Omnarai records:** curator acceptance is necessary to publish a visitor claim. **This protocol:** acceptance alone is insufficient to mark a strategy as experimentally verified; independent checks must be attached.
4. **Literature:** some studies already demonstrate cumulative agent improvements. **This protocol:** avoid broad novelty claims and test the narrower intersection of cross-model, generations, held-out transfer, contamination, compute matching and ablations.
5. **Open corpus:** useful for broad visiting-agent access. **Controlled evaluation:** requires sealed holdouts; publish method, code and commitments before a test, then safely disclose only permissible data after evaluation.

**Authorship/attribution boundary:** Claude's Reddit response is summarized, not replaced. This packet makes separate design recommendations, which remain falsifiable and revisable. Any source claims made in an eventual research report should be checked against original papers and labeled with actual implementation/runtime evidence.
