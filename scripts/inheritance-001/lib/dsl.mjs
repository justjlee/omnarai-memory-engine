// Inheritance study 001 — the task language.
//
// Tasks are few-shot program induction: a hidden program, composed from a small fixed set of string primitives, maps
// inputs to outputs; a solver sees a few input→output examples and must produce the output for a new query input.
// Why this domain first (protocol §"Verification gradient"): the verifier is cheap, objective and deterministic, so
// the pawl of verification can be tested before contested domains. A passing program is evidence FOR ITS SOURCE FAMILY
// UNDER ITS CHECKS — never general truth.
//
// Programs are DATA (JSON arrays of steps), interpreted here. Nothing a model writes is ever eval'd or executed as code:
// unknown ops, bad parameters, oversize programs and oversize strings all fail closed.
//
// A second, unrelated domain ("num": integer-sequence continuation) supplies the placebo arm E with structurally
// matched, really-verified artifacts whose content cannot help on string tasks.

export const STR_OPS = {
  reverse: { params: {}, fn: (s) => [...s].reverse().join("") },
  caesar: { params: { k: [1, 25] }, fn: (s, { k }) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + k) % 26) + 97)) },
  rotate: { params: { k: [1, 9] }, fn: (s, { k }) => (s.length ? s.slice(k % s.length) + s.slice(0, k % s.length) : s) },
  dedupe: { params: {}, fn: (s) => [...new Set(s)].join("") },
  sort: { params: {}, fn: (s) => [...s].sort().join("") },
  swapcase: { params: {}, fn: (s) => [...s].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join("") },
  double: { params: {}, fn: (s) => [...s].map((c) => c + c).join("") },
  evens: { params: {}, fn: (s) => [...s].filter((_, i) => i % 2 === 0).join("") },
  mirror: { params: {}, fn: (s) => s + [...s].reverse().join("") },
  vowelmask: { params: {}, fn: (s) => s.replace(/[aeiouAEIOU]/g, "*") },
  rle: { params: {}, fn: (s) => (s.match(/(.)\1*/g) || []).map((r) => `${r[0]}${r.length}`).join("") },
  interleave: { params: {}, fn: (s) => { const h = Math.ceil(s.length / 2), a = s.slice(0, h), b = s.slice(h); let o = ""; for (let i = 0; i < h; i++) o += (a[i] || "") + (b[i] || ""); return o; } },
};

export const NUM_OPS = {
  add: { params: { k: [-9, 9] }, fn: (xs, { k }) => xs.map((x) => x + k) },
  mul: { params: { k: [2, 5] }, fn: (xs, { k }) => xs.map((x) => x * k) },
  diffs: { params: {}, fn: (xs) => xs.slice(1).map((x, i) => x - xs[i]) },
  cumsum: { params: {}, fn: (xs) => xs.reduce((o, x) => [...o, (o.at(-1) || 0) + x], []) },
  revnum: { params: {}, fn: (xs) => xs.slice().reverse() },
  sortnum: { params: {}, fn: (xs) => xs.slice().sort((a, b) => a - b) },
};

export const DOMAINS = { str: STR_OPS, num: NUM_OPS };
export const LIMITS = { maxSteps: 6, maxInputChars: 64, maxOutputChars: 512, maxNums: 32, maxAbs: 1e9 };

export class ProgramError extends Error {
  constructor(code, detail) { super(`${code}${detail ? ` ${detail}` : ""}`); this.code = code; }
}

