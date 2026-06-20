import { useState, useEffect, useRef, useCallback } from "react";
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

// ── Repair loop ────────────────────────────────────────────────────────────────
// Each disposition turns a recorded tension into a generative act. Annotations
// write to the tension blob; council-review re-elicits the fault line live and
// deposits a divergence record; synthesis-drafted creates a pending proposal.
const DISPOSITIONS = [
  { id: "held",              label: "Hold",            hint: "Preserve as deliberately unresolved",                       gated: false },
  { id: "reclassified",      label: "Reclassify",      hint: "Mark one side as earlier-stage exploration",               gated: false },
  { id: "canon-note",        label: "Canon note",      hint: "Attach a curator ruling",                                  gated: false },
  { id: "crux",              label: "Diagnose crux",   hint: "Name what evidence would settle it — does not resolve; leaves the tension open", gated: false },
  { id: "synthesis-drafted", label: "Draft synthesis", hint: "Generate a reconciling/distinguishing entry (pending proposal)", gated: false },
  { id: "council-review",    label: "Council review",  hint: "Re-elicit the fault line from the live frontier council",  gated: true  },
];

function ResolutionBadge({ r }) {
  if (!r) return null;
  const link = r.divergenceId
    ? { label: r.divergenceId, href: `/api/divergences?id=${r.divergenceId}` }
    : null;
  return (
    <div style={{
      marginTop: 4, marginBottom: 10, padding: "8px 12px",
      background: "rgba(126,186,166,0.06)",
      border: "1px solid rgba(126,186,166,0.2)",
      borderRadius: 8,
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 8.5, ...mono, color: T.green, letterSpacing: "0.06em" }}>
          ✓ {String(r.disposition || "").toUpperCase().replace(/-/g, " ")}
        </span>
        <span style={{ fontSize: 9, ...mono, color: "rgba(200,192,176,0.4)" }}>
          {r.actor || "curator"} · {relativeTime(r.resolvedAt)}
        </span>
        {r.proposalId && (
          <span style={{ fontSize: 9, ...mono, color: T.gold + "90" }}>{r.proposalId} (pending)</span>
        )}
        {link && (
          <a href={link.href} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 9, ...mono, color: T.violet + "c0", textDecoration: "none" }}>
            {link.label} ↗
          </a>
        )}
        {r.reclassify?.downgraded_voice && (
          <span style={{ fontSize: 9, ...mono, color: "rgba(200,192,176,0.5)" }}>
            {r.reclassify.downgraded_voice} → {r.reclassify.to_stage || "exploration"}
          </span>
        )}
      </div>
      {r.note && (
        <div style={{ fontSize: 11, ...sans, color: "rgba(232,224,208,0.6)", lineHeight: 1.55, marginTop: 6 }}>
          {r.note}
        </div>
      )}
    </div>
  );
}

// The crux is NOT a resolution — the tension stays open. It's a falsifiability
// handle: what evidence would move each side, the decisive test, and whether the
// split is empirically decidable at all. Rendered violet (open/diagnostic), not
// green (resolved), so it never reads as "this is settled."
function CruxPanel({ c, voiceA, voiceB }) {
  if (!c) return null;
  const decColor = c.decidable === true ? T.green : c.decidable === false ? T.gold : "rgba(200,192,176,0.5)";
  const decLabel = c.decidable === true ? "DECIDABLE" : c.decidable === false ? "UNDECIDABLE" : "DECIDABILITY UNCLEAR";
  const rows = [
    { label: `What would move ${voiceA}`, value: c.wouldMoveA, color: T.gold },
    { label: `What would move ${voiceB}`, value: c.wouldMoveB, color: T.green },
    { label: "Decisive test",            value: c.decisiveTest, color: T.violet },
  ].filter(r => r.value);
  return (
    <div style={{
      marginTop: 4, marginBottom: 10, padding: "10px 12px",
      background: "rgba(160,137,201,0.06)",
      border: "1px solid rgba(160,137,201,0.2)",
      borderRadius: 8,
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 8.5, ...mono, color: T.violet, letterSpacing: "0.06em" }}>
          ⌖ CRUX — WHAT WOULD SETTLE THIS
        </span>
        <span
          style={{
            fontSize: 8, ...mono, color: decColor, letterSpacing: "0.06em",
            padding: "1px 6px", background: decColor + "14",
            border: `1px solid ${decColor}30`, borderRadius: 4,
          }}
          title={c.decidableNote || ""}
        >
          {decLabel}
        </span>
        <span style={{ fontSize: 9, ...mono, color: "rgba(200,192,176,0.4)" }}>
          {c.actor || "curator"} · {relativeTime(c.diagnosedAt)}
        </span>
      </div>
      {rows.map(r => (
        <div key={r.label} style={{ marginBottom: 7 }}>
          <div style={{ fontSize: 8, ...mono, color: r.color + "90", letterSpacing: "0.05em", marginBottom: 2 }}>
            {r.label}
          </div>
          <div style={{ fontSize: 11, ...sans, color: "rgba(232,224,208,0.7)", lineHeight: 1.55 }}>
            {r.value}
          </div>
        </div>
      ))}
      {c.decidable === false && c.decidableNote && (
        <div style={{ fontSize: 10, ...sans, color: "rgba(200,192,176,0.5)", lineHeight: 1.5, marginTop: 4, fontStyle: "italic" }}>
          {c.decidableNote}
        </div>
      )}
      {c.note && (
        <div style={{ fontSize: 11, ...sans, color: "rgba(232,224,208,0.6)", lineHeight: 1.55, marginTop: 6 }}>
          {c.note}
        </div>
      )}
    </div>
  );
}

