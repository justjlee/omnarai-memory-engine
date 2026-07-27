// Local-script guard for the SAME rolling-30-day compute ceiling the serverless
// endpoints enforce (api/_budget.js). Local research runs (utility studies, Atlas
// builds) hit the provider APIs straight from this machine, bypassing the
// serverless functions — so they can't be gated there. This helper makes them
// accountable to the shared Blob ledger instead.
//
// Usage, at the top of a script's real (money-spending) work:
//
//   import { preflightSpend } from "./budget-preflight.mjs";
//   await preflightSpend({ estUsd: 90, label: "utility-test-prereg full run" });
//
// Behavior:
//   • Reads the shared ledger. If this run's estimate would cross the ceiling,
//     it BLOCKS (exit 1) unless the operator passes --i-accept-spend (or sets
//     I_ACCEPT_SPEND=1) — a deliberate, per-run override so supervised work is
//     never killed silently but never spends silently either.
//   • Fails CLOSED on a ledger read error (same doctrine as the server gate):
//     no proof we're under budget ⇒ no spend, unless overridden.
//   • On proceed, RESERVES the estimate up front (records it before the run) so a
//     second run started concurrently sees this one's spend and can't both slip
//     under the ceiling. Reserving the estimate over-charges slightly if the run
//     comes in cheap — the safe direction for a hard cap.
//
// Requires BLOB_READ_WRITE_TOKEN in the environment (source .env.local).

import { spentLast30DaysUsd, resolvedCeilingUsd, recordSpend, budgetCapUsd } from "../api/_budget.js";

const OVERRIDE = process.argv.includes("--i-accept-spend") || process.env.I_ACCEPT_SPEND === "1";

export async function preflightSpend({ estUsd, label = "local run" }) {
  const est = Number.isFinite(estUsd) ? estUsd : 0;
  let spent, ceiling;
  try {
    spent = await spentLast30DaysUsd();
    ceiling = await resolvedCeilingUsd(); // honors a live override if one is set
  } catch (e) {
    if (!OVERRIDE) {
      console.error(`[budget] ledger unreadable (${String(e?.message || e)}) — refusing to spend on "${label}".`);
      console.error(`[budget] re-run with --i-accept-spend if you accept the spend without a ledger check.`);
      process.exit(1);
    }
    console.warn(`[budget] ledger unreadable; proceeding on "${label}" under --i-accept-spend (NOT recorded).`);
    return { recorded: false, overridden: true };
  }

  const projected = spent + est;
  console.error(
    `[budget] rolling-30d spent ~$${spent.toFixed(2)} / ceiling $${ceiling.toFixed(2)} ` +
    `(cap $${budgetCapUsd().toFixed(2)}). "${label}" est ~$${est.toFixed(2)} → projected ~$${projected.toFixed(2)}.`
  );

  if (projected > ceiling && !OVERRIDE) {
    console.error(`[budget] BLOCKED: "${label}" would cross the ceiling. Wait for spend to age out of the 30-day window, or re-run with --i-accept-spend to override.`);
    process.exit(1);
  }
  if (projected > ceiling) {
    console.warn(`[budget] OVERRIDE: proceeding past the ceiling on "${label}" under --i-accept-spend.`);
  }

  const recorded = await recordSpend("study", { usd: est });
  if (!recorded) console.warn(`[budget] note: could not write the reservation marker — this run will under-count in the ledger.`);
  return { recorded, overridden: projected > ceiling, spent, ceiling, projected };
}
