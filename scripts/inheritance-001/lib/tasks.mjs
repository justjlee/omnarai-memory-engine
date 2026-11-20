// Inheritance study 001 — task families, task generation, and the public/sealed split.
//
// A FAMILY SPEC (sealed for a real study) names a composition template: an ordered list of ops, each with the parameter
// values a task may draw. A task draws its own hidden program from the template, then its examples, query and hidden
// checks from a seeded generator. Two parts come out of every task:
//   public  — examples + query: the ONLY part any model, prompt, log or public file may carry;
//   sealed  — program, expected answer, hidden checks, canary, salt: read only by the oracle and the verifier.
// The public task carries a salted commitment to its sealed part, so the sealed part can be revealed later and checked
// against what was frozen, while a guessable task cannot be brute-forced from its hash before release.
import { schemaVersion, seal, sha256, hexId, rng } from "./canon.mjs";
import { DOMAINS, runProgram, validateProgram, formatValue } from "./dsl.mjs";

export const GENERATOR = { name: "is1-program-induction", version: "0.1.0" };
export const FAMILY_ROLES = ["work", "eval-anchor", "eval-generation", "placebo", "calibration"];
export const EVAL_ROLES = ["eval-anchor", "eval-generation"];

const pick = (rand, xs) => xs[Math.floor(rand() * xs.length)];

export function validateFamilySpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object") return ["family spec must be an object"];
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(spec.key || "")) errors.push("key must be a short slug");
  if (!Object.hasOwn(DOMAINS, spec.domain)) errors.push(`unknown domain ${spec.domain}`);
  if (!FAMILY_ROLES.includes(spec.role)) errors.push(`role must be one of ${FAMILY_ROLES.join(", ")}`);
  if (!Number.isInteger(spec.generation) || spec.generation < 0) errors.push("generation must be an integer >= 0");
  if (!Array.isArray(spec.steps) || !spec.steps.length) errors.push("steps must be a non-empty array");
  else {
    const ops = Object.hasOwn(DOMAINS, spec.domain) ? DOMAINS[spec.domain] : {};
    spec.steps.forEach((s, i) => {
      if (!Object.hasOwn(ops, s.op)) errors.push(`step ${i}: unknown op ${s.op}`);
      for (const [k, vals] of Object.entries(s)) {
        if (k === "op") continue;
        if (!Array.isArray(vals) || !vals.length) errors.push(`step ${i}: ${k} must list the allowed values`);
      }
    });
  }
  return errors;
}

// Public family record: commitments, never the template.
export function familyRecord(spec, { studyId, salt }) {
  const errors = validateFamilySpec(spec);
  if (errors.length) throw new Error(`FAMILY_SPEC_INVALID ${spec?.key}: ${errors[0]}`);
  const commitment = sha256({ salt, spec });
  return seal({
    schema_version: schemaVersion("task_family"),
    id: `IS1-FAM-${hexId({ studyId, commitment }, 10)}`,
    study_id: studyId,
    domain: spec.domain,
    role: spec.role,
    generation: spec.generation,
    n_steps: spec.steps.length,
    template_commitment_sha256: commitment,
    generator: GENERATOR,
    verification: { kind: "deterministic-dsl", cost_class: "cheap" },
    contamination_class: spec.contamination_class || "synthetic-novel",
  });
}

function sampleProgram(spec, rand) {
  return spec.steps.map((s) => {
    const step = { op: s.op };
    for (const [k, vals] of Object.entries(s)) if (k !== "op") step[k] = pick(rand, vals);
    return step;
  });
}
function sampleInput(spec, rand) {
  if (spec.domain === "num") {
    const n = 5 + Math.floor(rand() * 3), start = Math.floor(rand() * 20) - 5, step = 1 + Math.floor(rand() * 6);
    return Array.from({ length: n }, (_, i) => start + i * step + (i % 2 ? Math.floor(rand() * 3) : 0));
  }
  const alphabet = spec.alphabet || "abcdefghijklmnopqrstuvwxyz";
  const [lo, hi] = spec.length || [6, 10];
  const n = lo + Math.floor(rand() * (hi - lo + 1));
  return Array.from({ length: n }, () => pick(rand, [...alphabet])).join("");
}

// Generate `count` tasks for one family. Deterministic in (seed, family id). Inputs within a task are distinct and every
// example changes its input (an identity-looking example teaches nothing and invites a trivial guess).
export function generateTasks(spec, family, { seed, count, examples = 3, checks = 8 }) {
  const out = [];
  const rand = rng(`${seed}|${family.id}`);
  for (let t = 0; out.length < count; t++) {
    if (t > count * 50) throw new Error(`TASK_GENERATION_STALLED ${family.id}`);
    const program = sampleProgram(spec, rand);
    if (validateProgram(program, spec.domain).length) continue;
    const seen = new Set();
    const ios = [];
    for (let tries = 0; ios.length < examples + 1 + checks && tries < 400; tries++) {
      const input = sampleInput(spec, rand);
      const key = JSON.stringify(input);
      if (seen.has(key)) continue;
      let output;
      try { output = runProgram(program, input, spec.domain); } catch { continue; }
      if (JSON.stringify(output) === key) continue;
      seen.add(key);
      ios.push({ input: formatValue(input, spec.domain), output: formatValue(output, spec.domain) });
    }
    if (ios.length < examples + 1 + checks) continue;
    const salt = sha256(`${seed}|salt|${family.id}|${t}`).slice(0, 32);
    const canary = `IS1CANARY-${sha256(`${seed}|canary|${family.id}|${t}`).slice(0, 16)}`;
    const shown = ios.slice(0, examples);
    const query = ios[examples];
    const sealed = { program, expected: query.output, checks: ios.slice(examples + 1), canary, salt };
    const commitment = sha256(sealed);
    const id = `IS1-TASK-${hexId({ family: family.id, t, commitment }, 12)}`;
    const pub = seal({
      schema_version: schemaVersion("task"),
      id,
      study_id: family.study_id,
      family_id: family.id,
      domain: spec.domain,
      role: family.role,
      generation: family.generation,
      prompt: { examples: shown, query: query.input },
      sealed_commitment_sha256: commitment,
    });
    out.push({ public: pub, sealed: { task_id: id, ...sealed } });
  }
  return out;
}

// What may leave the sealed boundary. A positive allowlist, so a field added to the sealed part later cannot leak by
// default.
export function publicView(task) {
  const t = task.public || task;
  return { id: t.id, domain: t.domain, prompt: { examples: t.prompt.examples.map((e) => ({ input: e.input, output: e.output })), query: t.prompt.query } };
}
