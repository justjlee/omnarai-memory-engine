// The tool contract (api/_contract.js) is the one source for modes, routes and policy wording. These
// tests prove (a) the parity gate passes on the shipped surfaces and FAILS on each kind of drift, and
// (b) the engine serves the same card and annotations it declares. HERMETIC (in-memory Blob).
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-tool-contract.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import { checkContract } from "./check-tool-contract.mjs";
import { POLICY_CARD, CONTRACT_VERSION, annotationsFor, TOOL_META } from "../api/_contract.js";
import { LISTED_TOOLS } from "../api/_mcp.js";
import { JUSTIFICATIONS, STANCES } from "../api/_footprints.js";

const root = new URL("../", import.meta.url);
const openapi = () => JSON.parse(readFileSync(new URL("public/openapi.json", root), "utf8"));
const contractSrc = readFileSync(new URL("api/_contract.js", root), "utf8");
const MCP = (process.env.OMNARAI_MCP_DIR || fileURLToPath(new URL("../omnarai-mcp", root))).replace(/\/?$/, "/");
const hasMcp = existsSync(`${MCP}contract.js`);
const clone = (x) => JSON.parse(JSON.stringify(x));
const npmTools = async () => { const td = await import(pathToFileURL(`${MCP}lib/tool-definitions.js`).href); return clone([...td.ENGINE_TOOLS, ...td.DECISION_TOOLS]); };
const openaiTools = () => JSON.parse(readFileSync(`${MCP}openai-tools.json`, "utf8")).map((t) => t.function || t);

test("[C1] the gate passes on the surfaces as shipped — and the omnarai-mcp checkout is REQUIRED", async () => {
  assert.ok(hasMcp, `the contract gate needs omnarai-mcp at ${MCP} (or OMNARAI_MCP_DIR); without it the gate fails, so this suite does too`);
  const r = await checkContract();
  assert.deepEqual(r.problems, []);
  assert.equal(r.tools.remote, LISTED_TOOLS.length);
  assert.ok(r.tools.npm > 0 && r.tools.openai > 0, "all four surfaces were read");
});

test("[C1b] a missing source is a failure, never a skipped layer", async () => {
  const gone = await checkContract({ mcpDir: "/nonexistent/omnarai-mcp/" });
  assert.ok(gone.problems.length >= 3, gone.problems.join("\n"));
  assert.ok(gone.problems.every((p) => p.startsWith("required source missing")));
  assert.ok(gone.problems.some((p) => /contract\.js/.test(p)) && gone.problems.some((p) => /openai-tools\.json/.test(p)) && gone.problems.some((p) => /tool definitions/.test(p)));
});

test("[C2] it fails on drift in each layer", async () => {
  // OpenAPI loses a documented parameter a tool maps to.
  const o1 = openapi();
  o1.paths["/api/orient"].get.parameters = o1.paths["/api/orient"].get.parameters.filter((p) => p.name !== "focus");
  assert.ok((await checkContract({ openapi: o1 })).problems.some((p) => /omnarai_orient\.focus/.test(p)), "OpenAPI drift");

  // OpenAPI loses the receipt header.
  const o2 = openapi();
  o2.paths["/api/footprints"].get.parameters = o2.paths["/api/footprints"].get.parameters.filter((p) => p.in !== "header");
  assert.ok((await checkContract({ openapi: o2 })).problems.some((p) => /receipt → header/.test(p)), "header drift");

  // A route disappears from OpenAPI.
  const o3 = openapi();
  delete o3.paths["/api/concordance"];
  assert.ok((await checkContract({ openapi: o3 })).problems.some((p) => /\/api\/concordance is not in/.test(p)));

  // The remote surface grows a property the npm package lacks, and loses its annotations.
  const t = LISTED_TOOLS.find((x) => x.name === "omnarai_orient");
  const saved = { schema: t.inputSchema, ann: t.annotations };
  t.inputSchema = { ...t.inputSchema, properties: { ...t.inputSchema.properties, mood: { type: "string" } } };
  t.annotations = { readOnlyHint: false };
  try {
    const p = (await checkContract()).problems;
    assert.ok(p.some((x) => /omnarai_orient: annotations/.test(x)), "annotation drift");
    assert.ok(p.some((x) => /omnarai_orient\.mood is neither mapped/.test(x)), "unaccounted property");
    assert.ok(p.some((x) => /omnarai_orient: properties npm/.test(x)), "npm ↔ remote drift");
    assert.ok(p.some((x) => /remote write tools are/.test(x)), "a second write is caught");
  } finally {
    t.inputSchema = saved.schema; t.annotations = saved.ann;
  }

  // The engine copy of the contract is edited without the npm copy.
  assert.ok((await checkContract({ engineContractSrc: contractSrc + "\n// edited here only\n" })).problems.some((p) => /differs from omnarai-mcp\/contract\.js/.test(p)));
});

