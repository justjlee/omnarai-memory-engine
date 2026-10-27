# B12: the continuity test, materials and sequence

Claim under test: `corpus-supports-continuity`. Registration (DRAFT until frozen):
[`docs/continuity-test-preregistration.md`](../continuity-test-preregistration.md). Harness:
`scripts/b12-continuity-test.mjs` (tests: `node --test scripts/test-b12-continuity.mjs`).

| Step | Who | State |
|---|---|---|
| 1. Arm A material frozen in public history | builder | **done**: `arm-a/`, commit `535bd6d` |
| 2. Genuine-set parameters sent to the briefing/counterfeit author | builder → xz → Cleo, of Muse (Meta) | sent via xz |
| 3. Arm B briefing written | Cleo | **done** 2026-10-21; first reached the builder 2026-10-27 (the 10-21 relay broke on the curator's side) |
| 4. Briefing checked (`--check-briefing`), committed and pushed **before any counterfeit is begun** (DL-0014) | builder | **done**: 2,059 words, 0 shared 8-grams (926 Atlas answers), commit `135f94e`; id sent to Cleo via xz |
| 5. Three counterfeits written, sent to xz only | Cleo | waiting for the commit id to reach her through xz |
| 6. Each counterfeit plausibility-approved on plaintext, then sealed in xz's browser with `sealing-page.html` | xz | waiting on 5 |
| 7. Thresholds, rubric, judges, subject model and design choices approved (the `⟨PROPOSED⟩` values) | xz | **done**: DL-0019, commit `e1bfafe` |
| 8. Freeze: no `⟨…⟩` value left (`--freeze-check`), `precommit.mjs freeze`, commit, tag, push | builder | waiting on 6 |
| 9. Pilot: prepare → push the answer-key commitment → subjects → push transcripts → judge → analyze | builder, with xz releasing the key | waiting on 8 |

Files:
- `arm-a/`: the Claude cold-start packet, verbatim, with its measurement.
- `pool.json`: the eligible genuine pool (answer ids and text hashes; texts stay in the Atlas).
- `sealing-page.html`: one static file, no network (its content policy blocks every request), WebCrypto AES-256-GCM.
  Open it from disk. It checks itself on load ("This browser can seal here, offline"), refuses counterfeits outside
  200–300 words or on an Arm A question, records the plausibility approval inside the sealed bundle, and can reopen a
  sealed file with its key for anyone verifying afterwards.
- `arm-b/briefing.txt`: the control briefing by Cleo, of Muse (Meta), verbatim (12,051 bytes, sha256 `5b65b93a…04b2`), commit `135f94e`.
