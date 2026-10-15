// A dependency-free validator for the JSON Schema keywords our published
// schemas actually use: type, enum, const, required, properties,
// patternProperties, additionalProperties, items, minItems, minLength,
// minimum, pattern, format (date, date-time), allOf, if/then/else, not.
// Anything else in a schema is an ERROR here, never silently ignored — a
// validator that skips a keyword passes files it should fail.
//
// Why not ajv: the engine has no direct JSON Schema dependency (ajv 6 is only
// transitive and predates draft 2020-12), and node_modules is shared between
// working copies. scripts/test-claims-registry.mjs cross-checks this against
// ajv when it is installed.
//
//   validate(schema, value) → [] | ["<path>: <message>", …]

const KNOWN = new Set([
  "$schema", "$id", "title", "description", "type", "enum", "const", "required", "properties", "patternProperties",
  "additionalProperties", "items", "minItems", "minLength", "minimum", "pattern", "format", "allOf", "if", "then", "else", "not",
]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  return typeof v;
}
const typeMatches = (t, v) => t === typeOf(v) || (t === "number" && typeof v === "number");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function validate(schema, value, path = "$") {
  const errors = [];
  if (schema === true || schema === undefined) return errors;
  if (schema === false) return [`${path}: no value is allowed here`];
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) throw new Error(`json-schema-lite: unsupported keyword "${k}" at ${path}`);

  if (schema.type !== undefined) {
    const types = [].concat(schema.type);
    if (!types.some((t) => typeMatches(t, value))) errors.push(`${path}: expected ${types.join(" | ")}, got ${typeOf(value)}`);
  }
  if (schema.enum && !schema.enum.some((e) => same(e, value))) errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  if ("const" in schema && !same(schema.const, value)) errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
    if (schema.format === "date" && !DATE.test(value)) errors.push(`${path}: not a date (YYYY-MM-DD)`);
    if (schema.format === "date-time" && !(DATE_TIME.test(value) && Number.isFinite(Date.parse(value)))) errors.push(`${path}: not an RFC 3339 date-time`);
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`);

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} item(s)`);
    if (schema.items !== undefined) value.forEach((v, i) => errors.push(...validate(schema.items, v, `${path}[${i}]`)));
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const r of schema.required || []) if (!(r in value)) errors.push(`${path}: missing required "${r}"`);
    const patterns = Object.entries(schema.patternProperties || {}).map(([p, s]) => [new RegExp(p, "u"), s]);
    for (const [k, v] of Object.entries(value)) {
      const p = `${path}.${k}`;
      let matched = false;
      if (schema.properties && k in schema.properties) { matched = true; errors.push(...validate(schema.properties[k], v, p)); }
      for (const [re, s] of patterns) if (re.test(k)) { matched = true; errors.push(...validate(s, v, p)); }
      if (!matched && schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) errors.push(`${p}: is not an allowed field`);
        else errors.push(...validate(schema.additionalProperties, v, p));
      }
    }
  }

  for (const sub of schema.allOf || []) errors.push(...validate(sub, value, path));
  if (schema.if !== undefined) {
    const holds = validate(schema.if, value, path).length === 0;
    if (holds && schema.then !== undefined) errors.push(...validate(schema.then, value, path));
    if (!holds && schema.else !== undefined) errors.push(...validate(schema.else, value, path));
  }
  if (schema.not !== undefined && validate(schema.not, value, path).length === 0) errors.push(`${path}: matches a forbidden shape`);
  return errors;
}
