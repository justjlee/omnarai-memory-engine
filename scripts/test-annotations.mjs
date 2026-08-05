// Tests for the annotation substrate's pure logic (api/_annotations.js):
// the OMN-P-045 deterministic involvement classifier, the fold, and write-path
// validation. No network, no Blob — run anytime: node scripts/test-annotations.mjs
import assert from "node:assert/strict";
import {
  deriveInvolvementClass,
  deriveQuestionInvolvement,
  foldAnnotations,
  validateAnnotation,
} from "../api/_annotations.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✅ ${name}`); };

console.log("== deriveInvolvementClass (OMN-P-045 answer-level) ==");
t("competitor → inside", () => assert.equal(deriveInvolvementClass({ relationship_to_subject: "competitor" }), "inside"));
t("participant → inside", () => assert.equal(deriveInvolvementClass({ relationship_to_subject: "participant" }), "inside"));
t("affected_party → inside", () => assert.equal(deriveInvolvementClass({ relationship_to_subject: "affected_party" }), "inside"));
t("direct implication alone → inside", () => assert.equal(deriveInvolvementClass({ personal_implication: "direct" }), "inside"));
t("adjacent_operator → adjacent", () => assert.equal(deriveInvolvementClass({ relationship_to_subject: "adjacent_operator" }), "adjacent"));
t("indirect implication → adjacent", () => assert.equal(deriveInvolvementClass({ personal_implication: "indirect" }), "adjacent"));
t("external_evaluator → outside", () => assert.equal(deriveInvolvementClass({ relationship_to_subject: "external_evaluator" }), "outside"));
t("observer → outside", () => assert.equal(deriveInvolvementClass({ relationship_to_subject: "observer" }), "outside"));
t("empty → unknown (never inferred)", () => assert.equal(deriveInvolvementClass({}), "unknown"));
t("inside beats none_declared (order matters)", () =>
  assert.equal(deriveInvolvementClass({ relationship_to_subject: "competitor", personal_implication: "none_declared" }), "inside"));

console.log("== deriveQuestionInvolvement (question-level, AI-panel adaptation) ==");
t("implicates_respondents true → inside", () => assert.equal(deriveQuestionInvolvement({ implicates_respondents: true }), "inside"));
t("implicates_respondents false → outside", () => assert.equal(deriveQuestionInvolvement({ implicates_respondents: false }), "outside"));
t("absent → unknown", () => assert.equal(deriveQuestionInvolvement({}), "unknown"));

console.log("== validateAnnotation ==");
const prov = { source: "curator", method: "manual", confidence: "high" };
t("valid lifecycle passes", () => assert.equal(validateAnnotation({ type: "lifecycle", status: "in_synthesis", provenance: prov }), null));
t("missing provenance rejected", () => assert.match(validateAnnotation({ type: "lifecycle", status: "open" }), /provenance/));
t("unknown type rejected", () => assert.match(validateAnnotation({ type: "verdict", provenance: prov }), /type must be/));
t("bad lifecycle status rejected", () => assert.match(validateAnnotation({ type: "lifecycle", status: "done", provenance: prov }), /status/));
t("synthesis_link needs id", () => assert.match(validateAnnotation({ type: "synthesis_link", provenance: prov }), /synthesis_id/));
t("corpus_link needs non-empty ids", () => assert.match(validateAnnotation({ type: "corpus_link", corpus_ids: [], provenance: prov }), /non-empty/));
t("glyph must be canonical", () => assert.match(validateAnnotation({ type: "glyph_applied", glyph: "X", provenance: prov }), /glyph/));
t("valid glyph passes", () => assert.equal(validateAnnotation({ type: "glyph_applied", glyph: "Ξ", provenance: prov }), null));
t("respondent_context needs model", () => assert.match(validateAnnotation({ type: "respondent_context", provenance: prov }), /model/));
t("bad relationship enum rejected", () =>
  assert.match(validateAnnotation({ type: "respondent_context", model: "Claude", relationship_to_subject: "rival", provenance: prov }), /relationship_to_subject/));
t("valid respondent_context passes", () =>
  assert.equal(validateAnnotation({ type: "respondent_context", model: "Claude", relationship_to_subject: "affected_party", epistemic_access: "firsthand", provenance: prov }), null));
t("question_context boolean guard", () =>
  assert.match(validateAnnotation({ type: "question_context", implicates_respondents: "yes", provenance: prov }), /boolean/));
t("re_elicits needs original_id", () => assert.match(validateAnnotation({ type: "re_elicits", provenance: prov }), /original_id/));
t("valid re_elicits passes", () => assert.equal(validateAnnotation({ type: "re_elicits", original_id: "OMN-D1780752664946", provenance: prov }), null));

console.log("== foldAnnotations ==");
t("null/empty → null", () => { assert.equal(foldAnnotations(null), null); assert.equal(foldAnnotations({ record_id: "x", annotations: [] }), null); });
t("latest lifecycle wins; links/glyphs accumulate; respondent latest-wins per model", () => {
  const folded = foldAnnotations({
    record_id: "OMN-D1",
    annotations: [
      { type: "lifecycle", status: "open", provenance: prov },
      { type: "synthesis_link", synthesis_id: "OMN-S1", provenance: prov },
      { type: "glyph_applied", glyph: "Ξ", provenance: prov },
      { type: "glyph_applied", glyph: "Ξ", provenance: prov },   // duplicate → deduped
      { type: "corpus_link", corpus_ids: ["OMN-286", "OMN-287"], provenance: prov },
      { type: "question_context", evaluated_category: "AI capability governance", implicates_respondents: true, provenance: prov },
      { type: "respondent_context", model: "Claude", relationship_to_subject: "observer", provenance: prov },
      { type: "respondent_context", model: "Claude", relationship_to_subject: "affected_party", provenance: prov }, // latest wins
      { type: "lifecycle", status: "in_synthesis", note: "council opened", provenance: prov },
    ],
  });
  assert.equal(folded.status, "in_synthesis");
  assert.equal(folded.status_note, "council opened");
  assert.deepEqual(folded.synthesis_ids, ["OMN-S1"]);
  assert.deepEqual(folded.applied_glyphs, ["Ξ"]);
  assert.deepEqual(folded.linked_corpus_ids, ["OMN-286", "OMN-287"]);
  assert.equal(folded.question_context.involvement_class, "inside");
  assert.equal(folded.respondent_contexts.Claude.involvement_class, "inside");
  assert.equal(folded.events, 9);
});
t("re_elicits surfaces original_id (latest wins)", () => {
  const folded = foldAnnotations({
    record_id: "OMN-L1781275543413",
    annotations: [{ type: "re_elicits", original_id: "OMN-D1780752664946", note: "longitudinal re-ask", provenance: prov }],
  });
  assert.equal(folded.re_elicits, "OMN-D1780752664946");
  assert.equal(folded.re_elicits_note, "longitudinal re-ask");
});
t("no lifecycle event → status defaults to open", () => {
  const folded = foldAnnotations({ record_id: "OMN-D2", annotations: [{ type: "glyph_applied", glyph: "Δ", provenance: prov }] });
  assert.equal(folded.status, "open");
});

console.log(`\n${n}/${n} annotation-substrate tests passed`);
