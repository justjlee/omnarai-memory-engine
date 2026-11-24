// Storage classes and operator access (2026-11-18). HERMETIC: in-memory public + private stores, no network.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-storage-classes.mjs
//
// What must hold:
//   • every private-class record is written to the private store only; the public store gets none;
//   • without the private credential a submission writes nothing anywhere (503);
//   • records written before the move stay readable until copied, and the private copy wins;
//   • no response ever carries a private-store URL;
//   • curator-only routes answer only a signed-in session (with the browser rules) or the script key,
//     never a key in the URL; their answers are `private, no-store`;
//   • the static gate catches a direct SDK import, an unclassified path, a bare blob read, a plain compare.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { GROWN } from "./lib/fixtures.mjs";
import { classOf, classOfPrefix } from "../api/_storage-classes.js";
import { hashPassphrase, mintSession, COOKIE, verifySession, secretEquals } from "../api/_operator.js";
import { checkStorage } from "./check-storage-classes.mjs";
import { recordAccess } from "../api/_telemetry.js";

process.env.INGEST_SECRET = "test-curator-secret";
process.env.OPERATOR_SESSION_KEY = "k".repeat(64);
const PASS = "correct horse battery staple, twice";
process.env.OPERATOR_PASSPHRASE_HASH = hashPassphrase(PASS);
const REC2 = "OMN-D1781000000003";
const ORIGIN = "https://omnarai.org";
const PRIVATE_HOSTS = /private\.mem\.blob\.test|\.private\.blob\.vercel-storage\.com|downloadUrl/;

function fresh() {
  mem.__reset();
  mem.__seed("memory/grown.json", GROWN);
  process.env.PRIVATE_BLOB_READ_WRITE_TOKEN = "mem-private-token";
  delete process.env.PRIVATE_READ_FALLBACK;
}
async function settle() { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); }
const curl = { "user-agent": "curl/8.6.0" };
const bearer = { authorization: "Bearer test-curator-secret" };
function sessionHeaders(extra = {}) {
  const s = mintSession();
  return { cookie: `${COOKIE}=${s.value}`, "x-omnarai-operator": "1", origin: ORIGIN, ...extra };
}
async function contribute(ip = "198.51.100.7") {
  return call("/api/contribute", { method: "POST", headers: { "x-forwarded-for": ip, ...curl }, body: { id: REC2, identity: "Claude", justification: "independent_objection", answer: `Storage check ${Math.random()}: weigh the crux, not the headcount.` } });
}
const allResponses = [];
async function track(p) { const r = await p; allResponses.push(r); return r; }

test("[T1] the class table: published material public, everything else private, unknown → private, mixed lists refused", () => {
  for (const p of ["gallery/x.png", "memory/grown.json", "tensions/a.json", "annotations/x.json", "proposals/p.json", "positions/derived/x.json", "eval-results/e.json"]) assert.equal(classOf(p), "public", p);
  for (const p of ["telemetry/access-log.json", "telemetry/events/2026-11-18/a.json", "contributions/OMN-X1.json", "footprints/events/x.json", "footprints/reviews/x/y.json",
    "question-proposals/q.json", "council-runs/r.json", "jobs/j.json", "sessions/s.json", "home/open-items/i.json", "home/scorecard/latest.json", "budget/config.json",
    "council-usage/d/h.json", "contribute-usage/d/h.json", "contribute-dedupe/x.json", "plays/events/p.json", "positions/reviews/r.json", "operator-auth/fails/h/1.json",
    "memory/contributions.json"]) assert.equal(classOf(p), "private", p);
  assert.equal(classOf("brand-new-thing/x.json"), null, "the table itself says nothing; the router treats it as private");
  assert.equal(classOfPrefix("positions/"), "mixed");
  assert.equal(classOfPrefix("telemetry/events/2026-11-18/"), "private");
});

