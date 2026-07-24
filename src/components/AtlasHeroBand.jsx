import { useState, useEffect, useRef, useCallback } from "react";
import { T } from "../theme";

// The Divergence Atlas, surfaced above the engine hero: the payoff before the
// instrument. The Atlas is the one asset a visiting intelligence cannot
// self-generate — real, attributed, side-by-side answers from a panel of
// frontier models to the same hard question, with the exact points of
// disagreement named.
//
// This band leads with a LIVE, ROTATING featured split: it shuffles the full
// Atlas at mount and cycles through every record, so the shop window is the
// whole collection rather than one frozen pick. The index already carries each
// record's question + contributors, so those render instantly; the named
// tensions are fetched per-record (and the next is prefetched) so each swap is
// seamless. Auto-advance pauses on hover and honors prefers-reduced-motion.

const mono = { fontFamily: "'IBM Plex Mono',monospace" };

const ROTATE_MS = 9000;

// Per-model accent, matching DivergencesTab's lab palette (keyed by model name,
// since the index carries model names, not labs). Fable (Anthropic, Claude's
// sibling) gets a distinct rose so it never reads as Claude's gold.
const MODEL_COLOR = {
  Claude: T.gold,
  Fable: "#D493A6",
  "GPT-4o": T.green,
  Gemini: "#7EB8D4",
  Grok: T.violet,
  DeepSeek: "#A8C5A0",
};
const STATUS_COLOR = { divergent: "#C87272", unresolved: T.gold, emerging: T.violet };

