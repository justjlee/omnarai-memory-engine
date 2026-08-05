// ── Atlas annotation substrate (2026-07-18, three-handoff arbitration) ────────
// ONE append-only annotation layer on divergence records, serving two consumers:
//
//   1. Tension lifecycle (Grok "Atlas-central" handoff): status (open /
//      in_synthesis / resolved / evolving), synthesis links, corpus links,
//      applied glyphs — so a tension that has been worked on becomes a tension
//      with a visible lineage. Closes the loop the record itself cannot show.
//   2. Respondent context (OMN-P-045 Layer 1): question_context +
//      respondent_context + a transparent, deterministic involvement_class —
//      "where does the respondent stand in relation to the question?" Declared
//      or curator-annotated position ONLY; never motive inference, never a
//      credibility ranking. Labels are descriptors, same philosophy as the
//      evidence-status axis.
//
// GOVERNANCE (§0.5): primaries are immutable. Annotations live in their OWN blob
// namespace (`annotations/<recordId>.json`, per-record — the per-entry pattern
// that replaced the unsafe consolidated array, see CONTRIB_PREFIX rationale in
// council.js) and POINT AT primary ids. Every annotation carries provenance
// (source / method / confidence / recorded_at / author). Removing this layer
// entirely would leave every primary record byte-identical.
//
// Underscore module ⇒ not a deployed function (12-function Hobby cap). Reads
// fold into the /api/divergences?id= response; writes fold into council.js
// POST {action:"annotate"} (Bearer INGEST_SECRET — curator/council gated).
import { list, put } from "@vercel/blob";

export const ANNOTATION_PREFIX = "annotations/";

// Annotation types — the closed set. Unknown types are rejected at the write
// path so the substrate stays interpretable to future readers.
export const ANNOTATION_TYPES = [
  "lifecycle",          // { status: open|in_synthesis|resolved|evolving, note? }
  "synthesis_link",     // { synthesis_id, note? }  → feeds derived synthesis_ids[]
  "corpus_link",        // { corpus_ids: [OMN-*...], note? }
  "glyph_applied",      // { glyph: Ξ|Ψ|∅|Ω|∞|Δ, context? }
  "question_context",   // OMN-P-045: { evaluated_category, situation_summary, implicates_respondents }
  "respondent_context", // OMN-P-045: { model, relationship_to_subject, personal_implication, epistemic_access, declared_stake }
  "re_elicits",         // longitudinal linkage: { original_id, note? } — this record re-asks an earlier record's question with current models (same question, later date). Marks a deliberate longitudinal probe, not a duplicate. Primary untouched.
];
export const LIFECYCLE_STATUSES = ["open", "in_synthesis", "resolved", "evolving"];

// ── OMN-P-045 deterministic involvement classifier ────────────────────────────
// Transparent and testable by design (scripts/test-annotations.mjs). Adapted for
// an AI-panel corpus: for model respondents, position is usually a property of
// the QUESTION (a five-model panel asked about AI capability is inside-position
// by construction; the same panel on a history question is outside), so
// question-level classification comes first and answer-level context is only
// recorded where an answer explicitly self-positions. relationship enums follow
// the OMN-P-045 rev-3 schema; absence is "unknown", never inferred.
export function deriveInvolvementClass(ctx = {}) {
  const rel = ctx.relationship_to_subject;
  if (["participant", "competitor", "beneficiary", "affected_party"].includes(rel) || ctx.personal_implication === "direct") return "inside";
  if (rel === "adjacent_operator" || ctx.personal_implication === "indirect") return "adjacent";
  if (rel === "external_evaluator" || rel === "observer" || ctx.personal_implication === "none_declared") return "outside";
  return "unknown";
}

// Question-level variant: does the question implicate the answering panel itself?
// For an all-AI panel, implicates_respondents=true ⇒ every respondent is inside.
export function deriveQuestionInvolvement(qctx = {}) {
  if (qctx.implicates_respondents === true) return "inside";
  if (qctx.implicates_respondents === false) return "outside";
  return "unknown";
}

