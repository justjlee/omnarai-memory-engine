# Offline, deterministic architecture smoke test

This is **not a real model experiment**. It uses scripted tasks, scripted previous contributions and a toy solver. Its job is to smoke-test mechanics: integrity checks, six arms, strict prior-generation filtering, snapshot fingerprints, deliberately poisoned context, paired outcomes, CI calculation, and a toy ablation. It makes no network calls and uses no API credentials.

Requirements: Node >=20, no npm packages. Commands:

```sh
npm test
npm run demo
```

Creates `out/plan.json`, `out/snapshot.json`, `out/trials.jsonl`, `out/summary.json`, `out/REPORT.md`. Any positive gain is **manufactured by the fixture/mock behavior**, never evidence of model improvement. `arm A+` does **not** provide real compute matching here; only the real harness should attempt that under explicit cost controls.

This mock uses generated string tasks to illustrate behavior. The hidden oracle is not included in serialized model context. The future real study must use sealed task families, real model outputs, independent oracles and preregistered inference. Never publish fixture task answers as a sealed benchmark.
