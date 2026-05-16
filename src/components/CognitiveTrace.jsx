import { useState } from "react";
import { T } from "../theme";

export default function CognitiveTrace({ trace, onGlyphSuggestion }) {
  const [expanded, setExpanded] = useState(false);
  const [activeSection, setActiveSection] = useState("path");

  if (!trace) return null;

  const sections = [
    { id: "path", label: "Execution Path" },
    { id: "retrieval", label: "Retrieval" },
    { id: "glyphs", label: "Glyphs" },
    { id: "suggest", label: "Try Next" },
  ];

  return (
    <div style={{
      marginTop: 14,
      background: "rgba(255,255,255,0.015)",
      border: `1px solid rgba(160,137,201,0.15)`,
      borderRadius: 10,
      overflow: "hidden",
      transition: "all 0.3s ease",
    }}>
      {/* Header — always visible */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 14px",
          cursor: "pointer",
          transition: "background 0.2s",
        }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(160,137,201,0.05)"}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: T.violet,
            boxShadow: `0 0 6px ${T.violet}50`,
          }} />
          <span style={{
            fontSize: 9,
            fontFamily: "'IBM Plex Mono',monospace",
            color: T.violet + "90",
            letterSpacing: "0.08em",
          }}>
            COGNITIVE TRACE
          </span>
          {trace.glyphsDetected.length > 0 && (
            <span style={{
              fontSize: 9,
              fontFamily: "'IBM Plex Mono',monospace",
              color: T.gold + "70",
            }}>
              · {trace.glyphsDetected.map(g => g.name.split(" ")[0]).join(" + ")}
            </span>
          )}
          <span style={{
            fontSize: 9,
            fontFamily: "'IBM Plex Mono',monospace",
            color: "rgba(200,192,176,0.3)",
          }}>
            · {trace.retrievalScores.length} sources · {trace.searchTerms.length} terms
          </span>
        </div>
        <span style={{
          fontSize: 9,
          color: "rgba(200,192,176,0.3)",
          fontFamily: "'IBM Plex Mono',monospace",
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.2s",
        }}>▼</span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: "0 14px 14px" }}>
          {/* Section tabs */}
          <div style={{
            display: "flex", gap: 0, marginBottom: 12,
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}>
            {sections.map(s => (
              <button key={s.id}
                onClick={() => setActiveSection(s.id)}
                style={{
                  fontSize: 9,
                  fontFamily: "'IBM Plex Mono',monospace",
                  color: activeSection === s.id ? T.violet : "rgba(200,192,176,0.35)",
                  background: "none",
                  border: "none",
                  borderBottom: activeSection === s.id
                    ? `1px solid ${T.violet}`
                    : "1px solid transparent",
                  padding: "6px 12px",
                  cursor: "pointer",
                  letterSpacing: "0.04em",
                  transition: "all 0.2s",
                }}>
                {s.label}
                {s.id === "suggest" && trace.suggestedGlyphs.length > 0 && (
                  <span style={{
                    marginLeft: 4,
                    background: T.gold + "20",
                    color: T.gold,
                    borderRadius: 6,
                    padding: "1px 5px",
                    fontSize: 8,
                  }}>{trace.suggestedGlyphs.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Execution Path */}
          {activeSection === "path" && (
            <div>
              <div style={{
                fontSize: 8.5,
                fontFamily: "'IBM Plex Mono',monospace",
                color: "rgba(200,192,176,0.25)",
                letterSpacing: "0.06em",
                marginBottom: 8,
              }}>
                PROMPT MODE: {trace.promptMode}
              </div>
              {trace.executionPath.map((step, i) => (
                <div key={i} style={{
                  display: "flex",
                  gap: 8,
                  marginBottom: 4,
                  alignItems: "flex-start",
                }}>
                  <span style={{
                    fontSize: 8,
                    fontFamily: "'IBM Plex Mono',monospace",
                    color: T.violet + "50",
                    minWidth: 14,
                    textAlign: "right",
                  }}>{i + 1}</span>
                  <div style={{
                    width: 1,
                    minHeight: 14,
                    background: i < trace.executionPath.length - 1
                      ? `linear-gradient(180deg, ${T.violet}30, ${T.violet}10)`
                      : T.violet + "30",
                  }} />
                  <span style={{
                    fontSize: 10.5,
                    fontFamily: "'IBM Plex Sans',sans-serif",
                    color: "rgba(200,192,176,0.55)",
                    lineHeight: 1.5,
                  }}>{step}</span>
                </div>
              ))}
            </div>
          )}

          {/* Retrieval Scores */}
          {activeSection === "retrieval" && (
            <div>
              <div style={{
                fontSize: 8.5,
                fontFamily: "'IBM Plex Mono',monospace",
                color: "rgba(200,192,176,0.25)",
                letterSpacing: "0.06em",
                marginBottom: 8,
              }}>
                SEARCH: [{trace.searchTerms.join(", ")}] → {trace.retrievalScores.length} RESULTS
              </div>
              {trace.retrievalScores.map((r, i) => {
                const maxScore = trace.retrievalScores[0]?.score || 1;
                const barWidth = Math.max(5, (r.score / maxScore) * 100);
                const ringColor = T.ring[r.ring]?.color || T.ash;
                return (
                  <div key={r.id} style={{
                    marginBottom: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}>
                    <span style={{
                      fontSize: 8.5,
                      fontFamily: "'IBM Plex Mono',monospace",
                      color: T.violet + "60",
                      minWidth: 50,
                    }}>{r.id}</span>
                    <div style={{
                      flex: 1,
                      position: "relative",
                      height: 18,
                      background: "rgba(255,255,255,0.02)",
                      borderRadius: 4,
                      overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${barWidth}%`,
                        height: "100%",
                        background: `linear-gradient(90deg, ${ringColor}30, ${ringColor}15)`,
                        borderRadius: 4,
                        transition: "width 0.4s ease",
                      }} />
                      <span style={{
                        position: "absolute",
                        left: 6,
                        top: "50%",
                        transform: "translateY(-50%)",
                        fontSize: 9,
                        fontFamily: "'IBM Plex Sans',sans-serif",
                        color: "rgba(200,192,176,0.5)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "80%",
                      }}>
                        {r.title}
                      </span>
                    </div>
                    <span style={{
                      fontSize: 9,
                      fontFamily: "'IBM Plex Mono',monospace",
                      color: ringColor + "80",
                      minWidth: 24,
                      textAlign: "right",
                    }}>{r.score}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Glyphs */}
          {activeSection === "glyphs" && (
            <div>
              {trace.glyphsDetected.length === 0 ? (
                <div style={{
                  fontSize: 11,
                  color: "rgba(200,192,176,0.4)",
                  fontFamily: "'IBM Plex Sans',sans-serif",
                  fontStyle: "italic",
                  padding: "8px 0",
                }}>
                  No glyphs active — standard deliberation mode.
                  The system used Shared Ground / Points of Tension / What Remains Open / Direction.
                </div>
              ) : (
                trace.glyphsDetected.map(g => (
                  <div key={g.id} style={{
                    marginBottom: 12,
                    padding: "10px 12px",
                    background: `rgba(232,200,114,0.04)`,
                    border: `1px solid ${T.gold}15`,
                    borderRadius: 8,
                  }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      marginBottom: 6,
                    }}>
                      <span style={{
                        fontSize: 16,
                        fontFamily: "'IBM Plex Mono',monospace",
                        color: T.gold,
                      }}>{g.name.split(" ")[0]}</span>
                      <span style={{
                        fontSize: 11,
                        fontFamily: "'Cormorant Garamond',Georgia,serif",
                        fontWeight: 600,
                        color: T.gold,
                      }}>{g.name.split(" ").slice(1).join(" ")}</span>
                    </div>
                    <div style={{
                      fontSize: 10,
                      color: "rgba(200,192,176,0.45)",
                      fontFamily: "'IBM Plex Sans',sans-serif",
                      marginBottom: 6,
                    }}>{g.description}</div>
                    <div style={{
                      fontSize: 9,
                      fontFamily: "'IBM Plex Mono',monospace",
                      color: "rgba(200,192,176,0.3)",
                      lineHeight: 1.6,
                    }}>
                      <div style={{ color: T.violet + "60", marginBottom: 2 }}>PROMPT MODIFICATION:</div>
                      {g.effect.map((line, i) => (
                        <div key={i} style={{ paddingLeft: 8 }}>{line}</div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Glyph Suggestions */}
          {activeSection === "suggest" && (
            <div>
              {trace.suggestedGlyphs.length === 0 ? (
                <div style={{
                  fontSize: 11,
                  color: "rgba(200,192,176,0.4)",
                  fontFamily: "'IBM Plex Sans',sans-serif",
                  fontStyle: "italic",
                  padding: "8px 0",
                }}>
                  No additional glyph suggestions for this query.
                </div>
              ) : (
                <>
                  <div style={{
                    fontSize: 10.5,
                    color: "rgba(200,192,176,0.45)",
                    fontFamily: "'IBM Plex Sans',sans-serif",
                    marginBottom: 10,
                    lineHeight: 1.6,
                  }}>
                    The same question, asked through different operators, produces fundamentally different cognition.
                  </div>
                  {trace.suggestedGlyphs.map(s => (
                    <button key={s.symbol}
                      onClick={() => onGlyphSuggestion?.(s.symbol)}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        width: "100%",
                        textAlign: "left",
                        marginBottom: 8,
                        padding: "10px 12px",
                        background: "rgba(232,200,114,0.03)",
                        border: `1px solid ${T.gold}15`,
                        borderRadius: 8,
                        cursor: "pointer",
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = T.gold + "40";
                        e.currentTarget.style.background = "rgba(232,200,114,0.06)";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = T.gold + "15";
                        e.currentTarget.style.background = "rgba(232,200,114,0.03)";
                      }}
                    >
                      <span style={{
                        fontSize: 18,
                        fontFamily: "'IBM Plex Mono',monospace",
                        color: T.gold,
                        lineHeight: 1,
                      }}>{s.symbol}</span>
                      <div>
                        <div style={{
                          fontSize: 11,
                          fontFamily: "'IBM Plex Sans',sans-serif",
                          fontWeight: 500,
                          color: T.gold,
                          marginBottom: 2,
                        }}>Try with {s.name}</div>
                        <div style={{
                          fontSize: 10,
                          fontFamily: "'IBM Plex Sans',sans-serif",
                          color: "rgba(200,192,176,0.45)",
                          lineHeight: 1.5,
                        }}>{s.reason}</div>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
