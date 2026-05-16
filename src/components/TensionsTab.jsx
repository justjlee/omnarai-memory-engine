import { useState, useEffect, useRef } from "react";
import { T } from "../theme";

const STATUS = {
  divergent:  { color: "#E87272", label: "DIVERGENT",  bg: "rgba(232,114,114,0.07)", border: "rgba(232,114,114,0.18)" },
  unresolved: { color: T.violet,  label: "UNRESOLVED", bg: "rgba(160,137,201,0.07)", border: "rgba(160,137,201,0.18)" },
  emerging:   { color: T.green,   label: "EMERGING",   bg: "rgba(126,186,166,0.07)", border: "rgba(126,186,166,0.18)" },
};

const FILTERS = [
  { id: null,         label: "All" },
  { id: "unresolved", label: "Unresolved" },
  { id: "divergent",  label: "Divergent" },
  { id: "emerging",   label: "Emerging" },
];

const mono  = { fontFamily: "'IBM Plex Mono',monospace" };
const serif = { fontFamily: "'Cormorant Garamond',Georgia,serif" };
const sans  = { fontFamily: "'IBM Plex Sans',sans-serif" };

function relativeTime(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function TensionCard({ t, onQueryClick }) {
  const [open, setOpen] = useState(false);
  const s = STATUS[t.status] || STATUS.divergent;

  return (
    <div style={{
      background: s.bg,
      border: `1px solid ${s.border}`,
      borderRadius: 10,
      overflow: "hidden",
      marginBottom: 10,
    }}>
      {/* Topic bar */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "8px 14px", cursor: "pointer",
          borderBottom: `1px solid ${s.border}`,
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{
            ...serif, fontSize: 12.5, fontWeight: 600, color: s.color,
          }}>
            {t.topic}
          </span>
          {t.seenCount > 1 && (
            <span style={{
              fontSize: 8, ...mono, color: s.color + "70",
              background: s.color + "12", borderRadius: 4,
              padding: "1px 6px",
            }}>
              ×{t.seenCount}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{
            fontSize: 7.5, ...mono, color: s.color + "80", letterSpacing: "0.08em",
            padding: "2px 7px", background: s.color + "10", borderRadius: 4,
          }}>
            {s.label}
          </span>
          <span style={{ fontSize: 9, color: "rgba(200,192,176,0.25)", ...mono }}>
            {open ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {/* Claims */}
      <div style={{ display: "flex" }}>
        {/* Voice A */}
        <div style={{ flex: 1, padding: "10px 14px", borderRight: `1px solid ${s.border}` }}>
          <div style={{
            fontSize: 9, ...mono, color: T.gold + "80",
            letterSpacing: "0.04em", marginBottom: 4,
          }}>
            {t.voice_a}
          </div>
          <div style={{
            fontSize: 11.5, ...sans, color: "rgba(232,224,208,0.65)", lineHeight: 1.6,
          }}>
            {t.claim_a}
          </div>
        </div>

        {/* VS divider */}
        <div style={{
          width: 24, flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            border: `1.5px solid ${s.color}50`,
            position: "relative",
          }}>
            <div style={{
              position: "absolute", top: "50%",
              left: -6, right: -6, height: 1,
              background: s.color + "35",
            }} />
          </div>
        </div>

        {/* Voice B */}
        <div style={{ flex: 1, padding: "10px 14px" }}>
          <div style={{
            fontSize: 9, ...mono, color: T.green + "80",
            letterSpacing: "0.04em", marginBottom: 4,
          }}>
            {t.voice_b}
          </div>
          <div style={{
            fontSize: 11.5, ...sans, color: "rgba(232,224,208,0.65)", lineHeight: 1.6,
          }}>
            {t.claim_b}
          </div>
        </div>
      </div>

      {/* Expanded metadata */}
      {open && (
        <div style={{
          borderTop: `1px solid ${s.border}`,
          padding: "10px 14px",
          background: "rgba(0,0,0,0.12)",
        }}>
          {/* Provenance row */}
          <div style={{
            display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 10,
          }}>
            {[
              { label: "First seen", value: relativeTime(t.firstSeenAt) },
              { label: "Last seen",  value: relativeTime(t.lastSeenAt) },
              { label: "Occurrences", value: t.seenCount },
            ].map(m => (
              <div key={m.label}>
                <div style={{ fontSize: 8, ...mono, color: "rgba(200,192,176,0.3)", letterSpacing: "0.06em" }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 11, ...mono, color: "rgba(200,192,176,0.55)", marginTop: 2 }}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>

          {/* Sources */}
          {t.sources?.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{
                fontSize: 8, ...mono, color: "rgba(200,192,176,0.3)",
                letterSpacing: "0.06em", marginBottom: 4,
              }}>
                Sources
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {t.sources.map(src => (
                  <span key={src} style={{
                    fontSize: 9, ...mono, color: T.gold + "90",
                    background: T.gold + "0d", border: `1px solid ${T.gold}20`,
                    borderRadius: 4, padding: "1px 7px",
                  }}>
                    {src}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Triggering queries */}
          {t.queries?.length > 0 && (
            <div>
              <div style={{
                fontSize: 8, ...mono, color: "rgba(200,192,176,0.3)",
                letterSpacing: "0.06em", marginBottom: 6,
              }}>
                Triggered by
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {t.queries.map((q, i) => (
                  <div
                    key={i}
                    onClick={() => onQueryClick && onQueryClick(q)}
                    style={{
                      fontSize: 10.5, ...sans, color: "rgba(200,192,176,0.5)",
                      lineHeight: 1.5, cursor: onQueryClick ? "pointer" : "default",
                      padding: "3px 0",
                    }}
                    title={onQueryClick ? "Click to run this query in Ask AI-On" : undefined}
                  >
                    <span style={{ color: s.color + "60", ...mono, fontSize: 9 }}>›</span>{" "}
                    {q}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TensionsTab({ onQueryClick }) {
  const [tensions, setTensions]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [statusFilter, setStatus]   = useState(null);
  const [search, setSearch]         = useState("");
  const [debouncedSearch, setDebounced] = useState("");
  const debounceRef = useRef(null);

  // Debounce search input
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Fetch on filter change (status only — keyword filtering is client-side)
  useEffect(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    fetch(`/api/tensions${params.toString() ? "?" + params : ""}`)
      .then(r => r.json())
      .then(d => {
        setTensions(d.tensions || []);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [statusFilter]);

  // Client-side keyword filter
  const visible = debouncedSearch.trim()
    ? tensions.filter(t => {
        const hay = `${t.topic} ${t.voice_a} ${t.voice_b} ${t.claim_a} ${t.claim_b} ${(t.queries || []).join(" ")}`.toLowerCase();
        return hay.includes(debouncedSearch.toLowerCase());
      })
    : tensions;

  // Counts per status for badge display
  const counts = tensions.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{
          ...serif, fontSize: 22, fontWeight: 600, marginBottom: 4,
          color: "#E87272",
        }}>
          Tension Registry
        </h2>
        <p style={{
          fontSize: 11, color: "rgba(200,192,176,0.45)",
          marginBottom: 0, fontWeight: 300, lineHeight: 1.65,
        }}>
          Persistent cognitive gaps extracted from deliberations. Each tension is a named disagreement
          between contributors — deduped across queries, tracked over time. A tension seen multiple
          times is a tension the corpus has not resolved.
        </p>
      </div>

      {/* Filter + Search bar */}
      <div style={{
        display: "flex", gap: 8, flexWrap: "wrap",
        alignItems: "center", marginBottom: 16,
      }}>
        {/* Status filters */}
        <div style={{ display: "flex", gap: 4 }}>
          {FILTERS.map(f => {
            const active = statusFilter === f.id;
            const count = f.id ? (counts[f.id] || 0) : tensions.length;
            const s = f.id ? STATUS[f.id] : null;
            return (
              <button
                key={String(f.id)}
                onClick={() => setStatus(f.id)}
                style={{
                  fontSize: 9.5, ...mono,
                  color: active
                    ? (s?.color || T.gold)
                    : "rgba(200,192,176,0.4)",
                  background: active
                    ? (s ? s.bg : "rgba(232,200,114,0.08)")
                    : "transparent",
                  border: `1px solid ${active ? (s?.border || T.gold + "30") : "rgba(255,255,255,0.04)"}`,
                  borderRadius: 8, padding: "4px 10px", cursor: "pointer",
                  transition: "all 0.15s",
                  letterSpacing: "0.04em",
                }}
              >
                {f.label}
                {count > 0 && (
                  <span style={{
                    marginLeft: 5, fontSize: 8,
                    color: active ? (s?.color || T.gold) : "rgba(200,192,176,0.25)",
                  }}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Keyword search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="search topics, voices, claims…"
          style={{
            flex: 1, minWidth: 160,
            fontSize: 11, ...mono,
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 8, padding: "5px 12px",
            color: "rgba(200,192,176,0.7)",
            outline: "none",
          }}
        />

        {/* Refresh button */}
        <button
          onClick={() => {
            setLoading(true);
            const params = new URLSearchParams();
            if (statusFilter) params.set("status", statusFilter);
            fetch(`/api/tensions${params.toString() ? "?" + params : ""}`)
              .then(r => r.json())
              .then(d => { setTensions(d.tensions || []); setLoading(false); })
              .catch(() => setLoading(false));
          }}
          style={{
            fontSize: 9, ...mono, color: "rgba(200,192,176,0.35)",
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.04)",
            borderRadius: 8, padding: "4px 10px", cursor: "pointer",
          }}
        >
          ↺ refresh
        </button>
      </div>

      {/* Result count */}
      <div style={{
        fontSize: 9, ...mono, color: "rgba(200,192,176,0.25)",
        letterSpacing: "0.06em", marginBottom: 12,
      }}>
        {loading ? "fetching\u2026" : `${visible.length} tension${visible.length !== 1 ? "s" : ""}${debouncedSearch ? ` matching "${debouncedSearch}"` : ""}`}
      </div>

      {/* Error state */}
      {error && (
        <div style={{
          padding: "12px 16px", marginBottom: 12,
          background: "rgba(232,114,114,0.06)",
          border: "1px solid rgba(232,114,114,0.18)",
          borderRadius: 8, fontSize: 11, ...mono, color: "#E87272",
        }}>
          Failed to load tensions: {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{
              height: 80, borderRadius: 10,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.04)",
              animation: "pulse 1.4s ease-in-out infinite",
            }} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && visible.length === 0 && (
        <div style={{
          padding: "32px 20px", textAlign: "center",
          background: "rgba(255,255,255,0.01)",
          border: "1px solid rgba(255,255,255,0.04)",
          borderRadius: 10,
        }}>
          <div style={{
            fontSize: 9, ...mono, color: "rgba(200,192,176,0.25)",
            letterSpacing: "0.1em", marginBottom: 8,
          }}>
            {debouncedSearch ? "NO MATCHES" : "NO TENSIONS YET"}
          </div>
          <p style={{
            fontSize: 11.5, color: "rgba(200,192,176,0.4)", fontWeight: 300, margin: 0,
          }}>
            {debouncedSearch
              ? `Nothing matched "${debouncedSearch}". Try a different term.`
              : "Run some queries through Ask AI-On to surface disagreements. They'll appear here."}
          </p>
        </div>
      )}

      {/* Tension cards */}
      {!loading && visible.map(t => (
        <TensionCard key={t.key} t={t} onQueryClick={onQueryClick} />
      ))}

      {/* Footer note */}
      {!loading && visible.length > 0 && (
        <div style={{
          marginTop: 14, fontSize: 9, ...mono,
          color: "rgba(200,192,176,0.2)", letterSpacing: "0.06em",
          textAlign: "center",
        }}>
          TENSIONS PERSIST ACROSS QUERIES · DEDUPED BY VOICE PAIR + TOPIC ·{" "}
          <a
            href="/api/tensions?status=unresolved"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: T.violet + "60", textDecoration: "none" }}
          >
            GET /api/tensions
          </a>
        </div>
      )}
    </div>
  );
}
