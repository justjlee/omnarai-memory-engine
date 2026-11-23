// The move of private-class records into the private store (scripts/migrate-private-blobs.mjs). HERMETIC.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-private-move.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import * as mem from "./lib/mem-blob.mjs";
import { run, deletePublic, openSealed, ARCHIVE_FORMAT, MANIFEST_FORMAT } from "./migrate-private-blobs.mjs";

const KEY = randomBytes(32).toString("hex");
const NOW = new Date("2026-11-18T12:00:00Z");
const TOK = "a".repeat(64);
const quiet = () => {};
const dir = () => mkdtempSync(join(tmpdir(), "omn-move-"));
const files = () => { const d = dir(); return { archive: join(d, "archive.json"), manifest: join(d, "manifest.json") }; };

function seedWorld() {
  mem.__reset();
  process.env.PRIVATE_BLOB_READ_WRITE_TOKEN = "mem-private-token";
  mem.__seed("memory/grown.json", { version: 1, entries: [] });
  mem.__seed("gallery/a.png", "png-bytes");
  mem.__seed("contributions/OMN-X1.json", { id: "OMN-X1", answer: "a visitor answer", status: "pending" });
  mem.__seed("home/open-items/i1.json", { id: "i1", text: "curator note" });
  mem.__seed("budget/config.json", { cap_usd: 95 });
  mem.__seed("footprints/events/OMN-FP-1.json", { id: "OMN-FP-1" });
  mem.__seed("telemetry/access-log.json", { version: 2, recent: [{ at: "2026-11-01T00:00:00Z", path: `/api/footprints?id=OMN-FP-1&receipt=${TOK}`, referer: "https://x.test/p?q=secret" }], firstExternal: { path: "/api/info?q=hello%20there" }, days: {} });
  mem.__seed("telemetry/events/2026-11-10/a.json", { at: "2026-11-10T01:00:00Z", category: "ai-agent", endpoint: "footprints", ipHash: "h1", country: "US", path: `/api/footprints?receipt=${TOK}`, referer: null });
  mem.__seed("telemetry/events/2026-11-10/b.json", { at: "2026-11-10T02:00:00Z", category: "monitor", endpoint: "health", ipHash: "h2", path: "/api/health" });
  mem.__seed("telemetry/events/2026-07-20/old.json", { at: "2026-07-20T01:00:00Z", category: "external-browser", endpoint: "info", ipHash: "h3", path: "/api/info" });
}
const publicSnapshot = () => JSON.stringify([...mem.__snapshot()].map(([k, v]) => [k, v.body]));

test("[M1] dry run reads and plans; writes nothing anywhere", async () => {
  seedWorld();
  const before = publicSnapshot();
  const r = await run({ now: NOW, log: quiet });
  assert.equal(r.ok, true);
  assert.equal(r.dryRun, true);
  assert.equal(r.summary.objects, 8, "only private classes are in scope (gallery and grown memory are not)");
  assert.equal(r.summary.aggregate_only, 1, "the July event is past the 90-day window");
  assert.equal(r.summary.sanitized, 1);
  assert.equal(publicSnapshot(), before);
  assert.equal(mem.__dumpPrivate("").length, 0);
});

test("[M2] apply: archive first and verified; exact copies; telemetry sanitized; old events aggregated only; manifest sealed", async () => {
  seedWorld();
  const f = files();
  const r = await run({ apply: true, ...f, keyHex: KEY, now: NOW, log: quiet });
  assert.equal(r.ok, true, JSON.stringify(r.problems || r.refused));
  for (const p of [f.archive, f.manifest]) assert.equal(statSync(p).mode & 0o777, 0o600);
  const a = openSealed(f.archive, ARCHIVE_FORMAT, KEY);
  assert.equal(a.payload.entries.length, 8, "the archive holds every in-scope object exactly as it was");
  const orig = a.payload.entries.find((e) => e.pathname === "telemetry/events/2026-11-10/a.json");
  assert.ok(Buffer.from(orig.b64, "base64").toString().includes(TOK), "the archive is the untouched original");
  assert.deepEqual(mem.__readPrivate("contributions/OMN-X1.json"), { id: "OMN-X1", answer: "a visitor answer", status: "pending" });
  assert.deepEqual(mem.__readPrivate("budget/config.json"), { cap_usd: 95 });
  const priv = mem.__dumpPrivate("").map((k) => JSON.stringify(mem.__readPrivate(k))).join("\n");
  assert.ok(!priv.includes(TOK), "no receipt token reaches the private store");
  assert.ok(!priv.includes("q=secret") && !priv.includes("hello%20there"), "referrer queries and free text are removed");
  assert.equal(mem.__readPrivate("telemetry/events/2026-07-20/old.json"), null, "past the window: not copied");
  const d = mem.__readPrivate("telemetry/daily/2026-07-20.json");
  assert.equal(d.total, 1);
  assert.equal(mem.__readPrivate("telemetry/daily/2026-11-10.json").signal, 1, "monitors are subtracted");
  assert.ok(mem.__dump("contributions/").length === 1, "the old copy is untouched until a separate, approved delete");
  const m = openSealed(f.manifest, MANIFEST_FORMAT, KEY);
  assert.equal(m.doc.payload_sha256, r.manifestHash);
  assert.ok(m.payload.entries.every((e) => !("b64" in e)), "the manifest holds no content");
  assert.equal(m.payload.entries.find((e) => e.pathname === "telemetry/events/2026-07-20/old.json").action, "aggregate-only");
});

