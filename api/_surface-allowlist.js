// Counted figures that are CORRECT but legitimately differ from the live store.
// Read by api/_surface-audit.js (the public /api/sync tracker AND the deploy gates).
//
// Every entry needs a reason a stranger could verify — and because the tracker publishes this list, the
// exceptions are PUBLIC. An entry is a statement about HISTORY or a frozen release, never a way to silence a
// stale live number (fix those at the source: <!--live:KEY--> markers, data-live tokens, sync-doc-counts.py,
// omnarai-home/sync-counts.mjs). `surface` is a substring of the surface label ("/refutation-ledger",
// "hf:/realms-of-omnarai", "front:/").
export const ALLOWLIST = [
  { surface: "/refutation-ledger", key: "records", number: 124,
    reason: "Denominator of the refuted 'divergence is prevalent' test (5 of 124 certify, median DRI 0.987, run 2026-08 on the Atlas as it then stood). A result of record — deliberately NOT recomputed as the Atlas grows." },
  { surface: "hf:/realms-of-omnarai", key: "records", number: 124,
    reason: "Same refuted-premise denominator (5 of 124), quoted in the card's claims table, plus the dated 2026-07-20 sync note (Atlas v1.1.0 = 124 records)." },
  { surface: "hf:/omnarai-divergence-atlas", key: "records", number: 124,
    reason: "The card states that the figures in its refutation section come from the 124-record test and are 'not recomputed for the records added since'." },
  { surface: "hf:/omnarai-divergence-atlas", key: "records", number: 158,
    reason: "Field-coverage count inside the immutable v1.2.0 release (`divergence_score` present on 158 of that release's 166 records)." },
  { surface: "hf:/omnarai-divergence-atlas", key: "records", number: 137,
    reason: "Field-coverage count inside the immutable v1.2.0 release (`holdform_risk` present on 137 of that release's 166 records)." },
  { surface: "hf:/realms-of-omnarai", key: "works", number: 484,
    reason: "The text mirror's own count on its own card (text-only basis, synced 2026-10-05); the card states it lags the live total by design." },
  { surface: "hf:/realms-of-omnarai", key: "works", number: 436,
    reason: "Dated history in the card's sync log ('2026-07-20 sync brought the text mirror to 436 works')." },
];
