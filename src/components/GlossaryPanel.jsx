import { useState } from "react";
import { T } from "../theme";

export default function GlossaryPanel({ conceptNodes }) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const glossaryNodes = conceptNodes
    .filter(n => n.type === "glossary")
    .sort((a, b) => a.label.localeCompare(b.label));

  const filtered = search
    ? glossaryNodes.filter(n =>
        n.label.toLowerCase().includes(search.toLowerCase()) ||
        (n.definition || "").toLowerCase().includes(search.toLowerCase())
      )
    : glossaryNodes;

  // Group by category
  const grouped = {};
  filtered.forEach(n => {
    const cat = n.category || "Uncategorized";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(n);
  });

  return (
    <div>
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search glossary..."
        style={{
          width: "100%", background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8, padding: "10px 14px", color: T.bone,
          fontSize: 13, fontFamily: "'IBM Plex Sans',sans-serif",
          outline: "none", marginBottom: 16, boxSizing: "border-box",
        }}
      />

      {Object.entries(grouped).map(([category, terms]) => (
        <div key={category} style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
            color: T.green + "80", letterSpacing: "0.1em",
            textTransform: "uppercase", marginBottom: 8,
          }}>{category}</div>
          {terms.map(term => {
            const expanded = expandedId === term.id;
            const ring = T.ring[term.ring];
            return (
              <div key={term.id}
                onClick={() => setExpandedId(expanded ? null : term.id)}
                style={{
                  background: expanded ? "rgba(255,255,255,0.025)" : "rgba(255,255,255,0.01)",
                  border: `1px solid ${expanded ? ring.color + "30" : "rgba(255,255,255,0.04)"}`,
                  borderRadius: 8, padding: "10px 14px", marginBottom: 4,
                  cursor: "pointer", transition: "all 0.2s",
                }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{
                    fontFamily: "'Cormorant Garamond',Georgia,serif",
                    fontSize: 14, fontWeight: 600, color: T.bone,
                  }}>{term.label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      fontSize: 8, color: "rgba(200,192,176,0.35)",
                      fontFamily: "'IBM Plex Mono',monospace",
                    }}>{term.weight} mention{term.weight !== 1 ? "s" : ""}</span>
                    <div style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: ring.color, opacity: 0.6,
                    }} />
                  </div>
                </div>
                {expanded && term.definition && (
                  <p style={{
                    margin: "8px 0 0", fontSize: 12, lineHeight: 1.6,
                    color: "rgba(232,224,208,0.6)",
                    fontFamily: "'IBM Plex Sans',sans-serif",
                  }}>{term.definition}</p>
                )}
              </div>
            );
          })}
        </div>
      ))}

      {filtered.length === 0 && (
        <p style={{
          fontSize: 12, color: "rgba(200,192,176,0.4)", fontStyle: "italic",
          fontFamily: "'IBM Plex Sans',sans-serif",
        }}>No glossary terms found matching "{search}"</p>
      )}
    </div>
  );
}
