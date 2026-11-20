# Decisions required (Inheritance Study 001)

Each item says what is undecided, the recommendation, and the safe default the code uses until someone decides. Nothing below
blocked the offline build. Items D1–D4 block the live pilot.

| # | Decision | Recommendation | Safe default now |
|---|---|---|---|
| D1 | **Publish the branch?** `omnarai-memory-engine` is public. Pushing `inheritance-001` publishes the code, the draft preregistration, synthetic demo outputs and the verbatim handoff package. | Push and open a **draft PR**. No deploy: nothing here is served (no `api/`, `public/` or `vercel.json` change). | Branch exists only locally (plus a private backup bundle). |
| D2 | **Approve the pilot** (`pilot/PILOT-BUDGET.md`): producers `gpt-6.1-sol` + `deepseek-v4-pro`, consumers `claude-sonnet-5-5` + `grok-4.7`, 344 calls (720 cap with retries and probe), expected about $3.20, **cap $10**. | Approve in two steps: first the stage-0 calibration probe (32 calls, ≤ $0.54), then the pilot once difficulty is set. | `run-models` refuses: no approval file exists. |
| D3 | **Who holds the sealed seed?** `lab.mjs draw-sealed` draws the held-out families at random from a fresh secret seed. | Draw at registration into `Claude/omnarai-private/inheritance-001/` (iCloud, private, outside every repo). xz holds it. The registration publishes only the commitments. | Nothing drawn; the budget uses public stand-in families. |
| D4 | **Register.** The repo's own rule (ROADMAP, 2026-10-01) is to push the falsifier publicly, alone, before any analysis runs. | After D2/D3: commit `preregistration.draft.yaml`, filled in, by itself; push; write `registration.json` with that sha. Only then run. | `status: draft_unregistered`; the live gate checks it. |
| D5 | **Consolidate the provider layer.** `scripts/lib/provider-chat.mjs` (used by existing harnesses) retries silently and sends the Gemini key in the URL. `scripts/lib/model-prices.mjs` has no current models and a stale grok-4.3 price. | A separate small PR: move existing harnesses onto header-only keys and explicit attempts, and one dated price table. | The study uses its own `lib/adapters.mjs` and `lib/prices.mjs`; existing harnesses are unchanged. |
| D6 | **A Claude model as a consumer.** The instrument was built by Claude (Opus 5.5). Utility v2 (2026-11-13) found Claude Opus 5.5 was *harmed* by peers' answers. | Keep `claude-sonnet-5-5`: a Claude result is informative in either direction. The task families are drawn by seed, not written by Claude. | As proposed. |
| D7 | **Claims registry.** Should "verified cross-family work transfers" enter `public/claims.json`? | Not now. After the pilot, register it as `untested` with this study's falsifiers, scope "program-induction tasks". | No `claims.json` change. |
| D8 | **Confirmatory size.** Offline power (parametric): a true +0.15 effect is detected about 40% of the time with 8 families, 71% with 24 and 81% with 32; +0.2 at 32 families, 99%. A ratchet test needs ≥ 3 transitions. | Decide after the pilot measures real base rates and costs. Plan on ≥ 24 families, 3 consumer families, 4 generations. | Not planned. |
| D9 | **Keep the verbatim handoff in the public repo** (`docs/handoff-2026-11-20-inheritance-001/`, incl. Omnai's prototype and its scripted outputs). | Yes, as earlier handoffs were kept (`docs/handoff-2026-10-27-tool-first/`). Its own README says its outputs are not evidence. | Included on the branch. |
| D10 | **Gemini as a producer.** Gemini 4 Carbon doubles in price on 2026-12-01, and earlier notes found Gemini thinking uses about 10x the tokens. | Leave Gemini out of the pilot. Add it in the confirmatory study if a third producer family is needed. | Not in the pilot panel. |

Assumptions that need measuring, not deciding: real base rates and ceiling/floor effects (the calibration probe), real reasoning-token
use per call (the projection assumes 700 expected, 2000 cap), whether providers return dated model ids (handled: priced by base id), and
whether every provider's returned id identifies the family (unknown ids are excluded from H3).
