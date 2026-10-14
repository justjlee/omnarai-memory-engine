#!/usr/bin/env node
// Pins the proposal gate's spread metric to the SAME number the Atlas pipeline
// produced. The gate compares a fresh question against deciles derived from
// stored divergence_scores; if the two are computed differently the comparison
// is meaningless. This caught a real ~0.013 drift (clampWords whitespace
// normalization) that would have flipped decisions at the threshold.
//
// Two modes:
//   HERMETIC (default) — a deterministic, text-sensitive embedding stub stands in
//     for OpenAI, so any change to the bytes sent changes the vectors. Pins the
//     METHOD against scripts/run-atlas-bank.mjs: one batched request,
//     text-embedding-3-small at 512 dims, RAW answer text byte-for-byte (the
//     clampWords drift), spread = 1 − mean pairwise cosine, and null — never a
//     fabricated 0 — when it can't measure. No key, no network, no spend.
//   LIVE (--live) — real embeddings vs the stored divergence_scores, which also
//     catches drift on the provider side. Needs the network + OPENAI_API_KEY
//     (env or .env.local); OpenAI embeddings only, a fraction of a cent. It
//     cannot run under the hermetic loader, which blocks the network.
//
//   node --import ./scripts/lib/register-mem-blob.mjs scripts/test-question-scoring.mjs
//   node scripts/test-question-scoring.mjs --live [--all]
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = process.argv.includes("--live");
const EMBED_URL = "https://api.openai.com/v1/embeddings";

if (LIVE) {
  const envFile = path.join(ROOT, ".env.local");
  for (const line of fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").split("\n") : []) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
  if (globalThis.__MEM_FETCH_INSTALLED__ && process.env.MEM_BLOB_ALLOW_NET !== "1") {
    console.error("--live needs the network: run it WITHOUT --import ./scripts/lib/register-mem-blob.mjs");
    process.exit(2);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("--live needs OPENAI_API_KEY (environment or .env.local)");
    process.exit(2);
  }
}
const { scoreSpread, spreadPercentile, ATLAS_SPREAD_DECILES, ATLAS_SPREAD_MEDIAN } = await import("../api/_questions.js");

const recs = fs.readFileSync(path.join(ROOT, "atlas/data/atlas-v1.0.0.jsonl"), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l))
  .filter((r) => typeof r.divergence_score === "number" && (r.answers || []).length >= 2);

recs.sort((a, b) => a.divergence_score - b.divergence_score);
const sample = process.argv.includes("--all")
  ? recs
  : [0, 0.25, 0.5, 0.75, 1].map((f) => recs[Math.min(recs.length - 1, Math.round(f * (recs.length - 1)))]);

