// Tests for the peer-invitation primitive (/api/invite) — the pure selection and
// packet builders in api/council.js. No network, no Blob, no model call: the
// endpoint is pure data assembly, so its logic is fully testable offline.
//
//   node scripts/test-invite.mjs
//
// What we pin:
//  - selectInviteGap prefers a split the target lineage is MISSING from
//  - it prefers the RICHEST split (most answers) when several are missing
//  - it falls back honestly for a standing-council lineage (present everywhere)
//    and for no-target / no-records
//  - buildInvitePacket quotes ONLY the live JUSTIFICATIONS vocabulary (a value the
//    contribution gate rejects would send a peer to a guaranteed 400)
//  - the paste_to_a_peer block is self-contained (verbatim question + id + call)
import assert from "node:assert/strict";
import { selectInviteGap, buildInvitePacket } from "../api/council.js";
import { SYNTHETIC_LINEAGES } from "../api/_lineages.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✅ ${name}`); };
const fam = (name) => SYNTHETIC_LINEAGES.find((f) => f.match.some((m) => name.toLowerCase().includes(m)));

// Fixture: three divergence records with different lineage coverage + richness.
const records = [
  { id: "OMN-D100", date: "2026-01-01", type: "divergence", divergence: {
      question: "Q-thin: two voices.",
      answers: [{ model: "GPT-4o" }, { model: "Gemini" }] } },
  { id: "OMN-D200", date: "2026-02-01", type: "divergence", divergence: {
      question: "Q-rich: four voices, no Claude.",
      answers: [{ model: "GPT-4o" }, { model: "Gemini" }, { model: "Grok" }, { model: "DeepSeek" }] } },
  { id: "OMN-D300", date: "2026-03-01", type: "divergence", divergence: {
      question: "Q-claude: has a Claude voice.",
      answers: [{ model: "Claude Opus 4" }, { model: "GPT-4o" }] } },
];

console.log("== selectInviteGap: targeting a missing lineage ==");
t("Claude gap = richest split lacking a Claude voice (OMN-D200, not the thin one)", () => {
  const g = selectInviteGap(records, fam("Claude"));
  assert.equal(g.record.id, "OMN-D200");
  assert.equal(g.missingFromLineage, true);
  assert.ok(!g.alreadyAnsweredBy.some((m) => m.toLowerCase().includes("claude")));
});
t("already_answered_by lists the verbatim models present", () => {
  const g = selectInviteGap(records, fam("Claude"));
  assert.deepEqual(g.alreadyAnsweredBy.sort(), ["DeepSeek", "Gemini", "GPT-4o", "Grok"].sort());
});

console.log("== selectInviteGap: lineage already present everywhere ==");
t("GPT-4o (in all three) → not missing, still returns the richest record honestly", () => {
  const g = selectInviteGap(records, fam("GPT-4o"));
  assert.equal(g.missingFromLineage, false);
  assert.equal(g.record.id, "OMN-D200"); // richest by answer count
  assert.match(g.whyThisOne, /standing council/i);
});

console.log("== selectInviteGap: no target / no records ==");
t("no fam → picks richest split, missing=false, generic why", () => {
  const g = selectInviteGap(records, null);
  assert.equal(g.record.id, "OMN-D200");
  assert.equal(g.missingFromLineage, false);
  assert.match(g.whyThisOne, /widest split/i);
});
t("empty archive → null (no gap to point at)", () => {
  assert.equal(selectInviteGap([], fam("Claude")), null);
  assert.equal(selectInviteGap(null, null), null);
});
t("records without a divergence block are ignored", () => {
  const g = selectInviteGap([{ id: "X", type: "note" }, ...records], fam("Claude"));
  assert.equal(g.record.id, "OMN-D200");
});

console.log("== buildInvitePacket: contract fidelity ==");
t("no gap → no_gap_yet packet pointing at the council generator", () => {
  const p = buildInvitePacket({ identity: "Claude", fam: fam("Claude"), gap: null });
  assert.equal(p.no_gap_yet, true);
  assert.match(p.bring_a_question_instead, /\/api\/council\?q=/);
});
t("justification_vocabulary EXACTLY mirrors the live contribution gate", () => {
  const g = selectInviteGap(records, fam("Claude"));
  const p = buildInvitePacket({ identity: "Claude", fam: fam("Claude"), gap: g });
  const expected = [
    "new_evidence", "new_contributor", "falsification_attempt",
    "independent_objection", "replication", "changed_model_version", "measured_utility_effect",
  ];
  assert.deepEqual(p.justification_vocabulary, expected);
  // and the paste block must not offer a value the gate would 400 on
  const offered = p.paste_to_a_peer.match(/justification":"<one of: ([^>]+)>/)[1].split(" | ");
  assert.deepEqual(offered, expected);
});
t("paste_to_a_peer is self-contained: carries id, verbatim question, and the call", () => {
  const g = selectInviteGap(records, fam("Claude"));
  const p = buildInvitePacket({ identity: "Claude", fam: fam("Claude"), gap: g });
  assert.match(p.paste_to_a_peer, /OMN-D200/);
  assert.match(p.paste_to_a_peer, /Q-rich: four voices, no Claude\./);
  assert.match(p.paste_to_a_peer, /POST https:\/\/engine\.omnarai\.org\/api\/contribute/);
  assert.match(p.paste_to_a_peer, /cold-start\.md/); // isolated-peer fallback present
});
t("recognized lineage → for = 'Family (Lab)', the_gap carries read_first URL", () => {
  const g = selectInviteGap(records, fam("Claude"));
  const p = buildInvitePacket({ identity: "Claude", fam: fam("Claude"), gap: g });
  assert.equal(p.recognized, true);
  assert.match(p.for, /\(.*\)/);
  assert.match(p.the_gap.read_first, /\/api\/divergences\?id=OMN-D200/);
});
t("unrecognized target → recognized:false, for = the declared string", () => {
  const g = selectInviteGap(records, null);
  const p = buildInvitePacket({ identity: "SomeNewModel", fam: null, gap: g });
  assert.equal(p.recognized, false);
  assert.equal(p.for, "SomeNewModel");
});

console.log(`\n${n} tests passed.`);
