#!/usr/bin/env node
// check-tier-language.mjs — fail the deploy when served copy upgrades a certification tier.
//
// Why: on 2026-10-01 the Divergences tab told every visitor "only 6 of 162 recorded splits survive paraphrase and adversarial
// pressure to certify" (6 counted C1–C3; only the 2 C3 records survived pressure), and the browse chip read "C1 · certified".
// docs/tier3-perturbation-rigor.md says only C3 earns "certified / genuine divergence"; public/release-manifest.md warns that any
// surface rounding C1 up is overclaiming. Prose drifted and nothing caught it. This guards the language, as check-claim-pins guards
// claims and check-shape-literals guards frozen counts.
//
// Rules (narrow on purpose: a false positive blocks a deploy, so each rule names one concrete way the bug recurs):
//   R1  C1 or C2 and "certified" on one line, unless the line negates it (not / un / never certified) → the tier is being upgraded.
//   R2  "survive(d) … paraphrase and (adversarial) pressure|perturbation" on a line that never mentions C3 → "survived BOTH" is C3 only.
// Escape hatch for a legitimate exception: put `tier-language:ok` on the line.
//
//   node scripts/check-tier-language.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCAN = [["src", [".js", ".jsx"]], ["api", [".js"]], ["public", [".md", ".html", ".txt"]]];
const NEGATED = /\b(?:not|never|nor|no)[\s-]+(?:yet\s+|been\s+|be\s+|is\s+|are\s+)*certified\b|\buncertified\b/i;

const RULES = [
  { id: "R1", re: /\bC[12]\b[^\n]{0,60}\bcertified\b/i, skip: (line) => NEGATED.test(line) || /\?cert=/.test(line), // ?cert=C1|C2|C3|certified is a filter value (the cleared-a-tier bucket), not a description of C1/C2
    say: "C1/C2 described as certified — only C3 is certified (docs/tier3-perturbation-rigor.md)" },
  { id: "R2", re: /survive[sd]?\s+(?:\*?\*?both\*?\*?\s+)?(?:<em>)?(?:both)?(?:<\/em>)?\s*paraphrase\s*(?:\s(?:and|AND)\s|\/|\+|&)\s*(?:adversarial[\s-]+)?(?:pressure|perturbation)/i, skip: (line) => /\bC3\b/.test(line),
    say: "'survived paraphrase and pressure' without naming C3 — that conjunction is exactly C3" },
];

export function scanText(text, file = "<text>") {
  const hits = [];
  text.split("\n").forEach((line, i) => {
    if (/tier-language:ok/.test(line)) return;
    for (const r of RULES) if (r.re.test(line) && !r.skip(line)) hits.push({ file, line: i + 1, rule: r.id, say: r.say, text: line.trim().slice(0, 160) });
  });
  return hits;
}

function* walk(dir, exts) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".") || / 2\.[a-z]+$/.test(name)) continue; // iCloud conflict copies
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p, exts);
    else if (exts.includes(extname(name)) && basename(p) !== "openapi.json") yield p;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const all = [];
  for (const [dir, exts] of SCAN) for (const f of walk(join(ROOT, dir), exts)) all.push(...scanText(readFileSync(f, "utf8"), f.slice(ROOT.length)));
  if (all.length) {
    console.error(`🔴 check-tier-language: ${all.length} line(s) upgrade a certification tier`);
    for (const h of all) console.error(`  ${h.file}:${h.line} [${h.rule}] ${h.say}\n      ${h.text}`);
    process.exit(1);
  }
  console.log("🟢 check-tier-language: no served copy upgrades a certification tier");
}
