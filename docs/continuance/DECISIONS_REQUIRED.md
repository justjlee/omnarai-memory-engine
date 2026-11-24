# Decisions required (continuance handoff, 2026-11-23)

Each row gives what is undecided, a recommendation, and the safe default the code uses until xz decides. Nothing here was
assumed. **Owner of every decision: xz (curator).** Items marked ⛔ block something specific, and the row says what.

| # | Decision | Recommendation | Safe default now | Rollback |
|---|---|---|---|---|
| **D-A** | **Publish the branches.** `omnarai-memory-engine` is public, so pushing publishes code, docs, synthetic demos and Omnai's handoff verbatim. ⛔ blocks review on GitHub | Push `continuance-2026-11-23` and `inheritance-001-sync` and open **draft** PRs. Neither deploys anything | local only | delete the remote branches |
| D-001 | Route and tool names: `/api/problems`, `/api/changes`, `omnarai_problems`, `omnarai_changes` | `/api/problems` and `/api/changes` (no collisions found). Add MCP tools only after the HTTP preview has been used, and through `contract.js` + the parity gates | preview views under `council.js?_view=`, behind `OMNARAI_OPEN_WORK` / `OMNARAI_SIGNALS`, both unset | unset the flag |
| D-002 | A `resolves` relationship | Keep it a **work-event** fact (a claim reaches `reviewed` with all criteria met). Do not widen the Footprint vocabulary | not added | — |
| D-003 | Who registers problems; an HTTP curator action for registration, binding and moderation | Curator only, private until admitted. Add an operator-session action in `council.js` (the same auth as Arrivals) when the first real problem is registered | `_work-store.js` functions, called from curator code only | — |
| D-004 | Protocol 001 pilot approval | See IS1 `DECISIONS_REQUIRED.md` **D16** (ledger headroom) and **D17** (Pilot 002, expected $5.61, worst $14.07, proposed cap $18 or a smaller cap under D16) | `run-models` refuses without an approval file | — |
| D-005 | Production `PRIVATE_READ_FALLBACK` and retiring transition reads after DL-0043 | Read the production value; once every private-class prefix has been copied, set it to `off` on a preview, smoke-test, then promote | unchanged | set it back to unset |
| D-006 | Opt-in follow for Signals (capability, revocation, retention, consent) | Not before D-001 ships and a privacy threat model is written | none exists; every page says nobody is subscribed | — |
| D-007 | UTF-8 primary ingest route; binary later | Additive `POST /api/expressions` only after a moderation and threat review; binary needs its own review | module only; binary refused in code | — |
| D-008 | The fourth action (`/work`) inside Instrument, on the front door | Only after one **real** continuation (OW-1 below) is independently reconstructed and verified, with a front-door preview and smoke test | not built | — |
| D-009 | The API-key-shaped literal in `api/transcript.js`, `scripts/fetch-transcripts.mjs`, `scripts/verify-depth.sh` | Check that it is YouTube's public InnerTube key and not a key in xz's Google Cloud project (GCP console → Credentials). If it is xz's: revoke it, rotate, and move it to an env var | untouched; not printed in any log or doc | — |
| D-010 | What a redaction does to history | Signals already emits only a tombstone and never the body. State publicly that copies cached before a redaction cannot be recalled | as built | — |
| D-IS1-A | Model-release chronology in Protocol 001 | Record release dates and report them as a stratum; do **not** make them an eligibility rule | unchanged | — |
| D-IS1-B | Merge `inheritance-001` (via `inheritance-001-sync`) into `main` | After D-A and xz's read of `RECONCILIATION-2026-11-23.md`. No route, function or surface changes | unmerged | revert the merge |
| D-B | `CLAUDE.md` whole-suite command | Run `test-grown-guard` without the mem-blob loader (4 false failures otherwise), and note the Node 22.23 `test-figures` cancellations | unchanged | — |
| D-C | `omnarai-mcp` has no lockfile | Commit a `package-lock.json` so the SDK version is reproducible | unchanged | — |

## Not authorized and not done

No paid call, deploy, production read or write, migration, admission, publication of sealed material, outbound message,
claims-registry change or public scientific claim. Spend this session: **$0**.
