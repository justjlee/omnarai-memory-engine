import { useState, useEffect, useCallback } from "react";
import { T } from "../theme";

const RING_OPTIONS = [
  { id: "open", label: "Open Exploration", color: T.violet },
  { id: "curated", label: "Curated Expansions", color: T.green },
  { id: "core", label: "Core Canon", color: T.gold },
];

const STATUS_COLORS = {
  pending: { color: T.gold, label: "PENDING" },
  approved: { color: T.green, label: "APPROVED" },
  rejected: { color: "#E87272", label: "REJECTED" },
};

export default function ProposalReview() {
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");
  const [expandedId, setExpandedId] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  const fetchProposals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/store?action=list&status=${filter}`);
      const data = await res.json();
      setProposals(data.proposals || []);
    } catch (err) {
      console.error("Failed to fetch proposals:", err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchProposals(); }, [fetchProposals]);

  const handleAction = async (id, action, extraData) => {
    setActionLoading(id);
    try {
      await fetch(`/api/store?action=${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...extraData }),
      });
      await fetchProposals();
    } catch (err) {
      console.error(`${action} failed:`, err);
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div>
      {/* Filter tabs */}
      <div style={{
        display: "flex", gap: 6, marginBottom: 16,
      }}>
        {["pending", "approved", "rejected"].map(s => {
          const sc = STATUS_COLORS[s];
          return (
            <button key={s}
              onClick={() => setFilter(s)}
              style={{
                fontSize: 9,
                fontFamily: "'IBM Plex Mono',monospace",
                color: filter === s ? sc.color : "rgba(200,192,176,0.35)",
                background: filter === s ? sc.color + "12" : "transparent",
                border: `1px solid ${filter === s ? sc.color + "30" : "rgba(255,255,255,0.04)"}`,
                borderRadius: 8,
                padding: "5px 12px",
                cursor: "pointer",
                letterSpacing: "0.06em",
                transition: "all 0.2s",
              }}
            >{sc.label}</button>
          );
        })}
      </div>

      {loading && (
        <div style={{
          fontSize: 11, color: "rgba(200,192,176,0.4)",
          fontStyle: "italic", padding: "20px 0",
        }}>Loading proposals...</div>
      )}

      {!loading && proposals.length === 0 && (
        <div style={{
          fontSize: 12, color: "rgba(200,192,176,0.4)",
          fontFamily: "'IBM Plex Sans',sans-serif",
          padding: "30px 0", textAlign: "center",
        }}>
          {filter === "pending"
            ? "No pending proposals. Use Ask AI-On and commit a synthesis to get started."
            : `No ${filter} proposals.`
          }
        </div>
      )}

      {/* Proposal cards */}
      {proposals.map(p => {
        const isExpanded = expandedId === p.id;
        const sc = STATUS_COLORS[p.provenance.status] || STATUS_COLORS.pending;
        const isActioning = actionLoading === p.id;

        return (
          <div key={p.id} style={{
            marginBottom: 10,
            background: "rgba(255,255,255,0.015)",
            border: `1px solid rgba(255,255,255,0.04)`,
            borderRadius: 10,
            overflow: "hidden",
            transition: "border-color 0.2s",
            borderLeftWidth: 3,
            borderLeftColor: sc.color + "40",
          }}>
            {/* Header */}
            <div
              onClick={() => setExpandedId(isExpanded ? null : p.id)}
              style={{
                padding: "10px 14px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span style={{
                fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
                color: sc.color + "80",
                letterSpacing: "0.06em",
                minWidth: 55,
              }}>{sc.label}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12,
                  fontFamily: "'IBM Plex Sans',sans-serif",
                  color: T.bone,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}>{p.title}</div>
                <div style={{
                  fontSize: 9,
                  fontFamily: "'IBM Plex Mono',monospace",
                  color: "rgba(200,192,176,0.3)",
                  marginTop: 2,
                }}>
                  {p.id} · {p.date} · {p.wordCount} words · {(p.contributors || []).join(", ")}
                </div>
              </div>
              <span style={{
                fontSize: 9, color: "rgba(200,192,176,0.25)",
                transform: isExpanded ? "rotate(180deg)" : "rotate(0)",
                transition: "transform 0.2s",
              }}>▼</span>
            </div>

            {/* Expanded content */}
            {isExpanded && (
              <div style={{ padding: "0 14px 14px" }}>
                {/* Provenance */}
                <div style={{
                  marginBottom: 10, padding: "8px 10px",
                  background: "rgba(255,255,255,0.015)",
                  borderRadius: 6,
                }}>
                  <div style={{
                    fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
                    color: T.violet + "60", letterSpacing: "0.06em", marginBottom: 6,
                  }}>PROVENANCE</div>
                  <ProvenanceRow label="Query" value={p.provenance.query} />
                  <ProvenanceRow label="Sources" value={(p.provenance.sourceIds || []).join(", ")} />
                  <ProvenanceRow label="Glyphs" value={(p.provenance.glyphsActive || []).join(", ") || "None"} />
                  <ProvenanceRow label="Tensions" value={`${p.provenance.tensionCount} detected`} />
                  <ProvenanceRow label="Generated" value={new Date(p.provenance.generatedAt).toLocaleString()} />
                  {p.provenance.approvedAt && (
                    <ProvenanceRow label="Approved" value={new Date(p.provenance.approvedAt).toLocaleString()} />
                  )}
                </div>

                {/* Excerpt */}
                <div style={{
                  fontSize: 11, fontFamily: "'IBM Plex Sans',sans-serif",
                  color: "rgba(200,192,176,0.55)", lineHeight: 1.6,
                  maxHeight: 150, overflow: "auto",
                  marginBottom: 12,
                }}>
                  {p.excerpt}
                </div>

                {/* Tensions */}
                {p.provenance.tensions && p.provenance.tensions.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{
                      fontSize: 8.5, fontFamily: "'IBM Plex Mono',monospace",
                      color: "#E87272" + "80", letterSpacing: "0.06em", marginBottom: 4,
                    }}>PRESERVED TENSIONS</div>
                    {p.provenance.tensions.map((t, i) => (
                      <div key={i} style={{
                        fontSize: 10, color: "rgba(200,192,176,0.45)",
                        fontFamily: "'IBM Plex Sans',sans-serif",
                        padding: "2px 0",
                      }}>
                        {t.topic}: {t.voice_a} vs {t.voice_b}
                      </div>
                    ))}
                  </div>
                )}

                {/* Actions for pending proposals */}
                {p.provenance.status === "pending" && (
                  <div style={{
                    display: "flex", gap: 8, alignItems: "center",
                    paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.03)",
                  }}>
                    {/* Ring selector */}
                    <div style={{ display: "flex", gap: 4 }}>
                      {RING_OPTIONS.map(ring => (
                        <button key={ring.id}
                          onClick={() => handleAction(p.id, "approve", { ring: ring.id })}
                          disabled={isActioning}
                          style={{
                            fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
                            color: ring.color,
                            background: ring.color + "10",
                            border: `1px solid ${ring.color}30`,
                            borderRadius: 6,
                            padding: "4px 10px",
                            cursor: isActioning ? "wait" : "pointer",
                            opacity: isActioning ? 0.5 : 1,
                          }}
                        >
                          APPROVE → {ring.label}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() => handleAction(p.id, "reject")}
                      disabled={isActioning}
                      style={{
                        fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
                        color: "#E87272",
                        background: "transparent",
                        border: "1px solid rgba(232,114,114,0.20)",
                        borderRadius: 6,
                        padding: "4px 10px",
                        cursor: isActioning ? "wait" : "pointer",
                        marginLeft: "auto",
                        opacity: isActioning ? 0.5 : 1,
                      }}
                    >
                      REJECT
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProvenanceRow({ label, value }) {
  return (
    <div style={{ marginBottom: 2 }}>
      <span style={{
        fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
        color: "rgba(200,192,176,0.3)", letterSpacing: "0.04em",
      }}>{label}: </span>
      <span style={{
        fontSize: 10, fontFamily: "'IBM Plex Sans',sans-serif",
        color: "rgba(200,192,176,0.5)",
      }}>{value}</span>
    </div>
  );
}