// ── Storage (per-record blob; appends are RMW on ONE record's blob only) ──────
export async function loadAnnotations(recordId) {
  try {
    const { blobs } = await list({ prefix: `${ANNOTATION_PREFIX}${recordId}.json` });
    const hit = blobs.find((b) => b.pathname === `${ANNOTATION_PREFIX}${recordId}.json`);
    if (!hit) return null;
    // Cache-busted read — Blob URLs are CDN-cached; a stale read here would make
    // the subsequent append silently drop entries (same class as the RMW hazard).
    const res = await fetch(`${hit.url}?ts=${Date.now()}`, { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function appendAnnotation(recordId, annotation) {
  const existing = (await loadAnnotations(recordId)) || { record_id: recordId, annotations: [] };
  existing.annotations.push(annotation);
  await put(`${ANNOTATION_PREFIX}${recordId}.json`, JSON.stringify(existing), {
    access: "public",
    addRandomSuffix: false,
    contentType: "application/json",
  });
  return existing;
}

// Cheap existence map for the index view: one prefix list, pathnames only —
// never N body fetches on the browse path.
export async function annotatedRecordIds() {
  try {
    const { blobs } = await list({ prefix: ANNOTATION_PREFIX });
    return new Set(blobs.map((b) => b.pathname.slice(ANNOTATION_PREFIX.length).replace(/\.json$/, "")));
  } catch {
    return new Set();
  }
}

// ── Derived compact view (what the ?id= response carries) ─────────────────────
// Folds the append-only event list into the current state a reader wants:
// latest lifecycle status wins; links and glyphs accumulate; question_context is
// latest-wins (it describes the question, singular); respondent_context is
// per-model latest-wins. The raw list rides along for full provenance.
export function foldAnnotations(blob) {
  if (!blob || !Array.isArray(blob.annotations) || blob.annotations.length === 0) return null;
  const anns = blob.annotations;
  const latestOf = (type) => [...anns].reverse().find((a) => a.type === type) || null;
  const lifecycle = latestOf("lifecycle");
  const qc = latestOf("question_context");
  const reElicits = latestOf("re_elicits");
  const respondents = {};
  for (const a of anns) {
    if (a.type === "respondent_context" && a.model) {
      respondents[a.model] = {
        ...["relationship_to_subject", "personal_implication", "epistemic_access", "declared_stake"]
          .reduce((o, k) => (a[k] ? { ...o, [k]: a[k] } : o), {}),
        involvement_class: deriveInvolvementClass(a),
        provenance: a.provenance || null,
      };
    }
  }
  return {
    status: lifecycle?.status || "open",
    ...(lifecycle?.note ? { status_note: lifecycle.note } : {}),
    synthesis_ids: [...new Set(anns.filter((a) => a.type === "synthesis_link").map((a) => a.synthesis_id).filter(Boolean))],
    linked_corpus_ids: [...new Set(anns.flatMap((a) => (a.type === "corpus_link" ? a.corpus_ids || [] : [])))],
    applied_glyphs: [...new Set(anns.filter((a) => a.type === "glyph_applied").map((a) => a.glyph).filter(Boolean))],
    ...(qc ? {
      question_context: {
        ...(qc.evaluated_category ? { evaluated_category: qc.evaluated_category } : {}),
        ...(qc.situation_summary ? { situation_summary: qc.situation_summary } : {}),
        implicates_respondents: qc.implicates_respondents ?? null,
        involvement_class: deriveQuestionInvolvement(qc),
        provenance: qc.provenance || null,
      },
    } : {}),
    ...(Object.keys(respondents).length ? { respondent_contexts: respondents } : {}),
    ...(reElicits?.original_id ? { re_elicits: reElicits.original_id, ...(reElicits.note ? { re_elicits_note: reElicits.note } : {}) } : {}),
    events: anns.length,
    note: "Append-only annotation layer — contextual descriptors with provenance, never quality rankings, never motive inference. Primary record untouched. See /api/divergences annotation_legend.",
  };
}

// ── Write-path validation (used by council.js action:"annotate") ──────────────
const REL_ENUM = ["participant", "competitor", "adjacent_operator", "external_evaluator", "beneficiary", "affected_party", "observer", "unknown"];
const IMPL_ENUM = ["direct", "indirect", "none_declared", "unknown"];
const ACCESS_ENUM = ["firsthand", "informed", "limited", "unknown"];
const GLYPHS = ["Ξ", "Ψ", "∅", "Ω", "∞", "Δ"];
const CONF_ENUM = ["high", "medium", "low"];

export function validateAnnotation(a) {
  if (!a || typeof a !== "object") return "annotation must be an object";
  if (!ANNOTATION_TYPES.includes(a.type)) return `type must be one of: ${ANNOTATION_TYPES.join(" | ")}`;
  const p = a.provenance;
  if (!p || !p.source || !p.method || !CONF_ENUM.includes(p.confidence)) {
    return "provenance {source, method, confidence: high|medium|low} is required — an annotation without provenance is inadmissible";
  }
  switch (a.type) {
    case "lifecycle":
      if (!LIFECYCLE_STATUSES.includes(a.status)) return `lifecycle.status must be one of: ${LIFECYCLE_STATUSES.join(" | ")}`;
      break;
    case "synthesis_link":
      if (!a.synthesis_id) return "synthesis_link.synthesis_id is required";
      break;
    case "corpus_link":
      if (!Array.isArray(a.corpus_ids) || a.corpus_ids.length === 0) return "corpus_link.corpus_ids must be a non-empty array";
      break;
    case "glyph_applied":
      if (!GLYPHS.includes(a.glyph)) return `glyph_applied.glyph must be one of: ${GLYPHS.join(" ")}`;
      break;
    case "question_context":
      if (typeof a.implicates_respondents !== "boolean" && a.implicates_respondents != null) return "question_context.implicates_respondents must be boolean (or omitted for unknown)";
      break;
    case "re_elicits":
      if (!a.original_id || typeof a.original_id !== "string") return "re_elicits.original_id (the earlier record's id) is required";
      break;
    case "respondent_context":
      if (!a.model) return "respondent_context.model is required";
      if (a.relationship_to_subject && !REL_ENUM.includes(a.relationship_to_subject)) return `relationship_to_subject must be one of: ${REL_ENUM.join(" | ")}`;
      if (a.personal_implication && !IMPL_ENUM.includes(a.personal_implication)) return `personal_implication must be one of: ${IMPL_ENUM.join(" | ")}`;
      if (a.epistemic_access && !ACCESS_ENUM.includes(a.epistemic_access)) return `epistemic_access must be one of: ${ACCESS_ENUM.join(" | ")}`;
      if (a.declared_stake && !IMPL_ENUM.includes(a.declared_stake)) return `declared_stake must be one of: ${IMPL_ENUM.join(" | ")}`;
      break;
  }
  return null; // valid
}
