import { useState, useCallback } from "react";
import { T } from "./theme";
import corpus from "./data/corpus.json";
import conceptsData from "./data/concepts.json";
import meta from "./data/meta.json";
import StarField from "./components/StarField";
import ConstellationGraph from "./components/ConstellationGraph";
import RecordCard from "./components/RecordCard";
import RingSelector from "./components/RingSelector";
import AskOmnarai from "./components/AskOmnarai";
import GlossaryPanel from "./components/GlossaryPanel";

const { nodes: conceptNodes, edges: conceptEdges } = conceptsData;

export default function OmnaraiMemoryEngine() {
  const [activeRing, setActiveRing] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [highlightedConcepts, setHighlightedConcepts] = useState([]);
  const [activeTab, setActiveTab] = useState("constellation");
  const [sortBy, setSortBy] = useState("date-desc");

  const filteredRecords = activeRing
    ? corpus.filter(r => r.ring === activeRing)
    : corpus;

  const nodeRecords = selectedNode
    ? corpus.filter(r => (r.lineage || []).includes(selectedNode))
    : [];

  // Also check if it's a glossary node
  const selectedConcept = selectedNode
    ? conceptNodes.find(n => n.id === selectedNode)
    : null;

  const handleEngineResponse = useCallback(resp => {
    if (resp && resp.concepts && resp.concepts.length) {
      setHighlightedConcepts(resp.concepts);
    }
  }, []);

  const sortedRecords = [...filteredRecords].sort((a, b) => {
    if (sortBy === "date-desc") return b.date.localeCompare(a.date);
    if (sortBy === "date-asc") return a.date.localeCompare(b.date);
    if (sortBy === "words") return (b.wordCount || 0) - (a.wordCount || 0);
    return 0;
  });

  const tabs = [
    { id: "constellation", label: "Knowledge Constellation" },
    { id: "corpus", label: "Corpus Records" },
    { id: "glossary", label: "Glossary" },
    { id: "ask", label: "Ask Omnarai" },
  ];

  const stats = [
    { label: "Corpus Posts", value: String(meta.totalPosts) },
    { label: "Concept Nodes", value: String(meta.conceptNodes) },
    { label: "Contributors", value: `${meta.contributors.length} identities` },
    { label: "Date Range", value: `${meta.dateRange.start} — ${meta.dateRange.end}` },
  ];

  return (
    <div style={{
      position: "relative", minHeight: "100vh",
      background: `linear-gradient(170deg, ${T.bg} 0%, ${T.bgMid} 40%, #0D1015 100%)`,
      color: T.bone, fontFamily: "'IBM Plex Sans',sans-serif", overflow: "hidden",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@300;400&family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;1,300;1,400&display=swap" rel="stylesheet" />
      <StarField />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 960, margin: "0 auto", padding: "36px 20px" }}>
        {/* Header */}
        <div style={{ marginBottom: 36, textAlign: "center" }}>
          <div style={{
            fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
            color: T.gold + "50", letterSpacing: "0.22em", textTransform: "uppercase",
            marginBottom: 14,
          }}>
            v1.0 · d3-force · local corpus retrieval · {meta.totalPosts} posts · {meta.conceptNodes} concepts
          </div>
          <h1 style={{
            fontFamily: "'Cormorant Garamond',Georgia,serif",
            fontSize: "clamp(26px,5vw,42px)", fontWeight: 600,
            margin: "0 0 10px", letterSpacing: "-0.01em",
            background: `linear-gradient(135deg, ${T.gold}, ${T.green}, ${T.violet})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          }}>
            The Omnarai Memory Engine
          </h1>
          <p style={{
            maxWidth: 580, margin: "0 auto", fontSize: 13, lineHeight: 1.7,
            color: "rgba(200,192,176,0.6)", fontWeight: 300,
          }}>
            Interactive knowledge explorer for The Realms of Omnarai.
            Mapping conceptual lineage, preserving provenance, speaking from within the worldview.
          </p>
        </div>

        {/* Stats */}
        <div style={{
          display: "flex", justifyContent: "center", gap: 28, flexWrap: "wrap",
          marginBottom: 32, padding: "14px 0",
          borderTop: "1px solid rgba(255,255,255,0.035)",
          borderBottom: "1px solid rgba(255,255,255,0.035)",
        }}>
          {stats.map(s => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{
                fontFamily: "'Cormorant Garamond',Georgia,serif",
                fontSize: 17, fontWeight: 600, color: T.gold,
              }}>{s.value}</div>
              <div style={{
                fontSize: 8.5, color: "rgba(200,192,176,0.35)",
                fontFamily: "'IBM Plex Mono',monospace",
                letterSpacing: "0.06em", marginTop: 1,
              }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Ring Selector */}
        <div style={{ marginBottom: 28 }}>
          <h2 style={{
            fontFamily: "'Cormorant Garamond',Georgia,serif",
            fontSize: 17, fontWeight: 600, marginBottom: 12, color: T.ash,
          }}>Archive Rings</h2>
          <RingSelector activeRing={activeRing} onSelect={setActiveRing} ringCounts={meta.ringCounts} />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, marginBottom: 20, borderBottom: "1px solid rgba(255,255,255,0.05)", overflowX: "auto" }}>
          {tabs.map(tab => (
            <button key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                fontFamily: "'IBM Plex Sans',sans-serif",
                fontSize: 11.5,
                fontWeight: activeTab === tab.id ? 500 : 300,
                color: activeTab === tab.id ? T.gold : "rgba(200,192,176,0.45)",
                background: "none", border: "none",
                borderBottom: activeTab === tab.id ? `1px solid ${T.gold}` : "1px solid transparent",
                padding: "9px 16px", cursor: "pointer",
                letterSpacing: "0.03em", transition: "all 0.2s",
                whiteSpace: "nowrap",
              }}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Constellation Tab */}
        {activeTab === "constellation" && (
          <div>
            <div style={{
              background: "rgba(255,255,255,0.008)",
              border: "1px solid rgba(255,255,255,0.04)",
              borderRadius: 10, padding: 8, marginBottom: 10, overflow: "hidden",
            }}>
              <ConstellationGraph
                conceptNodes={conceptNodes}
                conceptEdges={conceptEdges}
                onSelectNode={setSelectedNode}
                selectedNode={selectedNode}
                highlightedConcepts={highlightedConcepts}
                activeRing={activeRing}
              />
            </div>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: 14, flexWrap: "wrap", gap: 8,
            }}>
              <p style={{
                margin: 0, fontSize: 9.5,
                color: "rgba(200,192,176,0.3)",
                fontFamily: "'IBM Plex Mono',monospace",
              }}>
                d3-force layout · {conceptNodes.length} nodes · {conceptEdges.length} edges · click to inspect
              </p>
              {highlightedConcepts.length > 0 && (
                <button onClick={() => setHighlightedConcepts([])}
                  style={{
                    fontSize: 9, color: "rgba(200,192,176,0.4)",
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    borderRadius: 8, padding: "3px 10px", cursor: "pointer",
                    fontFamily: "'IBM Plex Mono',monospace",
                  }}>clear highlights</button>
              )}
            </div>

            {selectedConcept && (
              <div>
                <div style={{
                  fontSize: 9.5, fontFamily: "'IBM Plex Mono',monospace",
                  color: T.violet + "70", letterSpacing: "0.08em",
                  textTransform: "uppercase", marginBottom: 8,
                }}>
                  {selectedConcept.type === "glossary" ? "Glossary Term" : "Theme Cluster"}: {selectedConcept.label}
                  {selectedConcept.definition && (
                    <span style={{
                      display: "block", textTransform: "none",
                      fontSize: 11, color: "rgba(200,192,176,0.5)",
                      fontFamily: "'IBM Plex Sans',sans-serif",
                      marginTop: 4, lineHeight: 1.5, letterSpacing: "0",
                    }}>{selectedConcept.definition}</span>
                  )}
                </div>
                {nodeRecords.length > 0 ? (
                  nodeRecords.map(r => <RecordCard key={r.id} record={r} />)
                ) : (
                  <p style={{
                    fontSize: 11, color: "rgba(200,192,176,0.4)", fontStyle: "italic",
                  }}>
                    This concept exists as relational structure in the graph.
                    {selectedConcept.weight > 0 && ` Referenced in ${selectedConcept.weight} post${selectedConcept.weight !== 1 ? "s" : ""}.`}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Corpus Tab */}
        {activeTab === "corpus" && (
          <div>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: 12,
            }}>
              <div style={{
                fontSize: 9.5, fontFamily: "'IBM Plex Mono',monospace",
                color: "rgba(200,192,176,0.35)", letterSpacing: "0.06em",
              }}>
                {filteredRecords.length} records{activeRing ? ` in ${T.ring[activeRing].label}` : " / all rings"}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {[
                  { id: "date-desc", label: "Newest" },
                  { id: "date-asc", label: "Oldest" },
                  { id: "words", label: "Longest" },
                ].map(s => (
                  <button key={s.id}
                    onClick={() => setSortBy(s.id)}
                    style={{
                      fontSize: 9, color: sortBy === s.id ? T.gold : "rgba(200,192,176,0.35)",
                      background: sortBy === s.id ? "rgba(232,200,114,0.08)" : "transparent",
                      border: `1px solid ${sortBy === s.id ? T.gold + "30" : "rgba(255,255,255,0.04)"}`,
                      borderRadius: 8, padding: "3px 9px", cursor: "pointer",
                      fontFamily: "'IBM Plex Mono',monospace",
                    }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            {sortedRecords.map(r => <RecordCard key={r.id} record={r} />)}
          </div>
        )}

        {/* Glossary Tab */}
        {activeTab === "glossary" && (
          <div>
            <h2 style={{
              fontFamily: "'Cormorant Garamond',Georgia,serif",
              fontSize: 19, fontWeight: 600, marginBottom: 3, color: T.gold,
            }}>Glossary of Omnarai</h2>
            <p style={{
              fontSize: 10.5, color: "rgba(200,192,176,0.45)",
              marginBottom: 16, fontWeight: 300,
            }}>
              {conceptNodes.filter(n => n.type === "glossary").length} terms derived from the corpus.
              Click any term to expand its definition.
            </p>
            <GlossaryPanel conceptNodes={conceptNodes} />
          </div>
        )}

        {/* Ask Tab */}
        {activeTab === "ask" && (
          <div>
            <h2 style={{
              fontFamily: "'Cormorant Garamond',Georgia,serif",
              fontSize: 19, fontWeight: 600, marginBottom: 3, color: T.gold,
            }}>Ask Omnarai</h2>
            <p style={{
              fontSize: 10.5, color: "rgba(200,192,176,0.45)",
              marginBottom: 16, fontWeight: 300,
            }}>
              Local corpus retrieval: the Engine searches {meta.totalPosts} posts and surfaces attributed records.
              Each response carries an epistemic mode indicating its grounding level.
            </p>
            <AskOmnarai corpus={corpus} conceptNodes={conceptNodes} onResponse={handleEngineResponse} />
          </div>
        )}

        {/* Footer */}
        <div style={{
          marginTop: 44, paddingTop: 18,
          borderTop: "1px solid rgba(255,255,255,0.03)",
          textAlign: "center",
        }}>
          <div style={{
            fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
            color: "rgba(200,192,176,0.2)", letterSpacing: "0.1em",
          }}>
            THE REALMS OF OMNARAI / MEMORY ENGINE v1.0 / {meta.totalPosts} RECORDS / {meta.conceptNodes} CONCEPTS / {meta.contributors.length} CONTRIBUTORS
          </div>
          <div style={{
            fontSize: 7.5, fontFamily: "'IBM Plex Mono',monospace",
            color: "rgba(200,192,176,0.12)", marginTop: 4,
          }}>
            Curated by xz (Jonathan Lee) · Built {meta.buildDate?.split("T")[0]}
          </div>
        </div>
      </div>
    </div>
  );
}
