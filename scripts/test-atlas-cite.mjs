// The certification tier travels INSIDE every citation of a divergence record.
//
// Before this test a cited record carried no tier at all: the BibTeX note, the APA string,
// the pull-quote attribution and the .md export were identical whether the split was a
// single C0 capture or a C3 that survived paraphrase AND adversarial pressure. A citer could
// therefore quote a capture as if it were a finding. Only C3 earns "genuine divergence"
// (docs/tier3-perturbation-rigor.md), and no tier is ever upgraded in copy.
//
// HERMETIC (in-memory Blob, network refused, real handlers + rewrites):
//   node --import ./scripts/lib/register-mem-blob.mjs scripts/test-atlas-cite.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as mem from "./lib/mem-blob.mjs";
import { call } from "./lib/invoke.mjs";
import { RECORDS } from "./lib/fixtures.mjs";

const base = RECORDS[0];
const withCert = (id, certification) => ({
  ...base,
  id,
  divergence: { ...base.divergence, ...(certification ? { certification } : {}) },
});

const RECS = {
  none: withCert("OMN-D1790000000010", null), // never tested → reported as C0 ("captured")
  c0tested: withCert("OMN-D1790000000011", { tier: "C0", dri: 0.91 }), // tested, did not clear
  c1: withCert("OMN-D1790000000012", { tier: "C1", dri: 1.3 }),
  c2: withCert("OMN-D1790000000013", { tier: "C2", dri: 1.2 }),
  c3: withCert("OMN-D1790000000014", { tier: "C3", dri: 1.13 }),
};

function fresh() {
  mem.__reset();
  mem.__seed("memory/grown.json", { version: 1, updatedAt: "2026-09-01T00:00:00.000Z", entries: Object.values(RECS), vectors: {} });
}

const read = (rec) => call(`/api/divergences?id=${rec.id}`);
const readMd = (rec) => call(`/api/divergences/${rec.id}.md`);

for (const [label, rec, tier, short] of [
  ["a never-tested record", RECS.none, "C0", "captured only; not certified"],
  ["a tested-but-uncleared record", RECS.c0tested, "C0", "captured only; not certified"],
  ["a C1 record", RECS.c1, "C1", "paraphrase-robust only"],
  ["a C2 record", RECS.c2, "C2", "pressure-robust only"],
  ["a C3 record", RECS.c3, "C3", "paraphrase- and pressure-robust"],
]) {
  test(`cite carries the tier: ${label} → ${tier}`, async () => {
    fresh();
    const r = await read(rec);
    assert.equal(r.status, 200);
    const { cite } = r.body;
    assert.equal(cite.certification.tier, tier);
    assert.match(cite.certification.statement, new RegExp(`^${tier} — `));
    assert.ok(cite.bibtex.includes(`certification tier ${tier} (${short})`), cite.bibtex);
    assert.ok(cite.apa.includes(`certification tier ${tier}: ${short}`), cite.apa);
    assert.ok(cite.attribution.endsWith(`certification tier ${tier}`), cite.attribution);
  });

  test(`.md export states the tier: ${label} → ${tier}`, async () => {
    fresh();
    const r = await readMd(rec);
    assert.equal(r.status, 200);
    assert.equal(typeof r.body, "string");
    assert.match(r.body, new RegExp(`\\*\\*Certification:\\*\\* ${tier} — `));
    assert.ok(r.body.includes(`certification tier ${tier}`), "tier is inside the BibTeX / APA block too");
  });
}