test("[M3] resume after a crash: the failed run writes no manifest; the re-run finishes and skips what is done", async () => {
  seedWorld();
  mem.__faults.put = (p) => p === "home/open-items/i1.json";
  const f1 = files();
  const r1 = await run({ apply: true, ...f1, keyHex: KEY, now: NOW, log: quiet, concurrency: 2 });
  assert.equal(r1.ok, false);
  assert.equal(r1.refused, "incomplete");
  assert.ok(existsSync(f1.archive) && !existsSync(f1.manifest));
  mem.__faults.put = null;
  const f2 = files();
  const r2 = await run({ apply: true, ...f2, keyHex: KEY, now: NOW, log: quiet });
  assert.equal(r2.ok, true);
  assert.ok(r2.byAction["already-copied"] >= 3, JSON.stringify(r2.byAction));
  assert.ok(mem.__readPrivate("home/open-items/i1.json"));
});

test("[M4] one unreadable object refuses the whole run before anything is written", async () => {
  seedWorld();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).includes("contributions/OMN-X1.json") ? new Response("boom", { status: 500 }) : real(url, init));
  try {
    const f = files();
    const r = await run({ apply: true, ...f, keyHex: KEY, now: NOW, log: quiet });
    assert.equal(r.ok, false);
    assert.equal(r.refused, "unreadable");
    assert.ok(!existsSync(f.archive) && !existsSync(f.manifest));
    assert.equal(mem.__dumpPrivate("").length, 0);
  } finally { globalThis.fetch = real; }
});

test("[M5] a record the new code already wrote privately is never overwritten", async () => {
  seedWorld();
  mem.__seedPrivate("contributions/OMN-X1.json", { id: "OMN-X1", answer: "a visitor answer", status: "approved" });
  const r = await run({ apply: true, ...files(), keyHex: KEY, now: NOW, log: quiet });
  assert.equal(r.ok, true);
  assert.equal(mem.__readPrivate("contributions/OMN-X1.json").status, "approved");
  assert.equal(r.results.find((e) => e.pathname === "contributions/OMN-X1.json").action, "kept-private");
});

test("[M6] delete from the old store: dry run names the sentence; wrong sentence deletes nothing; right one removes fixed-address copies only", async () => {
  seedWorld();
  const f = files();
  const r = await run({ apply: true, ...f, keyHex: KEY, now: NOW, log: quiet });
  const dry = await deletePublic({ ...f, keyHex: KEY, log: quiet });
  assert.equal(dry.ok, true);
  assert.equal(dry.count, 5, "contributions, home, budget, footprint, access log — not the event files");
  assert.equal(dry.sentence, `Delete the 5 public objects in manifest ${r.manifestHash.slice(0, 12)} from the engine store`);
  await assert.rejects(() => deletePublic({ ...f, keyHex: KEY, apply: true, approval: "yes delete", log: quiet }), /does not match/);
  assert.equal(mem.__dump("contributions/").length, 1);
  const done = await deletePublic({ ...f, keyHex: KEY, apply: true, approval: dry.sentence, log: quiet });
  assert.equal(done.deleted, 5);
  assert.deepEqual(done.still, []);
  assert.deepEqual(mem.__dump("").filter((k) => !/^(gallery|memory)\//.test(k)).sort(), ["telemetry/events/2026-07-20/old.json", "telemetry/events/2026-11-10/a.json", "telemetry/events/2026-11-10/b.json"]);
  assert.ok(mem.__readPrivate("contributions/OMN-X1.json"), "the private copy is untouched");
});

test("[M7] deletion is blocked when a private copy is missing or the old object changed after the copy", async () => {
  seedWorld();
  const f = files();
  await run({ apply: true, ...f, keyHex: KEY, now: NOW, log: quiet });
  mem.__seed("budget/config.json", { cap_usd: 50 });
  const { del } = await import("@vercel/blob");
  await del(["https://private.mem.blob.test/home/open-items/i1.json"], { token: "mem-private-token" });
  const r = await deletePublic({ ...f, keyHex: KEY, log: quiet });
  assert.equal(r.ok, false);
  assert.ok(r.blockers.some((b) => b.startsWith("budget/config.json")));
  assert.ok(r.blockers.some((b) => b.startsWith("home/open-items/i1.json")));
});

test("[M8] archive and manifest paths: refused inside a git checkout, in a synced folder, or over an existing file; wrong key refused", async () => {
  seedWorld();
  const d = dir();
  const existing = join(d, "exists.json");
  writeFileSync(existing, "x");
  await assert.rejects(() => run({ apply: true, archive: existing, manifest: join(d, "m.json"), keyHex: KEY, now: NOW, log: quiet }), /never overwritten/);
  await assert.rejects(() => run({ apply: true, archive: join(process.cwd(), "a.json"), manifest: join(d, "m2.json"), keyHex: KEY, now: NOW, log: quiet }), /git checkout/);
  await assert.rejects(() => run({ apply: true, archive: join(d, "a.json"), manifest: join(d, "m3.json"), keyHex: "short", now: NOW, log: quiet }), /64 hex/);
  const f = files();
  await run({ apply: true, ...f, keyHex: KEY, now: NOW, log: quiet });
  assert.throws(() => openSealed(f.archive, ARCHIVE_FORMAT, randomBytes(32).toString("hex")));
});
