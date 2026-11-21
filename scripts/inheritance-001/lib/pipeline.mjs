// Inheritance study 001 — the offline pipeline as functions (the CLI and the tests share these).
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runStudy } from "./runner.mjs";
import { createMockAdapter } from "./mock-model.mjs";
import { exportRun, loadRun, verifyRunDir } from "./store.mjs";
import { analyze } from "./analyze.mjs";
import { renderReport } from "./report.mjs";
import { demoStudy } from "../fixtures/worlds.mjs";

// Analyze an exported run directory and write summary.json + REPORT.md (+ ablations.json). Pure function of the files.
export function summarizeDir(outDir) {
  const run = loadRun(outDir);
  const study = run.list("study")[0];
  const runs = run.list("run");
  const { report, ablations } = analyze({
    study,
    plan: run.plan,
    trials: readFileSync(join(outDir, "trials.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)),
    snapshots: run.list("snapshot").sort((a, b) => a.generation - b.generation),
    artifacts: run.list("artifact"),
    evaluations: run.list("evaluation"),
    runs,
  });
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(join(outDir, "ablations.json"), JSON.stringify(ablations, null, 2) + "\n");
  writeFileSync(join(outDir, "REPORT.md"), renderReport({ report, plan: run.plan, run: runs[0] }));
  return report;
}

export async function runDemo({ world = "positive-shared", outDir, seed, resamples, consumerOverrides, sealedDir = join(outDir, "sealed-demo") } = {}) {
  const { study, mockWorld } = demoStudy({ world, seed, resamples, consumerOverrides });
  const adapter = createMockAdapter(mockWorld);
  const result = await runStudy({ study, adapter });
  mkdirSync(outDir, { recursive: true });
  exportRun(result.store, outDir, { plan: result.plan, sealed: result.sealed, sealedDir });
  const report = summarizeDir(outDir);
  const verification = verifyRunDir(outDir);
  return { report, verification, result, study };
}
