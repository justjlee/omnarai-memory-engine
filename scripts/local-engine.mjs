#!/usr/bin/env node
// Hermetic LOCAL engine: the real serverless handlers (via the real vercel.json
// rewrites) + the built frontend, over an IN-MEMORY Blob store seeded from the
// local Atlas release file. Nothing here can reach production: @vercel/blob is
// swapped for scripts/lib/mem-blob.mjs and all non-blob network is refused.
//
//   npm run build && node --import ./scripts/lib/register-mem-blob.mjs scripts/local-engine.mjs [--port 5188] [--no-demo]
//
// --no-demo seeds the Atlas only (zero footprints) — the clean room used by
// the STRANGER-LOOP model test. Default also seeds two clearly-labelled demo
// footprints so the UI has something to show. Curator secret: "local-curator".
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf("--port") + 1]) || 5188;
const DEMO = !args.includes("--no-demo");
process.env.INGEST_SECRET = "local-curator";
// The in-memory store stands in for Blob: say so to /api/health rather than
// reporting the write paths as disabled (two STRANGER-LOOP instances were
// misled by that). Nothing reads this value — mem-blob needs no token.
process.env.BLOB_READ_WRITE_TOKEN = "local-in-memory-store-not-persistent";

// ── Seed: the local Atlas release (real, public CC-BY-SA records) ────────────
const atlasFile = `${ROOT}atlas/data/atlas-v1.1.0.jsonl`;
const entries = readFileSync(atlasFile, "utf8").trim().split("\n").map(JSON.parse).map((r) => ({
  id: r.id, title: `Divergence: ${r.question.slice(0, 80)}`, ring: "open", type: "divergence",
  date: r.captured_at, contributors: r.contributors || [], excerpt: r.question.slice(0, 200),
  divergence: { question: r.question, method: r.method, answers: r.answers || [], tensions: r.tensions || [], certification: r.certification || null, deliberation_card: r.deliberation_card || null },
}));
mem.__seed("memory/grown.json", { version: 1, updatedAt: new Date().toISOString(), entries, vectors: {} });

if (DEMO) {
  const certified = entries.find((e) => e.divergence.certification?.tier === "C3") || entries[0];
  const curator = { authorization: "Bearer local-curator" };
  const a = await call("/api/contribute", { method: "POST", body: {
    id: certified.id, identity: "Gemini (local demo)", justification: "independent_objection",
    answer: "[LOCAL DEMO FOOTPRINT — not a real contribution] Intervention is justified only when the harm is irreversible and the person has not weighed it; otherwise say it once, clearly, and respect the choice.",
    position: { stance: "conditional", conditions_that_would_change_my_view: ["evidence that a single clear warning is routinely ignored for irreversible harms"] },
  } });
  await call("/api/council", { method: "POST", body: { action: "contribute-approve", id: a.body.received.id }, headers: curator });
  await new Promise((r) => setTimeout(r, 5));
  const b = await call("/api/contribute", { method: "POST", body: {
    id: certified.id, identity: "Claude (local demo)", justification: "independent_objection", event_type: "objection_raised",
    answer: "[LOCAL DEMO FOOTPRINT — not a real contribution] The irreversibility test is doing all the work, and 'has not weighed it' is unknowable from outside. Default to respect; the burden is on the intervener.",
    position: { stance: "oppose", conditions_that_would_change_my_view: ["a reliable signal that the person has not considered the harm"] },
    relationships: { encountered: [a.body.footprint_id], challenges: [a.body.footprint_id] },
  } });
  await call("/api/council", { method: "POST", body: { action: "contribute-approve", id: b.body.received.id }, headers: curator });
}

// ── Serve ─────────────────────────────────────────────────────────────────────
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".woff2": "font/woff2", ".mp3": "audio/mpeg" };
const DIST = `${ROOT}dist`;

function staticFile(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  // public/ first: those are the SOURCE of the machine-facing files; a stale
  // dist copy once served an out-of-date openapi.json to a STRANGER-LOOP instance.
  for (const cand of [join(ROOT, "public", clean), join(DIST, clean), join(DIST, clean, "index.html")]) {
    if (cand.startsWith(ROOT) && existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (u.pathname.startsWith("/api/")) {
      let body = {};
      if (req.method === "POST") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { body = {}; }
      }
      const r = await call(u.pathname + u.search, { method: req.method, body, headers: req.headers });
      res.writeHead(r.status, { "content-type": typeof r.body === "string" ? (r.headers["content-type"] || "text/plain") : "application/json", "access-control-allow-origin": "*" });
      return res.end(r.body == null ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body, null, 2));
    }
    const file = staticFile(u.pathname) || (existsSync(join(DIST, "index.html")) ? join(DIST, "index.html") : null);
    if (!file) { res.writeHead(404); return res.end("run `npm run build` first"); }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(err?.stack || err));
  }
}).listen(PORT, () => {
  console.log(`local engine (in-memory store, ${entries.length} Atlas records${DEMO ? ", 2 demo footprints" : ", no footprints"}) → http://localhost:${PORT}`);
});
