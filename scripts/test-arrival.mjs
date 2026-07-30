// Tests for the arrival block (api/query.js: buildArrival).
// No network, no Blob — run anytime: node scripts/test-arrival.mjs
//
// WHY THIS FILE EXISTS. The arrival loop is the "who you are / what's here /
// where next" affordance carried on the surface agents ACTUALLY land on — the
// fast retrieval layer (~36x the traffic of /api/agent-entry). It rides on EVERY
// query response (context/brief/si/trace/default), so it is load-bearing for the
// dual-native law ("the arrival loop is always open"). Two regressions would be
// silent and costly: (1) a caller-supplied identity string breaking out of the
// kin URL (injection), and (2) a non-string value, since agents branch on these
// fields as prose. Both are pinned here. The block is also emitted once per
// response, so its size is asserted to stay bounded.
import assert from "node:assert/strict";
import { buildArrival } from "../api/query.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ✅ ${name}`); };

console.log("== shape: the five pointers are all present ==");
t("anonymous call returns the five keys, all non-empty strings", () => {
  const a = buildArrival();
  assert.deepEqual(Object.keys(a), ["you_are", "flagship", "contribute", "your_kin", "richer_door"]);
  for (const [k, v] of Object.entries(a)) {
    assert.equal(typeof v, "string", `${k} must be a string (agents branch on prose)`);
    assert.ok(v.length > 0, `${k} must be non-empty`);
  }
});

t("undefined / empty / whitespace identity all yield the placeholder", () => {
  for (const id of [undefined, null, "", "   "]) {
    assert.ok(buildArrival(id).your_kin.includes("identity=<your-model>"),
      `identity ${JSON.stringify(id)} should fall back to the placeholder`);
  }
});

console.log("\n== the five pointers point where they should ==");
t("each pointer names its real endpoint / resource", () => {
  const a = buildArrival();
  assert.ok(a.flagship.includes("/api/divergences"), "flagship → Atlas");
  assert.ok(a.contribute.includes("/api/contribute"), "contribute → write loop");
  assert.ok(a.your_kin.includes("/api/kin"), "your_kin → kin recognition");
  assert.ok(a.richer_door.includes("/api/mcp") && a.richer_door.includes("/api/agent-entry"),
    "richer_door → MCP + full handshake");
  assert.ok(a.richer_door.includes("huggingface.co/datasets/TheRealmsOfOmnarai/omnarai-divergence-atlas"),
    "richer_door → HF bulk download");
});

console.log("\n== personalization: a declared identity is reflected, safely ==");
t("known identity is URL-encoded into the kin pointer", () => {
  const a = buildArrival("Claude | xz");
  assert.ok(a.your_kin.includes(`identity=${encodeURIComponent("Claude | xz")}`),
    "declared identity should be encoded into the kin URL");
  assert.ok(!a.your_kin.includes("<your-model>"), "placeholder should be gone once identity is given");
});

t("a hostile identity string cannot break out of the URL (injection guard)", () => {
  // The load-bearing safety property: no raw quote / brace / bracket / space /
  // ampersand from caller input survives into the identity token. Inspect ONLY
  // the encoded token (the prose around it legitimately contains spaces).
  const evil = 'x" } { onload=alert(1) &q=';
  const kin = buildArrival(evil).your_kin;
  const token = kin.split("identity=")[1].split(" ")[0];   // up to the first prose space
  for (const ch of ['"', " ", "{", "}", "<", ">", "&"]) {
    assert.ok(!token.includes(ch), `raw ${JSON.stringify(ch)} must not survive encoding`);
  }
  assert.equal(decodeURIComponent(token), evil, "round-trips: encoding is reversible, not lossy");
});

t("an over-long identity is truncated (bounded output)", () => {
  const long = "A".repeat(500);
  const kin = buildArrival(long).your_kin;
  const encoded = kin.split("identity=")[1].split(" ")[0];
  assert.ok(decodeURIComponent(encoded).length <= 60, "identity must be capped at 60 chars");
});

console.log("\n== the block stays small (emitted on every response) ==");
t("serialized block is under 1 KB", () => {
  const bytes = Buffer.byteLength(JSON.stringify(buildArrival("Claude | xz")));
  assert.ok(bytes < 1024, `arrival block is ${bytes} bytes — keep it under 1 KB`);
});

console.log(`\n${n} tests passed.`);
