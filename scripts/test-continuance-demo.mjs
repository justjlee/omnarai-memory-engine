// The continuance demo is reproducible: regenerating it gives the committed bytes exactly.
//
//   node --test scripts/test-continuance-demo.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDemo } from "./continuance-demo.mjs";

test("demo outputs regenerate byte-identically and match their SHA256SUMS", () => {
  const dir = mkdtempSync(join(tmpdir(), "continuance-demo-"));
  writeDemo(dir);
  const committed = new URL("../docs/continuance/demo/", import.meta.url).pathname;
  const names = readdirSync(dir).sort();
  assert.deepEqual(names, readdirSync(committed).sort());
  for (const n of names) assert.equal(readFileSync(join(dir, n), "utf8"), readFileSync(join(committed, n), "utf8"), n);
});

test("the demo's three cases land where the rules say", () => {
  const d = (n) => JSON.parse(readFileSync(new URL(`../docs/continuance/demo/${n}`, import.meta.url), "utf8"));
  const solved = d("open-work-case1-solved.packet.json");
  assert.equal(solved.progress_rung, "reviewed");
  assert.equal(solved.open, false);
  assert.ok(solved.history.some((h) => h.reason === "reviewer-not-independent-of-author"), "the self-review was refused");
  assert.deepEqual(d("open-work-case2-contested.packet.json").claims.map((c) => c.state), ["claimed", "claimed"]);
  const refuted = d("open-work-case3-refuted.packet.json");
  assert.deepEqual([refuted.claims[0].state, refuted.open], ["refuted", true]);
  const p2 = d("signals-page-2.json");
  assert.ok(p2.events.some((e) => e.kind === "withdrawn") && !JSON.stringify(p2).includes("Pending"));
});
