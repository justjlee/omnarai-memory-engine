// Embedding helper for the tension-identity tools: text → unit vector, cached by sha256 of the text. Network only for cache misses.
import fs from "node:fs";
import { createHash } from "node:crypto";

export const MODEL = "text-embedding-3-small", DIMS = 512;
const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export function loadEnv(file, names) {
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && names.includes(m[1])) { let v = m[2].trim(); if (/^["'].*["']$/.test(v)) v = v.slice(1, -1); process.env[m[1]] = v; }
  }
}

/** Returns Map text → number[] (not yet unit-normalised). Embeds only what the cache lacks. */
export async function embedCached(texts, { cachePath, envFile }) {
  let cache = { model: MODEL, dims: DIMS, vectors: {} };
  try { const c = JSON.parse(fs.readFileSync(cachePath, "utf8")); if (c.model === MODEL && c.dims === DIMS) cache = c; } catch { /* no cache */ }
  const need = [...new Set(texts)].filter((t) => !cache.vectors[sha256(t)]);
  if (need.length) {
    loadEnv(envFile, ["OPENAI_API_KEY"]);
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not found (pass --env <path to .env.local>)");
    for (let i = 0; i < need.length; i += 128) {
      const batch = need.slice(i, i + 128);
      let res;
      for (let attempt = 0; attempt < 4; attempt++) {
        res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: JSON.stringify({ model: MODEL, dimensions: DIMS, input: batch }),
        });
        if (res.ok) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
      if (!res.ok) throw new Error(`embeddings HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      (await res.json()).data.forEach((d, k) => { cache.vectors[sha256(batch[k])] = d.embedding; });
      console.log(`embedded ${Math.min(i + 128, need.length)}/${need.length}`);
    }
    fs.writeFileSync(cachePath, JSON.stringify(cache));
  }
  return new Map(texts.map((t) => [t, cache.vectors[sha256(t)]]));
}
