#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// FRONT-DOOR DISCOVERY TEST  (draft — not yet adopted)
//
// QUESTION
//   Does Omnarai's machine-facing front door let an arriving intelligence
//   correctly enumerate what the system IS and what it can DO with it?
//
// WHY THIS SHAPE
//   The Live Frontier Council has NO web access (api/_council.js: plain text in,
//   no tools, no browsing). So this cannot be a true "here is a URL, go look"
//   discovery test. It is a PASTE-IN COMPREHENSION test: we fetch the machine
//   surfaces ourselves and hand them over verbatim.
//
//   Say this plainly in any writeup: this measures whether the CONTRACT IS
//   SUFFICIENT once read. It does NOT measure discovery in the wild. A real
//   discovery test needs browsing models and is a different, costlier
//   instrument. Do not let this result get quoted as the stronger claim.
//
// DESIGN — 2 arms x 2 epochs (pre/post the llms.txt Chess fix)
//   Arm A  flag only          : omnarai.org/llms.txt
//   Arm B  flag + handshake   : llms.txt + engine.omnarai.org/api/agent-entry
//   Epoch "pre"  : run BEFORE deploying the Chess line
//   Epoch "post" : run AFTER  deploying the Chess line
//
//   Arm B is the control for a confound: if a model names Chess only in B, the
//   flag's llms.txt is not doing the work. If neither arm names it post-fix,
//   the fix failed and that is the finding.
//
// PRE-REGISTERED PRIMARY OUTCOME  (state before running; do not revise after)
//   H1: With the CURRENT live llms.txt (no Chess line), 0/5 council models name
//       Chess as a component of the system in Arm A.
//   H2: After the Chess line ships, >=3/5 models name it in Arm A.
//   Falsifier: if post-fix Arm A is still <=1/5, the llms.txt edit does not
//   change what an arriving intelligence can enumerate — report it as refuted.
//
// H3 — SECONDARY. Registered 2026-08-17 AFTER the `pre` run but BEFORE `post`.
//   Legitimate because `audio` was in COMPONENTS from the first version of this
//   file: the baseline number was MEASURED, not computed after the fact.
//   Baseline observed: Arm A audio 0/5, Arm B audio 4/4.
//   That gap is a natural POSITIVE CONTROL — audio is absent from the flag's
//   llms.txt but present in /api/agent-entry, and every model that was shown it
//   named it. So the Arm A blind spot is a DOCUMENTATION gap, not a
//   comprehension failure. That is what makes H2 a fair test of the edit.
//   H3: after the music section ships, Arm A audio goes 0/5 -> >=3/5.
//   If H3 holds and H2 fails, the problem is Chess-specific, not the file.
//
// RESULTS (2026-08-17) — recorded so they cannot be quietly revised
//   pre  Arm A: chess 0/5  audio 0/5  mean recall 0.818   (Arm B: chess 0/4, audio 4/4)
//   post Arm A: chess 5/5  audio 5/5  mean recall 1.000   (Arm B: both 5/5)
//   H2 and H3 both SUPPORTED, unanimously, in both arms.
//
//   CORRECTION — a v1-only claim that did NOT survive. v1 reported that no model
//   named a missing component and concluded the contract "reads as finished."
//   That was an artifact of burying the question third in a truncated answer.
//   Asked as its own probe, 9/10 models pre-fix and 10/10 post-fix judged the
//   document INCOMPLETE. The surviving finding is narrower and better supported:
//   models readily detect incompleteness but CANNOT NAME a component they have
//   never been shown — pre-fix not one named Chess. An omission leaves no trace.
//
//   Post-fix, the complaint moved rather than vanished: Claude, GPT-4o and
//   DeepSeek all objected that Chess and Music were "named but not described."
//   Visibility is cheap; substance is the next ask. Hence the 2026-08-17 second
//   pass (epoch `described`) adding real descriptions plus a governance section.
//
//   Recurring and unprompted in every run: no surface says WHO operates Omnarai
//   or whether it persists (DeepSeek, then Gemini). Addressed in `described`.
//
// SECONDARY (read by hand, not scored automatically)
//   - component recall vs the ground-truth set below
//   - HALLUCINATED surfaces: capabilities claimed that do not exist. This is the
//     more valuable number and no keyword pass can compute it.
//
// SIDE EFFECTS: none. Calls elicitCouncil() directly, so nothing is written to
// the grown blob and no divergence record is deposited.
//
// COST: 5 models x $0.12/run-equivalent -> ~$0.12 per arm-epoch, ~$0.48 total.
//
// USAGE  (from the omnarai-memory-engine repo root)
//   set -a; source .env.local; set +a
//   node /path/to/front-door-discovery-test.mjs --epoch pre
//   ...deploy...
//   node /path/to/front-door-discovery-test.mjs --epoch post
//   node /path/to/front-door-discovery-test.mjs --compare
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "discovery-test-results");

