// Inheritance study 001 — the program language, described for PRODUCERS (the models that leave work for others).
//
// Why this exists (Pilot 001, 2026-11-20): the contribution request asked producers for "JSON steps" but never said which
// steps exist. 0 of 51 producer records carried a valid program (one producer invented its own operation names, the other
// mostly wrote none), so nothing could be verified and arm C carried no records. A record is verifiable only if it states a
// program in this language, so producers must be told the language.
//
// Shown ONLY in the producer's contribution request (studies that set params.producer_language), never in a consumer's
// frame: the arms A…E keep exactly the frame they had. Every worked example below is checked against the interpreter in
// dsl.mjs by scripts/test-inheritance-001-caps.mjs [K13], so this text cannot drift from what the verifier runs.
// Pure data, no imports (the solver side may read it).
export const PROGRAM_LANGUAGE = Object.freeze({
  str: Object.freeze({
    value: "a string",
    steps: Object.freeze([
      { step: { op: "reverse" }, meaning: "reverse the string", input: "abc", output: "cba" },
      { step: { op: "caesar", k: 2 }, params: "K from 1 to 25", meaning: "shift each lowercase letter K places forward in the alphabet, wrapping z to a; other characters unchanged", input: "ayz", output: "cab" },
      { step: { op: "rotate", k: 2 }, params: "K from 1 to 9", meaning: "move the first K characters to the end (K is taken modulo the length)", input: "abcde", output: "cdeab" },
      { step: { op: "dedupe" }, meaning: "keep only the first occurrence of each character", input: "banana", output: "ban" },
      { step: { op: "sort" }, meaning: "sort the characters by character code (uppercase before lowercase)", input: "dcBa", output: "Bacd" },
      { step: { op: "swapcase" }, meaning: "swap upper and lower case", input: "aBc", output: "AbC" },
      { step: { op: "double" }, meaning: "write every character twice", input: "ab", output: "aabb" },
      { step: { op: "evens" }, meaning: "keep the characters at positions 0, 2, 4, …", input: "abcde", output: "ace" },
      { step: { op: "mirror" }, meaning: "append the reversed string", input: "ab", output: "abba" },
      { step: { op: "vowelmask" }, meaning: "replace every vowel (a, e, i, o, u, either case) with *", input: "Data", output: "D*t*" },
      { step: { op: "rle" }, meaning: "run-length encode: each run becomes the character followed by its length", input: "aaab", output: "a3b1" },
      { step: { op: "interleave" }, meaning: "split into a first half (the longer half when the length is odd) and a second half, then alternate their characters", input: "abcde", output: "adbec" },
    ]),
    example_program: [{ op: "reverse" }, { op: "caesar", k: 1 }],
  }),
  num: Object.freeze({
    value: "a comma-separated list of integers",
    steps: Object.freeze([
      { step: { op: "add", k: 2 }, params: "K from -9 to 9", meaning: "add K to every number", input: "1,2", output: "3,4" },
      { step: { op: "mul", k: 3 }, params: "K from 2 to 5", meaning: "multiply every number by K", input: "1,2", output: "3,6" },
      { step: { op: "diffs" }, meaning: "differences between neighbours", input: "1,4,9", output: "3,5" },
      { step: { op: "cumsum" }, meaning: "running totals", input: "1,2,3", output: "1,3,6" },
      { step: { op: "revnum" }, meaning: "reverse the list", input: "1,2,3", output: "3,2,1" },
      { step: { op: "sortnum" }, meaning: "sort ascending", input: "3,1,2", output: "1,2,3" },
    ]),
    example_program: [{ op: "mul", k: 2 }, { op: "revnum" }],
  }),
});

const stepText = ({ step, params, meaning, input, output }) => {
  const k = Object.hasOwn(step, "k");
  const shape = k ? JSON.stringify({ ...step, k: "K" }).replace('"K"', "K") : JSON.stringify(step);
  return `${shape}: ${meaning}${params ? ` (${params})` : ""}. Example${k ? ` with K=${step.k}` : ""}: ${input} -> ${output}`;
};

// The text appended to a producer's contribution request for a task in `domain`.
export function languageText(domain = "str") {
  const L = PROGRAM_LANGUAGE[domain];
  if (!L) throw new Error(`NO_LANGUAGE_FOR_DOMAIN ${domain}`);
  return [
    `How to write the program so it can be checked: a JSON array of steps, applied in order to ${L.value}, inside a block that starts with three backticks and the word program on its own line and ends with three backticks.`,
    "Use only these steps, with exactly these names and parameters:",
    ...L.steps.map((s) => `- ${stepText(s)}`),
    `Example block:\n\`\`\`program\n${JSON.stringify(L.example_program)}\n\`\`\``,
    "A program is checked by running it on hidden inputs of the same task; a program that only fits the shown examples, or uses any other step name, does not count.",
  ].join("\n");
}
