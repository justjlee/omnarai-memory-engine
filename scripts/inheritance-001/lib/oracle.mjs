// Inheritance study 001 — the scoring oracle. SEALED SIDE.
//
// Only the runner's scoring step and the analysis import this module. The context builder, the adapters and the mock
// model must never import it (scripts/test-inheritance-001.mjs checks the import graph), so a solver cannot reach an
// expected answer by any code path.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sha256 } from "./canon.mjs";
import { extractAnswer } from "./dsl.mjs";

const SELF = fileURLToPath(import.meta.url);
export const ORACLE = Object.freeze({ id: "is1-exact-match-oracle", version: "0.1.0", code_sha256: sha256(readFileSync(SELF, "utf8")) });

export const normalizeAnswer = (s, domain = "str") => (s == null ? null : domain === "num" ? String(s).replace(/\s+/g, "") : String(s).trim());

// Primary outcome (preregistered): exact match of the normalized <answer> against the hidden expected output.
// No answer tag → "abstain" (scored 0). Timeouts and API errors are set by the runner, never here.
export function scoreOutput(sealedTask, rawText, domain = "str") {
  if (!sealedTask || typeof sealedTask.expected !== "string") throw new Error("ORACLE_NEEDS_SEALED_TASK");
  const answer = normalizeAnswer(extractAnswer(rawText), domain);
  const outcome = answer === null ? "abstain" : answer === normalizeAnswer(sealedTask.expected, domain) ? "pass" : "fail";
  const score = outcome === "pass" ? 1 : 0;
  return {
    outcome,
    score,
    receipt_sha256: sha256({ oracle: ORACLE.id, version: ORACLE.version, task_id: sealedTask.task_id, answer_sha256: sha256(String(answer)), outcome }),
  };
}
