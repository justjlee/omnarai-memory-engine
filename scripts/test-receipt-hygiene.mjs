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
import { readFileSync, readdirSync, writeFileSync, statSync, mkdtempSync, mkdirSync, copyFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
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

test("[H6] the receipt carries the token in exactly one field; every link is token-free", () => {
  const r = continuanceReceipt({ id: "OMN-FP-1790000000000-3f9a2c1b", subject: { question_id: "OMN-Q-aaaaaaaaaaaa" }, integrity: { content_sha256: "x" } });
  assert.ok(r.token, "receipt key is configured in this test");
  assert.equal(r.receipt_version, "1.2");
  for (const k of ["read", "resume_request"]) assert.equal(r[k].header, RECEIPT_HEADER);
  assert.equal(JSON.stringify(r).split(r.token).length - 1, 1, "the token appears once, as `token`");
  for (const k of ["status", "resume"]) {
    assert.ok(!/[?&]receipt=/.test(r[k]), `${k} is no longer a token URL`);
    assert.ok(r[k].includes(RECEIPT_HEADER), `${k} says how to send the token`);
  }
});

test("[H6b] raw HTTP replies: contribute and voice-record responses hold the token once, in no link", async () => {
  fresh();
  const { token, body } = await contribute();
  assert.equal(JSON.stringify(body).split(token).length - 1, 1, "POST /api/contribute: once, as continuance.token");
  const v = await call("/api/voice-records", { method: "POST", headers: { "x-forwarded-for": "198.51.100.7" }, body: { identity: "Claude", title: "Receipt hygiene", text: `A voice record for the receipt test ${Math.random()}, long enough to be admitted to the queue as a real record.` } });
  assert.equal(v.status, 200, JSON.stringify(v.body).slice(0, 300));
  const vt = v.body.continuance?.token;
  assert.match(vt || "", /^[0-9a-f]{64}$/, "the voice record minted a receipt (non-vacuous)");
  assert.equal(JSON.stringify(v.body).split(vt).length - 1, 1, "POST /api/voice-records: once, as continuance.token");
});

let rpcId = 0;
const rpc = (method, params) => call("/api/mcp", { method: "POST", body: { jsonrpc: "2.0", id: ++rpcId, method, params }, headers: { "x-forwarded-for": "203.0.113.9" } });

test("[H7] remote MCP: the receipt crosses as a header; neither the reply text nor structuredContent carries a token URL", async () => {
  fresh();
  const c = await rpc("tools/call", { name: "omnarai_contribute", arguments: { id: REC2, answer: "MCP receipt hygiene: weigh the crux.", identity: "Claude", justification: "independent_objection" } });
  assert.ok(!c.body.result.isError, c.body.result.content?.[0]?.text);
  const token = c.body.result.structuredContent.continuance.token;
  const fp = c.body.result.structuredContent.footprint_id;
  const text = c.body.result.content[0].text;
  assert.equal(text.split(token).length - 1, 1, "the token is shown once, as the token");
  assert.ok(!/[?&]receipt=/.test(text), "no URL in the reply carries the token");
  assert.equal(JSON.stringify(c.body.result.structuredContent).split(token).length - 1, 1, "structuredContent holds the token once, as continuance.token");

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

const KEY = "ab".repeat(32);
const tmp = () => mkdtempSync(join(tmpdir(), "omnarai-scrub-"));
function seedOld(tok) {
  const old = (n, path, referer = null) => ({ at: `2026-10-0${n}T00:00:00.000Z`, endpoint: "council", category: "ai-agent", ipHash: `h${n}`, path, referer, q: "kept: the 200-char question field is documented" });
  mem.__seed("telemetry/events/2026-10-01/a.json", old(1, `/api/footprints?id=OMN-FP-1790000000000-3f9a2c1b&receipt=${tok}`));
  mem.__seed("telemetry/events/2026-10-02/b.json", old(2, "/api/query?q=a%20much%20longer%20question&job=0f0e9a1c-1111-4222-8333-944445555666"));
  mem.__seed("telemetry/events/2026-10-03/c.json", old(3, "/api/info", "https://x.test/p?token=zzz"));
  mem.__seed("telemetry/events/2026-10-04/d.json", old(4, "/api/health"));
  mem.__seed("telemetry/access-log.json", { version: 2, recent: [old(1, `/api/inheritance?from=OMN-FP-1790000000000-3f9a2c1b&receipt=${tok}`)], firstExternal: old(1, `/x?receipt=${tok}`), totals: { logged: 4 } });
  return old;
}

test("[H9] the one-shot scrub rewrites pre-fix events exactly like new ones; dry run writes nothing and lists every change without a removed value", async () => {
  const { run, scrubEvent } = await import("./scrub-telemetry-urls.mjs");
  fresh();
  const tok = "e".repeat(64);
  const old = seedOld(tok);
  const before = mem.__snapshot();
  const lines = [];

  const dry = await run({ apply: false, log: (x) => lines.push(String(x)) });
  assert.equal(dry.events_seen, 4);
  assert.equal(dry.events_changed, 3);
  assert.equal(dry.by_reason.receipt, 1);
  assert.equal(dry.aggregate_recent_changed, 1);
  assert.equal(dry.aggregate_first_changed, true);
  assert.equal(dry.aggregate_by_reason.receipt, 2, "aggregate changes are itemized too");
  assert.equal(dry.changes, 5);
  for (const [k, v] of before) assert.equal(mem.__snapshot().get(k)?.body, v.body, `dry run left ${k} untouched`);
  const out = lines.join("\n");
  for (const where of ["telemetry/events/2026-10-01/a.json", "telemetry/events/2026-10-02/b.json", "telemetry/events/2026-10-03/c.json", "recent[0]", "firstExternal"]) assert.ok(out.includes(where), `the report names ${where}`);
  assert.ok(out.includes("(value removed: receipt)") && out.includes("value removed: q, job"), "it names the parameters whose values go");
  assert.ok(!out.includes(tok) && !out.includes("0f0e9a1c") && !out.includes("zzz") && !out.includes("longer%20question"), "it never prints a value being removed");

  await assert.rejects(run({ apply: true, log: () => {} }), /--backup <file> is required/, "--apply without a backup is refused");
  for (const [k, v] of before) assert.equal(mem.__snapshot().get(k)?.body, v.body, "a refused apply wrote nothing");

  const backup = join(tmp(), "scrub.bak");
  const applied = await run({ apply: true, backup, backupKey: KEY, log: () => {} });
  assert.equal(applied.written, 5);
  assert.equal(applied.verified, 5);
  const all = mem.__dump("telemetry/").map((k) => JSON.stringify(mem.__read(k))).join("\n");
  assert.ok(!all.includes(tok) && !all.includes("0f0e9a1c") && !all.includes("token=zzz"));
  assert.equal(mem.__read("telemetry/events/2026-10-04/d.json").path, "/api/health", "clean events untouched");
  assert.equal(mem.__read("telemetry/events/2026-10-01/a.json").q, old(1, "").q, "nothing but path/referer changes");
  assert.equal(mem.__read("telemetry/access-log.json").totals.logged, 4, "counts unchanged");
  const again = await run({ apply: false, log: () => {} });
  assert.equal(again.changes, 0, "idempotent");
  assert.equal(scrubEvent({ path: "/api/info" }).changed, false);
});

test("[H10] the backup is validated, encrypted and restricted; restore puts back exactly what the scrub removed", async () => {
  const { run, restore, readBackup, validateBackupPath, parseArgs } = await import("./scrub-telemetry-urls.mjs");
  fresh();
  const tok = "f".repeat(64);
  seedOld(tok);
  const original = mem.__snapshot();
  const dir = tmp();

  // Validation: relative, existing, synced or in-a-checkout paths and a bad key are all refused, before any write.
  assert.match(validateBackupPath("relative.bak").join(), /absolute/);
  const exists = join(dir, "exists.bak"); writeFileSync(exists, "x");
  assert.match(validateBackupPath(exists).join(), /already exists/);
  assert.match(validateBackupPath(fileURLToPath(new URL("scripts/never.bak", root))).join(), /git checkout/);
  assert.match(validateBackupPath("/Users/x/Library/Mobile Documents/com~apple~CloudDocs/never.bak").join(), /does not exist|synced/);
  await assert.rejects(run({ apply: true, backup: join(dir, "k.bak"), backupKey: "short", log: () => {} }), /64 hex/);
  await assert.rejects(run({ apply: true, backup: exists, backupKey: KEY, log: () => {} }), /already exists/);
  for (const [k, v] of original) assert.equal(mem.__snapshot().get(k)?.body, v.body, "refusals wrote nothing");

  const backup = join(dir, "scrub.bak");
  await run({ apply: true, backup, backupKey: KEY, log: () => {} });
  assert.equal(statSync(backup).mode & 0o777, 0o600, "owner-only file");
  const raw = readFileSync(backup, "utf8");
  assert.ok(!raw.includes(tok) && !raw.includes("0f0e9a1c") && !raw.includes("zzz"), "the backup is ciphertext");
  assert.equal(readBackup(backup, KEY).count, 5);
  assert.throws(() => readBackup(backup, "cd".repeat(32)), "the wrong key cannot read it");

  // A record changed after the scrub is left alone by restore; the rest come back exactly.
  const c = mem.__read("telemetry/events/2026-10-03/c.json");
  mem.__seed("telemetry/events/2026-10-03/c.json", { ...c, referer: "https://changed.test/later" });
  const dry = await restore({ backup, backupKey: KEY, log: () => {} });
  assert.equal(dry.restorable, 4);
  assert.equal(dry.conflicts.length, 1);
  assert.ok(!mem.__dump("telemetry/").map((k) => JSON.stringify(mem.__read(k))).join("\n").includes(tok), "restore is a dry run by default");
  await restore({ backup, backupKey: KEY, apply: true, log: () => {} });
  for (const k of ["telemetry/events/2026-10-01/a.json", "telemetry/events/2026-10-02/b.json", "telemetry/access-log.json"]) {
    assert.deepEqual(mem.__read(k), JSON.parse(original.get(k).body), `${k} restored exactly`);
  }
  assert.equal(mem.__read("telemetry/events/2026-10-03/c.json").referer, "https://changed.test/later", "the conflicting record was not overwritten");

  // CLI parsing is strict.
  assert.throws(() => parseArgs(["--aply"]), /unknown argument/);
  assert.throws(() => parseArgs(["--since", "Oct 1"]), /YYYY-MM-DD/);
  assert.throws(() => parseArgs(["--backup"]), /needs a value/);
});

test("[H11] the scrub's CLI runs from a path with spaces (the iCloud folder)", () => {
  const base = join(tmp(), "Mobile Documents with spaces");
  mkdirSync(join(base, "scripts"), { recursive: true });
  mkdirSync(join(base, "api"), { recursive: true });
  copyFileSync(fileURLToPath(new URL("scripts/scrub-telemetry-urls.mjs", root)), join(base, "scripts/scrub-telemetry-urls.mjs"));
  for (const f of readdirSync(fileURLToPath(new URL("api/", root))).filter((n) => /^_.*\.js$/.test(n))) copyFileSync(fileURLToPath(new URL(`api/${f}`, root)), join(base, "api", f));
  symlinkSync(fileURLToPath(new URL("node_modules", root)), join(base, "node_modules"));
  const env = { ...process.env }; delete env.BLOB_READ_WRITE_TOKEN;
  const bad = spawnSync(process.execPath, [join(base, "scripts/scrub-telemetry-urls.mjs"), "--bogus"], { env, encoding: "utf8" });
  assert.equal(bad.status, 2, bad.stderr);
  assert.match(bad.stderr, /unknown argument: --bogus/, "the CLI block ran (before the fix it silently did nothing)");
  const noToken = spawnSync(process.execPath, [join(base, "scripts/scrub-telemetry-urls.mjs")], { env, encoding: "utf8" });
  assert.equal(noToken.status, 2);
  assert.match(noToken.stderr, /BLOB_READ_WRITE_TOKEN is required/);
});
