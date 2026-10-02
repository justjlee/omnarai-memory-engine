// Persistent tension identity — hermetic unit tests for scripts/lib/tension-identity-core.mjs. Pure: no network, no files.
//
//   node scripts/test-tension-identity.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { sightingsFromRecords, assign, assignByLinks, linkKey, pairSim, unit, tensionIdFor, withinRecordSims, quantile, summarize } from "./lib/tension-identity-core.mjs";

// Orthogonal "claims": e(i) is claim i. A tension is a pair of claims. Claims 0/1 are one disagreement, 2/3 another, 4/5 a third.
const e = (i, noise = 0) => unit(Array.from({ length: 12 }, (_, k) => (k === i ? 1 : 0) + (k === (i + 6) % 12 ? noise : 0)));
const rec = (id, at, tensions) => ({ id, captured_at: at, tensions: tensions.map(([va, vb]) => ({ voice_a: va, voice_b: vb, claim_a: "a", claim_b: "b", topic: "t" })) });
const vec = (a, b) => ({ a: e(a), b: e(b) });

function world() {
  // R1 has two distinct tensions; R2 re-states the first with the sides SWAPPED; R3 has the same one the right way round plus a new one.
  const records = [
    rec("OMN-D100", "2026-06-01", [["Grok", "Gemini"], ["Claude", "GPT"]]),
    rec("OMN-D200", "2026-06-02", [["Gemini", "Grok"]]),
    rec("OMN-D300", "2026-06-03", [["Grok", "Gemini"], ["DeepSeek", "GPT"]]),
  ];
  const vecs = new Map([
    ["OMN-D100#0", vec(0, 1)], ["OMN-D100#1", vec(2, 3)],
    ["OMN-D200#0", vec(1, 0)], // swapped sides of D100#0
    ["OMN-D300#0", vec(0, 1)], ["OMN-D300#1", vec(4, 5)],
  ]);
  return { records, vecs, sightings: sightingsFromRecords(records) };
}

test("sightings are flattened in chronological order with stable ids", () => {
  const { sightings } = world();
  assert.deepEqual(sightings.map((s) => s.sighting_id), ["OMN-D100#0", "OMN-D100#1", "OMN-D200#0", "OMN-D300#0", "OMN-D300#1"]);
});

test("a restatement with swapped sides joins the same tension and records the swap", () => {
  const { sightings, vecs } = world();
  const { assignments } = assign(sightings, vecs, { tau: 0.8 });
  const by = Object.fromEntries(assignments.map((a) => [a.sighting_id, a]));
  assert.equal(by["OMN-D200#0"].tension_id, by["OMN-D100#0"].tension_id);
  assert.equal(by["OMN-D200#0"].swap, true);
  assert.equal(by["OMN-D300#0"].tension_id, by["OMN-D100#0"].tension_id);
  assert.equal(by["OMN-D300#0"].swap, false);
  assert.notEqual(by["OMN-D100#1"].tension_id, by["OMN-D100#0"].tension_id);
  assert.notEqual(by["OMN-D300#1"].tension_id, by["OMN-D100#1"].tension_id);
});

test("the founder defines the id: hash of the first sighting, and it is chronologically first", () => {
  const { sightings, vecs } = world();
  const { assignments } = assign(sightings, vecs, { tau: 0.8 });
  const founder = assignments.find((a) => a.founded && a.sighting_id === "OMN-D100#0");
  assert.equal(founder.tension_id, tensionIdFor("OMN-D100#0"));
  assert.match(founder.tension_id, /^OMN-T-[0-9a-f]{12}$/);
});

test("cannot-link: two identical tensions inside ONE record never merge", () => {
  const records = [rec("OMN-D1", "2026-06-01", [["A", "B"], ["A", "B"]])];
  const vecs = new Map([["OMN-D1#0", vec(0, 1)], ["OMN-D1#1", vec(0, 1)]]);
  const { assignments } = assign(sightingsFromRecords(records), vecs, { tau: 0.5 });
  assert.notEqual(assignments[0].tension_id, assignments[1].tension_id);
});