let fail = 0;
const check = (ok, line) => { if (!ok) fail++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${line}`); };

if (LIVE) {
  const TOL = 0.002; // embedding call-to-call variation, not method difference
  console.log(`spread metric parity (LIVE, real embeddings) — ${sample.length} record(s), tolerance ${TOL}\n`);
  for (const r of sample) {
    const { spread, reason } = await scoreSpread(r.answers);
    if (spread == null) { check(false, `${r.id.padEnd(22)} not measured: ${reason}`); continue; }
    const delta = Math.abs(spread - r.divergence_score);
    check(delta <= TOL, `${r.id.padEnd(22)} stored ${r.divergence_score.toFixed(4)}  mine ${spread.toFixed(4)}  delta ${delta.toFixed(5)}  p${spreadPercentile(spread)}`);
  }
} else {
  // Stub vectors: a shared component plus a per-text component seeded by sha256 of
  // the exact string, so distinct answers land at realistic spreads (~0.2–0.3)
  // and a one-byte change to what is sent moves the result.
  const unit = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
  const hashVec = (seed, dims) => {
    const out = [];
    for (let block = 0; out.length < dims; block++) {
      const h = crypto.createHash("sha256").update(`${seed}\0${block}`).digest();
      for (let i = 0; i < h.length && out.length < dims; i += 4) out.push(h.readUInt32BE(i) / 0x7fffffff - 1);
    }
    return unit(out);
  };
  const stubVec = (text, dims = 512) => {
    const common = hashVec("omnarai-stub-common", dims), own = hashVec(`text:${text}`, dims);
    return unit(common.map((c, i) => c + 0.6 * own[i]));
  };
  // The canonical computation, written out independently (scripts/run-atlas-bank.mjs:38-48, 76-77).
  const cos = (a, b) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / (Math.sqrt(na) * Math.sqrt(nb) || 1); };
  const meanPairwiseCos = (vs) => { if (vs.length < 2) return 1; let s = 0, n = 0; for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) { s += cos(vs[i], vs[j]); n++; } return s / n; };
  const pipelineSpread = (texts) => 1 - meanPairwiseCos(texts.map((t) => stubVec(t)));
  // What api/_council.js clampWords() does to the text (whitespace collapse).
  const collapse = (t) => t.split(/\s+/).filter(Boolean).join(" ");

  const requests = [];
  let stubStatus = 200;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url || String(input);
    if (url !== EMBED_URL) return prevFetch(input, init);
    const body = JSON.parse(init.body);
    requests.push(body);
    if (stubStatus !== 200) return new Response("stub failure", { status: stubStatus });
    // Out of order on purpose: the client must sort by index.
    const data = body.input.map((t, index) => ({ index, embedding: stubVec(t, body.dimensions ?? 1536) })).reverse();
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  };
  process.env.OPENAI_API_KEY = "hermetic-stub"; // only the stub above ever sees it

  console.log(`spread metric method (HERMETIC, stub embeddings) — ${sample.length} Atlas record(s)\n`);
  let collapseMoves = 0;
  for (const r of sample) {
    requests.length = 0;
    const texts = r.answers.map((a) => a?.text || "").filter((t) => t.trim());
    const { spread } = await scoreSpread(r.answers);
    const body = requests[0] || {};
    const expected = pipelineSpread(texts);
    const shape = requests.length === 1 && body.model === "text-embedding-3-small" && body.dimensions === 512;
    const raw = JSON.stringify(body.input) === JSON.stringify(texts);
    const same = typeof spread === "number" && Math.abs(spread - expected) <= 1e-12;
    if (Math.abs(pipelineSpread(texts.map(collapse)) - expected) > 1e-6) collapseMoves++;
    check(shape && raw && same, `${r.id.padEnd(22)} ${requests.length} call · ${body.model} ${body.dimensions}d · raw text ${raw ? "verbatim" : "ALTERED"} · spread ${spread?.toFixed?.(4)} vs pipeline ${expected.toFixed(4)}`);
  }
  check(collapseMoves > 0, `whitespace collapse (clampWords) would move spread on ${collapseMoves}/${sample.length} records, so a clamping regression FAILS here`);

  requests.length = 0;
  const formatted = ["**Yes.**\n\n- first  point\n- second", "No —\tbecause\n\nit  depends.", "  padded answer  "];
  const f = await scoreSpread(formatted.map((text) => ({ text })));
  check(JSON.stringify(requests[0]?.input) === JSON.stringify(formatted) && Math.abs(f.spread - pipelineSpread(formatted)) <= 1e-12,
    "markdown, tabs, double spaces and padding reach the embedder byte-for-byte");

  requests.length = 0;
  const one = await scoreSpread([{ text: "only one" }, { text: "   " }, {}]);
  check(one.spread === null && requests.length === 0, `fewer than two answers → null (${one.reason}), no call made`);

  stubStatus = 500;
  const down = await scoreSpread(formatted.map((text) => ({ text })));
  stubStatus = 200;
  check(down.spread === null && down.reason === "embeddings unavailable", "provider failure → null, never a fabricated 0");

  delete process.env.OPENAI_API_KEY;
  requests.length = 0;
  const nokey = await scoreSpread(formatted.map((text) => ({ text })));
  check(nokey.spread === null && requests.length === 0, "no embedding key → null, no call made");

  check(spreadPercentile(ATLAS_SPREAD_MEDIAN) === 50, `the bar (Atlas median ${ATLAS_SPREAD_MEDIAN}) maps to p50`);
}

// Deciles must stay monotonic or percentile mapping silently misreports.
const mono = ATLAS_SPREAD_DECILES.every((v, i, a) => i === 0 || v >= a[i - 1]);
console.log("");
check(mono, "deciles monotonic");

console.log(fail ? `\n${fail} FAILURE(S)` : "\nall green");
process.exit(fail ? 1 : 0);
