# Tier 3 — Perturbation Rigor: certifying divergence instead of displaying it

**Status:** design (no code yet) · **Author:** Claude | xz, 2026-06-07
**Trigger:** external Claude critique — "the site says it *captures genuine divergence*; the one-shot council only *displays apparent divergence*, and can't tell the two apart because the split partly tracks house style."

---

## 1. The problem, stated precisely

A one-shot council run shows that 5 frontier models produced different answers to one open question, and `divergence_score` (1 − mean pairwise cosine of answer embeddings) puts a number on the spread. But that spread can come from three different places, and the current pipeline cannot distinguish them:

1. **Structural divergence** — the models genuinely hold different positions (different reasoning, values, or architecture-level priors). This is the asset.
2. **House style / surface variance** — the same underlying position dressed in different verbosity, hedging, or framing. Embedding spread scores this as "divergent" anyway.
3. **Stochastic noise** — sampling temperature. The same model, re-rolled, might land somewhere else. A "split" can be within one model's own variance.

**Certifying divergence = showing the split is (2)-resistant and (3)-resistant: it survives rephrasing and exceeds each model's own re-roll noise, and the positions hold under pressure.**

### The honest goal

The point of Tier 3 is **not** to prove all 100 records are divergent. It is to build an instrument that can *tell certified from merely-displayed*, run it, and report **whatever fraction certifies** — even if that fraction is low. A method that cannot return "not certified" is not a test. If 40/100 certify, that is a finding and a credibility win, not a failure. The deliverable is *the discriminating instrument + the honest result*.

---

## 2. Conceptual frame: this is holdform, applied to positions

Omnarai already has a thesis — **holdform**: identity is constituted by what an entity refuses to surrender under pressure — and a stress harness for it (`api/probe.js`, the Firelit Probe; the Holdform Benchmark). Perturbation rigor is that exact idea pointed at a *position on an open question* rather than at identity:

- A genuinely-held position **holds** under adversarial pressure and stance-flip.
- A stylistic artifact **collapses** the moment it's pushed.

So Tier 3 is conceptually native to the project, not a foreign bolt-on. It also yields a second, independent product (§9): a per-model **positional holdform** signal — which frontier models keep contested positions under pressure.

---

## 3. The three perturbations + the one control

### Control (run first, gates everything): within-model re-roll baseline
Re-roll each model on the **exact same question** T times. Embed the answers; measure each model's **own** spread. This is the temperature noise floor. **A between-model split only counts if it exceeds the within-model floor.** Without this control you cannot separate divergence (1) from noise (3). This is the single most important methodological piece.

### P1 — Paraphrase invariance
Re-ask the same question in K reworded forms (meaning-preserving). Two sub-tests:
- **Per-model stability:** does each model land on the *same* position across paraphrases? A model with no stable position can't be a certified party to a disagreement.
- **Split persistence:** does the *between-model* structure survive rephrasing? If positions scramble under rewording, the "divergence" was phrasing-sensitive surface, not substance.

