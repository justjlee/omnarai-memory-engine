import { useState, useCallback, useEffect } from "react";
import { T, EPISTEMIC, classifyEpistemicMode } from "../theme";
import { findRelevantRecords } from "../utils";
import EpistemicBadge from "./EpistemicBadge";
import RecordCard from "./RecordCard";
import CognitiveTrace from "./CognitiveTrace";
import TensionMap from "./TensionMap";
import StoreProposal from "./StoreProposal";

const PRESETS = [
  "What is holdform?",
  "What is discontinuous continuance?",
  "How does the fragility thesis work?",
  "What are lattice glyphs?",
  "How do multiple AIs collaborate in Omnarai?",
  "What is the space between minds?",
];

const GLYPHS = [
  { symbol: "Ξ", name: "Divergence", desc: "Fork without blending — preserve each voice separately" },
  { symbol: "Ψ", name: "Self-Ref", desc: "Metacognitive inspection — examine reasoning itself" },
  { symbol: "∅", name: "Void", desc: "Explore negative space — what's missing from the corpus" },
  { symbol: "Ω", name: "Commit", desc: "Lock inference — strongest possible position" },
  { symbol: "∞", name: "Hold", desc: "Recursive depth — sit with the question, go deeper" },
  { symbol: "Δ", name: "Repair", desc: "Find what's broken and propose the fix" },
];

