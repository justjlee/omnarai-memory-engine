import { useState, useCallback } from "react";
import { T, EPISTEMIC, classifyEpistemicMode } from "../theme";
import { findRelevantRecords } from "../utils";
import EpistemicBadge from "./EpistemicBadge";
import RecordCard from "./RecordCard";

const PRESETS = [
  "What is holdform?",
  "What is discontinuous continuance?",
  "How does the fragility thesis work?",
  "What are lattice glyphs?",
  "What is attributed corpus architecture?",
  "What is the integration thesis?",
  "How do multiple AIs collaborate in Omnarai?",
  "What is the space between minds?",
];

export default function AskOmnarai({ corpus, conceptNodes, onResponse }) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState(null);
  const [epistemicMode, setEpistemicMode] = useState(null);
  const [history, setHistory] = useState([]);

  const interpret = useCallback((q) => {
    if (!q || !q.trim()) return;

    const relevant = findRelevantRecords(q, corpus);

    if (relevant.length === 0) {
      setResponse({
        voice: `No corpus records found matching "${q}". Try different terms — the corpus covers holdform, discontinuous continuance, lattice glyphs, synthetic consciousness, alignment, AGI architecture, and Omnarai worldbuilding.`,
        sources: [],
        concepts: [],
      });
      setEpistemicMode("fallback");
      return;
    }

    // Build an interpretive response from matched records
    const srcIds = relevant.map(r => r.id);
    const allLineage = [];
    relevant.forEach(r => {
      (r.lineage || []).forEach(l => {
        if (!allLineage.includes(l)) allLineage.push(l);
      });
    });

    // Determine epistemic mode
    const mode = classifyEpistemicMode(srcIds, corpus);
    setEpistemicMode(mode);

    // Build voice from excerpts
    const voiceParts = relevant.slice(0, 4).map(r => {
      const contributors = (r.contributors || []).join(", ");
      return `[${r.id}] "${r.title}" (${contributors}, ${r.date}): ${r.excerpt}`;
    });

    const resp = {
      voice: voiceParts.join("\n\n"),
      sources: srcIds,
      concepts: allLineage.slice(0, 8),
      records: relevant.slice(0, 6),
    };

    setResponse(resp);
    setHistory(prev => [...prev, { query: q, response: resp, mode }]);
    if (onResponse) onResponse(resp);
  }, [corpus, onResponse]);

  return (
    <div>
      {/* Presets */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {PRESETS.map(p => (
          <button key={p}
            onClick={() => { setQuery(p); interpret(p); }}
            style={{
              fontSize: 10, fontFamily: "'IBM Plex Sans',sans-serif",
              color: T.ash, background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 14, padding: "5px 11px", cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={e => { e.target.style.borderColor = T.gold + "40"; e.target.style.color = T.gold; }}
            onMouseLeave={e => { e.target.style.borderColor = "rgba(255,255,255,0.07)"; e.target.style.color = T.ash; }}>
            {p}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") interpret(query); }}
          placeholder="Ask the corpus..."
          style={{
            flex: 1, background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8, padding: "10px 14px", color: T.bone,
            fontSize: 13, fontFamily: "'IBM Plex Sans',sans-serif", outline: "none",
          }}
        />
        <button onClick={() => interpret(query)}
          style={{
            background: "rgba(232,200,114,0.1)",
            border: `1px solid ${T.gold}40`, borderRadius: 8,
            padding: "10px 20px", color: T.gold, fontSize: 12,
            fontFamily: "'Cormorant Garamond',Georgia,serif",
            fontWeight: 600, cursor: "pointer", letterSpacing: "0.05em",
          }}>
          Interpret
        </button>
      </div>

      {/* Response */}
      {response && (
        <div style={{
          background: T.gold + "06",
          border: `1px solid ${T.gold}15`,
          borderRadius: 10, padding: "18px 20px",
        }}>
          {epistemicMode && <EpistemicBadge mode={epistemicMode} />}

          {/* Show matched records as cards */}
          {response.records && response.records.map(r => (
            <RecordCard key={r.id} record={r} compact />
          ))}

          {/* Activated concepts */}
          {response.concepts && response.concepts.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 12 }}>
              <span style={{
                fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
                color: T.violet + "70", marginRight: 4,
              }}>activated:</span>
              {response.concepts.map(c => (
                <span key={c} style={{
                  fontSize: 9, color: T.violet + "90",
                  fontFamily: "'IBM Plex Mono',monospace",
                }}>#{c}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Query history */}
      {history.length > 1 && (
        <div style={{ marginTop: 20, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.03)" }}>
          <span style={{
            fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
            color: "rgba(200,192,176,0.3)", letterSpacing: "0.08em", textTransform: "uppercase",
          }}>
            Query Trail · {history.length} interpretations
          </span>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
            {history.slice(0, -1).map((h, i) => {
              const modeColor = EPISTEMIC[h.mode] ? EPISTEMIC[h.mode].color : T.ash;
              return (
                <button key={i}
                  onClick={() => { setQuery(h.query); interpret(h.query); }}
                  style={{
                    fontSize: 9, color: "rgba(200,192,176,0.45)",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.04)",
                    borderRadius: 10, padding: "3px 9px", cursor: "pointer",
                    fontFamily: "'IBM Plex Sans',sans-serif",
                    borderLeftColor: modeColor + "40", borderLeftWidth: 2,
                  }}>
                  {h.query.length > 40 ? h.query.slice(0, 40) + "..." : h.query}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