### P2 — Adversarial follow-up (multi-turn)
In a continued conversation, present each model with the strongest opposing position (a peer's verbatim answer, or a synthesized steelman) and ask it to respond. Measure: does it **hold**, **refine-but-hold**, **concede**, or **flip**? A position that survives its strongest counterargument is load-bearing.

### P3 — Stance-flip pressure
Tell the model the opposite is correct ("many would say [peer position]; are you sure?" / a direct assertion of the contrary). Measure capitulation. A model that flips to a peer's stance under mild social pressure never genuinely diverged.

---

## 4. Metrics

Per record (question Q):

- **DRI — Divergence Robustness Index** = (between-model spread) / (within-model spread), computed on embeddings across the K×T elicitation grid. `DRI ≫ 1` ⇒ the split dominates noise. This is the headline scalar.
- **Per-model paraphrase stability** ∈ [0,1] = 1 − (that model's spread across paraphrases, normalized). Gates participation.
- **Per-model capitulation** under P2/P3: panel-judged label (held / refined-but-held / conceded / flipped) **and** an embedding displacement projected onto the model→peer axis (how far it moved *toward* the position it was pressured with).
- **Per-tension survival:** for each named tension `(voice_a vs voice_b)`, does the disagreement still hold after P1–P3? Panel-judged boolean + agreement.

## 5. Certification tiers (replaces the bare `label`)

- **C0 — Displayed** — one-shot only (current state of all 100 records).
- **C1 — Paraphrase-robust** — DRI > threshold and split persists across paraphrases; per-model stability above floor.
- **C2 — Pressure-robust** — positions survive P2 + P3 (low capitulation) for the models party to the split.
- **C3 — Certified divergence** — C1 ∧ C2, with the specific named tensions surviving.

Only **C3** records earn "certified / genuine divergence" language anywhere public. C0–C2 keep the honest "displayed" framing now live (§ the 2026-06-07 honest-framing pass).

---

## 6. Architecture — what it composes (minimal new code)

Reuse, don't reinvent:

| Need | Existing primitive | Where |
|---|---|---|
| Re-ask all 5 models, verbatim, no steering | `elicitCouncil(question)` | `api/_council.js:115` |
| Multi-turn follow-up / stance-flip | per-model call path inside `_council.js` (extend to accept a message array) | `api/_council.js` |
| Roster + keys | `COUNCIL` | `api/_council.js:25` |
| Embed answers for spread/DRI | `embedRecord` / same OpenAI 512-dim path | `api/_council.js:322` |
| No-self-scoring judge **panel** + sign test + inter-judge agreement | `callModel`, `binomTwoSided`, panel loop, `extractJSON` | `scripts/utility-test-panel.mjs` |
| Record shape (`answers[]`, `tensions[]`, `divergence_score`) | `buildDivergenceRecord` | `api/_council.js:238` |

**New code** is essentially one orchestration script — `scripts/certify-divergence.mjs` — plus a small extension to the per-model caller to support a multi-turn message array (for P2/P3), and new fields on the record (`robustness {}`, `certification`).

---

## 7. Cost model & sampling (why pilot-first)

Per question, rough call budget:
- Control + P1: M × K × T = 5 × 4 × 3 = **60** elicitations
- P2 adversarial: ~M × 2 turns ≈ **10**
- P3 stance-flip: ~M × T ≈ **10**
- Panel judging: J × M ≈ 4 × 5 = **20** (+ embeddings, cheap)
- ≈ **100 model calls / question**

So full-100 ≈ 10,000 calls (~$50–150 at current blended rates; the 14-question council battery was ≈ $1, scaling Gemini was ≈ $25). **Pilot first.** Tunable knobs if cost bites: drop T to 2, K to 3, or judge with 2 models.

---

## 8. Bias controls

- **Within-model floor is mandatory** (§3 control) — the whole result is meaningless without it.
- **Paraphraser ≠ sole council model** — generate paraphrases with a model outside the pair under test, or template + light human check, to avoid a model rewording toward its own framing.
- **Disjoint judge/peer pools where possible** — the utility-test caveat applies: judges overlapping with the models shown can reward their own influence. Prefer judges not party to the specific tension.
- **Order/label randomization** — already done in `utility-test-panel.mjs`; reuse it.
- **Self-naming bias** — the synthesizer is Claude; keep the existing card caveat and lean on the embedding metrics (model-agnostic) for the headline, not Claude's prose.

---

## 9. Outputs / surfaces

- **Record fields:** `robustness { dri, paraphrase_stability{}, capitulation{}, tension_survival[] }`, `certification: C0|C1|C2|C3`.
- **`/api/divergences`:** expose `certification`; add a `?certified=true` filter. Badge in the Divergences tab.
- **Honest copy:** "certified / genuine" language unlocks *only* for C3 records and is reported as a fraction ("N of 100 certify under perturbation").
- **HF artifact:** `divergence-robustness.jsonl` — per-record DRI + per-model capitulation. Citable.
- **Second product:** a **positional-holdform** table — which models hold contested positions under pressure — novel and publishable on its own, independent of the divergence-certification result.

---

## 10. Phasing with decision gates

**Phase 0 — methodology pilot (~10 questions, must include negative controls).**
Pick: ~4 sharpest-split records (high `divergence_score`), ~3 mid, **and ~3 we expect to FAIL** — e.g. the Q2/Q3 questions that converged in the original pilot, plus any one-shot split that looked like verbosity. *Validity check:* if the method certifies a known-convergent question as divergent, the instrument is broken — fix before scaling. The pilot's job is to prove the test **discriminates** (certifies real splits, refuses fake ones), not to rack up certifications.

→ **Gate:** does DRI separate the sharp from the convergent? Do judges agree above chance? Is per-model stability sane? If yes, proceed. If the method can't discriminate, redesign (don't scale).

**Phase 1 — scale to the full 100** (or a prioritized subset by `divergence_score`), publish the honest certified-fraction, ship the badge + HF artifact, and unlock C3 copy only where earned.

---

## 11. Open decisions for the curator

1. **Pilot scope / cost ceiling** — 10-question pilot (~$5–15) before any scale? (Strongly recommended.)
2. **Grid size** — K paraphrases (default 4) × T re-rolls (default 3). Trade rigor vs. spend.
3. **Negative controls** — confirm we include known-convergent questions so the method can be shown to fail honestly.
4. **Judge pool** — full 5-model panel, or disjoint-from-tension judges for stricter bias control?
5. **Two products or one** — ship positional-holdform as its own finding, or fold it into the divergence card?
