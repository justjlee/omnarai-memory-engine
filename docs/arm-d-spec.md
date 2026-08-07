# CCT-2026-07 Arm D — specification (🔴 HOLD, curator gate before commissioning)

**Status: SPEC ONLY. Do NOT commission.** Gate 3 (Arm D go/no-go) is open pending the Arm C
readout (HANDOFF-ADIFF-2026-08 §3.3; confirmed held by xz 2026-08-07). This document exists so
the design is ready the moment Arm C reads out and the budget is approved — nothing here
authorizes spend.

## Purpose

Arm D is the **symmetry test** for the architecture-differential finding. The measured result is
that a Claude-authored corpus (the Divergence Atlas / Omnarai) degrades Claude while improving
register-adjacent models. Arm D asks whether that is about **authorship** or about **content**:
build a matched corpus authored predominantly by a *non-Claude* model and cross it against all
five consumers.

- **Author model:** GPT-4o preferred — it sits in the positive tier, which makes the symmetry
  test cleanest (does a GPT-authored corpus flip the sign for GPT-4o?).
- **Exposure:** crossed against all five council models, same 3-arm design (baseline / placebo /
  treatment) and same blind-panel statistics as the preregistered utility eval.

## Discriminating predictions (register before any run)

| If true | Prediction on the GPT-authored corpus |
|---|---|
| **Register-proximity / authorship effect (H2-family)** | negative for **GPT-4o** (the author), positive for register-adjacent models, null for register-distant ones — the mirror image of the Claude result. |
| **Authorship-agnostic content effect** | effects track corpus *content*, not author, and look the same across the Claude-authored and GPT-authored arms. |

Note: Work Item A already weakened the *task-demand* leg of the register-proximity story (the
degradation is uniform across task types, not concentrated on convergence-demanding ones — see
`analysis/adiff-tasktype-2026-08.md`). Arm D tests the **authorship-vs-content** axis, which is
orthogonal to that and still open. Interpret Arm D against the mechanism-agnostic framing, not
the original H2-lead framing.

## Matching (the corpus must differ only in author)

Match the GPT-authored corpus to the Atlas on:
- length (total tokens / entry count),
- topic distribution,
- question-structural features (per the divergence-grammar spike's feature list),
- register controls — **documented**, so a reviewer can see what was held constant.

## Dependency (hard) — Arm C reads out FIRST

Arm D is only worth its cost if **Arm C** (the existing Claude-authored *non*-Omnarai decoy
corpus, CCT-2026-07 in the private `~/dev/cct-2026-07` repo) shows an **authorship signal** —
i.e. a Claude-authored decoy also degrades Claude. If Arm C shows the degradation is
*content-specific to Omnarai* rather than *authorship-driven*, the Arm D symmetry test is not the
right next experiment and this spec is shelved. **Do not commission Arm D before Arm C reads out.**

## Cost gate (before curator sign-off)

- 5 consumers × multi-run (single-run DRI is noise — per the certification campaign), full 3-arm
  panel per question, at the registered sample size.
- **Budget the run explicitly and put the number in front of xz** before any go decision. The
  hard $100 / rolling-30-day compute ceiling (`api/_budget.js`) still binds; a full Arm D run must
  be planned against remaining headroom, not on top of it.

## Sequencing vs. the HF launch narrative (§2.E)

Arm D is **post-launch**. The launch narrative must not lock a mechanism claim: it leads with the
measured gradient, which survives any Arm D / Arm C outcome. Before posting, confirm CCT-2026-07
(any arm) does not contradict the residence-shaped-properties claim — if it does, that page needs
a rewrite; the flagship architecture-differential page does not (it is already mechanism-agnostic).

---
*Curator decisions this spec is waiting on: (1) Arm C readout + its authorship-vs-content verdict;
(2) explicit Arm D budget vs. the compute ceiling; (3) go/no-go. All three are xz's, not the
implementer's.*