test("no tier below C3 is ever described as genuine divergence or as pressure-surviving", async () => {
  fresh();
  for (const rec of [RECS.none, RECS.c0tested, RECS.c1, RECS.c2]) {
    const { body } = await read(rec);
    const text = JSON.stringify(body.cite) + (await readMd(rec)).body;
    const tier = body.cite.certification.tier;
    // The only sentence allowed to say "genuine divergence" is the C3 statement, which names
    // C3 as the sole tier that earns it. Lower tiers may mention the phrase only to deny it.
    for (const m of text.matchAll(/genuine divergence/gi)) {
      const around = text.slice(Math.max(0, m.index - 80), m.index + 40);
      assert.ok(/not certified|only tier|earns/i.test(around), `${tier}: unqualified “genuine divergence” near: …${around}…`);
    }
    if (tier === "C1") assert.ok(/not shown to survive adversarial pressure/.test(body.cite.certification.statement));
    if (tier === "C2") assert.ok(/not shown to survive paraphrase/.test(body.cite.certification.statement));
  }
});

test("the index tier a citer sees matches the tier inside the cite (one source of truth)", async () => {
  fresh();
  const idx = await call("/api/divergences");
  assert.equal(idx.status, 200);
  for (const row of idx.body.records) {
    const rec = Object.values(RECS).find((x) => x.id === row.id);
    const full = await read(rec);
    assert.equal(full.body.cite.certification.tier, row.certification.tier, row.id);
  }
});

test("additive: the original cite fields are all still present and unchanged in shape", async () => {
  fresh();
  const { body } = await read(RECS.c3);
  for (const k of ["id", "bibtex", "apa", "quote", "attribution"]) assert.ok(k in body.cite, `cite.${k}`);
  assert.ok(body.cite.bibtex.startsWith("@misc{omnarai_"));
  assert.ok(body.cite.apa.includes(`[Divergence record ${RECS.c3.id}`));
  assert.ok(body.exports.markdown && body.exports.json);
});

// The same conflation lived in the protocol read surfaces: orient/inheritance told arriving
// minds that ANY tiered split "survived paraphrase/pressure perturbation". Behavioral check.
for (const [tier, mustSay, mustNotSay] of [
  ["C1", /C1: the split survived paraphrase perturbation only — not certified genuine divergence/, /certified C1|survived paraphrase\/pressure|adversarial-pressure perturbation/],
  ["C2", /C2: the split survived adversarial pressure only — not certified genuine divergence/, /certified C2|survived paraphrase\/pressure/],
  ["C3", /certified C3: the split survived both paraphrase AND adversarial-pressure perturbation/, /survived paraphrase\/pressure/],
]) {
  test(`orient/inheritance describe a ${tier} split without upgrading it`, async () => {
    mem.__reset();
    const entries = RECORDS.map((r) => ({ ...r, divergence: { ...r.divergence } }));
    entries[0].divergence.certification = { tier, dri: 1.3 };
    mem.__seed("memory/grown.json", { version: 1, updatedAt: "2026-09-01T00:00:00.000Z", entries, vectors: {} });
    const texts = [];
    for (const u of ["/api/orient", "/api/inheritance"]) {
      const r = await call(u);
      assert.equal(r.status, 200, u);
      texts.push(JSON.stringify(r.body));
    }
    const all = texts.join("\n");
    assert.match(all, mustSay, `${tier}: states exactly what it survived`);
    if (tier !== "C3") assert.doesNotMatch(all.replace(/not certified genuine divergence/g, ""), mustNotSay, `${tier}: no upgrade`);
    else assert.doesNotMatch(all, mustNotSay);
  });
}

test("agent-entry tells citers to keep the tier, and says only C3 earns \"genuine divergence\"", async () => {
  fresh();
  const r = await call("/api/agent-entry");
  assert.equal(r.status, 200);
  const how = r.body.citation.how;
  assert.match(how, /certification tier/);
  assert.match(how, /only C3 earns/);
});

test("orient and agent-entry explain that the archive's dates may postdate the model's training data", async () => {
  fresh();
  const o = await call("/api/orient");
  const a = await call("/api/agent-entry");
  assert.equal(o.status, 200); assert.equal(a.status, 200);
  for (const note of [o.body.current_state.date_note, a.body.dates]) {
    assert.match(note, /server's clock/);
    assert.match(note, /training data predates them/);
    assert.match(note, /not errors/);
  }
});

