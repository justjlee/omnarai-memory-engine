// Inheritance study 001 — reading Omnarai Footprints as candidate inheritance, through the engine's OWN public read path.
//
// Reuse, not a second Footprint store: loadPublicFootprints() (api/_footprints.js) returns only footprints that are
// admitted, intact (content hash re-verified) and whose admitting review is readable — pending, rejected, retracted and
// redacted footprints never come back. Each one becomes a study artifact that CITES it (footprint_refs + the content
// hash), keeps its text verbatim, and records its identity as declared-unverified.
//
// What this does NOT do: treat admission as verification. A curator admits for moderation reasons; that says nothing
// about whether the content is correct. An imported footprint is therefore eligible only for raw history (arm B), and
// its declared identity can never count as a producer family for the cross-family analysis.
import { loadPublicFootprints, getDefaultStore } from "../../../api/_footprints.js";
import { makeArtifact } from "./artifacts.mjs";

export async function importAdmittedFootprints({ studyId, generation = 0, domain = "str", createdAt, store = getDefaultStore() }) {
  const { publicBodies } = await loadPublicFootprints(store);
  return publicBodies
    .filter((fp) => typeof (fp.content?.answer || fp.content?.summary) === "string")
    .map((fp) => makeArtifact({
      studyId, generation, kind: "footprint_import", domain,
      producer: { provider: "omnarai-footprint", declared_lineage: fp.actor?.lineage_id || "unresolved" },
      source: { footprint_content_sha256: fp.integrity?.content_sha256 ?? null },
      text: fp.content.answer || fp.content.summary,
      relations: { footprint_refs: [fp.id] },
      createdAt,
    }));
}
