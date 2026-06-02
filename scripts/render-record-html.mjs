#!/usr/bin/env node
// Render the assembled Divergence Record draft to a readable HTML page on the
// Desktop, so the curator can read the FULL record (all verbatim answers +
// framing) before approving. Read-only; touches nothing live.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const draft = JSON.parse(readFileSync(join(__dirname, "divergence-pilot-runs", "divergence-record-DRAFT.json"), "utf8"));

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
  .replace(/\*(.+?)\*/g, "<em>$1</em>");

// Minimal, robust markdown → HTML (headings, blockquote, bullets, paragraphs)
function md(text) {
  const out = [];
  let para = [], list = [], quote = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list.length) { out.push(`<ul>${list.map(li => `<li>${inline(li)}</li>`).join("")}</ul>`); list = []; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^#{1,6}\s/.test(line)) { flushAll(); const lvl = line.match(/^#+/)[0].length; out.push(`<h${lvl}>${inline(line.replace(/^#+\s/, ""))}</h${lvl}>`); }
    else if (/^>\s?/.test(line)) { flushPara(); flushList(); quote.push(line.replace(/^>\s?/, "")); }
    else if (/^[-*]\s+/.test(line)) { flushPara(); flushQuote(); list.push(line.replace(/^[-*]\s+/, "")); }
    else if (line.trim() === "") { flushAll(); }
    else { flushList(); flushQuote(); para.push(line); }
  }
  flushAll();
  return out.join("\n");
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(draft.title)}</title>
<style>
  body{max-width:760px;margin:40px auto;padding:0 24px;font:18px/1.7 -apple-system,Georgia,serif;color:#1c1c1e;background:#faf9f7}
  h1{font-size:30px;line-height:1.25} h2{font-size:23px;margin-top:2em;border-bottom:1px solid #e2ded7;padding-bottom:.2em}
  h3{font-size:19px;margin-top:1.6em;color:#7a5c00} blockquote{margin:1em 0;padding:.4em 1.1em;border-left:3px solid #c9a227;background:#fff;color:#333;font-style:italic}
  ul{padding-left:1.3em} li{margin:.25em 0} strong{color:#111} em{color:#444}
  .meta{color:#8a8580;font-size:14px;margin-bottom:1.5em}
  .answer{background:#fff;border:1px solid #e8e4dc;border-radius:10px;padding:8px 22px;margin:1.2em 0}
</style></head><body>
<p class="meta">${esc(draft.id)} · ${esc(draft.date)} · ${draft.wordCount} words · pending review</p>
${md(draft.full_text)}
</body></html>`;

const outPath = "/Users/jonathanlee/Desktop/divergence-record.html";
writeFileSync(outPath, html);
console.log(`Wrote readable record to: ${outPath}`);
console.log(`Verbatim answers included: ${draft.provenance.answers.map(a => a.model).join(", ")}`);
