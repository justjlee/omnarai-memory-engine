#!/usr/bin/env node
// check-shape-literals.mjs — fail the deploy if a corpus-shape count is frozen into
// served code instead of derived from the live corpus.
//
// Why this exists: the 2026-07-17 audit traced a family of drift bugs to counts
// baked as literals in places that purport to be current. The engine's own counts
// are computed (mergedCorpus.length), but nothing stopped a literal creeping back
// into a component or a system prompt. This is that stop. First run caught a stale
// "568 works" citation in AskOmnarai.jsx.
//
// Rule: no distinctive corpus-shape literal in api/ or src/. Fixes are (a) read it
// from /api/info at runtime, (b) genericize the copy ("a corpus", not "568 works"),
// or (c) append `shape-literal-ok` on the line for a genuine static fallback.
//
// Scope note: public/ docs (index.html, llms.txt, omnarai.context.md, …) are NOT
// scanned — their counts are maintained automatically by scripts/sync-doc-counts.py
// against live /api/info, which is the right owner for served-doc numbers. Generic
// ring sub-counts (116/181/17) are not matched (too collision-prone); the API's own
// derivation plus scripts/omnarai-verify.sh count-congruence probes guard those.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const SCAN = ["api", "src"];
const SKIP_DIRS = new Set(["node_modules", ".git", "data", "__tests__"]);
const SCAN_EXT = new Set([".js", ".mjs", ".cjs", ".jsx"]);

const FORBIDDEN = [
  { re: /\b528077\b/, what: "total-word count" },
  { re: /\b528208\b/, what: "total-word count (stale, pre-OMN-085)" },
  { re: /\b567\b/, what: "total-work count" },
  { re: /\b568\b/, what: "total-work count (stale, pre-OMN-085)" },
  { re: /eight synthetic/i, what: "contributor-count phrasing" },
];

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);
const isAllowed = (line) => /shape-literal-ok/.test(line);
const isTest = (path) => /\.test\.|\.spec\./.test(path);

function* walk(path) {
  const st = statSync(path);
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(basename(path))) return;
    for (const e of readdirSync(path)) yield* walk(join(path, e));
  } else if ([...SCAN_EXT].some((x) => path.endsWith(x)) && !isTest(path)) {
    yield path;
  }
}

const hits = [];
for (const entry of SCAN) {
  let target;
  try { target = join(ROOT, entry); statSync(target); } catch { continue; }
  for (const file of walk(target)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (isComment(line) || isAllowed(line)) return;
      for (const { re, what } of FORBIDDEN) {
        if (re.test(line)) {
          hits.push({ file: file.replace(ROOT + "/", ""), line: i + 1, what, text: line.trim().slice(0, 100) });
        }
      }
    });
  }
}

if (hits.length) {
  console.error(`\n🔴 shape-literal check FAILED — ${hits.length} frozen corpus-shape literal(s):\n`);
  for (const h of hits) console.error(`  ${h.file}:${h.line}  [${h.what}]\n    ${h.text}`);
  console.error(`\nFix: read /api/info at runtime, genericize the copy, or append \`shape-literal-ok\` for a real static fallback.\n`);
  process.exit(1);
}
console.log("🟢 shape-literal check passed — no frozen corpus-shape literals in api/ or src/.");
