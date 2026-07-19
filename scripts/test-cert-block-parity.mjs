// Parity guard: the certification block written by certify-divergence.mjs and the
// one written by persist-certifications.mjs (checkpoint replay) must produce the
// same fields. They are separate copies by necessity — certify-divergence runs its
// whole battery at import time, so the replay script cannot import from it — and
// copies drift. A replayed grade that is missing fields the normal path emits
// would be a silently second-class record in the store.
//
//   node scripts/test-cert-block-parity.mjs
//
// Compares the literal key sets in each file's certBlock(). Keys the replay adds
// deliberately are allowlisted below.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Keys the replay path adds on purpose; not drift.
const REPLAY_ONLY = new Set(["persisted_via"]);

function certBlockKeys(file) {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const i = src.indexOf("function certBlock(");
  if (i === -1) throw new Error(`no certBlock() in ${file}`);
  // Walk braces from the function body's opening brace to its match.
  const start = src.indexOf("{", i);
  let depth = 0, end = -1;
  for (let j = start; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end === -1) throw new Error(`unbalanced certBlock() in ${file}`);
  const body = src.slice(start, end);
  const keys = new Set();
  // `key:` at the start of a line (object literal fields)
  for (const m of body.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gim)) keys.add(m[1]);
  // `...(cond ? { key: ... } : {})` spreads
  for (const m of body.matchAll(/\?\s*\{\s*([a-z_][a-z0-9_]*)\s*:/gi)) keys.add(m[1]);
  return keys;
}

const canonical = certBlockKeys("scripts/certify-divergence.mjs");
const replay = certBlockKeys("scripts/persist-certifications.mjs");

const missing = [...canonical].filter((k) => !replay.has(k));
const extra = [...replay].filter((k) => !canonical.has(k) && !REPLAY_ONLY.has(k));

console.log(`certify-divergence certBlock keys: ${canonical.size}`);
console.log(`persist-certifications certBlock keys: ${replay.size} (${REPLAY_ONLY.size} allowlisted replay-only)`);

let failed = false;
if (missing.length) { console.error(`✗ replay is MISSING: ${missing.join(", ")}`); failed = true; }
if (extra.length) { console.error(`✗ replay has UNDECLARED extra: ${extra.join(", ")}`); failed = true; }
if (failed) { console.error("\nFAIL — bring the two certBlock() copies back into sync."); process.exit(1); }
console.log("✓ cert block parity OK — replay emits every field the normal write path does.");
