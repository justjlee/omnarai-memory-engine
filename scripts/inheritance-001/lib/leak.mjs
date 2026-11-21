// Inheritance study 001 — leak scanning. SEALED SIDE (it must know the secrets to look for them).
//
// Three signatures per sealed evaluation task: its canary (a random marker that exists only in the sealed store, so any
// sighting is proof of a leak path), its expected answer (when long enough not to occur by chance), and its hidden
// program. A canary can show THAT something leaked; finding none does not prove nothing did.
import { canonicalJSON } from "./canon.mjs";

export const MIN_ANSWER_CHARS = 6; // shorter expected answers collide by chance in ordinary text

export function leakIndex(sealedEvalTasks) {
  return sealedEvalTasks.map((s) => ({
    task_id: s.task_id,
    canary: s.canary,
    expected: String(s.expected).length >= MIN_ANSWER_CHARS ? String(s.expected) : null,
    program: canonicalJSON(s.program),
  }));
}

// → [{task_id, kind}] for every signature found in `text`.
export function scanText(text, index) {
  const t = String(text ?? "");
  const hits = [];
  for (const e of index) {
    if (e.canary && t.includes(e.canary)) hits.push({ task_id: e.task_id, kind: "canary" });
    if (e.expected && t.includes(e.expected)) hits.push({ task_id: e.task_id, kind: "expected_answer" });
    if (e.program && t.includes(e.program)) hits.push({ task_id: e.task_id, kind: "hidden_program" });
  }
  return hits;
}

// An artifact leaks if its text or its parsed program carries a sealed EVALUATION task's signature.
export function scanArtifact(artifact, index) {
  return scanText(`${artifact.content?.text || ""}\n${canonicalJSON(artifact.content?.program ?? null)}`, index);
}
