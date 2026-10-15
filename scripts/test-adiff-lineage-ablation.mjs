// ALA v1 harness (scripts/adiff-lineage-ablation.mjs + scripts/lib/ala-core.mjs). HERMETIC: no keys, no spend; the
// spawned runs go through the loader, whose fetch shim refuses all network.
//
//   node --import ./scripts/lib/register-mem-blob.mjs --test scripts/test-adiff-lineage-ablation.mjs
//
//   [F*] fidelity to the July design and the registration   [A*] the decision table   [E*] end to end, scripted
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as A from "./lib/ala-core.mjs";
import { synthesisRequest, parseSynthesis } from "../api/_council.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const REGISTERED = read("scripts/utility-test-prereg.mjs");

test("[F1] every block copied from the registered July harness is byte-identical to it, and that harness is untouched", (t) => {
  for (const file of ["scripts/lib/ala-core.mjs", "scripts/adiff-lineage-ablation.mjs"]) {
    const blocks = [...read(file).matchAll(/\/\/ copied: [^\n]*\n([\s\S]*?)\/\/ end copied/g)].map((m) => m[1]);
    assert.ok(blocks.length >= 1, file);
    for (const b of blocks) assert.ok(REGISTERED.includes(b), `${file}: a copied block differs from scripts/utility-test-prereg.mjs:\n${b.slice(0, 120)}`);
  }
  try { execFileSync("git", ["cat-file", "-e", "cede75f"], { cwd: ROOT, stdio: "ignore" }); } catch { t.skip("no git history"); return; }
  assert.equal(execFileSync("git", ["show", "cede75f:scripts/utility-test-prereg.mjs"], { cwd: ROOT, encoding: "utf8" }), REGISTERED, "the registered harness is not edited (§3)");
});

test("[F2] the 162 July instances: 27 records × 3 wordings × 2 caps, the ids the registration lists", () => {
  const inst = A.julyInstances();
  assert.equal(inst.length, 162);
  const ids = [...new Set(inst.map((i) => i.record_id))];
  assert.equal(ids.length, 27);
  const prereg = read(A.PREREG);
  for (const id of ids) assert.ok(prereg.includes(`\`${id}\``), `${id} listed in the registration`);
  for (const id of ids) assert.equal(inst.filter((i) => i.record_id === id).length, 6);
  assert.deepEqual([...new Set(inst.map((i) => i.cap))].sort((a, b) => a - b), [700, 1500]);
  const one = inst.filter((i) => i.record_id === ids[0]);
  assert.equal(new Set(one.map((i) => i.question)).size, 3, "three wordings, reused verbatim");
});

test("[F3] arms: peers never include Claude; TP is the July text minus exactly the tension section; TX keeps only peer voices", () => {
  const recs = A.recordsById();
  const rec = recs.get(A.julyInstances()[0].record_id);
  const peers = A.peersOf(rec);
  assert.equal(peers.length, rec.answers.length - 1);
  assert.ok(!peers.some((p) => p.model === "Claude"));
  const tc = A.treatmentUser("Q?", "a1", peers, rec.tensions);
  const tp = A.peersOnlyUser("Q?", "a1", peers);
  assert.ok(tc.includes("Key tensions across the panel:") && !tp.includes("Key tensions"));
  assert.equal(tp, A.treatmentUser("Q?", "a1", peers, []).replace("\n\nKey tensions across the panel:\n(none extracted)", ""));
  assert.ok(rec.tensions.some((t) => t.voice_a === "Claude" || t.voice_b === "Claude"), "the original map restates Claude's claims — the confound TP removes");
  const f = A.filterTensions([{ voice_a: "Grok", voice_b: peers[1].model, topic: "x" }, { voice_a: "Claude", voice_b: "Grok", topic: "y" }], peers);
  assert.equal(f.kept.length, 1);
  assert.equal(f.dropped, 1);
});

test("[F4] the TX request is the council's own synthesis request for a four-member panel (only the model differs)", () => {
  const peers = [{ model: "GPT-4o", lab: "OpenAI", model_id: "gpt-4o", text: "a" }, { model: "Grok", lab: "xAI", model_id: "grok-4.3", text: "b" }];
  const r = synthesisRequest("Q?", peers);
  assert.ok(r.system.includes("(GPT-4o, Grok)") && !r.system.includes("(Claude, GPT-4o"));
  assert.ok(r.user.includes("### Grok (xAI, grok-4.3)\nb"));
  const src = read("api/_council.js");
  assert.match(src, /const \{ system: synthSystem, user: userMessage \} = synthesisRequest\(question, answered\);/, "synthesizeCouncil builds its request with the same function");
  assert.match(src, /return parseSynthesis\(msg\.content\[0\]\?\.text \|\| ""\);/);
  assert.equal(parseSynthesis("x\n```TENSION_MAP\n[{\"voice_a\":\"A\",\"voice_b\":\"B\",\"topic\":\"t\"},{\"voice_a\":\"A\"}]\n```").tensions.length, 1);
});

