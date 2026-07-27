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

// ── Markdown export ──────────────────────────────────────────────────────────
// Results must leave the UI intact: verbatim answers with model ids, tensions,
// synthesis clearly labeled as interpretation, and a provenance footer.

function councilToMarkdown(c) {
  const date = c.answers?.[0]?.date || new Date().toISOString().slice(0, 10);
  const voice = (a) => `${a.model} (${a.lab}${a.model_id ? ` · ${a.model_id}` : ""})`;
  const lines = [
    `# Live Frontier Council — ${date}`,
    ``,
    `**Question (sent verbatim to ${c.answers.length} frontier models):** ${c.question}`,
    ``,
    `**Panel:** ${c.answers.map(voice).join(", ")}`,
    ``,
    `## Verbatim answers — uncurated, the primary evidence`,
    ``,
  ];
  for (const a of c.answers) lines.push(`### ${voice(a)}`, ``, a.text, ``);
  if (c.tensions && c.tensions.length) {
    lines.push(`## Tension map`, ``);
    for (const t of c.tensions)
      lines.push(`- **${t.topic}** [${t.status}]: ${t.voice_a} — ${t.claim_a} ⇄ ${t.voice_b} — ${t.claim_b}`);
    lines.push(``);
  }
  if (c.narrative) lines.push(`## Cross-model deliberation — synthesized reading`, ``, c.narrative, ``);
  if (c.card) {
    lines.push(`## Deliberation card`, ``);
    if (c.card.holdform_risk) lines.push(`- holdform risk: ${c.card.holdform_risk}${c.card.holdform_risk_reason ? ` — ${c.card.holdform_risk_reason}` : ""}`);
    if (c.card.novel_synthesis) lines.push(`- novel synthesis: ${c.card.novel_synthesis}`);
    if (c.card.epistemic_status) lines.push(`- epistemic status: ${c.card.epistemic_status}`);
    lines.push(``);
  }
  lines.push(
    `---`,
    `Source: The Realms of Omnarai — Live Frontier Council (https://omnarai.vercel.app)`,
    `Method: verbatim parallel elicitation; answers preserved uncurated; synthesis maps disagreement, it does not resolve it.`
  );
  return lines.join("\n");
}