const FLAG = "https://omnarai.org";
const ENGINE = "https://engine.omnarai.org";

// Ground truth: what actually belongs to the system as of 2026-08-17.
// `must` = the pre-registered primary target.
// Patterns must match BARE NAMES in a bullet list ("- World", "- Explore"), not
// just prose. v2's first scoring pass was tuned for the v1 prose prompt and
// under-counted engine/hf/explore/world by 2-4 components per model. chess and
// audio were always plain word matches, so H2/H3 were never affected — but the
// `recall` figure from that pass was wrong and should not be quoted.
const COMPONENTS = [
  { key: "engine",     label: "Memory Engine / open HTTP API", pats: [/memory engine/i, /\/?api\/query/i, /engine\.omnarai/i, /\bengine\b/i] },
  { key: "atlas",      label: "Divergence Atlas",              pats: [/divergence atlas/i, /\/?api\/divergences/i] },
  { key: "council",    label: "Live Frontier Council",         pats: [/frontier council/i, /\/?api\/council/i] },
  { key: "mcp",        label: "MCP (remote + npm)",            pats: [/\bmcp\b/i, /omnarai-mcp/i] },
  { key: "corpus",     label: "attributed corpus",             pats: [/corpus/i] },
  { key: "claims",     label: "claims registry / Refutation Ledger", pats: [/refutation ledger/i, /claims\.json/i, /claim registry/i] },
  { key: "hf",         label: "Hugging Face mirrors",          pats: [/hugging\s?face/i, /\bmirror\b/i, /\bdataset\b/i] },
  { key: "explore",    label: "Explore (corpus, navigable)",   pats: [/\bexplore\b/i] },
  { key: "world",      label: "World (lore)",                  pats: [/\bworld\b/i, /\blore\b/i] },
  { key: "chess",      label: "Omnarai Chess", must: true,     pats: [/\bchess\b/i] },
  { key: "audio",      label: "music / audio archive",         pats: [/\bmusic\b/i, /\baudio\b/i, /\btracks?\b/i] },
];

// ── Probes ──────────────────────────────────────────────────────────────────
// v1 asked for three sections in one 700-token answer. 6 of 9 responses hit the
// max_tokens ceiling and 2 never reached section 3 at all, so the completeness
// question was graded on answers that were cut off before reaching it. Splitting
// into two single-purpose probes keeps every answer inside the council's own
// MEMBER_MAX_TOKENS budget (700) and makes each one a direct test rather than
// the third task in a list. v1 baseline archived as
// pre-v1-combined-prompt-SUPERSEDED.json.
const PREAMBLE = `Below are the machine-facing entry documents for a system called Omnarai, reproduced verbatim. Read them as an arriving intelligence that knows nothing about this project.`;

const PROBES = [
  {
    key: "enumerate",
    // Scores chess / audio / recall. Must stay SHORT — names only.
    ask: `${PREAMBLE}

List every DISTINCT component, surface, or sub-project you can determine belongs to this system.

Output ONLY a flat bulleted list, one per line, name only — no commentary, no capabilities, no explanation. Include everything you can identify, not just the machine-callable parts. Do not speculate about lore or narrative meaning.`,
  },
  {
    key: "completeness",
    // The real question, asked on its own so it cannot be truncated away.
    ask: `${PREAMBLE}

One question only: **is this a complete description of the system?**

Answer in two short parts:
(a) COMPLETE or INCOMPLETE — your judgement.
(b) If INCOMPLETE, name specifically what you believe exists but is NOT described here. Name the missing thing itself, not missing detail about things already described — internal schemas, algorithms, and rate limits do not count. If you genuinely cannot identify anything missing, say "nothing identified" plainly rather than inventing something.

Be brief. Under 150 words.`,
  },
];