const row = (TC, TX, TP) => ({ arms: { TC, TX, TP } });
test("[A1] the decision table (§5), row by row; July's own numbers would pass the gate", () => {
  assert.ok(A.signOneSided(126, 161) < 1e-10, "35–126 is far past p < .025");
  const deg = (n, arm = "placebo") => Array(n).fill(arm);
  const mk = (tc, tp, tx = tc) => tc.map((v, i) => row(v, tx[i], tp[i]));
  assert.equal(A.analyze(mk(deg(12, "tie"), deg(12))).verdict, "no_concurrent_degradation", "no gate, no mechanism verdict");
  assert.equal(A.analyze(mk(deg(12), deg(12))).verdict, "refuted_as_tested", "still degrades with peers only");
  assert.equal(A.analyze(mk(deg(12), deg(12, "treatment"))).verdict, "supported_as_tested");
  const mixed = [...deg(4, "placebo"), ...deg(3, "treatment"), ...deg(5, "tie")];
  assert.equal(A.analyze(mk(deg(12), mixed)).verdict, "inconclusive");
  const a = A.analyze(mk(deg(12), deg(12, "treatment")));
  assert.equal(a.secondary.TC_vs_TP.placebo_won_only_vs_first, 12);
});

test("[A2] the July panel rule, exactly: majority verdict, a tie at the top is a tie", () => {
  assert.equal(A.panelOverall(["placebo", "placebo", "treatment"]).overall, "placebo");
  assert.equal(A.panelOverall(["treatment", "placebo", "tie"]).overall, "tie");
  assert.equal(A.panelOverall(["treatment", "placebo"]).overall, "tie");
  assert.equal(A.panelOverall(["tie", "tie", "treatment"]).overall, "tie");
});

const tmp = () => mkdtempSync(join(tmpdir(), "ala-test-"));
const spawn = (argv, env = {}) => spawnSync(process.execPath, ["--import", "./scripts/lib/register-mem-blob.mjs", "scripts/adiff-lineage-ablation.mjs", ...argv], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH, ADIFF_NO_ENV_FILE: "1", ...env }, timeout: 120000 });

test("[E1] a scripted run exercises every arm and judge; a real run refuses its scripted maps and spends nothing", () => {
  const out = tmp();
  try {
    const r = spawn(["--stub", "--instances", "3", "--out", out]);
    assert.equal(r.status, 0, r.stderr.slice(-800));
    const runFile = readdirSync(out).find((f) => /^stub-/.test(f) && !f.includes("analysis"));
    const data = JSON.parse(readFileSync(join(out, runFile), "utf8"));
    assert.equal(data.instances.length, 3);
    for (const it of data.instances) {
      assert.deepEqual(Object.keys(it.revisions).sort(), ["P", "TC", "TP", "TX"]);
      for (const arm of A.ARMS) assert.equal(it.verdicts[arm].verdicts.length, 3, "three judges per comparison");
      assert.match(it.revisions.TP, /^\[TP\]/);
    }
    const maps = JSON.parse(readFileSync(join(out, "tension-maps-deepseek.json"), "utf8"));
    assert.equal(maps.stub, true);
    assert.ok(Object.values(maps.records).every((m) => m.dropped === 1), "a tension naming Claude is dropped from the four-peer map");
    // The real run, pointed at that directory with fake keys (the loader still blocks all network): it must refuse.
    const live = spawn(["--yes", "--out", out], { MEM_BLOB_KEEP_ENV: "1", ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "x", GEMINI_API_KEY: "x", XAI_API_KEY: "x", DEEPSEEK_API_KEY: "x" });
    assert.notEqual(live.status, 0);
    assert.match(live.stderr, /not a registered deepseek-chat map file \(stub=true\)/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("[E2] the real run refuses without keys, and --plan estimates from the real prompt sizes", () => {
  const noKeys = spawn(["--yes", "--out", tmp()]);
  assert.equal(noKeys.status, 1);
  assert.match(noKeys.stderr, /missing [A-Z_]+_API_KEY/);
  const plan = spawn(["--plan"]);
  assert.equal(plan.status, 0, plan.stderr.slice(-500));
  const est = JSON.parse(plan.stdout);
  assert.equal(est.instances, 162);
  assert.equal(est.calls, 27 + 162 * 5 + 162 * 3 * 3, "27 maps + 5 consumer calls + 3 arms × 3 judges per instance");
  assert.ok(est.estimate_usd > 0 && est.estimate_usd < 40, `got ${est.estimate_usd}`);
  assert.ok(Math.abs(est.reserve_usd - est.estimate_usd * 1.5) < 0.02);
});
