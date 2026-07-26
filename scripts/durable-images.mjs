#!/usr/bin/env node
// durable-images.mjs — the Gallery's 104 images are hotlinked Reddit preview URLs
// (external-preview.redd.it/…?s=<signature>) whose signatures expire, so the archive is on
// borrowed time. This downloads each and re-hosts it on Vercel Blob (durable, CDN), repointing
// public/data/images.json[].url AND the matching corpus entry's .image field. Originals are
// preserved as url_original / image_original so nothing is lost.
//
//   BLOB_READ_WRITE_TOKEN=... node scripts/durable-images.mjs [--apply] [--limit N]
// Idempotent: records already pointing at blob.vercel-storage.com are skipped.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const limIdx = process.argv.indexOf("--limit");
const LIMIT = limIdx > -1 ? parseInt(process.argv[limIdx + 1], 10) : Infinity;
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!TOKEN) { console.error("BLOB_READ_WRITE_TOKEN required (source .env.local)"); process.exit(2); }

const IMAGES_PATH = join(ROOT, "public", "data", "images.json");
const CORPUS_PATH = join(ROOT, "public", "data", "corpus.json");
const images = JSON.parse(readFileSync(IMAGES_PATH, "utf8"));
const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8"));
const corpusById = new Map(corpus.map((e) => [e.id, e]));

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const isBlob = (u) => typeof u === "string" && u.includes("blob.vercel-storage.com");

async function rehost(url, pathBase) {
  const dl = await fetch(url);
  if (!dl.ok) return { ok: false, why: `download ${dl.status}` };
  const ct = dl.headers.get("content-type") || "image/png";
  const ext = EXT[ct.split(";")[0].trim()] || "png";
  const bytes = Buffer.from(await dl.arrayBuffer());
  if (bytes.length < 500) return { ok: false, why: `too small (${bytes.length}b)` };
  const put = await fetch(`https://blob.vercel-storage.com/gallery/${pathBase}.${ext}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${TOKEN}`, "x-content-type": ct, "x-add-random-suffix": "1" },
    body: bytes,
  });
  if (!put.ok) return { ok: false, why: `blob ${put.status}: ${(await put.text()).slice(0, 80)}` };
  const j = await put.json();
  return j.url ? { ok: true, url: j.url, bytes: bytes.length } : { ok: false, why: "no url in blob response" };
}

let done = 0, ok = 0, skip = 0, fail = 0, corpusRepointed = 0;
const fails = [];
for (let i = 0; i < images.length; i++) {
  if (done >= LIMIT) break;
  const rec = images[i];
  if (isBlob(rec.url)) { skip++; continue; }
  if (!rec.url) { skip++; continue; }
  const base = `${rec.corpusId || "img"}-${i}`;
  if (!APPLY) { done++; ok++; continue; } // dry run: just count
  const r = await rehost(rec.url, base);
  done++;
  if (r.ok) {
    rec.url_original = rec.url;
    rec.url = r.url;
    // repoint the matching corpus entry's .image too, if it was the same hotlink
    const e = corpusById.get(rec.corpusId);
    if (e && e.image && !isBlob(e.image)) { e.image_original = e.image; e.image = r.url; corpusRepointed++; }
    ok++;
  } else { fail++; fails.push(`${rec.corpusId}: ${r.why}`); }
  if (done % 20 === 0) process.stdout.write(`  …${done} (${ok} ok / ${fail} fail)\n`);
}

console.log(`\nimages: ${images.length} | processed: ${done} | rehosted: ${ok} | skipped(existing/none): ${skip} | failed: ${fail}`);
console.log(`corpus .image fields repointed: ${corpusRepointed}`);
if (fails.length) console.log("failures:", fails.slice(0, 12).join(" | "));
if (APPLY && ok > 0) {
  writeFileSync(IMAGES_PATH, JSON.stringify(images, null, 2));
  writeFileSync(CORPUS_PATH, JSON.stringify(corpus, null, 2));
  console.log(`\n✅ APPLIED — images.json + corpus.json repointed to Blob.`);
} else if (!APPLY) {
  console.log(`\n(dry run — pass --apply to download + re-host)`);
}
