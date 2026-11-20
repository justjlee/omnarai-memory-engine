// Inheritance study 001 — record schemas (research/inheritance-001/schemas/*.schema.json), validated with the engine's
// own dependency-free validator (scripts/lib/json-schema-lite.mjs, which refuses any keyword it does not implement).
// Unknown keys, unknown statuses and unsealed bodies fail closed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validate } from "../../lib/json-schema-lite.mjs";
import { RECORD_KINDS, isSealedIntact } from "./canon.mjs";

const dir = fileURLToPath(new URL("../../../research/inheritance-001/schemas/", import.meta.url));
export const SCHEMAS = Object.fromEntries(RECORD_KINDS.map((k) => [k, JSON.parse(readFileSync(`${dir}${k.replace("_", "-")}.schema.json`, "utf8"))]));

export function validateRecord(kind, record) {
  const schema = SCHEMAS[kind];
  if (!schema) return [`unknown record kind ${kind}`];
  const errors = validate(schema, record);
  if (!isSealedIntact(record)) errors.push("$: sha256 does not match the record body");
  return errors;
}