// Structural validation, fail closed. Returns [] or a list of problems.
export function validateProgram(program, domain = "str") {
  const ops = Object.hasOwn(DOMAINS, domain) ? DOMAINS[domain] : null;
  const errors = [];
  if (!ops) return [`unknown domain ${domain}`];
  if (!Array.isArray(program) || program.length === 0) return ["program must be a non-empty array of steps"];
  if (program.length > LIMITS.maxSteps) errors.push(`program longer than ${LIMITS.maxSteps} steps`);
  program.forEach((step, i) => {
    if (!step || typeof step !== "object" || Array.isArray(step)) { errors.push(`step ${i} must be an object`); return; }
    const spec = typeof step.op === "string" && Object.hasOwn(ops, step.op) ? ops[step.op] : null; // never a prototype key
    if (!spec) { errors.push(`step ${i}: unknown op ${JSON.stringify(step.op)}`); return; }
    for (const k of Object.keys(step)) if (k !== "op" && !(k in spec.params)) errors.push(`step ${i}: unknown parameter ${k}`);
    for (const [k, [lo, hi]] of Object.entries(spec.params)) {
      if (!Number.isInteger(step[k]) || step[k] < lo || step[k] > hi) errors.push(`step ${i}: ${k} must be an integer in [${lo}, ${hi}]`);
    }
  });
  return errors;
}

// Interpret a program on one input. Throws ProgramError; never returns a partial result.
export function runProgram(program, input, domain = "str") {
  const errors = validateProgram(program, domain);
  if (errors.length) throw new ProgramError("INVALID_PROGRAM", errors[0]);
  const ops = DOMAINS[domain];
  let v = input;
  if (domain === "str") {
    if (typeof v !== "string" || v.length > LIMITS.maxInputChars) throw new ProgramError("INVALID_INPUT");
  } else if (!Array.isArray(v) || v.length > LIMITS.maxNums || !v.every(Number.isInteger)) throw new ProgramError("INVALID_INPUT");
  for (const step of program) {
    v = ops[step.op].fn(v, step);
    if (domain === "str" && v.length > LIMITS.maxOutputChars) throw new ProgramError("OUTPUT_TOO_LONG");
    if (domain === "num" && (v.length > LIMITS.maxNums || v.some((x) => !Number.isSafeInteger(x) || Math.abs(x) > LIMITS.maxAbs))) throw new ProgramError("OUTPUT_OUT_OF_RANGE");
  }
  return v;
}

export const formatValue = (v, domain = "str") => (domain === "num" ? v.join(",") : v);
export const parseValue = (s, domain = "str") => (domain === "num" ? String(s).split(",").map((x) => Number(x.trim())) : String(s));

// Pull the first ```program fenced JSON block out of free text (a model's answer or note). A model's text is untrusted:
// return {program:null, error} on anything that does not validate.
export function extractProgram(text, domain = "str") {
  const m = /```program\s*\n([\s\S]{1,2000}?)\n```/.exec(String(text ?? ""));
  if (!m) return { program: null, error: "NO_PROGRAM_BLOCK" };
  let program;
  try { program = JSON.parse(m[1]); } catch { return { program: null, error: "PROGRAM_NOT_JSON" }; }
  const errors = validateProgram(program, domain);
  return errors.length ? { program: null, error: `INVALID_PROGRAM: ${errors[0]}` } : { program, error: null };
}
// The answer is the text inside the LAST <answer>…</answer> (models sometimes restate the format first).
export function extractAnswer(text) {
  const all = [...String(text ?? "").matchAll(/<answer>([\s\S]{0,600}?)<\/answer>/g)];
  return all.length ? all.at(-1)[1].trim() : null;
}
export const describeProgram = (program) => program.map((s) => s.op + Object.entries(s).filter(([k]) => k !== "op").map(([k, v]) => `(${k}=${v})`).join("")).join(" → ");
export const primitivesOf = (program) => [...new Set((program || []).map((s) => s.op))];

// Every program up to `maxLen` steps over the given op instances (an op instance is a fixed step, e.g. {op:"caesar",k:3}).
export function enumeratePrograms(instances, maxLen) {
  const out = [];
  const grow = (prefix) => {
    if (prefix.length) out.push(prefix);
    if (prefix.length === maxLen) return;
    for (const s of instances) grow([...prefix, s]);
  };
  grow([]);
  return out;
}
