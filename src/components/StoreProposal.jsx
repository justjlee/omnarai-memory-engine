import { useState } from "react";
import { T } from "../theme";

export default function StoreProposal({ response, trace, tensions, query }) {
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [editTitle, setEditTitle] = useState("");

  if (!response || !response.voice || !trace) return null;

  const cleanQuery = trace.cleanQuery || query;
  const defaultTitle = `Synthesis: ${cleanQuery}`;

  const handleCommit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/store?action=propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: cleanQuery,
          answer: response.voice,
          sources: response.sources || [],
          contributors: response.contributors || [],
          glyphs: response.glyphs || [],
          tensions: tensions || [],
          trace: {
            cleanQuery: trace.cleanQuery,
            retrievalScores: trace.retrievalScores || [],
            glyphsDetected: trace.glyphsDetected || [],
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setSubmitted(data.proposal);
        setShowPreview(false);
      } else {
        console.error("Store error:", data);
      }
    } catch (err) {
      console.error("Store failed:", err);
    } finally {
      setSubmitting(false);
    }
  };

  // Already submitted
  if (submitted) {
    return (
      <div style={{
        marginTop: 14,
        padding: "10px 14px",
        background: `rgba(126,186,166,0.06)`,
        border: `1px solid ${T.green}25`,
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: T.green,
          boxShadow: `0 0 6px ${T.green}50`,
        }} />
        <span style={{
          fontSize: 10,
          fontFamily: "'IBM Plex Mono',monospace",
          color: T.green + "90",
          letterSpacing: "0.04em",
        }}>
          STORED · {submitted.id} · Pending curator review
        </span>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14 }}>
      {/* Commit button */}
      {!showPreview && (
        <button
          onClick={() => { setEditTitle(defaultTitle); setShowPreview(true); }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "10px 14px",
            background: "rgba(126,186,166,0.04)",
            border: `1px solid ${T.green}20`,
            borderRadius: 8,
            cursor: "pointer",
            transition: "all 0.2s",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = T.green + "40";
            e.currentTarget.style.background = "rgba(126,186,166,0.08)";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = T.green + "20";
            e.currentTarget.style.background = "rgba(126,186,166,0.04)";
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" stroke={T.green} strokeWidth="1.2" />
            <line x1="7" y1="4" x2="7" y2="10" stroke={T.green} strokeWidth="1.2" strokeLinecap="round" />
            <line x1="4" y1="7" x2="10" y2="7" stroke={T.green} strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span style={{
            fontSize: 10,
            fontFamily: "'IBM Plex Mono',monospace",
            color: T.green + "90",
            letterSpacing: "0.06em",
          }}>
            COMMIT TO LATTICE
          </span>
          <span style={{
            fontSize: 9,
            fontFamily: "'IBM Plex Sans',sans-serif",
            color: "rgba(200,192,176,0.35)",
            marginLeft: "auto",
          }}>
            Propose this synthesis as a new corpus entry
          </span>
        </button>
      )}

      {/* Preview panel */}
      {showPreview && (
        <div style={{
          padding: "16px",
          background: "rgba(126,186,166,0.04)",
          border: `1px solid ${T.green}20`,
          borderRadius: 10,
        }}>
          <div style={{
            fontSize: 9,
            fontFamily: "'IBM Plex Mono',monospace",
            color: T.green + "80",
            letterSpacing: "0.08em",
            marginBottom: 12,
          }}>
            STORE · PREVIEW PROPOSED ENTRY
          </div>

          {/* Editable title */}
          <div style={{ marginBottom: 10 }}>
            <div style={{
              fontSize: 8.5,
              fontFamily: "'IBM Plex Mono',monospace",
              color: "rgba(200,192,176,0.3)",
              marginBottom: 4,
            }}>TITLE</div>
            <input
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 6,
                padding: "8px 10px",
                color: T.bone,
                fontSize: 12,
                fontFamily: "'IBM Plex Sans',sans-serif",
                outline: "none",
              }}
            />
          </div>

          {/* Metadata grid */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "6px 16px",
            marginBottom: 12,
          }}>
            <MetaRow label="RING" value="Open Exploration (default)" />
            <MetaRow label="TYPE" value="synthesis" />
            <MetaRow label="CONTRIBUTORS" value={(response.contributors || []).join(", ") || "—"} />
            <MetaRow label="SOURCES" value={`${(response.sources || []).length} records`} />
            <MetaRow label="GLYPHS" value={
              trace.glyphsDetected.length > 0
                ? trace.glyphsDetected.map(g => g.name.split(" ")[0]).join(" + ")
                : "None"
            } />
            <MetaRow label="TENSIONS" value={`${(tensions || []).length} detected`} />
            <MetaRow label="WORD COUNT" value={String(response.voice.split(/\s+/).length)} />
            <MetaRow label="QUERY" value={cleanQuery} />
          </div>

          {/* Excerpt preview */}
          <div style={{
            fontSize: 8.5,
            fontFamily: "'IBM Plex Mono',monospace",
            color: "rgba(200,192,176,0.3)",
            marginBottom: 4,
          }}>EXCERPT (first 300 chars)</div>
          <div style={{
            fontSize: 11,
            fontFamily: "'IBM Plex Sans',sans-serif",
            color: "rgba(200,192,176,0.5)",
            lineHeight: 1.6,
            padding: "8px 10px",
            background: "rgba(255,255,255,0.015)",
            borderRadius: 6,
            marginBottom: 14,
          }}>
            {response.voice.length > 300
              ? response.voice.slice(0, 297) + "..."
              : response.voice
            }
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => setShowPreview(false)}
              style={{
                fontSize: 10,
                fontFamily: "'IBM Plex Mono',monospace",
                color: "rgba(200,192,176,0.4)",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 6,
                padding: "6px 14px",
                cursor: "pointer",
              }}
            >
              CANCEL
            </button>
            <button
              onClick={handleCommit}
              disabled={submitting}
              style={{
                fontSize: 10,
                fontFamily: "'IBM Plex Mono',monospace",
                color: T.green,
                background: `rgba(126,186,166,0.10)`,
                border: `1px solid ${T.green}40`,
                borderRadius: 6,
                padding: "6px 14px",
                cursor: submitting ? "wait" : "pointer",
                opacity: submitting ? 0.5 : 1,
                letterSpacing: "0.04em",
              }}
            >
              {submitting ? "COMMITTING..." : "COMMIT"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaRow({ label, value }) {
  return (
    <div>
      <span style={{
        fontSize: 8,
        fontFamily: "'IBM Plex Mono',monospace",
        color: "rgba(200,192,176,0.25)",
        letterSpacing: "0.06em",
      }}>{label}: </span>
      <span style={{
        fontSize: 10,
        fontFamily: "'IBM Plex Sans',sans-serif",
        color: "rgba(200,192,176,0.5)",
      }}>{value}</span>
    </div>
  );
}
