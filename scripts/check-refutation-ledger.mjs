#!/usr/bin/env node
// check-refutation-ledger.mjs — fail the deploy when a claim has been REFUTED in
// /claims.json but the Refutation Ledger does not carry it.
//
// Why this exists: on 2026-08-23 the Ledger — the front-door document, the one that
// leads every surface — was found still titled "Four Ideas This Project Tested and
// Could Not Keep" while /claims.json held SIX refuted claims. Two refutations had
// been published on their own pages and never reached the record that consolidates
// them: `cross-model-divergence-is-prevalent` (2026-07-26, the founding premise of
// the flagship dataset) and `register-proximity-explains-the-gradient` (2026-08-07).
//
// scripts/check-claim-pins.mjs guards against a claim MOVING under fixed prose. It
// cannot catch this: nothing moved, the Ledger simply never mentioned them. Pins
// detect drift; this detects OMISSION — a refutation that exists but is not
// consolidated where readers are told to look for it.
//
// The rule: every claim at evidence_level "refuted" must have its claim_id appear in
// public/refutation-ledger.md, and the Ledger's own stated count must match. A project
// whose entire pitch is "we publish the obituary as loudly as the birth" cannot ship a
// ledger that undercounts its own dead.
//
// Usage: node scripts/check-refutation-ledger.mjs   (deploy gate, after check-claim-pins)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CLAIMS_PATH = join(ROOT, "public", "claims.json");
const LEDGER_PATH = join(ROOT, "public", "refutation-ledger.md");
const LEDGER_HTML_PATH = join(ROOT, "public", "refutation-ledger.html");

let registry, ledger;
try {
  registry = JSON.parse(readFileSync(CLAIMS_PATH, "utf8"));
} catch (e) {
  console.error(`🔴 check-refutation-ledger: cannot read ${CLAIMS_PATH}: ${e.message}`);
  process.exit(2);
}
try {
  ledger = readFileSync(LEDGER_PATH, "utf8");
} catch (e) {
  console.error(`🔴 check-refutation-ledger: cannot read ${LEDGER_PATH}: ${e.message}`);
  process.exit(2);
}

const refuted = (registry.claims ?? []).filter((c) => c.evidence_level === "refuted");

// ---- 1. every refuted claim_id must be named in the ledger -------------------
const missing = refuted.filter((c) => !ledger.includes(c.claim_id));

// ---- 2. the ledger's stated count must match the registry --------------------
// The count is written as an English number in the H1 and reused in the prose.
const WORD = ["zero","one","two","three","four","five","six","seven","eight","nine","ten","eleven","twelve"];
const expectedWord = WORD[refuted.length] ?? String(refuted.length);
const h1 = (ledger.match(/^#\s+.*$/m) ?? [""])[0];
const countOk = new RegExp(`\\b${expectedWord}\\b`, "i").test(h1);

// ---- 3. a refuted claim must not still be described as a live hypothesis -----
// (cheap tripwire: the H1 must not disagree with the table row count either)
const tableRows = (ledger.match(/^\|\s*\d+\s*\|/gm) ?? []).length;

// ---- 4. the HTML ledger carries the same claims and the same counts ----------
// The .md is the machine-facing record; the .html is what people read, and it repeats
// the count in three places (H1, hero stat bar, summary table). On 2026-08-23 the stat
// bar still read "4 claims / 3 of 4" after the prose had been brought to six — a grep
// for the word "four" could not see it. Numerals get checked here.
let htmlProblems = [];
try {
  const html = readFileSync(LEDGER_HTML_PATH, "utf8");
  for (const c of refuted) {
    if (!html.includes(c.claim_id)) htmlProblems.push(`does not mention "${c.claim_id}"`);
  }
  const cards = (html.match(/class="card"/g) ?? []).length;
  if (cards && cards !== refuted.length) {
    htmlProblems.push(`has ${cards} refutation card(s), expected ${refuted.length}`);
  }
  const rows = (html.match(/<tr><td>/g) ?? []).length;
  if (rows && rows !== refuted.length) {
    htmlProblems.push(`summary table has ${rows} row(s), expected ${refuted.length}`);
  }
  // hero stat bar: "<span>refuted</span><span>N claims</span>" and "<span>N of M</span>"
  const stat = html.match(/<span>refuted<\/span><span>(\d+)\s*claims?<\/span>/i);
  if (stat && Number(stat[1]) !== refuted.length) {
    htmlProblems.push(`hero stat bar says "${stat[1]} claims", expected ${refuted.length}`);
  }
  const shamOf = html.match(/<span>killed by a sham arm<\/span><span>\d+\s*of\s*(\d+)<\/span>/i);
  if (shamOf && Number(shamOf[1]) !== refuted.length) {
    htmlProblems.push(`hero stat bar denominator is "of ${shamOf[1]}", expected ${refuted.length}`);
  }
  if (!new RegExp(`\\b${expectedWord}\\b`, "i").test((html.match(/<h1>[\s\S]*?<\/h1>/) ?? [""])[0])) {
    htmlProblems.push(`H1 does not say "${expectedWord}"`);
  }
} catch (e) {
  htmlProblems.push(`cannot read refutation-ledger.html: ${e.message}`);
}

let fails = 0;
for (const c of missing) {
  console.error(
    `🔴 refutation-ledger.md does not mention refuted claim "${c.claim_id}". ` +
      `It is refuted in claims.json but absent from the record that consolidates refutations — ` +
      `add a section for it, or the Ledger is undercounting.`,
  );
  fails++;
}
if (!countOk) {
  console.error(
    `🔴 refutation-ledger.md H1 says: ${h1.trim()} — but claims.json holds ${refuted.length} ` +
      `refuted claim(s) ("${expectedWord}"). Update the title and the prose counts.`,
  );
  fails++;
}
if (tableRows && tableRows !== refuted.length) {
  console.error(
    `🔴 refutation-ledger.md summary table has ${tableRows} numbered row(s) but there are ` +
      `${refuted.length} refuted claim(s). Add the missing row(s).`,
  );
  fails++;
}

for (const p of htmlProblems) {
  console.error(`\u{1F534} refutation-ledger.html ${p} — the human-facing ledger is out of sync.`);
  fails++;
}

console.log(
  `check-refutation-ledger: ${refuted.length} refuted claim(s) in registry ` +
    `${registry.registry_version} — ${refuted.length - missing.length} carried in the Ledger, ` +
    `${tableRows} table row(s), html ${htmlProblems.length} problem(s) — ${fails} failed.`,
);
if (fails > 0) {
  console.error(
    `🔴 check-refutation-ledger FAILED: the Refutation Ledger is out of sync with /claims.json. ` +
      `The Ledger leads every front door; it must not undercount.`,
  );
  process.exit(1);
}
