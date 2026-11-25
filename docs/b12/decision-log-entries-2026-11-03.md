# B12 decision-log entries of 2026-11-03, published before the pilot

The three entries below are published here, on branch `b12-arm-a-material`, before any pilot call is made. The decision
log on main (`governance/decision-log.md`) was held by another session's deploy at the time. They are appended to that
log verbatim, as DL-0035 to DL-0037, once main is free. DL-0034 is that deploy's own entry.

---

## DL-0035 · 2026-11-03 · B12: the first three counterfeits are retired unsealed; the judge panel stays as approved, with a dated note on Gemini
- Decider: xz (chose "Cleo writes three new ones", "Keep as approved" and "Yes, add the note" in the Claude Code session
  of 2026-11-03)
- Reason: Cleo, of Muse (Meta) sent three counterfeits to xz in the same message as her reply to the builder's report.
  The whole message was relayed to the builder, who therefore saw their plaintext before sealing and before the freeze.
  That is the exposure the blind exists to prevent. All three were retired, unsealed and unused. Neither their texts nor
  their questions are kept on the builder's side. Three new ones were written on other questions and sent to xz alone.
  Separately, `deepseek-chat` stays a judge as approved in DL-0019, although DeepSeek now answers that name as
  `deepseek-flash`; the harness records the provider-reported model on every call. Registration §6 receives a dated
  correction, because its stated reason for leaving Gemini off the judges (credit exhausted) is no longer true. The panel
  is unchanged.
- Source: branch b12-arm-a-material, commit 820c77c (docs/b12/README.md; docs/continuity-test-preregistration.md §6)
- Logged: 2026-11-03 by Claude Code (Anthropic). First published, before any pilot call, in
  docs/b12/decision-log-entries-2026-11-03.md on branch b12-arm-a-material.

## DL-0036 · 2026-11-03 · B12 v1 is frozen
- Decider: xz ("Proceed to freeze", and then "Yes — push the freeze" after his message interrupted the first push), in the
  Claude Code session of 2026-11-03
- Reason: xz approved the three new counterfeits on plaintext and sealed them in his browser at 2026-11-03T19:58:53Z. He
  confirmed they are the new three, not the retired ones. The values that waited for artifacts are filled:
  - Arm B commit 135f94ec01a8bb04a3f2e5ac8eea028a54bfc20c, sha256
    5b65b93a64ed45ff354d284776e789e84153b9a1165df055d5fa50a62c8104b2;
  - the sealed file's sha256, 03a4302ec68616ecccf428826ad66e196086d216ac6d305f350e0badee6b5034.
  The precommit.mjs record verifies against the hash the harness computes,
  b33104c332382b7f70741cd076e34a9ca9246be82dad3aa5bf4659bd56b90141. Design values are unchanged since DL-0019. The builder
  holds only the ciphertext, and the key stays with xz until run start. Any change from here is v2.
- Source: commit e0c5fe57697e39cc732e2d2c9150bc37f76164ad, tag precommit/corpus-supports-continuity/20261103; record
  precommitments/corpus-supports-continuity/2026-11-03T20-12-29-547Z.json
- Logged: 2026-11-03 by Claude Code (Anthropic). First published, before any pilot call, in
  docs/b12/decision-log-entries-2026-11-03.md on branch b12-arm-a-material.

## DL-0037 · 2026-11-03 · B12 pilot spend approved
- Decider: xz ("Go", in the Claude Code session of 2026-11-03)
- Reason: the pilot of the frozen B12 v1 registration makes 18 subject calls (claude-opus-5-5, effort medium, no
  fallback) and 15 judge calls (gpt-4o, grok-4.3, deepseek-chat). It is estimated at $2.54 at list prices, and the
  harness reserves $6 on the shared ledger (the DL-0005 method). This approves this pilot only. A second run, or a run of
  a v2 registration, needs its own approval.
- Source: branch b12-arm-a-material, commit 46a2682 (README step 9); harness --plan on the frozen registration
- Logged: 2026-11-03 by Claude Code (Anthropic). First published, before any pilot call, in
  docs/b12/decision-log-entries-2026-11-03.md on branch b12-arm-a-material.