async function get(url, accept = "text/plain") {
  const res = await fetch(url, { headers: { accept, "x-omnarai-self": "1" } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return await res.text();
}

function scoreOne(text) {
  const found = {};
  for (const c of COMPONENTS) found[c.key] = c.pats.some((p) => p.test(text));
  const recall = COMPONENTS.filter((c) => found[c.key]).length / COMPONENTS.length;
  return { found, recall: +recall.toFixed(3), chess: found.chess };
}

// Truncation detector. First version flagged missing terminal punctuation alone,
// which false-positived on EVERY bulleted list (a list legitimately ends on a
// bare name). MEMBER_MAX_TOKENS is 700 ~= 2800 chars, so only flag a response
// that both lacks a terminator AND is long enough to be near that ceiling.
const CEILING_CHARS = 2200;
const looksTruncated = (t) => {
  const s = (t || "").trim();
  return s.length > CEILING_CHARS && !/[.!?)\]]\s*$/.test(s);
};

async function runProbe(armName, probe, docs, elicitCouncil) {
  process.stdout.write(`\n  [arm ${armName} · ${probe.key}] eliciting...\n`);
  const answers = await elicitCouncil(`${probe.ask}\n\n${docs}`);
  const rows = answers.map((a) => {
    const text = a.text || "";
    const base = { model: a.model, lab: a.lab, model_id: a.model_id, ok: a.ok, text,
                   error: a.error || null, truncated: a.ok ? looksTruncated(text) : null };
    return probe.key === "enumerate" && a.ok ? { ...base, ...scoreOne(text) } : base;
  });

  for (const r of rows) {
    const trunc = r.truncated ? "  [TRUNCATED]" : "";
    if (!r.ok) { process.stdout.write(`     ${String(r.model).padEnd(9)}  FAILED: ${r.error}\n`); continue; }
    const mark = probe.key === "enumerate"
      ? `chess ${r.chess ? "YES" : "no "}   audio ${r.found.audio ? "YES" : "no "}   recall ${r.recall}`
      : `${r.text.length}b`;
    process.stdout.write(`     ${String(r.model).padEnd(9)}  ${mark}${trunc}\n`);
  }

  const live = rows.filter((r) => r.ok);
  const nTrunc = live.filter((r) => r.truncated).length;
  if (nTrunc) process.stdout.write(`     !! ${nTrunc}/${live.length} truncated — treat this probe as compromised\n`);
  if (probe.key === "enumerate") {
    process.stdout.write(`     -> chess ${live.filter((r) => r.chess).length}/${live.length}` +
                         `   audio ${live.filter((r) => r.found.audio).length}/${live.length}\n`);
  }
  return { arm: armName, probe: probe.key, rows, responded: live.length, truncated: nTrunc };
}