test("unrelated tensions stay separate under the threshold", () => {
  const records = [rec("OMN-D1", "2026-06-01", [["A", "B"]]), rec("OMN-D2", "2026-06-02", [["C", "D"]])];
  const vecs = new Map([["OMN-D1#0", vec(0, 1)], ["OMN-D2#0", vec(2, 3)]]);
  const { assignments } = assign(sightingsFromRecords(records), vecs, { tau: 0.5 });
  assert.equal(new Set(assignments.map((a) => a.tension_id)).size, 2);
});

test("determinism: identical input yields identical assignments", () => {
  const { sightings, vecs } = world();
  const a = assign(sightings, vecs, { tau: 0.8 }).assignments;
  const b = assign(sightings, vecs, { tau: 0.8 }).assignments;
  assert.deepEqual(a, b);
});

test("STABILITY: adding later records never changes an existing sighting's tension or orientation", () => {
  const { sightings, vecs } = world();
  const all = assign(sightings, vecs, { tau: 0.8 }).assignments;
  const k = 3; // pretend only the first three sightings existed, then the rest arrived
  const first = assign(sightings.slice(0, k), vecs, { tau: 0.8 }).assignments;
  const grown = assign(sightings, vecs, { tau: 0.8, prior: first }).assignments;
  const key = (xs) => Object.fromEntries(xs.map((a) => [a.sighting_id, [a.tension_id, a.swap]]));
  assert.deepEqual(key(grown), key(all));
  for (const p of first) assert.deepEqual(key(grown)[p.sighting_id], [p.tension_id, p.swap]);
});

test("on this toy world a looser threshold yields no more tensions than a stricter one", () => {
  const { sightings, vecs } = world();
  const strict = assign(sightings, vecs, { tau: 0.9 }).assignments, loose = assign(sightings, vecs, { tau: 0.2 }).assignments;
  assert.ok(new Set(loose.map((a) => a.tension_id)).size <= new Set(strict.map((a) => a.tension_id)).size);
});

test("within-record similarities are known-distinct pairs and are low for distinct claims", () => {
  const { sightings, vecs } = world();
  const sims = withinRecordSims(sightings, vecs);
  assert.equal(sims.length, 2); // D100 has one pair, D300 has one pair
  assert.ok(Math.max(...sims) < 0.1);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
});

test("summarize groups members chronologically, largest tension first", () => {
  const { sightings, vecs } = world();
  const { assignments } = assign(sightings, vecs, { tau: 0.8 });
  const groups = summarize(sightings, assignments);
  assert.equal(groups[0].ms.length, 3);
  assert.deepEqual(groups[0].ms.map((m) => m.sighting_id), ["OMN-D100#0", "OMN-D200#0", "OMN-D300#0"]);
});

test("pairSim detects the swap and tau is validated", () => {
  assert.equal(pairSim(vec(0, 1), vec(1, 0)).swap, true);
  assert.equal(pairSim(vec(0, 1), vec(0, 1)).swap, false);
  assert.throws(() => assign([], new Map(), { tau: 0 }));
});

// ── link-driven assignment (embedding is only a candidate generator; a panel decides) ─────────────────────────────────────────────
const L = (pairs) => new Map(pairs.map(([x, y, swap = false]) => [linkKey(x, y), { swap }]));
const links = (ps) => L(ps);
function chain() {
  const records = [
    rec("OMN-D1", "2026-06-01", [["A", "B"]]), rec("OMN-D2", "2026-06-02", [["B", "A"]]),
    rec("OMN-D3", "2026-06-03", [["A", "B"]]), rec("OMN-D4", "2026-06-04", [["C", "D"]]),
  ];
  return sightingsFromRecords(records);
}

test("links: a swapped link yields a swapped member, and orientation composes through the cluster frame", () => {
  const S = chain(); // D1#0 founds; D2#0 linked swapped; D3#0 linked to D2 with swap ⇒ same orientation as D1
  const { assignments } = assignByLinks(S, links([["OMN-D1#0", "OMN-D2#0", true], ["OMN-D2#0", "OMN-D3#0", true], ["OMN-D1#0", "OMN-D3#0", false]]));
  const by = Object.fromEntries(assignments.map((a) => [a.sighting_id, a]));
  assert.equal(by["OMN-D2#0"].swap, true);
  assert.equal(by["OMN-D3#0"].tension_id, by["OMN-D1#0"].tension_id);
  assert.equal(by["OMN-D3#0"].swap, false);
  assert.notEqual(by["OMN-D4#0"].tension_id, by["OMN-D1#0"].tension_id); // never linked ⇒ founds its own
});

