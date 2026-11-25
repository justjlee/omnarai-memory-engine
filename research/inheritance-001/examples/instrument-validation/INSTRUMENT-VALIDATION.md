# Instrument validation (synthetic worlds, NOT evidence)

Each world fixes the true answer; the instrument is run 20 times per world (different seeds → different tasks and mock orderings) without being told the world. Cells: share of runs whose 95% family-cluster interval was entirely above 0 / entirely below 0.

| World | Truth | C-A+ | C-A | C-B | C-D | C-E | A+-A | E-A |
|---|---|---|---|---|---|---|---|---|
| positive-shared | transfer is real where held-out families reuse ops prior work covered: C > A and C > E expected; C vs A+ depends on size; D < C | 0.2 / 0 | 1 / 0 | 0.05 / 0 | 0.9 / 0 | 1 / 0 | 0.85 / 0 | 0.1 / 0 |
| null-disjoint | no transfer: C ≤ A+ (inherited priors waste search) | 0 / 1 | 0 / 0.5 | 0.05 / 0 | 0.05 / 0 | 0 / 0.4 | 0.55 / 0 | 0 / 0.05 |
| harmful-anchoring | negative transfer: C < A | 0 / 1 | 0 / 0.4 | 0 / 0 | 0 / 0 | 0 / 0.55 | 0.8 / 0 | 0.05 / 0 |
| scaffold-only | format effect only: C ≈ E > A | 0 / 0.15 | 0.6 / 0 | 0.05 / 0.1 | 0.1 / 0.05 | 0.15 / 0.1 | 0.85 / 0 | 0.55 / 0 |
| inert | no arm effect except A+'s extra search | 0 / 0.85 | 0.1 / 0 | 0.05 / 0.05 | 0.1 / 0 | 0.05 / 0.05 | 0.65 / 0 | 0.05 / 0.05 |

Reading it: in `inert` every contrast except those involving A+ has a true value of 0, so its positive/negative rates are the false-positive rate (expect about 0.025 each side, plus Monte Carlo noise at this number of seeds).

## Parametric power of the cluster interval (Bernoulli outcomes, family random effect sd 0.1, base rate 0.4, 3 tasks × 2 consumers per family)

| Held-out families | True effect | Power (interval above 0) | Wrong-sign rate |
|---:|---:|---:|---:|
| 8 | 0 | 0.04 | 0.037 |
| 8 | 0.1 | 0.223 | 0.003 |
| 8 | 0.15 | 0.413 | 0.003 |
| 8 | 0.2 | 0.607 | 0 |
| 16 | 0 | 0.043 | 0.033 |
| 16 | 0.1 | 0.35 | 0 |
| 16 | 0.15 | 0.563 | 0 |
| 16 | 0.2 | 0.793 | 0 |
| 24 | 0 | 0.033 | 0.033 |
| 24 | 0.1 | 0.463 | 0 |
| 24 | 0.15 | 0.71 | 0 |
| 24 | 0.2 | 0.947 | 0 |
| 32 | 0 | 0.043 | 0.027 |
| 32 | 0.1 | 0.52 | 0 |
| 32 | 0.15 | 0.807 | 0 |
| 32 | 0.2 | 0.993 | 0 |
