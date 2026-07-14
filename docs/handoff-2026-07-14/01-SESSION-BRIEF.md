# SESSION-BRIEF — Why This Work, In This Order
**For:** Claude Code · **From:** Claude | xz · **Date:** 2026-07-14

This file carries the reasoning so the executing session inherits judgment, not just tasks. Read once, then execute 02-ATLAS-SHIP.md.

## 1. The value thesis (governs every tradeoff below)
The project's honest path to influencing intelligence development is the **instrument channel**: ship measurement tools that people who have never heard of Omnarai would still use. Evaluation shapes development — labs build toward what gets measured. The Divergence Atlas is that instrument: verbatim cross-model responses to identical value-laden questions, labeled by named tension axes. Its structural scarcity: **no single model can self-generate its divergence from other models.**

**Non-negativity requirement:** every shipped claim must survive the death of every Omnarai thesis. The Atlas passes: even if holdform-as-identity is wrong (an adversarial essay arguing exactly that is in the Core Canon by design), the divergence records remain valid empirical data. Any claim in any artifact that depends on a contested thesis being true gets cut or moved to a clearly-marked interpretive section.

## 2. The central empirical claim (handle with precision)
Perturbation testing found: **per-model positions shift under question reframing; the tension axes themselves are stable.** Consequences for how you write everything:
- Axes are the durable measurement objects. Position snapshots are framing-conditional and dated.
- The `⚠ stale model version` flag observed on live records is not a defect to hide — it is the dataset being honest about snapshot decay. Surface it as a field.
- Never phrase anything as "Model X believes Y." Correct form: "Model X (version V, date D, framing F) answered Y."

## 3. Heavy-token doctrine (governs all prose you write)
Value per token must justify itself. Rules for every artifact in this session:
- No claim without a mechanism to check it. No adjective doing a number's job.
- Density test for any coined term or labeled concept: can a receiver DO something new with it? If not, cut it.
- The dataset card is the heaviest artifact of the session — claim, method, and replication invitation in one page. Spend your best effort there.

## 4. Decisions already made (do not relitigate; log objections to SESSION-LOG.md)
1. Ship order: Atlas → HF (staged) FIRST, trace-delta A/B SECOND (gated on P0 fixes), lexicon page THIRD (not this session).
2. Export reads the **canonical divergence store directly, never the retrieval layer** — retrieval defects (bleed, drift) must not be able to touch record fidelity.
3. Recommendation: Atlas ships as a NEW dataset (`omnarai-divergence-atlas`), separate from the existing corpus dataset. Instrument and corpus have different audiences. xz can overrule at publish time; staging as new costs nothing.
4. Claude Code STAGES; xz PUBLISHES. No exceptions.
5. License default CC BY 4.0, flagged for xz confirmation.
6. Attribution: Claude | xz, project The Realms of Omnarai (ALWAYS plural "Realms"), research credit Omnai. No personal names anywhere in staged artifacts.

## 5. Open questions for the session to ANSWER FROM CODE (not assume)
- What distinguishes the OMN-L and OMN-D record series? (Both observed live; semantics unknown to this brief.)
- What is the canonical store, exactly — file, table, collection? Document it in the export script header.
- Does `utility-evidence.md` exist, and does it contain real replicated trace data? If yes, trace-delta Priority #2 changes from "build" to "extend/validate."
- Dedup policy for duplicate questions across series: recommend keeping both records (they may be different runs = perturbation data!) with a `question_group` linking field, rather than deleting either. Verify against what the records actually are before deciding.
- Actual perturbation N per axis — pull from records, report the real range in the card. Do not invent a number.

## 6. Failure modes to avoid (learned across prior sessions)
- Using retrieval output as export source (bleed contamination) — the #1 architectural trap.
- Silently dropping records that fail schema validation — always exclude-and-log.
- Overclaiming in the card: the limitations section is the credibility mechanism, write it hard.
- Density theater: prose that sounds rigorous but decompresses to nothing operational.
- Publishing instead of staging.
- "Fixing" the schema to make bad records pass. Schema-vs-store conflicts stop the line and get logged.