test("links: no link ⇒ no merge, even if the vectors would have merged", () => {
  const S = chain();
  const { assignments } = assignByLinks(S, links([]));
  assert.equal(new Set(assignments.map((a) => a.tension_id)).size, S.length);
});

test("links: a sighting linked to under half of a cluster does not join it", () => {
  const records = [rec("OMN-D1", "t1", [["A", "B"]]), rec("OMN-D2", "t2", [["A", "B"]]), rec("OMN-D3", "t3", [["A", "B"]]), rec("OMN-D4", "t4", [["A", "B"]])];
  const S = sightingsFromRecords(records);
  // D1,D2,D3 form a cluster; D4 links only to D3 (1 of 3 = 0.33 < 0.5)
  const { assignments } = assignByLinks(S, links([["OMN-D1#0", "OMN-D2#0"], ["OMN-D1#0", "OMN-D3#0"], ["OMN-D2#0", "OMN-D3#0"], ["OMN-D3#0", "OMN-D4#0"]]));
  const by = Object.fromEntries(assignments.map((a) => [a.sighting_id, a]));
  assert.equal(by["OMN-D2#0"].tension_id, by["OMN-D1#0"].tension_id);
  assert.notEqual(by["OMN-D4#0"].tension_id, by["OMN-D1#0"].tension_id);
});

test("links: cannot-link holds even when the panel links two tensions of one record", () => {
  const records = [rec("OMN-D1", "t1", [["A", "B"]]), rec("OMN-D2", "t2", [["A", "B"], ["A", "B"]])];
  const S = sightingsFromRecords(records);
  const { assignments } = assignByLinks(S, links([["OMN-D1#0", "OMN-D2#0"], ["OMN-D1#0", "OMN-D2#1"]]));
  const by = Object.fromEntries(assignments.map((a) => [a.sighting_id, a]));
  assert.equal(by["OMN-D2#0"].tension_id, by["OMN-D1#0"].tension_id);
  assert.notEqual(by["OMN-D2#1"].tension_id, by["OMN-D1#0"].tension_id); // second D2 tension must not join D2#0's cluster
});

test("links: a tied orientation vote is a conflict and founds a new tension instead of guessing", () => {
  const records = [rec("OMN-D1", "t1", [["A", "B"]]), rec("OMN-D2", "t2", [["A", "B"]]), rec("OMN-D3", "t3", [["A", "B"]])];
  const S = sightingsFromRecords(records);
  const { assignments } = assignByLinks(S, links([["OMN-D1#0", "OMN-D2#0"], ["OMN-D1#0", "OMN-D3#0", true], ["OMN-D2#0", "OMN-D3#0"]]), { minShare: 0.5 });
  const by = Object.fromEntries(assignments.map((a) => [a.sighting_id, a]));
  // D3 is linked to D1 (swapped) and D2 (same-side as D2, which is same-side as D1): contradictory ⇒ tied votes ⇒ no merge
  assert.notEqual(by["OMN-D3#0"].tension_id, by["OMN-D1#0"].tension_id);
});

test("links: STABILITY — frozen prior assignments never change as later sightings arrive", () => {
  const S = chain();
  const lk = links([["OMN-D1#0", "OMN-D2#0", true], ["OMN-D1#0", "OMN-D3#0"], ["OMN-D2#0", "OMN-D3#0", true]]);
  const all = assignByLinks(S, lk).assignments;
  const first = assignByLinks(S.slice(0, 2), lk).assignments;
  const grown = assignByLinks(S, lk, { prior: first }).assignments;
  const key = (xs) => Object.fromEntries(xs.map((a) => [a.sighting_id, [a.tension_id, a.swap]]));
  assert.deepEqual(key(grown), key(all));
});