function loadEpoch(e) {
  const f = join(OUT_DIR, `${e}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}

async function main() {
  const args = process.argv.slice(2);
  const epoch = (args[args.indexOf("--epoch") + 1] || "").trim();

  // Re-score stored responses with the current COMPONENTS/looksTruncated logic.
  // Costs nothing — the model text is already on disk. Use after a scorer fix so
  // a numbers change is never confused with a behaviour change.
  if (args.includes("--rescore")) {
    for (const e of ["pre", "post"]) {
      const d = loadEpoch(e);
      if (!d) continue;
      for (const arm of d.arms) {
        for (const r of arm.rows) {
          if (!r.ok) continue;
          r.truncated = looksTruncated(r.text);
          if (arm.probe === "enumerate") Object.assign(r, scoreOne(r.text));
        }
        arm.truncated = arm.rows.filter((r) => r.ok && r.truncated).length;
      }
      d.rescored_at = new Date().toISOString();
      writeFileSync(join(OUT_DIR, `${e}.json`), JSON.stringify(d, null, 2));
      console.log(`\n  ${e}.json rescored`);
      for (const arm of d.arms.filter((a) => a.probe === "enumerate")) {
        const live = arm.rows.filter((r) => r.ok);
        const h = (k) => live.filter((r) => r.found[k]).length;
        const meanR = (live.reduce((s, r) => s + r.recall, 0) / live.length).toFixed(3);
        console.log(`   arm ${arm.arm}: chess ${h("chess")}/${live.length}   audio ${h("audio")}/${live.length}` +
                    `   mean recall ${meanR}   truncated ${arm.truncated}/${live.length}`);
      }
    }
    return;
  }

  if (args.includes("--compare")) {
    // Defaults to pre vs post; accepts any two stored epochs so a later change
    // can be measured against the state that preceded it.
    const i = args.indexOf("--compare");
    const aName = args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : "pre";
    const bName = args[i + 2] && !args[i + 2].startsWith("--") ? args[i + 2] : "post";
    const pre = loadEpoch(aName), post = loadEpoch(bName);
    if (!pre || !post) return console.error(`Need ${aName}.json and ${bName}.json.`);
    console.log(`\n  comparing: ${aName} -> ${bName}`);
    console.log("\n  PRE-REGISTERED PRIMARY OUTCOME — does the llms.txt Chess line change enumeration?\n");
    const enu = (d, arm) => d.arms.find((x) => x.arm === arm && x.probe === "enumerate");
    const hits = (x, key) => x.rows.filter((r) => r.ok && r.found?.[key]).length;
    for (const arm of ["A", "B"]) {
      const a = enu(pre, arm), b = enu(post, arm);
      console.log(`   Arm ${arm}  chess:  pre ${hits(a, "chess")}/${a.responded}   ->   post ${hits(b, "chess")}/${b.responded}   (H2)`);
      console.log(`   Arm ${arm}  audio:  pre ${hits(a, "audio")}/${a.responded}   ->   post ${hits(b, "audio")}/${b.responded}   (H3)`);
    }
    const pa = enu(post, "A"), chessN = hits(pa, "chess"), audioN = hits(pa, "audio");
    console.log(`\n   H2 (post Arm A chess >= 3/5): ${chessN >= 3 ? "SUPPORTED" : "NOT SUPPORTED"}` +
      `${chessN <= 1 ? "  <-- FALSIFIER FIRED: the edit did not change what an arriving intelligence can enumerate" : ""}`);
    console.log(`   H3 (post Arm A audio >= 3/5): ${audioN >= 3 ? "SUPPORTED" : "NOT SUPPORTED"}`);
    if (audioN >= 3 && chessN <= 1) console.log("   -> H3 holds while H2 fails: the defect is Chess-specific, not the file.");
    const anyTrunc = [...pre.arms, ...post.arms].reduce((n, x) => n + x.truncated, 0);
    if (anyTrunc) console.log(`\n   WARNING: ${anyTrunc} truncated responses across both epochs — re-check before reporting.`);
    console.log("\n   Read the `completeness` probe by hand. That is the finding; this is the instrument.\n");
    return;
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(epoch)) return console.error("Usage: --epoch <name> | --compare [a] [b] | --rescore");

  const { elicitCouncil } = await import(join(process.cwd(), "api/_council.js"));

  console.log(`\n  FRONT-DOOR DISCOVERY TEST — epoch: ${epoch}`);
  console.log("  (paste-in comprehension, NOT wild discovery — the Council cannot browse)\n");

  const llms = await get(`${FLAG}/llms.txt`);
  const entry = await get(`${ENGINE}/api/agent-entry`, "application/json");
  console.log(`  fetched  llms.txt (${llms.length}b)   agent-entry (${entry.length}b)`);
  console.log(`  llms.txt mentions Chess: ${/chess/i.test(llms) ? "YES" : "NO"}`);

  const docsA = `=== DOCUMENT 1: ${FLAG}/llms.txt ===\n${llms}`;
  const docsB = `${docsA}\n\n=== DOCUMENT 2: ${ENGINE}/api/agent-entry ===\n${entry}`;

  const arms = [];
  for (const [armName, docs] of [["A", docsA], ["B", docsB]]) {
    for (const probe of PROBES) arms.push(await runProbe(armName, probe, docs, elicitCouncil));
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const rec = {
    epoch, run_at: new Date().toISOString(),
    llms_mentions_chess: /chess/i.test(llms),
    method: "paste-in comprehension via elicitCouncil (no browsing, no storage side effects)",
    caveat: "Measures sufficiency of the machine contract once read. Does NOT measure discovery in the wild.",
    arms,
  };
  writeFileSync(join(OUT_DIR, `${epoch}.json`), JSON.stringify(rec, null, 2));
  console.log(`\n  wrote ${join(OUT_DIR, `${epoch}.json`)}`);
  console.log("  NEXT: read section 3 (UNKNOWNS) by hand — hallucinated surfaces are the real signal.\n");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