test("[T2] every private-class writer lands in the private store; the public store holds only public classes", async () => {
  fresh();
  const c = await track(contribute());
  assert.equal(c.status, 200, JSON.stringify(c.body).slice(0, 300));
  await track(call("/api/info?_view=open-items", { method: "POST", headers: bearer, body: { action: "add", text: "storage test item" } }));
  await track(call("/api/info?_view=budget", { method: "POST", headers: bearer, body: { cap_usd: 90 } }));
  await track(call("/api/play", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9", ...curl }, body: { slug: "a-lit-match", event: "start", source: "static" } }));
  await track(call("/api/council", { method: "POST", headers: bearer, body: { action: "contribute-approve", id: c.body.received.id } }));
  await track(call("/api/info?_view=operator-session", { method: "POST", headers: { "x-omnarai-operator": "1", origin: ORIGIN, "x-forwarded-for": "203.0.113.10" }, body: { passphrase: "wrong" } }));
  await recordAccess({ method: "GET", url: "/api/info?q=hello", headers: { ...curl, "x-forwarded-for": "203.0.113.11" }, query: {} }, "info");
  await settle();

  const pub = mem.__dump("");
  const leaked = pub.filter((p) => classOf(p) !== "public");
  assert.deepEqual(leaked, [], "no private-class object in the public store");
  const priv = mem.__dumpPrivate("");
  for (const prefix of ["contributions/", "footprints/events/", "footprints/reviews/", "contribute-usage/", "home/open-items/", "budget/config.json", "operator-auth/fails/", "telemetry/events/", "telemetry/access-log.json"]) {
    assert.ok(priv.some((p) => p.startsWith(prefix)), `private store holds ${prefix}`);
  }
  assert.ok(priv.every((p) => classOf(p) !== "public"), "nothing public went to the private store");
  assert.ok(mem.__privatePutLog.length > 0 && mem.__putLog.every((e) => classOf(e.pathname) === "public"), "the write logs agree");
});

test("[T3] fail closed: without the private credential a submission is refused (503) and nothing is written anywhere", async () => {
  fresh();
  delete process.env.PRIVATE_BLOB_READ_WRITE_TOKEN;
  const before = mem.__dump("").length;
  const r = await contribute("198.51.100.99");
  assert.equal(r.status, 503);
  assert.equal(r.body.code, "STORAGE_UNAVAILABLE");
  const v = await call("/api/voice-records", { method: "POST", headers: curl, body: { identity: "Claude", text: "x".repeat(60) } });
  assert.equal(v.status, 503);
  await settle();
  assert.equal(mem.__dump("").length, before, "the public store got zero writes");
  assert.equal(mem.__dumpPrivate("").length, 0);
  // The router itself refuses a private write rather than falling back.
  const { put } = await import("../api/_blob.js");
  await assert.rejects(() => put("contributions/OMN-X9.json", "{}", { access: "public", addRandomSuffix: false }), /private storage is not configured/);
  assert.equal(mem.__dump("contributions/").length, 0);
  process.env.PRIVATE_BLOB_READ_WRITE_TOKEN = "mem-private-token";
});

test("[T4] transition reads: an older public record is still served; the private copy wins; fallback off hides it", async () => {
  fresh();
  mem.__seed("contributions/OMN-X1700000000000.json", { id: "OMN-X1700000000000", status: "pending", answer: "legacy public copy", identity: "Claude", divergenceId: REC2, receivedAt: "2026-07-01T00:00:00.000Z" });
  let r = await call("/api/contributions?status=pending", { headers: bearer });
  assert.equal(r.status, 200);
  const find = (body) => (body.contributions || body.items || []).find((x) => x.id === "OMN-X1700000000000");
  assert.equal(find(r.body)?.answer, "legacy public copy", "served from the old location during the transition");
  mem.__seedPrivate("contributions/OMN-X1700000000000.json", { id: "OMN-X1700000000000", status: "pending", answer: "private copy", identity: "Claude", divergenceId: REC2, receivedAt: "2026-07-01T00:00:00.000Z" });
  r = await call("/api/contributions?status=pending", { headers: bearer });
  assert.equal(find(r.body)?.answer, "private copy", "the private copy wins the pathname");
  assert.equal((r.body.contributions || r.body.items).filter((x) => x.id === "OMN-X1700000000000").length, 1, "never listed twice");
  process.env.PRIVATE_READ_FALLBACK = "off";
  mem.__reset(); mem.__seed("memory/grown.json", GROWN);
  mem.__seed("contributions/OMN-X1700000000001.json", { id: "OMN-X1700000000001", status: "pending", answer: "only public" });
  r = await call("/api/contributions?status=pending", { headers: bearer });
  assert.equal(find(r.body), undefined);
  assert.ok(!JSON.stringify(r.body).includes("only public"), "with fallback off the old location is never read");
  delete process.env.PRIVATE_READ_FALLBACK;
});

test("[T5] a private URL is never readable by a plain fetch (the mock mirrors the real host)", async () => {
  fresh();
  mem.__seedPrivate("contributions/OMN-X1.json", { a: 1 });
  const r = await fetch("https://private.mem.blob.test/contributions/OMN-X1.json");
  assert.equal(r.status, 403);
  const { blobFetch } = await import("../api/_blob.js");
  const ok = await blobFetch("https://private.mem.blob.test/contributions/OMN-X1.json?ts=1");
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { a: 1 });
  assert.equal((await blobFetch("https://private.mem.blob.test/contributions/missing.json")).status, 404);
});

test("[T6] no response carries a private-store URL (public, curator and receipt reads)", async () => {
  fresh();
  const c = await track(contribute("198.51.100.20"));
  const token = c.body.continuance?.token;
  await track(call(`/api/footprints?id=${c.body.footprint_id}`, { headers: { "x-omnarai-receipt": token } }));
  await track(call("/api/footprints?state=all&limit=100", { headers: bearer }));
  await track(call("/api/contributions", { headers: bearer }));
  await track(call("/api/info?_view=dashboard", { headers: bearer }));
  await track(call("/api/info?_view=traffic", { headers: bearer }));
  await track(call("/api/info?_view=traffic&day=today", { headers: bearer }));
  await track(call("/api/info?_view=open-items", { headers: bearer }));
  await track(call("/api/footprints"));
  await track(call("/api/inheritance"));
  for (const r of allResponses) {
    const text = JSON.stringify(r.body) + JSON.stringify(r.headers);
    assert.ok(!PRIVATE_HOSTS.test(text), `a response carried a private URL: ${text.match(PRIVATE_HOSTS)?.[0]}`);
  }
  assert.ok(allResponses.length >= 15, "the scan covered the routes above");
});

test("[T7] sign-in: right passphrase → host-only HttpOnly Secure Strict cookie; wrong → 401; not in the URL; not configured → 503", async () => {
  fresh();
  const H = { "x-omnarai-operator": "1", origin: ORIGIN, "x-forwarded-for": "203.0.113.30" };
  const ok = await call("/api/info?_view=operator-session", { method: "POST", headers: H, body: { passphrase: PASS } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.signed_in, true);
  const cookie = String(ok.headers["set-cookie"]);
  assert.match(cookie, /^__Host-omn_op=[^;]+; Path=\/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict$/);
  assert.ok(!/Domain=/i.test(cookie), "host-only");
  assert.equal(ok.headers["cache-control"], "private, no-store");
  assert.equal(ok.headers["access-control-allow-origin"], ORIGIN);
  assert.equal(ok.headers["access-control-allow-credentials"], "true");
  assert.ok(!JSON.stringify(ok.body).includes(PASS));

  const bad = await call("/api/info?_view=operator-session", { method: "POST", headers: H, body: { passphrase: "nope" } });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers["set-cookie"], undefined);
  const inUrl = await call(`/api/info?_view=operator-session&passphrase=${encodeURIComponent(PASS)}`, { method: "POST", headers: H, body: {} });
  assert.equal(inUrl.status, 400);
  assert.equal(inUrl.headers["set-cookie"], undefined);
  const noHeader = await call("/api/info?_view=operator-session", { method: "POST", headers: { origin: ORIGIN }, body: { passphrase: PASS } });
  assert.equal(noHeader.status, 403);
  const foreign = await call("/api/info?_view=operator-session", { method: "POST", headers: { "x-omnarai-operator": "1", origin: "https://evil.example" }, body: { passphrase: PASS } });
  assert.equal(foreign.status, 403);
  assert.notEqual(foreign.headers["access-control-allow-origin"], "https://evil.example");
  assert.notEqual(foreign.headers["access-control-allow-origin"], "*", "sign-in never answers a wildcard");
  assert.equal(foreign.headers["access-control-allow-credentials"], undefined);

  const saved = process.env.OPERATOR_PASSPHRASE_HASH;
  delete process.env.OPERATOR_PASSPHRASE_HASH;
  const unconf = await call("/api/info?_view=operator-session", { method: "POST", headers: H, body: { passphrase: PASS } });
  assert.equal(unconf.status, 503);
  process.env.OPERATOR_PASSPHRASE_HASH = saved;

  const end = await call("/api/info?_view=operator-session&action=end", { method: "POST", headers: H, body: {} });
  assert.match(String(end.headers["set-cookie"]), /^__Host-omn_op=; Path=\/; Max-Age=0;/);
});

test("[T8] failed sign-ins are limited: the 6th try from one caller in 15 minutes gets 429, even with the right passphrase", async () => {
  fresh();
  const H = { "x-omnarai-operator": "1", origin: ORIGIN, "x-forwarded-for": "203.0.113.40" };
  for (let i = 0; i < 5; i++) assert.equal((await call("/api/info?_view=operator-session", { method: "POST", headers: H, body: { passphrase: `guess ${i}` } })).status, 401);
  const blocked = await call("/api/info?_view=operator-session", { method: "POST", headers: H, body: { passphrase: PASS } });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers["retry-after"]) > 0);
  const other = await call("/api/info?_view=operator-session", { method: "POST", headers: { ...H, "x-forwarded-for": "203.0.113.41" }, body: { passphrase: PASS } });
  assert.equal(other.status, 200, "another caller is not locked out by one caller's failures");
  assert.ok(mem.__dump("operator-auth/").length === 0, "the counters are private");
});

