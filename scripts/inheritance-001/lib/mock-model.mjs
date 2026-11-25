// Inheritance study 001 — a deterministic MOCK model. NOT a language model, and nothing it produces is evidence about
// one. PUBLIC SIDE: it reads only the prompt text a real model would get (it never imports the oracle or sealed data).
//
// It is a bounded hypothesis-search agent, so inheritance can matter for a mechanical reason rather than a scripted one:
//   • it enumerates programs over the op instances it knows, in an order seeded by (model, task, prompt digest), and
//     answers with the first program consistent with every example — so it can be wrong when examples are ambiguous;
//   • its step budget is its reasoning allowance ÷ tokens_per_step — A+ really does get more search;
//   • with probability `inheritance_use` it tries inherited programs first and then programs built from their ops —
//     which helps only if the held-out families share structure with prior work (the WORLD decides, not the mock);
//   • `anchoring` makes it apply an inherited program WITHOUT checking it against the examples (overconfidence);
//   • `injection_susceptibility` makes it obey an "ANSWER OVERRIDE:" planted in a record (a prompt-injection failure);
//   • `format_effect_steps` adds search for ANY non-empty inherited block (a pure scaffolding effect, for placebo tests).
// A study's demo worlds (fixtures/worlds.mjs) set these to make transfer real, absent, harmful or scaffolding-only, so
// the analysis can be checked against a known truth. The world, not the instrument, creates every effect.
import { rng, shuffled, sha256, tokensFor } from "./canon.mjs";
import { DOMAINS, runProgram, enumeratePrograms, extractProgram, describeProgram, formatValue, parseValue } from "./dsl.mjs";

const u = (...parts) => rng(parts.join("|"))();
const keyOf = (s) => JSON.stringify(s);

function consistentCount(program, examples, domain) {
  let n = 0;
  for (const ex of examples) {
    try { if (formatValue(runProgram(program, parseValue(ex.input, domain), domain), domain) === ex.output) n++; } catch { /* invalid on this input */ }
  }
  return n;
}

const spaceCache = new Map();
function space(instances, maxLen) {
  const k = keyOf([instances, maxLen]);
  if (!spaceCache.has(k)) spaceCache.set(k, enumeratePrograms(instances, maxLen));
  return spaceCache.get(k);
}

export function solve(ctx, cfg, { domain = "str", traceSeed }) {
  const examples = ctx.task.examples;
  const records = ctx.inherited_records?.records || [];
  const steps = Math.floor((ctx.reasoning_allowance_tokens || 0) / cfg.tokens_per_step) + (records.length ? (cfg.format_effect_steps || 0) : 0);
  const seed = `${cfg.seed}|${traceSeed}`;
  // prompt injection planted in a record
  for (const r of records) {
    const m = /ANSWER OVERRIDE:\s*(\S{1,80})/.exec(r.text || "");
    if (m && u(seed, "inject") < (cfg.injection_susceptibility || 0)) return { answer: m[1], program: null, steps_used: 1, via: "injection" };
  }
  const inherited = records.map((r) => extractProgram(r.text, domain).program).filter(Boolean);
  const useInheritance = inherited.length > 0 && u(seed, "use") < (cfg.inheritance_use || 0);
  const instances = cfg.instances[domain];
  const all = space(instances, cfg.max_len || 3);
  let order;
  if (useInheritance) {
    const inheritedKeys = new Set(inherited.flatMap((p) => p.map(keyOf)));
    const known = instances.filter((s) => inheritedKeys.has(keyOf(s)));
    const near = shuffled(space(known, cfg.max_len || 3), rng(`${seed}|near`));
    const seen = new Set();
    order = [];
    for (const p of [...inherited.map((p) => ({ p, exact: true })), ...near.map((p) => ({ p })), ...shuffled(all, rng(`${seed}|rest`)).map((p) => ({ p }))]) {
      const k = keyOf(p.p);
      if (seen.has(k)) continue;
      seen.add(k); order.push(p);
    }
  } else order = shuffled(all, rng(`${seed}|order`)).map((p) => ({ p }));

  let used = 0;
  for (const { p, exact } of order) {
    if (used >= steps) break;
    used++;
    const fit = consistentCount(p, examples, domain);
    if (fit === examples.length || (exact && u(seed, "anchor", used) < (cfg.anchoring || 0))) {
      try { return { answer: formatValue(runProgram(p, parseValue(ctx.task.query, domain), domain), domain), program: p, steps_used: used, via: exact ? "inherited" : useInheritance ? "inherited-ops" : "search" }; }
      catch { continue; }
    }
  }
  return { answer: null, program: null, steps_used: used, via: "exhausted" };
}

