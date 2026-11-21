// Inheritance study 001 — what a given dollar cap would let a pilot finish. Investigator side, offline, $0.
//
// The spend guard (adapters.mjs) stops BEFORE any call whose worst case (input counted twice, the whole output cap) would
// carry the recorded spend past the cap. So a cap well under the plan's worst case can still let a run finish when real
// outputs stay near their measured means; and a run that stops keeps everything it recorded before the stop.
//
// replaySpend() runs a plan offline against a fake provider that bills every call `outputMultiplier` times its model's
// expected output (never past the call's cap) and its input at the plan's per-model factor, through the REAL spend guard
// with no cap, logging each pre-call check. atCap() then reads off, for any cap, where the guard would have stopped and how
// many paired blocks would be complete. It is a what-if on token counts, not a forecast of any model: the replay's
// producers always leave verifiable records (so arm C carries a full context, the dearer case) and nothing ever fails.
import { buildPlan, outputCapFor } from "./plan.mjs";
import { runStudy } from "./runner.mjs";
import { createSpendGuard } from "./adapters.mjs";
import { hexId } from "./canon.mjs";

const pick = (map, k, dflt) => (map && Object.hasOwn(map, k) ? map[k] : dflt);

export async function replaySpend(study, { outputMultiplier = 1 } = {}) {
  const { plan, tasks } = buildPlan(study);
  const p = study.params;
  const byQuery = tasks.map((t) => [`"query":${JSON.stringify(t.public.prompt.query)}`, t.sealed]);
  const guard = createSpendGuard({ maxCalls: 1e6, maxUsd: 1e9, onDate: study.price_date });
  const log = [];
  const precheck = guard.precheck;
  guard.precheck = (args) => { const usd_before = guard.state.usd; const r = precheck(args); log.push({ usd_before, worst: r.worst_usd }); return r; };
  const adapter = { kind: "replay", billable: false, async call(req) {
    log.at(-1).tracing_id = req.tracing_id;
    const s = byQuery.find(([q]) => req.input.user.includes(q))?.[1];
    const producer = req.tracing_id.startsWith("P-");
    const output = `<answer>${s ? s.expected : "?"}</answer>${producer && s ? `\n\`\`\`program\n${JSON.stringify(s.program)}\n\`\`\`` : ""}`;
    // A+ calls get an extra reasoning allowance on top of the model's cap; the projection expects it to be used.
    const extra = Math.max(0, req.max_output_tokens - outputCapFor(p, req.model_id));
    const out = Math.min(req.max_output_tokens, Math.round((pick(p.expected_output_tokens_by_model, req.model_id, p.expected_output_tokens) + extra) * outputMultiplier));
    const tin = Math.ceil(req.tokens_in_est * pick(p.input_token_factor_by_model, req.model_id, 1));
    return { provider_returned_model_id: req.model_id, output, usage: { in: tin, out }, request_id: "replay", duration_ms: 1, provider_response_metadata: {}, error: null };
  } };
  await runStudy({ study: { ...study, budget: { max_paid_calls: 0, max_usd: 0 } }, adapter, guard });
  const index = new Map(log.map((e, i) => [e.tracing_id, i]));
  const tid = (b, arm) => index.get(`T-g${b.generation}-${hexId({ b: b.block_id, arm, variant: "full" }, 12)}`);
  const blocks = plan.blocks.map((b) => ({ c: tid(b, "C"), aplus: tid(b, "A+"), all: Math.max(...plan.arms.map((a) => tid(b, a))) }));
  return {
    output_multiplier: outputMultiplier,
    calls: log.length,
    usd_total: +guard.state.usd.toFixed(4),
    // the smallest cap under which the guard refuses no call of this replay
    min_cap_to_finish: +Math.max(...log.map((e) => e.usd_before + e.worst)).toFixed(4),
    atCap(cap) {
      const stop = log.findIndex((e) => e.usd_before + e.worst > cap);
      const done = stop < 0 ? log.length : stop;
      return {
        cap, completes: stop < 0, calls_done: done, usd_recorded: +(stop < 0 ? guard.state.usd : log[stop].usd_before).toFixed(4),
        blocks_with_c_and_aplus: blocks.filter((b) => b.c < done && b.aplus < done).length,
        blocks_all_six_arms: blocks.filter((b) => b.all < done).length,
        blocks: blocks.length,
      };
    },
  };
}