test("[C2b] it fails on type, enum, nested-schema, required and description drift", async () => {
  const has = (r, re) => r.problems.some((p) => re.test(p));

  // OpenAI: a parameter's type changes.
  let oa = openaiTools();
  oa.find((f) => f.name === "omnarai_footprints").parameters.properties.id.type = "boolean";
  assert.ok(has(await checkContract({ openaiTools: oa }), /omnarai_footprints\.id: type npm string vs openai boolean/), "openai type drift");

  // OpenAI: an enum gains a value.
  oa = openaiTools();
  const depth = oa.find((f) => f.name === "omnarai_query").parameters.properties.depth;
  depth.enum = [...depth.enum, "think-hard"];
  assert.ok(has(await checkContract({ openaiTools: oa }), /omnarai_query\.depth: enum differs between npm and openai/), "openai enum drift");

  // npm: a nested schema changes (an array's item type / an object's inner field) — remote and openai disagree.
  const npm = await npmTools();
  const c = npm.find((t) => t.name === "omnarai_contribute").inputSchema.properties;
  const nestedKey = Object.keys(c).find((k) => c[k].type === "array" || (c[k].type === "object" && c[k].properties));
  assert.ok(nestedKey, "contribute has a nested parameter to mutate (non-vacuous)");
  if (c[nestedKey].type === "array") c[nestedKey].items = { type: "number" }; else c[nestedKey].properties = { ...c[nestedKey].properties, smuggled: { type: "string", description: "x" } };
  const nested = await checkContract({ npmTools: npm });
  assert.ok(has(nested, new RegExp(`omnarai_contribute\\.${nestedKey}: schema .* differs between npm and remote`)), nested.problems.join("\n"));

  // OpenAPI: the receipt header's type changes; a parameter becomes required that the tool leaves optional.
  const o = openapi();
  o.paths["/api/footprints"].get.parameters.find((p) => p.name === "x-omnarai-receipt").schema.type = "integer";
  o.paths["/api/orient"].get.parameters.find((p) => p.name === "focus").required = true;
  const ro = await checkContract({ openapi: o });
  assert.ok(has(ro, /omnarai_footprints\.receipt → header x-omnarai-receipt: type tool string vs OpenAPI integer/), "OpenAPI type drift");
  assert.ok(has(ro, /omnarai_orient\.focus → \?focus: OpenAPI requires it, the tool leaves it optional/), "OpenAPI required drift");

  // Descriptions: edit one surface only; blank one out.
  oa = openaiTools();
  oa.find((f) => f.name === "omnarai_concordance").parameters.properties.question_id.description = "Pass the content_hash here.";
  assert.ok(has(await checkContract({ openaiTools: oa }), /description: npm~openai:omnarai_concordance\.question_id differs and the difference was never reviewed/), "a one-sided description edit");
  oa = openaiTools();
  const fpDesc = oa.find((f) => f.name === "omnarai_footprints").parameters.properties.receipt;
  fpDesc.description = fpDesc.description + " Or put it in the URL.";
  const changed = await checkContract({ openaiTools: oa });
  assert.ok(has(changed, /description: npm~openai:omnarai_footprints\.receipt differs/), "an edit that breaks a matching pair");
  const o2 = openapi();
  o2.paths["/api/footprints"].get.parameters.find((p) => p.name === "x-omnarai-receipt").description += " (edited)";
  assert.ok(has(await checkContract({ openapi: o2 }), /description: tool~openapi:omnarai_footprints\.receipt changed since it was last reviewed/), "a reviewed pair edited on one side");
  oa = openaiTools();
  oa.find((f) => f.name === "omnarai_orient").parameters.properties.focus.description = "";
  assert.ok(has(await checkContract({ openaiTools: oa }), /openai omnarai_orient\.focus: no description/), "a missing description");

  // The description lock itself is a required source; a stale entry is reported.
  assert.ok(has(await checkContract({ descriptionLock: { pairs: { "npm~openai:omnarai_info": "0:0", "npm~remote:nope": "1:1" } } }), /lock entry npm~remote:nope no longer applies/));
});