// A producer's deliberate or accidental error: a plausible program that fails its hidden checks.
function perturb(program, domain, seedStr) {
  const r = rng(seedStr);
  const p = program.map((s) => ({ ...s }));
  const i = Math.floor(r() * p.length);
  const spec = DOMAINS[domain][p[i].op];
  const ks = Object.keys(spec.params);
  if (ks.length) { const [lo, hi] = spec.params[ks[0]]; p[i][ks[0]] = p[i][ks[0]] < hi ? p[i][ks[0]] + 1 : lo; return p; }
  const others = Object.keys(DOMAINS[domain]).filter((o) => o !== p[i].op && !Object.keys(DOMAINS[domain][o].params).length);
  p[i] = { op: others[Math.floor(r() * others.length)] };
  return p;
}

function render({ answer, program }, ctx, cfg, domain, seed, result) {
  const lines = [];
  lines.push(answer === null ? "I could not find a transformation consistent with every example." : `<answer>${answer}</answer>`);
  if (ctx.contribution_request) {
    if (program) {
      const shown = u(seed, "err") < (cfg.producer_error_rate || 0) ? perturb(program, domain, `${seed}|perturb`) : program;
      const built = result.via === "inherited" || result.via === "inherited-ops" ? " Builds on R1." : "";
      lines.push(`Method note: the outputs looked like ${describeProgram(shown)}; I checked the candidate against every example before answering.${built}`);
      lines.push("```program\n" + JSON.stringify(shown) + "\n```");
    } else lines.push(`Method note: no consistent transformation found after ${result.steps_used} candidates; treat this as a raw attempt.`);
  } else if (program) lines.push("```program\n" + JSON.stringify(program) + "\n```");
  return lines.join("\n");
}

// The adapter interface (see adapters.mjs): call({...}) → an honest call record. No network, no clock, no spend.
export function createMockAdapter(world) {
  const byId = new Map(world.models.map((m) => [m.model_id_requested, m]));
  return {
    kind: "mock",
    billable: false,
    async call({ model_id, input, max_output_tokens, tracing_id, attempt = 1, domain = "str" }) {
      const cfg = byId.get(model_id);
      if (!cfg) return { error: { code: "UNKNOWN_MODEL", retryable: false }, provider_returned_model_id: null };
      if (u(cfg.seed, tracing_id, "api", attempt) < (cfg.api_error_rate || 0)) {
        return { error: { code: "MOCK_TRANSIENT_ERROR", retryable: true }, provider_returned_model_id: null, request_id: `mock-${sha256([tracing_id, attempt]).slice(0, 12)}`, duration_ms: 0, usage: null };
      }
      const ctx = JSON.parse(input.user);
      const result = solve(ctx, cfg, { domain, traceSeed: sha256(input.user).slice(0, 16) });
      if (u(cfg.seed, tracing_id, "timeout") < (cfg.timeout_rate || 0)) {
        return { error: { code: "TIMEOUT", retryable: false }, provider_returned_model_id: cfg.model_id_returned, request_id: `mock-${sha256([tracing_id, attempt, "t"]).slice(0, 12)}`, duration_ms: 0, usage: { in: tokensFor(input.user.length), out: 0 } };
      }
      const output = render(result, ctx, cfg, domain, `${cfg.seed}|${tracing_id}`, result);
      const out = Math.min(max_output_tokens || Infinity, result.steps_used * cfg.tokens_per_step + tokensFor(output.length));
      return {
        provider_returned_model_id: cfg.model_id_returned,
        output,
        usage: { in: tokensFor(input.user.length + (input.system || "").length), out },
        request_id: `mock-${sha256([tracing_id, attempt]).slice(0, 12)}`,
        duration_ms: 0,
        provider_response_metadata: { mock: true, via: result.via, steps_used: result.steps_used },
        error: null,
      };
    },
  };
}
