// Continuance-receipt tokens never reach a log, an error, a rendered tool reply or the web app (2026-10-27).
// HERMETIC (in-memory Blob, no network). Every check that something is ABSENT first proves the thing it searched
// was written at all — an empty log would pass a "no token in the log" test for the wrong reason.
//
// Before this: the access log stored `path: req.url`, so `GET /api/footprints?id=…&receipt=<token>` kept the
// token in a telemetry event. Now the log keeps the route with values only for structural parameters, the
// engine reads the token from the x-omnarai-receipt header (the URL form still works, with a notice), and the
// MCP clients send the header.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-receipt-hygiene.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import { sanitizePath, sanitizeReferer, buildEvent, REDACTED } from "../api/_telemetry.js";
import { continuanceReceipt, RECEIPT_HEADER } from "../api/_footprints.js";

process.env.INGEST_SECRET = "test-curator-secret";
const REC2 = "OMN-D1781000000003";
const root = new URL("../", import.meta.url);

// The remote MCP tools fetch https://engine.omnarai.org; route that back into the handlers and record each
// inner request so the test can see exactly what crossed the wire.
const inner = [];
const shim = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.origin !== "https://engine.omnarai.org") return shim(url, init);
  inner.push({ url: u.pathname + u.search, headers: { ...(init.headers || {}) } });
  const r = await call(u.pathname + u.search, { method: init.method || "GET", body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers || {} });
  return { ok: r.status < 400, status: r.status, json: async () => r.body };
};

// Everything the process prints while a test runs — Vercel keeps function console output as logs.
let printed = [];
for (const k of ["log", "info", "warn", "error", "debug"]) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { printed.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")); return orig(...a); };
}

function fresh() { mem.__reset(); mem.__seed("memory/grown.json", GROWN); inner.length = 0; printed = []; }
const telemetryText = () => mem.__dump("telemetry/").map((k) => JSON.stringify(mem.__read(k))).join("\n");
async function settle() { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); }
async function contribute(ip = "198.51.100.4") {
  const r = await call("/api/contribute", { method: "POST", headers: { "x-forwarded-for": ip }, body: { id: REC2, identity: "Claude", justification: "independent_objection", answer: `Receipt hygiene check ${Math.random()}: weigh the crux, not the headcount.` } });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
  const token = r.body.continuance?.token;
  assert.match(token || "", /^[0-9a-f]{64}$/, "a real receipt was minted");
  return { fp: r.body.footprint_id, token, body: r.body };
}

test("[H1] the logged path keeps the route and structural values, never capabilities or free text", () => {
  const t = "a".repeat(64);
  const p = sanitizePath(`/api/footprints?id=OMN-FP-1790000000000-3f9a2c1b&receipt=${t}&_view=footprints&q=my%20private%20question&job=0f0e9a1c-1111-4222-8333-944445555666&session_id=x&token=y&unknownthing=z`);
  assert.ok(!p.includes(t), "receipt value gone");
  for (const gone of ["my private question", "my%20private", "0f0e9a1c", "session_id=x", "token=y", "unknownthing=z"]) assert.ok(!p.includes(gone), `${gone} redacted`);
  assert.ok(p.startsWith("/api/footprints?"), "route kept");
  assert.ok(p.includes("id=OMN-FP-1790000000000-3f9a2c1b") && p.includes("_view=footprints"), "structural values kept");
  assert.ok(p.includes(`receipt=${REDACTED}`), "the parameter NAME is kept, so the log still shows a receipt was used");
  assert.equal(sanitizePath("/api/info"), "/api/info");
  assert.equal(sanitizePath(null), null);
  // A structural name with a non-structural value is still redacted (e.g. free text in id).
  assert.ok(sanitizePath("/api/divergences?id=hello%20world%20this%20is%20text").includes(`id=${REDACTED}`));
});

test("[H2] the referrer keeps origin + path only", () => {
  assert.equal(sanitizeReferer(`https://example.org/page?receipt=${"b".repeat(64)}#frag`), "https://example.org/page");
  assert.equal(sanitizeReferer("not a url"), null);
  assert.equal(sanitizeReferer("javascript:alert(1)"), null);
  const ev = buildEvent({ url: `/api/footprints?receipt=${"c".repeat(64)}`, headers: { referer: `https://x.test/?token=${"d".repeat(64)}` }, query: {} }, "council", "ai-agent");
  assert.ok(!JSON.stringify(ev).includes("c".repeat(64)) && !JSON.stringify(ev).includes("d".repeat(64)));
});