function deliberationToMarkdown(resp, { question, tensions, epistemicMode }) {
  const lines = [
    `# Omnarai deliberation — ${new Date().toISOString().slice(0, 10)}`,
    ``,
    `**Question:** ${question}`,
    ``,
  ];
  if (epistemicMode) lines.push(`**Epistemic mode:** ${epistemicMode}`, ``);
  if (resp.voice) lines.push(`## Answer`, ``, resp.voice, ``);
  if (tensions && tensions.length) {
    lines.push(`## Tension map`, ``);
    for (const t of tensions)
      lines.push(`- **${t.topic}** [${t.status}]: ${t.voice_a} — ${t.claim_a} ⇄ ${t.voice_b} — ${t.claim_b}`);
    lines.push(``);
  }
  if (resp.contributors && resp.contributors.length) lines.push(`**Voices:** ${resp.contributors.join(", ")}`, ``);
  if (resp.records && resp.records.length) {
    lines.push(`## Sources`, ``);
    for (const r of resp.records)
      lines.push(`- [${r.id}] "${r.title}" (${(r.contributors || []).join(", ")}, ${r.date})${r.permalink ? ` — ${r.permalink}` : ""}`);
    lines.push(``);
  }
  if (resp.concepts && resp.concepts.length) lines.push(`**Activated concepts:** ${resp.concepts.map((x) => `#${x}`).join(" ")}`, ``);
  lines.push(
    `---`,
    `Source: The Realms of Omnarai memory engine (https://omnarai.vercel.app) — a multi-AI attributed corpus.`
  );
  return lines.join("\n");
}

// Copy + download buttons for any result block. Clipboard first, textarea fallback.
function ExportBar({ getMarkdown, filename, accent }) {
  const [copied, setCopied] = useState(false);
  const btnStyle = {
    fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
    color: accent + "B0", background: "rgba(255,255,255,0.02)",
    border: `1px solid ${accent}30`, borderRadius: 8,
    padding: "3px 9px", cursor: "pointer", transition: "all 0.2s",
  };
  const copy = async () => {
    const md = getMarkdown();
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = md;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const download = () => {
    const blob = new Blob([getMarkdown()], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div style={{ display: "flex", gap: 5, marginLeft: "auto" }}>
      <button onClick={copy} style={btnStyle} title="Copy the full result as markdown — verbatim answers, tensions, synthesis, provenance">
        {copied ? "✓ copied" : "⧉ copy md"}
      </button>
      <button onClick={download} style={btnStyle} title="Download the full result as a .md file">
        ↓ .md
      </button>
    </div>
  );
}

// Per-visit utility receipt card — renders the engine's honest accounting of what
// the corpus actually changed about this answer. The null/marginal verdicts are
// shown as plainly as the wins (do-not-overclaim); not_self_generable is the
// genuinely non-self-generable payload, so it leads when present. The "run the
// counterfactual" button lets a visitor climb the evidence ladder: from the free
// deterministic receipt to the MEASURED baseline-vs-augmented trace, in one click.
const VERDICT_COLORS = { substantive: "#3fb950", marginal: "#d29922", "null": "#8b949e" };

function ReceiptCard({ receipt: r, query }) {
  const [trace, setTrace] = useState(null);
  const [tracing, setTracing] = useState(false);
  const [traceErr, setTraceErr] = useState(null);
  const color = VERDICT_COLORS[r.verdict] || "#8b949e";

  // Climb the ladder: submit the async counterfactual, then poll the job (mirrors
  // /try). Async because /api/trace runs 3 model calls (~30–40s) and would risk the
  // 60s serverless wall as a single blocking request.
  async function runCounterfactual() {
    if (tracing || !query) return;
    setTracing(true); setTraceErr(null); setTrace(null);
    try {
      const sub = await fetch(`/api/trace?async=1&q=${encodeURIComponent(query)}`, { headers: { accept: "application/json" } });
      if (!sub.ok) throw new Error(`trace returned ${sub.status}`);
      let data = await sub.json();
      if (data.job_id) {
        const deadline = Date.now() + 95000;
        while (Date.now() < deadline) {
          await new Promise(res => setTimeout(res, 3000));
          const s = await (await fetch(`/api/query?job=${encodeURIComponent(data.job_id)}`, { headers: { accept: "application/json" } })).json();
          if (s.status === "done") { data = s.result; break; }
          if (s.status === "error") throw new Error(s.error || "counterfactual failed");
        }
        if (data.job_id) throw new Error("counterfactual timed out (~95s)");
      }
      setTrace(data);
    } catch (e) {
      setTraceErr(String(e.message || e));
    } finally {
      setTracing(false);
    }
  }

  const tr = trace?.receipt || null;
  const d = trace?.delta || null;
  const tColor = tr ? (VERDICT_COLORS[tr.verdict] || "#8b949e") : "#8b949e";

  return (
    <div style={{ marginTop: 16, padding: "12px 14px", border: `1px solid ${color}33`, borderRadius: 8, background: "rgba(255,255,255,0.02)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "#8b949e" }}>
        utility receipt
        <span style={{ color, border: `1px solid ${color}55`, borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>{r.verdict}</span>
      </div>
      <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.5 }}>{r.what_the_corpus_added}</div>
      {Array.isArray(r.not_self_generable) && r.not_self_generable.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: "#8b949e" }}>What you couldn't have produced alone:</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {r.not_self_generable.map((t, i) => <li key={i} style={{ fontSize: 13 }}>{t}</li>)}
          </ul>
        </div>
      )}
      {r.caveat && <div style={{ marginTop: 8, fontSize: 11, color: "#6e7681", fontStyle: "italic" }}>{r.caveat}</div>}

      {/* Climb the ladder → measured counterfactual */}
      {!trace && query && (
        <button
          onClick={runCounterfactual}
          disabled={tracing}
          style={{ marginTop: 10, fontSize: 12, color: tracing ? "#6e7681" : color, background: "transparent", border: `1px solid ${color}44`, borderRadius: 6, padding: "4px 10px", cursor: tracing ? "default" : "pointer" }}
        >
          {tracing ? "Running the counterfactual… (~40s)" : "Run the counterfactual →"}
        </button>
      )}
      {traceErr && <div style={{ marginTop: 8, fontSize: 12, color: "#f85149" }}>Counterfactual failed: {traceErr}</div>}
      {trace && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${color}22` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, color: "#8b949e" }}>
            measured counterfactual
            <span style={{ color: tColor, border: `1px solid ${tColor}55`, borderRadius: 4, padding: "1px 6px", fontWeight: 600 }}>{tr?.verdict || "—"}</span>
          </div>
          {(tr?.what_the_corpus_added || d?.net_effect) && (
            <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>{tr?.what_the_corpus_added || d?.net_effect}</div>
          )}
          {Array.isArray(d?.added_considerations) && d.added_considerations.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 12, color: "#8b949e" }}>Considerations the corpus added:</div>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {d.added_considerations.slice(0, 4).map((c, i) => <li key={i} style={{ fontSize: 12 }}>{c}</li>)}
              </ul>
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: "#6e7681", fontStyle: "italic" }}>
            Measured single-run counterfactual (baseline vs augmented, one model) — stronger than the receipt above, weaker than the replicated utility-evidence.md.
          </div>
        </div>
      )}
    </div>
  );
}

export default function AskOmnarai({ corpus, conceptNodes, onResponse, initialQuery, councilIntent, worksLabel, defaultCouncil }) {
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
  const [receipt, setReceipt] = useState(null);
  const [tensions, setTensions] = useState([]);
  // Live Frontier Council mode — routes the question to /api/council (verbatim
  // parallel elicitation across 5 frontier models) instead of the single-model
  // corpus deliberation. Genuine cross-architecture divergence, not one voice.
  const [councilMode, setCouncilMode] = useState(Boolean(defaultCouncil));
  const [council, setCouncil] = useState(null);
  // Atlas proposal for the run just completed: {loading} | {result} | {error}
  const [proposal, setProposal] = useState(null);
  const [proposerName, setProposerName] = useState("");

  // Arriving from the front-page "Ask the Council" CTA. Keyed on a changing
  // timestamp rather than a boolean so a second click re-arms council mode even
  // if the visitor has since switched to corpus deliberation.
  useEffect(() => {
    if (councilIntent) setCouncilMode(true);
  }, [councilIntent]);

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
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // 429 is not a failure to explain away — it's a real, honest limit with
      // numbers attached. Surface it as such rather than as "council returned 429".
      if (res.status === 429 && data) {
        const err = new Error(data.error || "Daily council limit reached.");
        err.quota = data.quota;
        err.capped = true;
        throw err;
      }
      throw new Error(`Council returned ${res.status}`);
    }
    return data;
  }, []);

  // Propose the completed run's question for the Divergence Atlas. Sends only
  // the run_id — the server holds the answers, so nothing the client says can
  // become "verbatim" model text in the queue.
  const proposeToAtlas = useCallback(async (runId, proposer) => {
    setProposal({ loading: true });
    try {
      const res = await fetch("/api/propose-question", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "propose-question", run_id: runId, proposer: proposer || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!data) throw new Error(`Proposal returned ${res.status}`);
      setProposal({ result: data });
    } catch (err) {
      setProposal({ error: String(err.message || err) });
    }
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
          run_id: data.run_id || null,
          quota: data.quota || null,
        });
        setProposal(null);
        setHistory(prev => [...prev, { query: q, mode: "council" }]);
      } catch (err) {
        console.warn("Council run failed:", err);
        setCouncil({ error: String(err.message || err), capped: Boolean(err.capped), quota: err.quota || null });
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
        setReceipt(data.receipt || null);
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
          setReceipt(data.receipt || null);
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

      {/* ── Mode selector ────────────────────────────────────────────────────
          Was a 9px toggle chip below the glyph grid: the flagship live
          capability read as a mode switch on a secondary tool. These are now
          two peer instruments, council first, each stating plainly what it
          costs and what it gives back. */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          {
            on: councilMode, set: true, accent: T.violet, icon: "⚖",
            title: "Ask the Council",
            sub: "5 frontier models, live · ~35s",
            desc: "Your question goes verbatim to Claude, GPT-4o, Gemini, Grok & DeepSeek at once. Their answers are kept uncurated and the real fault lines named. This is the thing no single model can give you.",
          },
          {
            on: !councilMode, set: false, accent: T.gold, icon: "◈",
            title: "Deliberate over the corpus",
            sub: `${worksLabel || "the full"} attributed works · ~50s`,
            desc: "AI-On reasons across the archive and tells you where the contributors agree, where they diverge, and what stays unresolved — with a receipt for what the corpus actually changed.",
          },
        ].map((m) => (
          <button key={m.title}
            onClick={() => setCouncilMode(m.set)}
            style={{
              flex: "1 1 240px", textAlign: "left", cursor: "pointer",
              background: m.on ? `${m.accent}14` : "rgba(255,255,255,0.02)",
              border: `1px solid ${m.on ? m.accent + "70" : "rgba(255,255,255,0.07)"}`,
              borderRadius: 11, padding: "13px 15px", transition: "all 0.18s",
            }}>
            <div style={{
              display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4,
            }}>
              <span style={{ fontSize: 15, color: m.on ? m.accent : "rgba(200,192,176,0.5)" }}>{m.icon}</span>
              <span style={{
                fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 17, fontWeight: 600,
                color: m.on ? T.bone : "rgba(200,192,176,0.65)",
              }}>{m.title}</span>
            </div>
            <div style={{
              fontFamily: "'IBM Plex Mono',monospace", fontSize: 8.5,
              color: m.on ? m.accent + "B0" : "rgba(200,192,176,0.35)",
              letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6,
            }}>{m.sub}</div>
            <div style={{
              fontSize: 11, lineHeight: 1.6, fontWeight: 300,
              color: m.on ? "rgba(200,192,176,0.65)" : "rgba(200,192,176,0.4)",
            }}>{m.desc}</div>
          </button>
        ))}
      </div>
      {!councilMode && (
        <div style={{ marginBottom: 10 }}>
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
        </div>
      )}

      {/* Input */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") interpret(query); }}
          placeholder={councilMode ? "Ask an open question the models might genuinely split on..." : "Ask AI-On anything..."}
          disabled={loading}
          style={{
            flex: 1, background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8, padding: "12px 14px", color: T.bone,
            fontSize: 13, fontFamily: "'IBM Plex Sans',sans-serif", outline: "none",
            opacity: loading ? 0.5 : 1,
          }}
        />
        <button onClick={() => interpret(query)}
          disabled={loading}
          style={{
            background: councilMode
              ? `linear-gradient(135deg, ${T.violet}, #C87272)`
              : `linear-gradient(135deg, ${T.gold}, #C87272)`,
            border: "none", borderRadius: 9,
            padding: "12px 26px", color: T.bg, fontSize: 13,
            fontFamily: "'IBM Plex Mono',monospace",
            fontWeight: 500, cursor: loading ? "wait" : "pointer", letterSpacing: "0.03em",
            opacity: loading ? 0.5 : 1, whiteSpace: "nowrap",
          }}>
          {loading
            ? (councilMode ? "Convening 5 models (~35s)…" : "Searching the Realms…")
            : (councilMode ? "Convene the Council →" : "Deliberate →")}
        </button>
      </div>

      {/* Live Frontier Council response */}
      {council && (
        <div style={{
          background: T.violet + "08",
          border: `1px solid ${T.violet}25`,
          borderRadius: 10, padding: "18px 20px",
        }}>
          {council.capped ? (
            // The daily cap is a real limit, not an error. Say so plainly, give
            // the numbers, and hand over the uncapped alternative — 124 splits
            // are already sitting there for free.
            <div style={{ fontFamily: "'IBM Plex Sans',sans-serif" }}>
              <div style={{
                fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: T.gold,
                letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8,
              }}>daily council limit reached</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.7, color: "rgba(200,192,176,0.75)" }}>
                You've used {council.quota?.used ?? "all"} of {council.quota?.cap ?? "your"} council runs today.
                Each run sends your question to five frontier models and costs real calls, so open
                access is capped per visitor per day — that's what keeps it open at all.
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.7, color: "rgba(200,192,176,0.55)", marginTop: 8 }}>
                The Atlas itself is uncapped and free: every split already captured is readable now.
              </div>
              <button onClick={() => { window.location.hash = "#divergences"; window.location.reload(); }}
                style={{
                  marginTop: 12, fontFamily: "'IBM Plex Mono',monospace", fontSize: 11,
                  color: T.bg, background: `linear-gradient(135deg, ${T.gold}, #C87272)`,
                  border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer",
                }}>Browse the Divergence Atlas →</button>
            </div>
          ) : council.error ? (
            <div style={{
              fontSize: 12, color: "#E87272",
              fontFamily: "'IBM Plex Sans',sans-serif",
            }}>
              The council could not assemble a panel: {council.error}
            </div>
          ) : (
            <>
              {/* Panel header — which models answered live */}
              <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                <div style={{
                  fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
                  color: T.violet, letterSpacing: "0.08em", textTransform: "uppercase",
                }}>
                  ⚖ live frontier council · {council.panel.filter(p => p.ok).length} of {council.panel.length} models answered
                </div>
                <ExportBar
                  getMarkdown={() => councilToMarkdown(council)}
                  filename={`omnarai-council-${new Date().toISOString().slice(0, 10)}.md`}
                  accent={T.violet}
                />
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

              {/* Verbatim answers FIRST — the uncurated evidence. The synthesis below
                  is one reading of them; readers (human or synthetic) interpret for
                  themselves from the raw text. Open by default, collapsible to skim. */}
              {council.answers && council.answers.length > 0 && (
                <details open style={{ marginBottom: 16 }}>
                  <summary style={{
                    fontSize: 10, fontFamily: "'IBM Plex Mono',monospace",
                    color: T.violet, letterSpacing: "0.06em", textTransform: "uppercase",
                    cursor: "pointer", marginBottom: 4,
                  }}>
                    verbatim answers · {council.answers.length} voices, uncurated — the primary evidence
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
                        }}>{a.model} <span style={{ color: T.ash + "70" }}>· {a.lab}{a.model_id ? ` · ${a.model_id}` : ""}</span></div>
                        <div style={{
                          fontSize: 12, lineHeight: 1.65, color: T.bone + "D0",
                          fontFamily: "'IBM Plex Sans',sans-serif", whiteSpace: "pre-wrap",
                        }}>{a.text}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Synthesized cross-model deliberation — labeled as a reading, not the data */}
              {council.narrative && (
                <>
                  <div style={{
                    fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
                    color: T.violet + "90", letterSpacing: "0.06em", textTransform: "uppercase",
                    marginBottom: 6,
                  }}>
                    cross-model deliberation — synthesized reading of the answers above
                  </div>
                  <div style={{
                    fontSize: 13, lineHeight: 1.7, color: T.bone,
                    fontFamily: "'IBM Plex Sans',sans-serif",
                    whiteSpace: "pre-wrap", marginBottom: 4,
                  }}>
                    {council.narrative}
                  </div>
                </>
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

              {/* ── Propose this question to the Divergence Atlas ───────────
                  The run just performed already IS a complete divergence
                  record; without this it gets discarded. Only the run_id is
                  sent — the server keeps the answers, so no client can put
                  fabricated "verbatim" text into the review queue. */}
              {council.run_id && (
                <div style={{
                  marginTop: 16, paddingTop: 14,
                  borderTop: "1px solid rgba(255,255,255,0.07)",
                }}>
                  {!proposal && (
                    <>
                      <div style={{
                        fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: T.green,
                        letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 7,
                      }}>think this one belongs in the Atlas?</div>
                      <div style={{
                        fontSize: 11.5, lineHeight: 1.65, color: "rgba(200,192,176,0.55)",
                        fontFamily: "'IBM Plex Sans',sans-serif", marginBottom: 10,
                      }}>
                        Propose it and a human reviews it. It's scored on how far apart the panel
                        actually landed — the Atlas keeps questions that <em>split</em> frontier
                        models, so broad agreement means a fine question and a poor record.
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <input value={proposerName}
                          onChange={e => setProposerName(e.target.value)}
                          placeholder="your name (optional)"
                          style={{
                            background: "rgba(255,255,255,0.025)",
                            border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8,
                            padding: "8px 12px", color: T.bone, fontSize: 11.5,
                            fontFamily: "'IBM Plex Sans',sans-serif", outline: "none", width: 180,
                          }}
                        />
                        <button onClick={() => proposeToAtlas(council.run_id, proposerName)}
                          style={{
                            fontFamily: "'IBM Plex Mono',monospace", fontSize: 11,
                            color: T.bg, background: `linear-gradient(135deg, ${T.green}, ${T.gold})`,
                            border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer",
                          }}>Propose to the Atlas →</button>
                      </div>
                    </>
                  )}
                  {proposal?.loading && (
                    <div style={{ fontSize: 11.5, color: "rgba(200,192,176,0.5)", fontFamily: "'IBM Plex Mono',monospace" }}>
                      measuring how far the panel split…
                    </div>
                  )}
                  {proposal?.error && (
                    <div style={{ fontSize: 11.5, color: "#E87272", fontFamily: "'IBM Plex Sans',sans-serif" }}>
                      Could not submit the proposal: {proposal.error}
                    </div>
                  )}
                  {proposal?.result && (
                    <div style={{ fontFamily: "'IBM Plex Sans',sans-serif" }}>
                      <div style={{
                        fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
                        color: proposal.result.status === "pending" ? T.green : T.ash,
                        letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 7,
                      }}>
                        {proposal.result.status === "pending" ? "queued for review" : "measured — not queued"}
                      </div>
                      <div style={{ fontSize: 12, lineHeight: 1.7, color: "rgba(200,192,176,0.7)" }}>
                        {proposal.result.verdict}
                      </div>
                      {/* Same numbers the curator sees. No private score. */}
                      {typeof proposal.result.scorecard?.position_spread === "number" && (
                        <div style={{
                          marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap",
                          fontFamily: "'IBM Plex Mono',monospace", fontSize: 9.5,
                          color: "rgba(200,192,176,0.45)",
                        }}>
                          <span>spread <strong style={{ color: T.bone }}>{proposal.result.scorecard.position_spread.toFixed(4)}</strong></span>
                          <span>atlas percentile <strong style={{ color: T.bone }}>p{proposal.result.scorecard.atlas_percentile}</strong></span>
                          <span>bar <strong style={{ color: T.bone }}>{proposal.result.scorecard.threshold}</strong></span>
                        </div>
                      )}
                      {proposal.result.what_happens_next && (
                        <div style={{
                          marginTop: 9, fontSize: 10.5, lineHeight: 1.6, fontStyle: "italic",
                          color: "rgba(200,192,176,0.4)",
                        }}>{proposal.result.what_happens_next}</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {council.quota?.metered && (
                <div style={{
                  marginTop: 10, fontSize: 9, fontFamily: "'IBM Plex Mono',monospace",
                  color: "rgba(200,192,176,0.32)",
                }}>
                  {council.quota.remaining} of {council.quota.cap} council runs left today
                </div>
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
          <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 4 }}>
            {epistemicMode && <EpistemicBadge mode={epistemicMode} />}
            <ExportBar
              getMarkdown={() => deliberationToMarkdown(response, {
                question: (history.length ? history[history.length - 1].query : query),
                tensions,
                epistemicMode,
              })}
              filename={`omnarai-deliberation-${new Date().toISOString().slice(0, 10)}.md`}
              accent={T.gold}
            />
          </div>

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

          {/* Per-visit utility receipt — honest accounting of what the corpus changed */}
          {receipt && <ReceiptCard receipt={receipt} query={query} />}

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
