// The omnarai.response/1.0 envelope on the DELIBERATION shapes of /api/query (default, brief, si,
// POST, async submit → poll done) and its documented absence on trace. HERMETIC and FREE: the
// Anthropic SDK is replaced by a canned fake (node:test module mocks), Blob is in memory, and the
// network is refused, so no model is ever called.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --experimental-test-module-mocks --test scripts/test-response-envelope-deliberation.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as mem from "./lib/mem-blob.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import { validate } from "./lib/json-schema-lite.mjs";

const ROOT = new URL("../", import.meta.url);
const schema = JSON.parse(readFileSync(new URL("public/schemas/omnarai-response-1.0.schema.json", ROOT), "utf8"));
const FAKE_MODEL = "claude-sonnet-4-6-fake-for-tests";
const canMock = typeof mock.module === "function";

// The async path races the deliberation against a 55s timer; unref long timers so a finished
// test file does not wait on it.
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...a) => { const t = realSetTimeout(fn, ms, ...a); if (ms >= 10000) t?.unref?.(); return t; };

let call;
if (canMock) {
  class FakeAnthropic {
    constructor() {
      this.messages = {
        create: async (params) => {
          const blocks = /extract two structured blocks/.test(params.system || "");
          const text = blocks
            ? '```TENSION_MAP\n[{"voice_a":"Claude","claim_a":"a","voice_b":"GPT-4o","claim_b":"b","topic":"holding","status":"unresolved"}]\n```\n```DELIBERATION_CARD\n{"holdform_risk":"low","holdform_risk_reason":"","novel_synthesis":"n","epistemic_status":"speculative"}\n```'
            : /Question:|BASELINE|AUGMENTED|thoughtful analyst/.test(JSON.stringify(params.messages) + (params.system || ""))
              ? '{"added_considerations":[],"citations_introduced":[],"position_shift":"none","tensions_surfaced":[],"net_effect":"little","verdict":"marginal"}'
              : "## Reflexive Check\nFake.\n## Shared Ground\nFake.\n## Points of Tension\nFake.\n## What Remains Open\nFake.\n## Actionable Next Step\nFake.\n## My Reading\nFake, and complete.";
          return { content: [{ type: "text", text }], stop_reason: "end_turn", model: FAKE_MODEL, usage: { input_tokens: 1, output_tokens: 1 } };
        },
      };
    }
  }
  mock.module("@anthropic-ai/sdk", { defaultExport: FakeAnthropic });
  ({ call } = await import("./lib/invoke.mjs"));
}

const fresh = () => { mem.__reset(); mem.__seed("memory/grown.json", GROWN); };
function deliberationEnvelope(body) {
  const e = body.omnarai_response;
  assert.ok(e, "envelope present");
  assert.deepEqual(validate(schema, e), []);
  assert.equal(e.kind, "deliberation");
  assert.equal(e.retrieval.deliberation_ran, true);
  assert.deepEqual(e.retrieval.deliberation, { model_reported: FAKE_MODEL, synthesis: "one_model_reading_not_ground_truth" });
  assert.equal(e.provenance.grown_store_updated_at, GROWN.updatedAt);
  assert.equal(JSON.stringify(e).includes("SENTINEL"), false);
  return e;
}

test("deliberation shapes (default, brief, si, POST) carry a deliberation envelope whose sources mirror the body", { skip: !canMock && "needs --experimental-test-module-mocks" }, async () => {
  fresh();
  const q = "SENTINEL-question%20stable%20position%20without%20memory";
  const def = await call(`/api/query?q=${q}&sync=1&si=SENTINEL-identity`);
  assert.equal(def.status, 200, JSON.stringify(def.body).slice(0, 300));
  assert.deepEqual(deliberationEnvelope(def.body).retrieval.sources_returned, def.body.sources);
  const brief = await call(`/api/query?q=${q}&format=brief`);
  assert.equal(brief.body.format, "brief");
  assert.deepEqual(deliberationEnvelope(brief.body).retrieval.sources_returned, brief.body.sources);
  const si = await call(`/api/query?q=${q}&format=si`);
  assert.equal(si.body.format, "si");
  assert.deepEqual(deliberationEnvelope(si.body).retrieval.sources_returned, si.body.sources);
  const post = await call("/api/query", { method: "POST", body: { query: "SENTINEL stable position", syntheticIdentity: "SENTINEL-mind" } });
  assert.equal(post.status, 200);
  deliberationEnvelope(post.body);
});

test("async: the 202 and the poll are async_job envelopes without the job id; the finished result keeps its deliberation envelope", { skip: !canMock && "needs --experimental-test-module-mocks" }, async () => {
  fresh();
  const sub = await call("/api/query?q=SENTINEL%20stable%20position&async=1");
  assert.equal(sub.status, 202);
  const se = sub.body.omnarai_response;
  assert.deepEqual(validate(schema, se), []);
  assert.equal(se.kind, "async_job");
  assert.equal(JSON.stringify(se).includes(sub.body.job_id), false);
  let poll;
  for (let i = 0; i < 100; i++) {
    poll = await call(sub.body.poll_url);
    if (poll.body.status !== "pending") break;
    await new Promise((r) => realSetTimeout(r, 20));
  }
  assert.equal(poll.body.status, "done", JSON.stringify(poll.body).slice(0, 300));
  assert.equal(poll.body.omnarai_response.kind, "async_job");
  assert.equal(JSON.stringify(poll.body.omnarai_response).includes(sub.body.job_id), false);
  deliberationEnvelope(poll.body.result);
});

test("trace results are not covered in v1 and stay exactly as they were", { skip: !canMock && "needs --experimental-test-module-mocks" }, async () => {
  fresh();
  const t = await call("/api/trace?q=stable%20position&sync=1");
  assert.equal(t.status, 200, JSON.stringify(t.body).slice(0, 300));
  assert.equal(t.body.format, "trace");
  assert.equal(t.body.omnarai_response, undefined);
});