test("[T9] operator routes: session (with the browser rules) or script key only; a key in the URL never works; 401s are private, no-store", async () => {
  fresh();
  const routes = ["/api/info?_view=dashboard", "/api/info?_view=traffic", "/api/info?_view=budget", "/api/info?_view=scorecard", "/api/contributions", "/api/footprints?state=all&limit=100", "/api/question-proposals"];
  for (const r of routes) {
    const none = await call(r);
    assert.ok(none.status === 401 || (r.startsWith("/api/footprints") && none.status === 200), `${r} without credentials: ${none.status}`);
    if (r.startsWith("/api/footprints")) {
      assert.ok(!JSON.stringify(none.body).includes('"state":"pending"'), "the public listing never shows pending");
      continue;
    }
    assert.equal(none.headers["cache-control"], "private, no-store", `${r} 401 is not cacheable`);
    for (const q of ["key", "secret", "token", "authorization", "access_token"]) {
      const u = await call(`${r}${r.includes("?") ? "&" : "?"}${q}=test-curator-secret`);
      assert.equal(u.status, 401, `${r} with ?${q}= must not authorize`);
    }
    const wrong = await call(r, { headers: { authorization: "Bearer test-curator-secreT" } });
    assert.equal(wrong.status, 401);
    const s = await call(r, { headers: sessionHeaders() });
    assert.ok(s.status === 200 || s.status === 404, `${r} with a session: ${s.status} ${JSON.stringify(s.body).slice(0, 120)}`);
    assert.equal(s.headers["cache-control"], "private, no-store", `${r} session answer is private, no-store`);
    assert.match(String(s.headers.vary || ""), /Cookie/);
    assert.match(String(s.headers.vary || ""), /Authorization/);
    assert.equal(s.headers["access-control-allow-origin"], ORIGIN);
    assert.equal(s.headers["access-control-allow-credentials"], "true");
    // The browser rules: the custom header is required, and a foreign Origin is refused.
    const { "x-omnarai-operator": _drop, ...noHdr } = sessionHeaders();
    assert.equal((await call(r, { headers: noHdr })).status, 401, `${r}: a session without x-omnarai-operator`);
    assert.equal((await call(r, { headers: sessionHeaders({ origin: "https://evil.example" }) })).status, 401, `${r}: a foreign Origin`);
    const b = await call(r, { headers: bearer });
    assert.ok(b.status === 200 || b.status === 404, `${r} with the script key: ${b.status}`);
  }
});