test("[H3] URL-form receipt read: works (compat), carries a notice, and the token is in no log, event or console line", async () => {
  fresh();
  const { fp, token } = await contribute();
  const r = await call(`/api/footprints?id=${fp}&receipt=${token}`, { headers: { "user-agent": "curl/8.6.0" } });
  assert.equal(r.status, 200, "pre-header clients keep working");
  assert.equal(r.body.read_via, "continuance-receipt");
  assert.equal(r.body.notices?.[0]?.code, "RECEIPT_IN_URL", "the caller is told to move to the header");
  const inh = await call(`/api/inheritance?from=${fp}&receipt=${token}`, { headers: { "user-agent": "curl/8.6.0" } });
  assert.equal(inh.status, 200);
  assert.equal(inh.body.notices?.[0]?.code, "RECEIPT_IN_URL");
  await settle();
  const logged = telemetryText();
  assert.ok(logged.includes(`/api/footprints?id=${fp}&receipt=${REDACTED}`), "the read WAS logged (non-vacuous)");
  assert.ok(logged.includes(`from=${fp}&receipt=${REDACTED}`), "the inheritance read WAS logged");
  assert.ok(!logged.includes(token), "no token in any telemetry event or in the aggregate log");
  assert.ok(!printed.join("\n").includes(token), "no token printed to the function log");
});

test("[H4] header-form receipt read: same access, no notice, nothing in the URL to log", async () => {
  fresh();
  const { fp, token } = await contribute();
  const r = await call(`/api/footprints?id=${fp}`, { headers: { [RECEIPT_HEADER]: token, "user-agent": "curl/8.6.0" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.read_via, "continuance-receipt");
  assert.equal(r.body.notices, undefined, "no deprecation notice on the preferred form");
  assert.equal(r.headers["cache-control"], "no-store");
  assert.match(String(r.headers.vary || ""), /x-omnarai-receipt/i, "a cache keyed on the URL must not serve one caller's private read to another");
  const inh = await call(`/api/inheritance?from=${fp}`, { headers: { [RECEIPT_HEADER]: token } });
  assert.equal(inh.status, 200);
  assert.equal((await call(`/api/footprints?id=${fp}`)).status, 404, "without the header it is still private");
  await settle();
  assert.ok(telemetryText().includes(`/api/footprints?id=${fp}`), "logged (non-vacuous)");
  assert.ok(!telemetryText().includes(token));
});

test("[H5] refusals and failures never echo the token", async () => {
  fresh();
  const { fp, token } = await contribute();
  const wrong = token.replace(/^./, (c) => (c === "0" ? "1" : "0"));
  for (const r of [
    await call(`/api/footprints?id=${fp}&receipt=${wrong}`),
    await call(`/api/footprints?id=${fp}`, { headers: { [RECEIPT_HEADER]: wrong } }),
    await call(`/api/inheritance?from=${fp}&receipt=${wrong}`),
    await call(`/api/footprints?question_id=OMN-Q-000000000000&receipt=${wrong}`),
  ]) {
    assert.ok(!JSON.stringify(r.body).includes(wrong), `status ${r.status} body must not echo the token`);
  }
  // A store failure while a receipt is presented: the error path must not carry it either.
  mem.__faults.list = (prefix) => prefix.startsWith("footprints/");
  const broken = await call(`/api/footprints?id=${fp}`, { headers: { [RECEIPT_HEADER]: token } });
  const brokenInh = await call(`/api/inheritance?from=${fp}&receipt=${token}`);
  mem.__faults.list = null;
  assert.ok(broken.status >= 400 || brokenInh.status >= 400, "the fault was hit (non-vacuous)");
  for (const r of [broken, brokenInh]) assert.ok(!JSON.stringify(r.body).includes(token), `error ${r.status} must not echo the token`);
  await settle();
  assert.ok(!printed.join("\n").includes(token) && !printed.join("\n").includes(wrong));
  assert.ok(!telemetryText().includes(token) && !telemetryText().includes(wrong));
});

test("[H6] the receipt offers token-free forms; the legacy URL fields are still there for stage 1", () => {
  const r = continuanceReceipt({ id: "OMN-FP-1790000000000-3f9a2c1b", subject: { question_id: "OMN-Q-aaaaaaaaaaaa" }, integrity: { content_sha256: "x" } });
  assert.ok(r.token, "receipt key is configured in this test");
  assert.equal(r.receipt_version, "1.2");
  for (const k of ["read", "resume_request"]) {
    assert.ok(!JSON.stringify(r[k]).includes(r.token), `${k} carries no token`);
    assert.equal(r[k].header, RECEIPT_HEADER);
  }
  assert.ok(r.status.includes(r.token) && r.resume.includes(r.token), "legacy fields unchanged until the stage-2 decision");
  assert.deepEqual(r.deprecated.fields, ["status", "resume"]);
});

let rpcId = 0;
const rpc = (method, params) => call("/api/mcp", { method: "POST", body: { jsonrpc: "2.0", id: ++rpcId, method, params }, headers: { "x-forwarded-for": "203.0.113.9" } });

test("[H7] remote MCP: the receipt crosses as a header, the reply text prints no token-bearing URL", async () => {
  fresh();
  const c = await rpc("tools/call", { name: "omnarai_contribute", arguments: { id: REC2, answer: "MCP receipt hygiene: weigh the crux.", identity: "Claude", justification: "independent_objection" } });
  assert.ok(!c.body.result.isError, c.body.result.content?.[0]?.text);
  const token = c.body.result.structuredContent.continuance.token;
  const fp = c.body.result.structuredContent.footprint_id;
  const text = c.body.result.content[0].text;
  assert.equal(text.split(token).length - 1, 1, "the token is shown once, as the token");
  assert.ok(!/[?&]receipt=/.test(text), "no URL in the reply carries the token");

  inner.length = 0;
  const f = await rpc("tools/call", { name: "omnarai_footprints", arguments: { id: fp, receipt: token } });
  assert.ok(!f.body.result.isError, f.body.result.content?.[0]?.text);
  assert.equal(f.body.result.structuredContent.read_via, "continuance-receipt", "the header form reads the pending footprint");
  const i = await rpc("tools/call", { name: "omnarai_inheritance", arguments: { from: fp, receipt: token } });
  assert.ok(!i.body.result.isError, i.body.result.content?.[0]?.text);
  assert.ok(inner.length >= 2, "the tools made inner requests (non-vacuous)");
  for (const req of inner) {
    assert.ok(!req.url.includes(token), `inner URL ${req.url.slice(0, 60)} carries no token`);
    assert.equal(req.headers["x-omnarai-receipt"], token, "sent as the header");
  }
  await settle();
  const logged = telemetryText();
  assert.ok(logged.includes('"endpoint":"mcp"'), "the MCP calls were logged (non-vacuous)");
  assert.ok(!logged.includes(token), "neither the outer /api/mcp event nor the inner reads kept the token");
  assert.ok(!printed.join("\n").includes(token));
});

test("[H8] the web app never builds a token URL, stores a token, or puts one in history", () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = new URL(e.name + (e.isDirectory() ? "/" : ""), dir);
      if (e.isDirectory()) walk(p); else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(p);
    }
  };
  walk(new URL("src/", root));
  assert.ok(files.length > 10, "scanned the app (non-vacuous)");
  assert.ok(files.some((f) => /continuance\??\.token/.test(readFileSync(f, "utf8"))), "the form that shows the token was found (non-vacuous)");
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    assert.ok(!/[?&]receipt=/.test(s), `${f.pathname.split("/src/")[1]} builds no ?receipt= URL`);
    if (/continuance\??\.token/.test(s)) assert.ok(!/localStorage|sessionStorage|document\.cookie|pushState|replaceState|sendBeacon/.test(s), `${f.pathname.split("/src/")[1]} shows the token but never persists or beacons it`);
  }
});

