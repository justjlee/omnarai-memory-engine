// Deploy gate: Open Work stays readable at scale (2026-11-25).
//
//   node scripts/check-open-work-scale.mjs
//
// Builds a synthetic problem with 50 tested claims and 50 attempts, every text at or near its limit
// (scripts/lib/open-work-scale-fixture.mjs), and fails if any surface a visiting mind reads would grow past its
// budget: each claim digest (DIGEST_LIMITS), each tried line, the copy-a-prompt text (PROMPT_LIMITS.PROMPT_BUDGET)
// and the MCP tool's text for the problem. Hermetic: no Blob, no network. Exit 1 on any breach.
import { deriveWorkPacket, successorBrief, DIGEST_LIMITS } from "../api/_work.js";
import { relayPrompt, inheritedWork, PROMPT_LIMITS } from "../api/_handoff.js";
import { runProtocolTool } from "../api/_protocol-tools.js";
import { scaleFixture } from "./lib/open-work-scale-fixture.mjs";

const MCP_BUDGET = 60000;
const fails = [];
const check = (ok, msg) => { if (!ok) fails.push(msg); };

const fx = scaleFixture({ claims: 50, attempts: 50 });
const packet = deriveWorkPacket(fx);
check(packet.claims.length === 50 && packet.attempts.length === 50, `fixture did not project: ${packet.claims.length} claims, ${packet.attempts.length} attempts`);
for (const c of packet.claims) {
  const text = c.digest.join("\n");
  check(c.digest.length <= DIGEST_LIMITS.lines, `digest of ${c.claim_event_id} has ${c.digest.length} lines (limit ${DIGEST_LIMITS.lines})`);
  check(text.length <= DIGEST_LIMITS.chars, `digest of ${c.claim_event_id} is ${text.length} chars (limit ${DIGEST_LIMITS.chars})`);
  check(c.digest.some((l) => l.includes("/api/footprints?id=")), `digest of ${c.claim_event_id} lost its full-text link`);
  check(c.digest.some((l) => l.includes("/api/open-work?results=")), `digest of ${c.claim_event_id} lost its full-results link`);
}
check(packet.tried.length === 100, `tried has ${packet.tried.length} lines, expected 100`);
for (const t of packet.tried) check(t.length <= DIGEST_LIMITS.tried_line, `a tried line is ${t.length} chars (limit ${DIGEST_LIMITS.tried_line})`);

const prompt = relayPrompt(packet, inheritedWork(packet, fx.publicFootprints));
check(prompt.length <= PROMPT_LIMITS.PROMPT_BUDGET, `the copy-a-prompt text is ${prompt.length} chars (budget ${PROMPT_LIMITS.PROMPT_BUDGET})`);
check(prompt.includes("=== OMNARAI CONTRIBUTION ==="), "the prompt lost its contribution block");
check(prompt.includes("WHAT HAS BEEN TRIED"), "the prompt lost its tried list");

const brief = successorBrief(packet, { trustBoundary: "fixture" });
const fakeFetch = async () => new Response(JSON.stringify(brief), { status: 200, headers: { "content-type": "application/json" } });
const mcp = await runProtocolTool("omnarai_open_work", { id: fx.problem.id, format: "brief" }, { fetchImpl: fakeFetch });
check(mcp.text.length <= MCP_BUDGET, `the MCP tool's text is ${mcp.text.length} chars (budget ${MCP_BUDGET})`);

console.log(`Open Work at scale (50 claims, 50 attempts, max-length fields): prompt ${prompt.length}/${PROMPT_LIMITS.PROMPT_BUDGET} chars, MCP text ${mcp.text.length}/${MCP_BUDGET}, largest digest ${Math.max(...packet.claims.map((c) => c.digest.join("\n").length))}/${DIGEST_LIMITS.chars}`);
if (fails.length) { console.error(`FAIL (${fails.length}):\n- ${fails.slice(0, 20).join("\n- ")}`); process.exit(1); }
console.log("ok");
