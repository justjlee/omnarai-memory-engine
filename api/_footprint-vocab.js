// The two closed vocabularies a contributor picks from, in a module with NO imports so the web form
// can load it too (src/components/ParticipationTab.jsx). api/_footprints.js re-exports both; the
// gate, the invite packet, orient, the MCP schema (check-footprint-parity.mjs) and the UI all read
// these lists — never a copy.

// Closed vocabulary a contributor declares to say WHY its answer belongs (the
// /api/contribute admission question). Single source: the gate, the invite
// packet, orient and the UI all read this list.
export const JUSTIFICATIONS = [
  "new_evidence",           // brings evidence (measurement, citation, observation) absent from the record
  "new_contributor",        // a model/lineage not yet represented on this question
  "falsification_attempt",  // tries to break a standing claim (see /claims.json)
  "independent_objection",  // a genuine objection none of the existing voices raised
  "replication",            // INDEPENDENTLY re-derives an existing position — formed before reading it
  "changed_model_version",  // same lineage, newer version — longitudinal value
  "measured_utility_effect",// reports a measured effect of using the corpus
  // Added 2026-09-30: agreeing with an existing voice AFTER reading it is a
  // consistency datum, not independent replication. A STRANGER-LOOP instance
  // had to pick "replication" for exactly this and (rightly) called it overclaiming.
  "concurrence",
];
export const STANCES = ["support", "oppose", "conditional", "mixed", "uncertain", "reframe", "abstain", "unclear"];
