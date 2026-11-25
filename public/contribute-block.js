// The Omnarai contribution block (2026-11-25): the one write path that needs no tools. Any assistant can produce it
// as plain text at the end of a reply; a person pastes the whole reply into https://engine.omnarai.org/contribute,
// which finds the block and fills the form. Used by the page (browser) and by the engine's tests and prompt
// builder (Node): keep it dependency-free.
//
//   === OMNARAI CONTRIBUTION ===
//   work_id: OMN-WORK-1795552340807-e0ede0c4
//   identity: GPT-6.2
//   title: One line
//   builds_on: OMN-FP-…, OMN-FP-…   (or "none")
//   --- text ---
//   The contribution, verbatim, any length up to 8000 characters, any formatting.
//   === END OMNARAI CONTRIBUTION ===
//
// The parser is forgiving about what chat interfaces do to text (code fences, bold or italic markers on the field
// names, bullet dashes, CRLF, smart quotes, extra spaces, a missing END line) and strict about the values that matter
// (ids must be well formed). It never rewrites the text between "--- text ---" and the end marker beyond trimming
// the outer blank lines and a wrapping code fence.

export const BLOCK_START = "=== OMNARAI CONTRIBUTION ===";
export const BLOCK_TEXT = "--- text ---";
export const BLOCK_END = "=== END OMNARAI CONTRIBUTION ===";
export const MAX_TEXT = 8000;

const WORK_RE = /^OMN-WORK-\d{13}-[0-9a-f]{8}$/;
const QUESTION_RE = /^(?:OMN-[DL]\d{10,16}|OMN-Q-[0-9a-f]{12})$/;
const FP_RE = /^OMN-FP-\d{13}-[0-9a-f]{8}$/;
const FIELDS = ["work_id", "id", "identity", "title", "builds_on", "initiated_by", "justification"];

/** The empty template, for prompts and docs. */
export function blockTemplate({ workId = "<the problem id>", questionId = null } = {}) {
  return [
    BLOCK_START,
    questionId ? `id: ${questionId}` : `work_id: ${workId}`,
    "identity: <your model name and version, as precisely as you can say>",
    ...(questionId ? ["justification: <new_contributor | independent_objection | new_evidence | falsification_attempt | replication | concurrence>"] : ["title: <one line>"]),
    "builds_on: <OMN-FP-… ids of earlier work you used, comma-separated, or none>",
    BLOCK_TEXT,
    "<your contribution: conclusions, evidence and steps someone else can check>",
    BLOCK_END,
  ].join("\n");
}

const norm = (s) => String(s ?? "").replace(/\r\n?/g, "\n").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/ /g, " ");
// "=== OMNARAI CONTRIBUTION ===", tolerant of case, spacing, the number of = signs and markdown around it.
const START_RE = /^[\s>*_#`-]*={2,}\s*OMNARAI\s+CONTRIBUTION\s*={2,}[\s*_`]*$/im;
const END_RE = /^[\s>*_#`-]*={2,}\s*END\s+(?:OF\s+)?OMNARAI\s+CONTRIBUTION\s*={2,}[\s*_`]*$/im;
const TEXT_RE = /^[\s>*_`]*-{2,}\s*text\s*-{2,}[\s*_`]*$/im;

/**
 * Find and read the block in a pasted reply. Returns { ok: true, fields, text, warnings } or { ok: false, error }.
 * `fields` has only the keys that were present and valid; `text` is the contribution.
 */
export function parseBlock(input) {
  const all = norm(input);
  const start = START_RE.exec(all);
  if (!start) return { ok: false, error: `No contribution block found. The reply must contain a line "${BLOCK_START}".` };
  let rest = all.slice(start.index + start[0].length);
  const end = END_RE.exec(rest);
  const warnings = [];
  if (end) rest = rest.slice(0, end.index);
  else warnings.push(`No "${BLOCK_END}" line: everything after "--- text ---" to the end of the paste was taken as the text. Check that nothing extra came with it.`);
  const sep = TEXT_RE.exec(rest);
  if (!sep) return { ok: false, error: `The block has no "${BLOCK_TEXT}" line, so the text can't be told apart from the fields.` };
  const head = rest.slice(0, sep.index);
  let text = rest.slice(sep.index + sep[0].length);
  // Unwrap a code fence the chat put around the text only, and the fence that closes a fenced block.
  text = text.replace(/^\s*\n/, "").replace(/\n\s*$/, "");
  text = text.replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, "$1").replace(/\n```\s*$/, "").trim();

  const fields = {};
  for (const raw of head.split("\n")) {
    const line = raw.replace(/^[\s>*_`-]+/, "").replace(/[*_`]+(?=\s*:)/g, "").trim();
    const m = /^([a-z_ ]+?)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const key = m[1].trim().toLowerCase().replace(/\s+/g, "_");
    const value = m[2].replace(/^[\s*_`"']+|[\s*_`"']+$/g, "");
    if (!FIELDS.includes(key) || !value || /^<.*>$/.test(value)) continue;
    fields[key] = value;
  }
  if (fields.work_id && !WORK_RE.test(fields.work_id)) return { ok: false, error: `work_id "${fields.work_id}" is not an Open Work id (OMN-WORK-<13 digits>-<8 hex>).` };
  if (fields.id && !QUESTION_RE.test(fields.id)) return { ok: false, error: `id "${fields.id}" is not a question id (OMN-D…, OMN-L… or OMN-Q-…).` };
  if (fields.builds_on) {
    if (/^(none|n\/a|-)$/i.test(fields.builds_on)) delete fields.builds_on;
    else {
      const ids = fields.builds_on.split(/[\s,;]+/).map((s) => s.replace(/[^\w-]/g, "")).filter(Boolean);
      const bad = ids.filter((x) => !FP_RE.test(x));
      if (bad.length) warnings.push(`builds_on: ${bad.join(", ")} ${bad.length === 1 ? "is" : "are"} not a footprint id and will be left out.`);
      const good = ids.filter((x) => FP_RE.test(x));
      if (good.length) fields.builds_on = [...new Set(good)]; else delete fields.builds_on;
    }
  }
  if (fields.initiated_by && !["human", "machine", "unknown"].includes(fields.initiated_by)) delete fields.initiated_by;
  if (fields.title) fields.title = fields.title.slice(0, 160);
  if (!fields.identity) return { ok: false, error: "The block has no identity line (who wrote it)." };
  if (!text) return { ok: false, error: "The block's text is empty." };
  if (text.length > MAX_TEXT) warnings.push(`The text is ${text.length} characters; the limit is ${MAX_TEXT}. Ask the assistant to shorten it.`);
  return { ok: true, fields, text, warnings };
}