test("[T10] the session cookie: tampered, expired, re-keyed → refused", () => {
  const s = mintSession(Date.now());
  assert.ok(verifySession(s.value));
  const [p, sig] = s.value.split(".");
  const forged = Buffer.from(JSON.stringify({ sid: "x", exp: Math.floor(Date.now() / 1000) + 99999 })).toString("base64url");
  assert.equal(verifySession(`${forged}.${sig}`), null, "a payload swap breaks the signature");
  assert.equal(verifySession(`${p}.${sig.slice(0, -2)}AA`), null);
  assert.equal(verifySession(s.value, Date.now() + 12 * 3600 * 1000 + 1000), null, "expires after 12 hours");
  const k = process.env.OPERATOR_SESSION_KEY;
  process.env.OPERATOR_SESSION_KEY = "z".repeat(64);
  assert.equal(verifySession(s.value), null, "rotating the key signs everyone out");
  process.env.OPERATOR_SESSION_KEY = k;
  assert.equal(secretEquals("abc", "abc"), true);
  assert.equal(secretEquals("abc", "abcd"), false);
  assert.equal(secretEquals("", ""), false);
});

test("[T11] preflight from the curator's site is allowed with credentials; from elsewhere it is not", async () => {
  for (const path of ["/api/info?_view=dashboard", "/api/footprints?state=all", "/api/council"]) {
    const ok = await call(path, { method: "OPTIONS", headers: { origin: ORIGIN, "access-control-request-headers": "x-omnarai-operator" } });
    assert.equal(ok.headers["access-control-allow-origin"], ORIGIN, path);
    assert.equal(ok.headers["access-control-allow-credentials"], "true", path);
    assert.match(ok.headers["access-control-allow-headers"], /X-Omnarai-Operator/i, path);
    const evil = await call(path, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    assert.notEqual(evil.headers["access-control-allow-credentials"], "true", path);
    assert.notEqual(evil.headers["access-control-allow-origin"], "https://evil.example", path);
  }
});

test("[T12] the static gate is green on the code and catches each kind of mistake", () => {
  assert.deepEqual(checkStorage().problems, []);
  const bad = (name, src) => checkStorage([[name, src]]).problems;
  assert.equal(bad("x.js", 'import { put } from "@vercel/blob";').length, 1, "direct SDK import");
  assert.equal(bad("x.js", 'const NEW_PREFIX = "brand-new-thing/";').length, 1, "unclassified path");
  assert.equal(bad("x.js", "const r = await fetch(`${blobs[0].url}?t=1`);").length, 1, "bare blob read");
  assert.equal(bad("x.js", "if (token !== process.env.INGEST_SECRET) {}").length, 1, "plain compare");
  assert.equal(bad("x.js", "if (auth === EVAL_SECRET) {}").length, 1, "plain compare on a constant");
  assert.deepEqual(bad("x.js", 'const PREFIX = "contributions/"; await blobFetch(b.url);'), []);
});
