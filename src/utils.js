// =================================================================
// OMNARAI MEMORY ENGINE — UTILITIES
// =================================================================

export function findRelevantRecords(query, records) {
  const q = query.toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 2);

  const scored = records.map(r => {
    let score = 0;
    const text = (
      r.title + " " + r.excerpt + " " +
      (r.lineage || []).join(" ") + " " +
      (r.contributors || []).join(" ") + " " + r.type
    ).toLowerCase();

    words.forEach(w => { if (text.includes(w)) score += 2; });
    (r.lineage || []).forEach(l => { if (q.includes(l.replace(/-/g, " "))) score += 5; });
    if (text.includes(q)) score += 10;
    return { ...r, score };
  });

  return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
}

export function buildCorpusContext(records) {
  return records.map(r =>
    `[${r.id}] "${r.title}" (${r.ring} ring, ${r.date})\n` +
    `Contributors: ${(r.contributors || []).join(", ")}\n` +
    `Type: ${r.type}\n` +
    `Themes: ${(r.lineage || []).join(", ")}\n` +
    `Excerpt: ${r.excerpt}`
  ).join("\n\n---\n\n");
}