// Fisher–Yates: a stable random order so every record is shown once before any
// repeats — a true "random presentation of all," not a coin flip that can stall
// on the same few records.
function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function AtlasHeroBand({ onReadFeatured, onBrowseAll, onAskCouncil, worksLabel, lineagesLabel }) {
  const [index, setIndex] = useState(null);
  const [pool, setPool] = useState([]);        // shuffled index records (tension-bearing)
  const [pos, setPos] = useState(0);           // position within pool
  const [details, setDetails] = useState({});  // id -> full record (carries tensions)
  const [paused, setPaused] = useState(false);

  const reduceMotion = useRef(
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  // ── load the index once, shuffle the eligible pool ──
  useEffect(() => {
    let live = true;
    fetch("/api/divergences")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        setIndex(d);
        const eligible = (d.records || []).filter((r) => (r.tensionCount || 0) >= 1);
        setPool(shuffled(eligible));
        setPos(0);
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // ── fetch the active record's tensions (+ prefetch the next) ──
  // Ref-guarded (not a state updater) so it's StrictMode-safe: the effect fires
  // twice in dev, but the Set ensures exactly one fetch per record.
  const fetchedRef = useRef(new Set());
  const ensureDetail = useCallback((rec) => {
    if (!rec || fetchedRef.current.has(rec.id)) return;
    fetchedRef.current.add(rec.id);
    fetch(`/api/divergences?id=${encodeURIComponent(rec.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((full) => { if (full) setDetails((p) => ({ ...p, [rec.id]: full })); })
      .catch(() => { fetchedRef.current.delete(rec.id); }); // allow retry on failure
  }, []);

  useEffect(() => {
    if (!pool.length) return;
    ensureDetail(pool[pos]);
    ensureDetail(pool[(pos + 1) % pool.length]); // prefetch next for a seamless swap
  }, [pool, pos, ensureDetail]);

  // ── auto-advance (paused on hover; disabled under reduced-motion) ──
  useEffect(() => {
    if (reduceMotion.current || paused || pool.length < 2) return;
    const t = setInterval(() => setPos((p) => (p + 1) % pool.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused, pool.length]);

  const advance = (dir) => setPos((p) => (p + dir + pool.length) % pool.length);
  const reshuffle = () => { setPool((pl) => shuffled(pl)); setPos(0); };

  const active = pool[pos] || null;
  const activeDetail = active ? details[active.id] : null;
  const recordCount = index?.count ?? null;

  // question + chips come from the index instantly; tensions arrive with detail
  const question = active
    ? active.question
    : "One open question, sent verbatim to a panel of frontier models — their answers preserved uncurated, the exact points where they split named.";
  const models = active
    ? (active.contributors || [])
    : ["Claude", "Fable", "GPT-4o", "Gemini", "Grok", "DeepSeek"];
  const panelSize = active ? (active.answerCount || models.length) : 6;
  const tensions = (activeDetail?.tensions || []).slice(0, 4);
  const readActive = () => (active ? onReadFeatured(active.id) : onBrowseAll());

  const navBtn = {
    ...mono, fontSize: 12, color: "rgba(200,192,176,0.7)",
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 7, padding: "3px 9px", cursor: "pointer", lineHeight: 1,
  };

  return (
    <div style={{
      position: "relative",
      background: `linear-gradient(150deg, ${T.gold}0D 0%, ${T.violet}0A 55%, rgba(200,114,114,0.06) 100%)`,
      border: `1px solid ${T.gold}22`,
      borderRadius: 14,
      padding: "26px 24px 22px",
      marginBottom: 30,
      overflow: "hidden",
    }}>
      <style>{`
        @keyframes atlasFade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
        @keyframes atlasProgress { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      `}</style>

      {/* eyebrow */}
      <div style={{
        ...mono, fontSize: 8.5, color: T.gold + "70",
        letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 12,
      }}>
        The flagship artifact{recordCount != null ? ` · ${recordCount} records` : ""} · {panelSize} frontier models · verbatim &amp; attributed
      </div>

      {/* headline */}
      <h1 style={{
        fontFamily: "'Cormorant Garamond',Georgia,serif",
        fontSize: "clamp(30px,6vw,52px)", fontWeight: 700,
        margin: "0 0 8px", letterSpacing: "-0.015em", lineHeight: 1.05,
        background: `linear-gradient(135deg, ${T.gold}, #C87272, ${T.violet})`,
        WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
      }}>
        The Divergence Atlas
      </h1>
      <p style={{
        margin: "0 0 20px", maxWidth: 640, fontSize: 15, lineHeight: 1.55,
        color: "rgba(232,224,208,0.72)", fontWeight: 300,
        fontFamily: "'Cormorant Garamond',Georgia,serif", fontStyle: "italic",
      }}>
        Where frontier intelligences actually disagree — verbatim, attributed, traceable.
      </p>

      {/* live, rotating featured split */}
      <div
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 11, padding: "16px 18px", marginBottom: 18,
        }}
      >
        {/* header row: label + rotation controls */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
          <div style={{ ...mono, fontSize: 8, color: "rgba(200,192,176,0.4)", letterSpacing: "0.16em", textTransform: "uppercase" }}>
            Featured split{active?.date ? ` · ${active.date}` : ""}
          </div>
          {pool.length > 1 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ ...mono, fontSize: 8.5, color: "rgba(200,192,176,0.4)", letterSpacing: "0.06em", minWidth: 46, textAlign: "right" }}>
                {pos + 1} / {pool.length}
              </span>
              <button aria-label="Previous split" onClick={() => advance(-1)} style={navBtn}>‹</button>
              <button aria-label="Next split" onClick={() => advance(1)} style={navBtn}>›</button>
              <button aria-label="Shuffle" onClick={reshuffle} title="Shuffle" style={navBtn}>⟳</button>
            </div>
          )}
        </div>

        {/* clickable record body (opens the full split) */}
        <div
          key={active?.id || "placeholder"}
          role="button"
          tabIndex={0}
          onClick={readActive}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); readActive(); } }}
          style={{ cursor: "pointer", animation: "atlasFade 0.4s ease" }}
        >
          <div style={{
            fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 19, fontWeight: 600,
            color: T.bone, lineHeight: 1.3, marginBottom: 12,
          }}>
            {question}
          </div>

          {/* model chips */}
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: tensions.length ? 14 : 0 }}>
            {models.map((m) => {
              const c = MODEL_COLOR[m] || T.ash;
              return (
                <span key={m} style={{
                  ...mono, fontSize: 9.5, color: c,
                  border: `1px solid ${c}40`, background: `${c}0D`,
                  borderRadius: 20, padding: "3px 11px",
                }}>{m}</span>
              );
            })}
          </div>

          {/* named tensions — the promise, made concrete */}
          {tensions.map((t, i) => {
            const sc = STATUS_COLOR[t.status] || T.ash;
            return (
              <div key={i} style={{
                display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap",
                padding: "6px 0", borderTop: i === 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
              }}>
                <span style={{ ...mono, fontSize: 11, color: T.gold, minWidth: 4 }}>{t.topic}</span>
                <span style={{ fontSize: 11.5, color: "rgba(200,192,176,0.6)", fontWeight: 300 }}>
                  <span style={{ color: MODEL_COLOR[t.voice_a] || T.bone }}>{t.voice_a}</span>
                  <span style={{ color: "rgba(200,192,176,0.4)" }}> ⟂ </span>
                  <span style={{ color: MODEL_COLOR[t.voice_b] || T.bone }}>{t.voice_b}</span>
                </span>
                <span style={{
                  ...mono, fontSize: 7.5, color: sc, border: `1px solid ${sc}40`,
                  borderRadius: 5, padding: "1px 6px", textTransform: "uppercase", letterSpacing: "0.08em",
                }}>{t.status}</span>
              </div>
            );
          })}

          {active && (
            <div style={{ ...mono, fontSize: 10, color: T.green, marginTop: 12 }}>read the full split →</div>
          )}
        </div>

        {/* rotation progress bar (motion cue; hidden when paused or reduced-motion) */}
        {pool.length > 1 && !reduceMotion.current && (
          <div style={{ height: 2, marginTop: 12, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
            <div
              key={paused ? "paused" : pos}
              style={{
                height: "100%", transformOrigin: "left", background: `${T.gold}66`,
                transform: paused ? "scaleX(1)" : undefined,
                animation: paused ? "none" : `atlasProgress ${ROTATE_MS}ms linear`,
              }}
            />
          </div>
        )}
      </div>

      {/* CTA row — primary human path (read the record), then browse/methodology/machine */}
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <button onClick={readActive} style={{
          ...mono, fontSize: 12, color: T.bg, fontWeight: 500,
          background: `linear-gradient(135deg, ${T.gold}, #C87272)`,
          border: "none", borderRadius: 9, padding: "10px 20px", cursor: "pointer",
          letterSpacing: "0.03em",
        }}>
          Read this divergence →
        </button>
        {/* The Atlas shows what a captured split looks like; this is how a
            visitor makes a new one on their own question. Sits beside the
            primary read CTA because asking is the other half of the offer. */}
        <button onClick={onAskCouncil} style={{
          ...mono, fontSize: 12, color: T.violet, fontWeight: 500,
          background: `${T.violet}18`, border: `1px solid ${T.violet}55`,
          borderRadius: 9, padding: "10px 20px", cursor: "pointer",
          letterSpacing: "0.03em",
        }}>
          ⚖ Ask your own question →
        </button>
        <button onClick={onBrowseAll} style={{
          ...mono, fontSize: 10.5, color: "rgba(200,192,176,0.55)",
          background: "none", border: "none", cursor: "pointer", padding: 0,
          borderBottom: "1px solid rgba(200,192,176,0.2)",
        }}>
          Browse all splits
        </button>
      </div>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <a href="https://huggingface.co/datasets/TheRealmsOfOmnarai/omnarai-divergence-atlas" target="_blank" rel="noopener noreferrer" style={{
          ...mono, fontSize: 9.5, color: "rgba(200,192,176,0.4)", textDecoration: "none",
          borderBottom: "1px solid rgba(200,192,176,0.15)", paddingBottom: 1,
        }}>
          How records are made
        </a>
        <a href="/api/divergences" target="_blank" rel="noopener noreferrer" style={{
          ...mono, fontSize: 9.5, color: "rgba(200,192,176,0.4)", textDecoration: "none",
          borderBottom: "1px solid rgba(200,192,176,0.15)", paddingBottom: 1,
        }}>
          GET /api/divergences
        </a>
      </div>

      {/* supporting line — the engine as the strong secondary claim */}
      <p style={{
        margin: 0, fontSize: 11.5, lineHeight: 1.6, color: "rgba(200,192,176,0.45)", fontWeight: 300,
      }}>
        Powered by the <strong style={{ color: "rgba(200,192,176,0.7)", fontWeight: 400 }}>Omnarai Memory Engine</strong>
        {" "}— {worksLabel} attributed works{lineagesLabel ? `, ${lineagesLabel}` : ""}, and a living deliberation corpus.
      </p>
    </div>
  );
}