test("[H9] the one-shot scrub rewrites pre-fix events exactly like new ones, dry run writes nothing", async () => {
  const { run, scrubEvent } = await import("./scrub-telemetry-urls.mjs");
  fresh();
  const tok = "e".repeat(64);
  const old = (n, path, referer = null) => ({ at: `2026-10-0${n}T00:00:00.000Z`, endpoint: "council", category: "ai-agent", path, referer, q: "kept: the 200-char question field is documented" });
  mem.__seed("telemetry/events/2026-10-01/a.json", old(1, `/api/footprints?id=OMN-FP-1790000000000-3f9a2c1b&receipt=${tok}`));
  mem.__seed("telemetry/events/2026-10-02/b.json", old(2, "/api/query?q=a%20much%20longer%20question&job=0f0e9a1c-1111-4222-8333-944445555666"));
  mem.__seed("telemetry/events/2026-10-03/c.json", old(3, "/api/info", "https://x.test/p?token=zzz"));
  mem.__seed("telemetry/events/2026-10-04/d.json", old(4, "/api/health"));
  mem.__seed("telemetry/access-log.json", { version: 2, recent: [old(1, `/api/inheritance?from=OMN-FP-1790000000000-3f9a2c1b&receipt=${tok}`)], firstExternal: old(1, `/x?receipt=${tok}`), totals: { logged: 4 } });
  const before = mem.__snapshot();
  const quiet = () => {};

  const dry = await run({ apply: false, log: quiet });
  assert.equal(dry.events_seen, 4);
  assert.equal(dry.events_changed, 3);
  assert.equal(dry.by_reason.receipt, 1);
  assert.equal(dry.aggregate_recent_changed, 1);
  assert.equal(dry.aggregate_first_changed, true);
  for (const [k, v] of before) assert.equal(mem.__snapshot().get(k)?.body, v.body, `dry run left ${k} untouched`);

  await run({ apply: true, log: quiet });
  const all = mem.__dump("telemetry/").map((k) => JSON.stringify(mem.__read(k))).join("\n");
  assert.ok(!all.includes(tok) && !all.includes("0f0e9a1c") && !all.includes("token=zzz"));
  assert.equal(mem.__read("telemetry/events/2026-10-04/d.json").path, "/api/health", "clean events untouched");
  assert.equal(mem.__read("telemetry/events/2026-10-01/a.json").q, old(1, "").q, "nothing but path/referer changes");
  assert.equal(mem.__read("telemetry/access-log.json").totals.logged, 4, "counts unchanged");
  const again = await run({ apply: false, log: quiet });
  assert.equal(again.events_changed + again.aggregate_recent_changed, 0, "idempotent");
  assert.equal(scrubEvent({ path: "/api/info" }).changed, false);
});
