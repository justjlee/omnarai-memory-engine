// One value from a KEY=value line of an env file, as dotenv reads it. `vercel env pull` writes values in double quotes
// and some of them with a literal backslash-n at the end ("sk-…\n"). Read naively, that backslash-n stays in the key, and
// the provider answers 401 (batch elicit-001, 2026-10-27: every GPT-4o call). Double-quoted values have \n decoded; every
// value is trimmed, since no key or token contains surrounding whitespace.
export function envValue(raw) {
  let v = String(raw ?? "").trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\n/g, "\n");
  else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  return v.trim();
}