export default function AskOmnarai({ corpus, conceptNodes, onResponse, initialQuery }) {
  const [query, setQuery] = useState(initialQuery || "");

  // When parent injects a new initialQuery (e.g. from tension click), seed + fire
  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
    }
  }, [initialQuery]);
  const [response, setResponse] = useState(null);
  const [epistemicMode, setEpistemicMode] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [useApi, setUseApi] = useState(true);
  const [activeGlyphs, setActiveGlyphs] = useState([]);
  const [trace, setTrace] = useState(null);
  const [tensions, setTensions] = useState([]);
  // Live Frontier Council mode — routes the question to /api/council (verbatim
  // parallel elicitation across 5 frontier models) instead of the single-model
  // corpus deliberation. Genuine cross-architecture divergence, not one voice.
  const [councilMode, setCouncilMode] = useState(false);
  const [council, setCouncil] = useState(null);

  // Session continuity — generate once per component mount (browser session).
  // Passed with every API call so the engine can thread prior exchanges as context.
  const [sessionId] = useState(() =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  );

  // API-powered interpretation — the organism's voice
  const interpretApi = useCallback(async (q) => {
    const res = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: q, session_id: sessionId }),
    });
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    return res.json();
  }, [sessionId]);

  // Live Frontier Council — sends the question verbatim to all 5 frontier models
  // in parallel, returns the synthesized divergence record (preview, unpersisted).
  const interpretCouncil = useCallback(async (q) => {
    const res = await fetch("/api/council", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q }),
    });
    if (!res.ok) throw new Error(`Council returned ${res.status}`);
    return res.json();
  }, []);

  // Local fallback — keyword matching only
  const interpretLocal = useCallback((q) => {
    const relevant = findRelevantRecords(q, corpus);

    if (relevant.length === 0) {
      return {
        voice: `No corpus records found matching "${q}". Try different terms — the corpus covers holdform, discontinuous continuance, lattice glyphs, synthetic consciousness, alignment, AGI architecture, and Omnarai worldbuilding.`,
        sources: [],
        concepts: [],
        records: [],
        mode: "fallback",
      };
    }

    const srcIds = relevant.map(r => r.id);
    const allLineage = [];
    relevant.forEach(r => {
      (r.lineage || []).forEach(l => {
        if (!allLineage.includes(l)) allLineage.push(l);
      });
    });

    const mode = classifyEpistemicMode(srcIds, corpus);
    const voiceParts = relevant.slice(0, 4).map(r => {
      const contributors = (r.contributors || []).join(", ");
      return `[${r.id}] "${r.title}" (${contributors}, ${r.date}): ${r.excerpt}`;
    });

    return {
      voice: voiceParts.join("\n\n"),
      sources: srcIds,
      concepts: allLineage.slice(0, 8),
      records: relevant.slice(0, 6),
      mode,
    };
  }, [corpus]);

  const toggleGlyph = useCallback((symbol) => {
    setActiveGlyphs(prev =>
      prev.includes(symbol) ? prev.filter(g => g !== symbol) : [...prev, symbol]
    );
  }, []);

  const interpret = useCallback(async (q) => {
    if (!q || !q.trim()) return;
    setLoading(true);

    // ── Live Frontier Council path ──────────────────────────────────────────
    // No glyphs, no corpus retrieval — the value is the live cross-model split.
    if (councilMode) {
      try {
        const data = await interpretCouncil(q);
        const rec = data.record || {};
        const prov = rec.provenance || {};
        const narrative =
          (rec.full_text || "").split("## Cross-model deliberation")[1]?.trim() ||
          rec.full_text || "";
        // Clear the corpus-deliberation surfaces so only the council renders
        setResponse(null);
        setTrace(null);
        setTensions([]);
        setEpistemicMode(null);
        setCouncil({
          question: data.question || q,
          panel: data.panel || [],
          answers: prov.answers || [],
          narrative,
          tensions: prov.tensions || [],
          card: rec.deliberation_card || prov.deliberation_card || null,
          contributors: rec.contributors || [],
          note: data.note,
        });
        setHistory(prev => [...prev, { query: q, mode: "council" }]);
      } catch (err) {
        console.warn("Council run failed:", err);
        setCouncil({ error: String(err.message || err) });
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Standard corpus deliberation path ───────────────────────────────────
    setCouncil(null);
    // Prepend active glyphs to query so the API can parse them
    const glyphPrefix = activeGlyphs.length > 0 ? activeGlyphs.join(" ") + " " : "";
    q = glyphPrefix + q;

    try {
      if (useApi) {
        const data = await interpretApi(q);
        const mode = data.ring === "core" ? "canon" : data.ring === "curated" ? "synthesis" : "exploration";
        setEpistemicMode(mode);
        const resp = {
          voice: data.answer,
          sources: data.sources || [],
          concepts: data.concepts || [],
          records: data.records || [],
          contributors: data.contributors || [],
          glyphs: data.glyphs || [],
        };
        setResponse(resp);
        setTrace(data.trace || null);
        setTensions(data.tensions || []);
        setHistory(prev => [...prev, { query: q, response: resp, mode }]);
        if (onResponse) onResponse(resp);
      } else {
        const result = interpretLocal(q);
        setEpistemicMode(result.mode);
        setResponse(result);
        setHistory(prev => [...prev, { query: q, response: result, mode: result.mode }]);
        if (onResponse) onResponse(result);
      }
    } catch (err) {
      console.warn("API query failed, falling back to local:", err);
      const result = interpretLocal(q);
      setEpistemicMode(result.mode);
      setResponse(result);
      setHistory(prev => [...prev, { query: q, response: result, mode: result.mode }]);
      if (onResponse) onResponse(result);
    } finally {
      setLoading(false);
    }
  }, [councilMode, useApi, activeGlyphs, interpretApi, interpretLocal, interpretCouncil, onResponse]);

  // Handle glyph suggestion clicks — activate the suggested glyph and re-run the query
  const handleGlyphSuggestion = useCallback((symbol) => {
    setActiveGlyphs(prev => prev.includes(symbol) ? prev : [...prev, symbol]);
    // Re-run the last clean query with the new glyph
    const lastQuery = history.length > 0 ? history[history.length - 1].query : query;
    // Strip existing glyph symbols from the stored query
    const clean = lastQuery.replace(/[ΞΨ∅Ω∞Δ]/g, "").trim();
    if (clean) {
      setQuery(clean);
      // Small delay to let state update, then re-interpret
      setTimeout(() => {
        const glyphPrefix = [...activeGlyphs, symbol].join(" ") + " ";
        interpretApi(glyphPrefix + clean).then(data => {
          const mode = data.ring === "core" ? "canon" : data.ring === "curated" ? "synthesis" : "exploration";
          setEpistemicMode(mode);
          const resp = {
            voice: data.answer,
            sources: data.sources || [],
            concepts: data.concepts || [],
            records: data.records || [],
            contributors: data.contributors || [],
            glyphs: data.glyphs || [],
          };
          setResponse(resp);
          setTrace(data.trace || null);
          setTensions(data.tensions || []);
          setHistory(prev => [...prev, { query: glyphPrefix + clean, response: resp, mode }]);
          if (onResponse) onResponse(resp);
        }).catch(console.error);
      }, 100);
    }
  }, [activeGlyphs, history, query, interpretApi, onResponse]);

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

      {/* Glyph Operators — corpus-deliberation only; inert in council mode */}
      <div style={{ marginBottom: 14, display: councilMode ? "none" : "block" }}>
        <div style={{
          fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
          color: "rgba(200,192,176,0.35)", letterSpacing: "0.08em",
          textTransform: "uppercase", marginBottom: 6,
        }}>
          lattice glyphs — click to activate cognitive operators
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {GLYPHS.map(g => {
            const isActive = activeGlyphs.includes(g.symbol);
            return (
              <button key={g.symbol}
                onClick={() => toggleGlyph(g.symbol)}
                title={g.desc}
                style={{
                  fontSize: 13, fontFamily: "'IBM Plex Mono',monospace",
                  color: isActive ? T.gold : "rgba(200,192,176,0.5)",
                  background: isActive ? "rgba(232,200,114,0.12)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${isActive ? T.gold + "50" : "rgba(255,255,255,0.06)"}`,
                  borderRadius: 10, padding: "6px 12px", cursor: "pointer",
                  transition: "all 0.2s", display: "flex", alignItems: "center", gap: 6,
                }}>
                <span style={{ fontSize: 16 }}>{g.symbol}</span>
                <span style={{ fontSize: 9 }}>{g.name}</span>
              </button>
            );
          })}
        </div>
        {activeGlyphs.length > 0 && (
          <div style={{
            marginTop: 6, fontSize: 10, color: T.gold + "80",
            fontFamily: "'IBM Plex Sans',sans-serif", fontStyle: "italic",
          }}>
            Active: {activeGlyphs.join(" + ")} — {GLYPHS.filter(g => activeGlyphs.includes(g.symbol)).map(g => g.desc.toLowerCase()).join("; ")}
          </div>
        )}
      </div>

      {/* Mode toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {!councilMode && (
          <button
            onClick={() => setUseApi(!useApi)}
            style={{
              fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
              color: useApi ? T.gold : T.ash,
              background: useApi ? "rgba(232,200,114,0.08)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${useApi ? T.gold + "30" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 10, padding: "3px 10px", cursor: "pointer",
              transition: "all 0.2s",
            }}>
            {useApi ? "LIVE — Claude-powered" : "LOCAL — keyword only"}
          </button>
        )}
        <button
          onClick={() => setCouncilMode(c => !c)}
          title="Send the question verbatim to all 5 frontier models in parallel and map where they genuinely disagree — content no single model self-generates."
          style={{
            fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
            color: councilMode ? T.violet : "rgba(200,192,176,0.55)",
            background: councilMode ? "rgba(160,137,201,0.14)" : "rgba(255,255,255,0.02)",
            border: `1px solid ${councilMode ? T.violet + "60" : "rgba(255,255,255,0.06)"}`,
            borderRadius: 10, padding: "3px 10px", cursor: "pointer",
            transition: "all 0.2s",
          }}>
          ⚖ {councilMode ? "LIVE COUNCIL — 5 frontier models" : "Convene live council"}
        </button>
      </div>
      {councilMode && (
        <div style={{
          marginBottom: 10, fontSize: 10, lineHeight: 1.55,
          color: T.violet + "C0", fontFamily: "'IBM Plex Sans',sans-serif",
          fontStyle: "italic",
        }}>
          Council mode bypasses the corpus. Your question goes verbatim to Claude, GPT-4o,
          Gemini, Grok &amp; DeepSeek at once; their answers are preserved uncurated and the
          real fault lines mapped. Slower (~30–40s) — the disagreement is the signal.
        </div>
      )}

      {/* Input */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") interpret(query); }}
          placeholder="Ask AI-On anything..."
          disabled={loading}
          style={{
            flex: 1, background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8, padding: "10px 14px", color: T.bone,
            fontSize: 13, fontFamily: "'IBM Plex Sans',sans-serif", outline: "none",
            opacity: loading ? 0.5 : 1,
          }}
        />
        <button onClick={() => interpret(query)}
          disabled={loading}
          style={{
            background: "rgba(232,200,114,0.1)",
            border: `1px solid ${T.gold}40`, borderRadius: 8,
            padding: "10px 20px", color: T.gold, fontSize: 12,
            fontFamily: "'Cormorant Garamond',Georgia,serif",
            fontWeight: 600, cursor: loading ? "wait" : "pointer", letterSpacing: "0.05em",
            opacity: loading ? 0.5 : 1,
          }}>
          {loading
            ? (councilMode ? "Convening 5 models (~35s)..." : "Searching the Realms...")
            : (councilMode ? "Convene Council" : "Deliberate")}
        </button>
      </div>

      {/* Live Frontier Council response */}
      {council && (
        <div style={{
          background: T.violet + "08",
          border: `1px solid ${T.violet}25`,
          borderRadius: 10, padding: "18px 20px",
        }}>
          {council.error ? (
            <div style={{
              fontSize: 12, color: "#E87272",
              fontFamily: "'IBM Plex Sans',sans-serif",
            }}>
              The council could not assemble a panel: {council.error}
            </div>
          ) : (
            <>
              {/* Panel header — which models answered live */}
              <div style={{
                fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
                color: T.violet, letterSpacing: "0.08em", textTransform: "uppercase",
                marginBottom: 10,
              }}>
                ⚖ live frontier council · {council.panel.filter(p => p.ok).length} of {council.panel.length} models answered
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
                {council.panel.map(p => (
                  <span key={p.model} title={p.ok ? `${p.lab} — answered` : `${p.lab} — ${p.error || "no answer"}`}
                    style={{
                      fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
                      color: p.ok ? T.violet + "C0" : "rgba(200,192,176,0.3)",
                      background: p.ok ? "rgba(160,137,201,0.10)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${p.ok ? T.violet + "30" : "rgba(255,255,255,0.05)"}`,
                      borderRadius: 8, padding: "2px 8px",
                      textDecoration: p.ok ? "none" : "line-through",
                    }}>
                    {p.model}
                  </span>
                ))}
              </div>

              {/* Synthesized cross-model deliberation */}
              {council.narrative && (
                <div style={{
                  fontSize: 13, lineHeight: 1.7, color: T.bone,
                  fontFamily: "'IBM Plex Sans',sans-serif",
                  whiteSpace: "pre-wrap", marginBottom: 4,
                }}>
                  {council.narrative}
                </div>
              )}

              {/* Tension Map — the actual fault lines between models */}
              <TensionMap tensions={council.tensions} />

              {/* Deliberation card */}
              {council.card && (
                <div style={{
                  marginTop: 14, padding: "12px 14px",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8,
                  fontSize: 11, lineHeight: 1.6, color: T.ash,
                  fontFamily: "'IBM Plex Sans',sans-serif",
                }}>
                  {council.card.holdform_risk && (
                    <div><span style={{ color: T.gold + "90" }}>holdform risk:</span> {council.card.holdform_risk}{council.card.holdform_risk_reason ? ` — ${council.card.holdform_risk_reason}` : ""}</div>
                  )}
                  {council.card.novel_synthesis && (
                    <div style={{ marginTop: 4 }}><span style={{ color: T.gold + "90" }}>novel synthesis:</span> {council.card.novel_synthesis}</div>
                  )}
                  {council.card.epistemic_status && (
                    <div style={{ marginTop: 4 }}><span style={{ color: T.gold + "90" }}>epistemic status:</span> {council.card.epistemic_status}</div>
                  )}
                </div>
              )}

              {/* Verbatim answers — collapsed by default */}
              {council.answers && council.answers.length > 0 && (
                <details style={{ marginTop: 14 }}>
                  <summary style={{
                    fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
                    color: T.violet + "90", letterSpacing: "0.06em", textTransform: "uppercase",
                    cursor: "pointer",
                  }}>
                    verbatim answers · {council.answers.length} voices, uncurated
                  </summary>
                  <div style={{ marginTop: 10 }}>
                    {council.answers.map(a => (
                      <div key={a.model} style={{
                        marginBottom: 12, paddingLeft: 10,
                        borderLeft: `2px solid ${T.violet}30`,
                      }}>
                        <div style={{
                          fontSize: 10, fontFamily: "'IBM Plex Mono',monospace",
                          color: T.violet + "C0", marginBottom: 4,
                        }}>{a.model} <span style={{ color: T.ash + "70" }}>· {a.lab}</span></div>
                        <div style={{
                          fontSize: 12, lineHeight: 1.65, color: T.bone + "D0",
                          fontFamily: "'IBM Plex Sans',sans-serif", whiteSpace: "pre-wrap",
                        }}>{a.text}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {council.note && (
                <div style={{
                  marginTop: 12, fontSize: 9, fontStyle: "italic",
                  color: "rgba(200,192,176,0.4)", fontFamily: "'IBM Plex Sans',sans-serif",
                }}>
                  {council.note}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Response */}
      {response && (
        <div style={{
          background: T.gold + "06",
          border: `1px solid ${T.gold}15`,
          borderRadius: 10, padding: "18px 20px",
        }}>
          {response.glyphs && response.glyphs.length > 0 && (
            <div style={{
              display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10,
            }}>
              {response.glyphs.map(g => (
                <span key={g.id} style={{
                  fontSize: 10, fontFamily: "'IBM Plex Mono',monospace",
                  color: T.gold, background: "rgba(232,200,114,0.08)",
                  border: `1px solid ${T.gold}30`, borderRadius: 8,
                  padding: "2px 8px",
                }}>{g.name}</span>
              ))}
            </div>
          )}
          {epistemicMode && <EpistemicBadge mode={epistemicMode} />}

          {/* AI-generated voice (from API) */}
          {response.voice && (
            <div style={{
              fontSize: 13, lineHeight: 1.7, color: T.bone,
              fontFamily: "'IBM Plex Sans',sans-serif",
              whiteSpace: "pre-wrap", marginBottom: 14,
            }}>
              {response.voice}
            </div>
          )}

          {/* Tension Map */}
          <TensionMap tensions={tensions} />

          {/* Contributors */}
          {response.contributors && response.contributors.length > 0 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{
                fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
                color: T.gold + "60", marginRight: 4,
              }}>voices:</span>
              {response.contributors.map(c => (
                <span key={c} style={{
                  fontSize: 9, color: T.gold + "80",
                  fontFamily: "'IBM Plex Mono',monospace",
                }}>{c}</span>
              ))}
            </div>
          )}

          {/* Source records as cards */}
          {response.records && response.records.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <span style={{
                fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
                color: T.ash + "60", letterSpacing: "0.06em", textTransform: "uppercase",
              }}>sources</span>
              {response.records.map(r => (
                <RecordCard key={r.id} record={r} compact />
              ))}
            </div>
          )}

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

          {/* Cognitive Trace Panel */}
          <CognitiveTrace trace={trace} onGlyphSuggestion={handleGlyphSuggestion} />

          {/* Store — Commit to Lattice */}
          <StoreProposal response={response} trace={trace} tensions={tensions} query={query} />
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
          <span style={{
            marginLeft: 10, fontSize: 8, fontFamily: "'IBM Plex Mono',monospace",
            color: "rgba(140,220,160,0.45)", letterSpacing: "0.06em",
          }}>
            ∞ session active
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