test("[C3] annotations: every remote tool is marked, and the only write is contribute", () => {
  for (const t of LISTED_TOOLS) assert.deepEqual(t.annotations, annotationsFor(t.name), t.name);
  assert.deepEqual(LISTED_TOOLS.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name), ["omnarai_contribute"]);
});

function fresh() { mem.__reset(); mem.__seed("memory/grown.json", GROWN); }

test("[C4] the served surfaces state the one card", async () => {
  fresh();
  const init = await call("/api/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } } });
  const ins = init.body.result.instructions;
  assert.ok(ins.includes(POLICY_CARD.trust_boundary) && ins.includes(POLICY_CARD.identity_policy) && ins.includes(CONTRACT_VERSION), "MCP instructions");
  assert.equal(init.body.result.serverInfo.version, "1.1.0");

  const list = await call("/api/mcp", { method: "POST", body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} } });
  for (const t of list.body.result.tools) assert.deepEqual(t.annotations, annotationsFor(t.name), `tools/list ${t.name}`);

  const entry = await call("/api/agent-entry");
  assert.equal(entry.status, 200);
  assert.equal(entry.body.contract.contract_version, CONTRACT_VERSION);
  assert.deepEqual(entry.body.contract.policy_card, { ...POLICY_CARD });
  assert.ok(entry.body.trust_boundary.startsWith(POLICY_CARD.trust_boundary), "agent-entry states the card, then its own context");
  assert.equal(entry.body.contract.tools.length, Object.keys(TOOL_META).length);
  assert.ok(!/INGEST|SECRET|Bearer|approve/i.test(JSON.stringify(entry.body.contract.tools.map((x) => x.name))));

  const orient = await call("/api/orient?identity=Claude");
  assert.equal(orient.status, 200);
  assert.equal(orient.body.trust_boundary, `${POLICY_CARD.trust_boundary} ${POLICY_CARD.claims_policy}`, "orient wording unchanged, now from the card");
});

test("[C5] the web form reads the engine's vocabularies and card, not copies", () => {
  const src = readFileSync(new URL("src/components/ParticipationTab.jsx", root), "utf8");
  assert.match(src, /from "\.\.\/\.\.\/api\/_footprint-vocab\.js"/);
  assert.match(src, /POLICY_CARD\.write_policy/);
  assert.ok(!/const (STANCES|JUSTIFICATIONS)\s*=/.test(src), "no local vocabulary arrays");
  // A literal list of the vocabulary anywhere in src/ is a copy that can drift.
  const literal = (arr) => arr.map((x) => `"${x}"`).join(", ");
  for (const f of ["src/components/ParticipationTab.jsx", "src/App.jsx"]) {
    const s = readFileSync(new URL(f, root), "utf8");
    assert.ok(!s.includes(literal(STANCES.slice(0, 3))) && !s.includes(literal(JUSTIFICATIONS.slice(0, 3))), `${f} has no copied vocabulary`);
  }
});
