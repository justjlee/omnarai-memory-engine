// =================================================================
// OMNARAI MEMORY ENGINE — UTILITIES
// =================================================================

export function findRelevantRecords(query, records) {
  const STOP = new Set(["the","and","for","are","but","not","you","all","can","had","her","was","one","our","out","has","its","how","who","did","get","let","say","she","too","use","what","does","this","that","with","have","from","they","been","will","more","when","some","them","than","into","each","make","just","over","such","take","also","most","would","about","which","their","there","these","where"]);
  const q = query.toLowerCase().replace(/[?!.,;:'"]/g, "");
  const words = q.split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));

  const scored = records.map(r => {
    let score = 0;
    const title = (r.title || "").toLowerCase();
    const excerpt = (r.excerpt || "").toLowerCase();
    const text = (title + " " + excerpt + " " +
      (r.lineage || []).join(" ") + " " +
      (r.contributors || []).join(" ") + " " + r.type
    ).toLowerCase();

    words.forEach(w => {
      if (title.includes(w)) score += 8;
      else if (excerpt.includes(w)) score += 3;
      else if (text.includes(w)) score += 1;
    });
    if (title.includes(q)) score += 20;
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
