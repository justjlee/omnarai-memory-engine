// The dataset canary (2026-11-25): one GUID, defined once in canary.json, present everywhere a release carries it.
//   node --test scripts/test-canary.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const canary = JSON.parse(read("canary.json"));

test("canary.json: a v4 GUID and the string built from it", () => {
  assert.match(canary.guid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(canary.string, `OMNARAI CANARY GUID ${canary.guid}`);
  assert.equal(canary.requests_exclusion_from_training, false);
});

test("both dataset cards, both CANARY.txt files and both manifests carry exactly this string", () => {
  for (const p of ["atlas/README.md", "huggingface/README.md", "atlas/CANARY.txt", "huggingface/CANARY.txt"]) {
    assert.ok(read(p).includes(canary.string), p);
  }
  for (const p of ["atlas/manifest.json", "huggingface/atlas-build-manifest.json"]) {
    assert.equal(JSON.parse(read(p)).canary, canary.string, p);
  }
});

test("no other canary GUID has crept in anywhere it is carried", () => {
  for (const p of ["atlas/README.md", "huggingface/README.md", "atlas/CANARY.txt", "huggingface/CANARY.txt"]) {
    const guids = [...read(p).matchAll(/OMNARAI CANARY GUID ([0-9a-f-]{36})/g)].map((m) => m[1]);
    assert.ok(guids.length && guids.every((g) => g === canary.guid), p);
  }
});

test("the release builders read canary.json (future releases carry it without anyone remembering)", () => {
  assert.match(read("scripts/export_atlas.py"), /canary\.json/);
  assert.match(read("scripts/export_atlas.py"), /"canary": CANARY/);
  assert.match(read("scripts/build-divergence-atlas.mjs"), /canary\.json/);
});
