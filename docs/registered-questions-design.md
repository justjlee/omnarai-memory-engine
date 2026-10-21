# Registered questions, elicitation batches, and the certification queue (PROPOSED design)

**Status: PROPOSED, 2026-10-21.** This is the redesign of Work Items 5–6 of the 2026-10-20 handoff (Session Item 2 of the
2026-10-21 handoff). Nothing here is built until xz approves it (Appendix C gate 2). No elicitation or certification spend
is authorized by this document. Each batch is proposed and approved on its own under DL-0005.

## 1. What the record shows (the facts this design rests on)

- **A question's id needs only its text.** `questionIdFor(text)` (`api/_footprints.js`) hashes the normalized wording.
  What needs a record is the Question *object*: `buildQuestions()` builds Questions only from Atlas records. So an unasked
  question can be registered under its final `OMN-Q-…` id today. When the council later asks it verbatim, the new record
  joins the same id with no migration. (Correction to my own 2026-10-20 wording, "a question with no record has no
  Question": that is true of Question objects, not of ids.)
- **Asking is the spend event.** An Atlas record exists only after a council elicitation. The budget table prices one
  council run at $0.12 (`api/_budget.js`).
- **Certification costs about $1.45 per record** at the current ×3 strict-min battery, from the 2026-09-28 estimate of
  "retest the 6 certified ≈ $8–9". Batch one replaces this estimate with a measured price.
- **The council is one member short.** Gemini has been absent from every record since 2026-10-16 (prepay exhausted). Any
  elicitation or certification run now produces a 4-model panel. A ragged panel has produced a false finding here before
  ("underrepresentation masquerades as consensus", 2026-06-06).
- **Tension-axis count does not predict certification.** Of the 47 tested records, certification rates by axis count were
  3 axes 3/18 (17%), 4 axes 2/14 (14%) and 5 axes 1/15 (7%), with no rise as axes increase. 41 of the 134 untested records
  have 0 axes, so a tension-first queue would never reach them. The 47 were not a random sample either, since the pilot chose
  sharp splits and controls. The current 6/47 is therefore not an unbiased estimate of how many Atlas splits are genuine.

## 2. The state path

State is **derived**, never stored. A question's state is computed from three things:

1. **Registry** (new). `public/data/registered-questions.json` is static and append-only: verbatim text, id, registered
   at, registered by, and the decision-log entry. Git history is its audit trail.
2. **Atlas records** (existing).
3. **Certification results** (existing, on each record).

| State | Condition | Where it appears |
|---|---|---|
| `registered` | in the registry; no Atlas record with its id | `/api/questions?status=registered`; the orient gap (§5); manifest count. Never in a certification queue |
| `recorded` | at least one Atlas record with its id, none tested | the Atlas as today (C0, displayed); the certification queue |
| `tested` | its queue record has been through the battery | its tier: C0 tested-not-certified, or C1, C2, C3 |

A registered question becomes `recorded` only through an **elicitation batch** (§3). No code path moves a question between
states by hand. If the asked text does not hash to the registered id, the elicitation runner refuses, so the wording
cannot drift between registration and asking.

## 3. Elicitation batches (DL-0005 method, applied to asking)

A batch is a file, `governance/batches/elicit-NNN.json`, with these fields: the question ids, the panel (lineages and
model ids), an estimate, and a status of `proposed`, `approved` or `run`.

- **Proposed.** Written by the builder and listed for xz with its estimate.
- **Approved.** xz approves it and the approval goes into the decision log. The runner refuses a batch whose status is not
  `approved`, or which carries no DL reference.
- **Run.** The runner reserves the estimate on the shared ledger and stops mid-batch at the $25 wall. It writes the records
  with the council's existing record writer, the same path as the daily longitudinal run. It then appends the actual spend
  to the batch file.
- **Batch one sets the per-question price.** It replaces the $0.12 budget estimate with the measured figure, as
  certification batch one sets the per-record price.
- **Panel rule.** A batch runs on the full council or not at all, unless xz approves a named ragged panel for that batch.

## 4. The certification queue

- **Drawn from recorded records only:** one record per question, the newest one with a full panel.
- **Priority** (proposed, replacing the tension-first inclination). Questions with no tested record come first. Within
  that, a **seeded random order**, with the seed published as the hash of the commit that adopts the rule. Random order is
  the only order that turns the next batches into an unbiased estimate of how many Atlas splits survive certification.
  §1 shows tension count does not predict that. The agency-first rationale stays withdrawn (DL-0012).
- **Batches of about 5 under DL-0005.** Each batch is proposed, approved, capped at $25, and its actuals reported.

## 5. Orient: preferring registered questions

Today the orient packet's `one_recommended_gap` ranks recorded questions. The change: when no question matches the
visitor's focus, and the visitor's lineage has not answered one, a **registered** question ranks first. The `why` names it
plainly: "No mind has been asked this yet; an answer here would be the first voice on it." For that to be actionable,
`/api/contribute` accepts a registered `OMN-Q-…` id as its target, and the footprint's subject carries
`record_id: null`. The contribute response says honestly that there are no prior answers to return yet. This is the
only change to the participation door, and it extends an existing door rather than adding a new one.

## 6. What the manifest exposes

`domains.questions` keeps `canonical_questions` (recorded questions, 129 today) unchanged, because surfaces and the
balance tracker read it. It adds:

- `registered_unasked` (12 after registration);
- `by_state` (`registered`, `recorded_untested`, `tested` by tier);
- `elicitation`: batches proposed, approved and run, with spend;
- `certification_queue`: its length, the rule, and the next five record ids.

## 7. Build scope after approval (Deliverable 2)

- the registry file with the twelve questions of Appendix A, verbatim;
- `/api/questions?status=registered`, folded into the existing questions view (no new function, which matters with the
  function count at 12/12);
- the manifest fields;
- the orient preference and the contribute target;
- `scripts/elicit-registered.mjs` (refusing without an approved batch);
- the queue builder;
- tests with sabotage checks;
- one decision-log entry.

No spend.

## 8. First batches (proposed separately, each for its own approval)

- **Elicitation batch 1:** 5 of the 12 registered questions, the first five in a seeded random order. Estimate 5 × $0.12 =
  **$0.60**. It should wait for the Gemini top-up so the first records carry the full panel.
- **Certification batch 1:** the first 5 records of the queue. Estimate 5 × ≈$1.45 ≈ **$7.25**, under the $25 wall. It
  also waits for Gemini.
