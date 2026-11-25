// Inheritance study 001 — drawing a SEALED family set at random, so no person (or model) hand-picks the held-out tasks.
//
// The seed is the secret: whoever holds it can regenerate the set; the repository holds only commitments. Constraints:
// every family is a composition of `steps` distinct ops; no evaluation family shares its op SET with any work family
// (so reordered, possibly equivalent compositions are not "held out"); every op used by an evaluation family appears in
// at least one work family when `shared: true` (transfer is possible in principle — whether it happens is the question).
import { rng, shuffled } from "./canon.mjs";

const PARAMS = { caesar: { k: [1, 2, 3, 4, 5] }, rotate: { k: [1, 2, 3] } };
export const SEALABLE_OPS = ["caesar", "rotate", "reverse", "dedupe", "sort", "swapcase", "double", "evens", "mirror", "vowelmask", "rle", "interleave"];
const step = (op) => ({ op, ...(PARAMS[op] || {}) });
export const setKey = (ops) => [...ops].sort().join("+");

// `exclude`: op-set keys (setKey) that may not be drawn at all — e.g. the public calibration families, so a sealed set never
// reuses a family a model has already been probed on. An empty set leaves every existing draw unchanged.
export function drawFamilySet({ seed, nWork, nAnchor, nGenerationEval = 0, generations = 1, nPlacebo = 2, steps = 3, shared = true, ops = SEALABLE_OPS, exclude = new Set() }) {
  const r = rng(`family-set|${seed}`);
  const draw = () => shuffled(ops, r).slice(0, steps);
  const work = [], used = new Set();
  for (let i = 0, tries = 0; work.length < nWork; tries++) {
    if (tries > 5000) throw new Error("FAMILY_DRAW_STALLED (work)");
    const o = draw();
    if (used.has(setKey(o)) || exclude.has(setKey(o))) continue;
    used.add(setKey(o));
    work.push({ key: `w${work.length}`, domain: "str", role: "work", generation: Math.min(generations - 1, Math.floor((work.length * generations) / nWork)), steps: o.map(step), length: [6, 10] });
    i++;
  }
  const workOps = new Set(work.flatMap((w) => w.steps.map((s) => s.op)));
  const evals = [];
  const want = [...Array(nAnchor).fill("eval-anchor"), ...Array(nGenerationEval * generations).fill("eval-generation")];
  for (let tries = 0; evals.length < want.length; tries++) {
    if (tries > 20000) throw new Error("FAMILY_DRAW_STALLED (eval)");
    const o = draw();
    if (used.has(setKey(o)) || exclude.has(setKey(o))) continue;
    if (shared && !o.every((op) => workOps.has(op))) continue;
    used.add(setKey(o));
    const role = want[evals.length];
    const generation = role === "eval-anchor" ? 1 : 1 + Math.floor((evals.length - nAnchor) / nGenerationEval);
    evals.push({ key: `${role === "eval-anchor" ? "a" : "e"}${evals.length}`, domain: "str", role, generation, steps: o.map(step), length: [6, 10] });
  }
  const placebo = [
    { key: "p0", domain: "num", role: "placebo", generation: 0, steps: [{ op: "add", k: [1, 2, 3] }] },
    { key: "p1", domain: "num", role: "placebo", generation: 0, steps: [{ op: "mul", k: [2, 3] }, { op: "revnum" }] },
  ].slice(0, nPlacebo);
  return [...work, ...evals, ...placebo];
}
