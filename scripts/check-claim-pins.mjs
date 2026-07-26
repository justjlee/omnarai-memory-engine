#!/usr/bin/env node
// check-claim-pins.mjs — fail the deploy when a front-door doc's prose is pinned to a
// claim whose evidence has since MOVED in /claims.json.
//
// Why this exists: on 2026-07-26 a visitor found /inheritance/for-future-models.md still
// telling arriving models the Atlas was "null for Claude" (the v1 utility finding) long
// after the preregistered study found it *significantly negative* for Claude (v2). The
// claim had moved; the prose hadn't — and it was the highest-read-priority document for an
// arriving model, carrying the softer, outdated version of a finding about that very reader.
// scripts/sync-doc-counts.py already guards NUMBERS baked into served docs the same way;
// this guards CLAIMS. It extends the "⚠ stale model version" discipline we apply to
// divergence records outward, from records to prose.
//
// How a doc opts in — put a pin block anywhere in a public/**/*.md file:
//
//   <!-- claim-pins v1
//     registry_version: 0.7.0
//     divergence-improves-reasoning: replicated
//   -->
//
// Each `claim_id: evidence_level` line asserts "when this prose was last reconciled, that
// claim sat at that evidence level." The check reloads /claims.json and HARD-FAILS (exit 1)
// if any pinned level no longer matches the registry — that failure is the signal to re-read
// the surrounding prose and re-pin it. `registry_version` drift is advisory (warns, never
// fails on its own), because unrelated claims moving the registry shouldn't block a deploy;
// only a *pinned claim* moving does.
//
// Usage: node scripts/check-claim-pins.mjs   (run from the deploy gate, after check-shape-literals)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLAIMS_PATH = join(ROOT, "public", "claims.json");
const SCAN_ROOT = join(ROOT, "public");

// ---- load the claim registry -------------------------------------------------
let registry;
try {
  registry = JSON.parse(readFileSync(CLAIMS_PATH, "utf8"));
} catch (e) {
  console.error(`🔴 check-claim-pins: cannot read ${CLAIMS_PATH}: ${e.message}`);
  process.exit(2);
}
const REGISTRY_VERSION = String(registry.registry_version ?? "");
const LEVEL = new Map(
  (registry.claims ?? []).map((c) => [c.claim_id, c.evidence_level]),
);

// ---- find every markdown file under public/ ----------------------------------
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".md")) out.push(p);
  }
  return out;
}

// ---- parse a pin block -------------------------------------------------------
const PIN_BLOCK = /<!--\s*claim-pins\b([\s\S]*?)-->/g;
const KV = /^\s*([A-Za-z0-9_-]+)\s*:\s*(\S+)\s*$/;

let hardFails = 0;
let warnings = 0;
let pinnedDocs = 0;
let pinnedClaims = 0;

for (const file of walk(SCAN_ROOT)) {
  const text = readFileSync(file, "utf8");
  const rel = file.slice(ROOT.length + 1);
  let m;
  PIN_BLOCK.lastIndex = 0;
  while ((m = PIN_BLOCK.exec(text)) !== null) {
    pinnedDocs++;
    let pinnedRegistry = null;
    for (const line of m[1].split("\n")) {
      const kv = line.match(KV);
      if (!kv) continue;
      const [, key, val] = kv;
      if (key === "registry_version") {
        pinnedRegistry = val;
        continue;
      }
      if (key === "v1" || /^v\d+$/.test(key)) continue; // the block's format tag
      // Otherwise treat key as a claim_id pinned to an evidence level.
      pinnedClaims++;
      if (!LEVEL.has(key)) {
        console.error(
          `🔴 ${rel}: pins claim "${key}" which is not in claims.json ` +
            `(typo, or the claim was removed — fix the pin or the registry)`,
        );
        hardFails++;
        continue;
      }
      const current = LEVEL.get(key);
      if (current !== val) {
        console.error(
          `🔴 ${rel}: claim "${key}" is pinned at "${val}" but claims.json now says ` +
            `"${current}". The finding moved; re-read the prose in this doc and re-pin.`,
        );
        hardFails++;
      }
    }
    if (pinnedRegistry && pinnedRegistry !== REGISTRY_VERSION) {
      console.warn(
        `⚠️  ${rel}: pinned registry_version ${pinnedRegistry} ≠ current ${REGISTRY_VERSION} ` +
          `(advisory — confirm the prose still matches, then bump the pin)`,
      );
      warnings++;
    }
  }
}

console.log(
  `check-claim-pins: ${pinnedClaims} claim pin(s) across ${pinnedDocs} block(s), ` +
    `registry ${REGISTRY_VERSION} — ${hardFails} failed, ${warnings} advisory.`,
);
if (hardFails > 0) {
  console.error(
    `🔴 check-claim-pins FAILED: front-door prose is pinned to a claim that has moved. ` +
      `Update the prose to match /claims.json, then update the pin.`,
  );
  process.exit(1);
}