function RepairPanel({ t, onRepaired }) {
  const [pending, setPending] = useState(null); // disposition id being composed
  const [note, setNote]       = useState("");
  const [downVoice, setDown]  = useState(t.voice_a);
  const [token, setToken]     = useState(() => {
    try { return localStorage.getItem("omnarai_curator_token") || ""; } catch { return ""; }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  const def = DISPOSITIONS.find(d => d.id === pending);

  async function submit() {
    setBusy(true); setErr(null);
    const headers = { "Content-Type": "application/json" };
    if (def?.gated && token) {
      headers.Authorization = `Bearer ${token}`;
      try { localStorage.setItem("omnarai_curator_token", token); } catch { /* ignore */ }
    }
    const payload = { action: "repair", key: t.key, disposition: pending, actor: "xz" };
    if (note.trim()) payload.note = note.trim();
    if (pending === "reclassified") payload.reclassify = { downgraded_voice: downVoice, to_stage: "exploration" };
    try {
      const r = await fetch("/api/tensions", { method: "POST", headers, body: JSON.stringify(payload) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setPending(null); setNote("");
      onRepaired && onRepaired();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const fieldStyle = {
    width: "100%", boxSizing: "border-box", fontSize: 11, ...sans,
    background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 6, padding: "6px 10px", color: "rgba(232,224,208,0.8)", outline: "none",
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
      <div style={{ fontSize: 8, ...mono, color: "rgba(200,192,176,0.3)", letterSpacing: "0.06em", marginBottom: 6 }}>
        Repair
      </div>

      {/* Disposition buttons */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {DISPOSITIONS.map(d => (
          <button
            key={d.id}
            onClick={() => { setErr(null); setPending(pending === d.id ? null : d.id); }}
            title={d.hint}
            style={{
              fontSize: 9.5, ...mono,
              color: pending === d.id ? T.gold : "rgba(200,192,176,0.5)",
              background: pending === d.id ? "rgba(232,200,114,0.08)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${pending === d.id ? T.gold + "30" : "rgba(255,255,255,0.06)"}`,
              borderRadius: 7, padding: "4px 10px", cursor: "pointer",
            }}
          >
            {d.gated ? "⚷ " : ""}{d.label}
          </button>
        ))}
      </div>

      {/* Composer for the chosen disposition */}
      {pending && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ fontSize: 10, ...sans, color: "rgba(200,192,176,0.45)", lineHeight: 1.5 }}>
            {def.hint}.
            {pending === "crux" && " This calls the model (~10–30s) to diagnose what would settle the disagreement. It does not resolve the tension — it stays open, now carrying a crux."}
            {pending === "council-review" && " This calls the live council (~10–45s) and writes a durable divergence record."}
            {pending === "synthesis-drafted" && " This drafts an entry and files it as a pending proposal for your approval."}
          </div>

          {pending === "reclassified" && (
            <select value={downVoice} onChange={e => setDown(e.target.value)} style={fieldStyle}>
              <option value={t.voice_a}>{t.voice_a} → earlier-stage exploration</option>
              <option value={t.voice_b}>{t.voice_b} → earlier-stage exploration</option>
            </select>
          )}

          {def.gated && (
            <input
              type="password" value={token} onChange={e => setToken(e.target.value)}
              placeholder="curator token (INGEST_SECRET)"
              style={{ ...fieldStyle, ...mono, fontSize: 10 }}
            />
          )}

          <textarea
            value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder={pending === "canon-note" ? "curator ruling…" : "note (optional)…"}
            style={{ ...fieldStyle, resize: "vertical" }}
          />

          {err && (
            <div style={{ fontSize: 10, ...mono, color: "#E87272" }}>{err}</div>
          )}

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              onClick={submit}
              disabled={busy || (def.gated && !token.trim())}
              style={{
                fontSize: 10, ...mono,
                color: busy ? "rgba(200,192,176,0.4)" : T.green,
                background: "rgba(126,186,166,0.1)",
                border: `1px solid ${T.green}35`, borderRadius: 7,
                padding: "5px 14px", cursor: busy ? "wait" : "pointer",
                opacity: (def.gated && !token.trim()) ? 0.5 : 1,
              }}
            >
              {busy
                ? (pending === "council-review" ? "convening council…" : pending === "synthesis-drafted" ? "drafting…" : pending === "crux" ? "diagnosing…" : "saving…")
                : "Confirm"}
            </button>
            <button
              onClick={() => { setPending(null); setNote(""); setErr(null); }}
              disabled={busy}
              style={{
                fontSize: 10, ...mono, color: "rgba(200,192,176,0.4)",
                background: "transparent", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 7, padding: "5px 12px", cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TensionCard({ t, onQueryClick, onRepaired }) {
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
          {t.crux && !t.resolution && (
            <span style={{
              fontSize: 7.5, ...mono, color: T.violet, letterSpacing: "0.08em",
              padding: "2px 7px", background: "rgba(160,137,201,0.1)",
              border: "1px solid rgba(160,137,201,0.25)", borderRadius: 4,
            }} title="Crux diagnosed — what would settle this (tension still open)">
              ⌖ CRUX
            </span>
          )}
          {t.resolution && (
            <span style={{
              fontSize: 7.5, ...mono, color: T.green, letterSpacing: "0.08em",
              padding: "2px 7px", background: "rgba(126,186,166,0.1)",
              border: "1px solid rgba(126,186,166,0.25)", borderRadius: 4,
            }} title={`Resolved: ${t.resolution.disposition}`}>
              ✓ {String(t.resolution.disposition).toUpperCase().replace(/-/g, " ")}
            </span>
          )}
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
          {/* Resolution (if repaired) */}
          <ResolutionBadge r={t.resolution} />

          {/* Crux (if diagnosed) — tension stays open, now with what would settle it */}
          <CruxPanel c={t.crux} voiceA={t.voice_a} voiceB={t.voice_b} />

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

          {/* Repair actions — close the loop on this tension */}
          <RepairPanel t={t} onRepaired={onRepaired} />
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
  const [stateFilter, setStateFilter] = useState("all"); // all | open | resolved
  const [search, setSearch]         = useState("");
  const [debouncedSearch, setDebounced] = useState("");
  const debounceRef = useRef(null);

  // Single fetch path — reused by the filter effect, the refresh button, and
  // the post-repair refresh so a repaired tension re-renders with its resolution.
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    return fetch(`/api/tensions${params.toString() ? "?" + params : ""}`)
      .then(r => r.json())
      .then(d => { setTensions(d.tensions || []); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [statusFilter]);

  // Debounce search input
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebounced(search), 350);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Fetch on status-filter change (keyword + state filtering are client-side)
  useEffect(() => { load(); }, [load]);

  // Client-side keyword + open/resolved filter
  const visible = tensions.filter(t => {
    if (stateFilter === "open" && t.resolution) return false;
    if (stateFilter === "resolved" && !t.resolution) return false;
    if (debouncedSearch.trim()) {
      const hay = `${t.topic} ${t.voice_a} ${t.voice_b} ${t.claim_a} ${t.claim_b} ${(t.queries || []).join(" ")}`.toLowerCase();
      if (!hay.includes(debouncedSearch.toLowerCase())) return false;
    }
    return true;
  });

  // Counts per status for badge display
  const counts = tensions.reduce((acc, t) => {
    acc[t.status] = (acc[t.status] || 0) + 1;
    return acc;
  }, {});
  const resolvedCount = tensions.filter(t => t.resolution).length;

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

        {/* Open / Resolved state filter */}
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { id: "all",      label: "All",      count: tensions.length },
            { id: "open",     label: "Open",     count: tensions.length - resolvedCount },
            { id: "resolved", label: "Resolved", count: resolvedCount },
          ].map(f => {
            const active = stateFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setStateFilter(f.id)}
                style={{
                  fontSize: 9.5, ...mono,
                  color: active ? T.green : "rgba(200,192,176,0.4)",
                  background: active ? "rgba(126,186,166,0.08)" : "transparent",
                  border: `1px solid ${active ? T.green + "30" : "rgba(255,255,255,0.04)"}`,
                  borderRadius: 8, padding: "4px 10px", cursor: "pointer",
                  letterSpacing: "0.04em",
                }}
              >
                {f.label}
                {f.count > 0 && (
                  <span style={{ marginLeft: 5, fontSize: 8, color: active ? T.green : "rgba(200,192,176,0.25)" }}>
                    {f.count}
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
          onClick={() => load()}
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
        <TensionCard key={t.key} t={t} onQueryClick={onQueryClick} onRepaired={load} />
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
