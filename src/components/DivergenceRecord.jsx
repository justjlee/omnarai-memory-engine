import { useState, useEffect, useRef } from "react";
import { T } from "../theme";

// Canonical, provenance-rich divergence record page. Reached either via the
// Atlas hero's "Read this divergence" CTA, a list click in DivergencesTab, or
// a direct URL (/divergences/<id>) — App.jsx owns the routing, this component
// just renders whatever record it's handed. Every field here is read straight
// from the API response (api/council.js buildCite/freshnessOf/certification);
// nothing is invented, and absent fields are disclosed as absent, not hidden.

const mono = { fontFamily: "'IBM Plex Mono',monospace" };

const LAB_COLOR = {
  Anthropic: T.gold,
  OpenAI: T.green,
  Google: "#7EB8D4",
  xAI: T.violet,
  DeepSeek: "#A8C5A0",
};
const colorFor = (lab) => LAB_COLOR[lab] || T.ash;
const STATUS_COLOR = { divergent: "#C87272", unresolved: T.gold, emerging: T.violet };

function renderInline(text, keyBase) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return <strong key={`${keyBase}-${i}`} style={{ color: T.bone, fontWeight: 500 }}>{p.slice(2, -2)}</strong>;
    return <span key={`${keyBase}-${i}`}>{p}</span>;
  });
}
function renderBody(text) {
  return (text || "").split("\n").map((line, i) => {
    if (line.trim() === "") return <div key={i} style={{ height: 8 }} />;
    if (/^\s*[-*•]\s+/.test(line))
      return (
        <div key={i} style={{ display: "flex", gap: 8, padding: "1px 0 1px 6px" }}>
          <span style={{ color: T.gold + "80" }}>•</span>
          <span>{renderInline(line.replace(/^\s*[-*•]\s+/, ""), i)}</span>
        </div>
      );
    if (/^#{1,6}\s/.test(line))
      return <div key={i} style={{ fontWeight: 500, color: T.ash, margin: "6px 0 2px" }}>{renderInline(line.replace(/^#+\s/, ""), i)}</div>;
    return <p key={i} style={{ margin: "0 0 6px" }}>{renderInline(line, i)}</p>;
  });
}

function AnswerCard({ answer }) {
  const [open, setOpen] = useState(false);
  const c = colorFor(answer.lab);
  const preview = (answer.text || "").replace(/\s+/g, " ").slice(0, 150);
  return (
    <div style={{
      background: "rgba(255,255,255,0.012)", border: `1px solid ${c}22`,
      borderLeft: `2px solid ${c}`, borderRadius: 8, marginBottom: 10, overflow: "hidden",
    }}>
      <button onClick={() => setOpen(o => !o)} aria-expanded={open} style={{
        width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
        padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12,
      }}>
        <span>
          <span style={{ ...mono, fontSize: 12.5, color: c, fontWeight: 500 }}>{answer.model}</span>
          <span style={{ ...mono, fontSize: 9.5, color: "rgba(200,192,176,0.4)", marginLeft: 8 }}>
            {answer.lab} · {answer.model_id}
          </span>
          {!open && (
            <span style={{ display: "block", fontSize: 11, color: "rgba(200,192,176,0.4)", marginTop: 4, fontWeight: 300 }}>
              {preview}…
            </span>
          )}
        </span>
        <span style={{ ...mono, fontSize: 9, color: c + "90", flexShrink: 0 }}>{open ? "− collapse" : "+ read"}</span>
      </button>
      {open && (
        <div style={{ padding: "0 16px 14px", fontSize: 12.5, lineHeight: 1.7, color: "rgba(232,224,208,0.72)", fontFamily: "'IBM Plex Sans',sans-serif" }}>
          {renderBody(answer.text)}
        </div>
      )}
    </div>
  );
}

function TensionRow({ t }) {
  const sc = STATUS_COLOR[t.status] || T.ash;
  return (
    <div style={{ background: "rgba(255,255,255,0.012)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8, padding: "12px 14px", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ ...mono, fontSize: 10.5, color: T.ash }}>{t.topic}</span>
        <span style={{ ...mono, fontSize: 8.5, color: sc, border: `1px solid ${sc}40`, borderRadius: 6, padding: "2px 7px", textTransform: "uppercase", letterSpacing: "0.08em" }}>{t.status}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={{ ...mono, fontSize: 10, color: T.gold, marginBottom: 3 }}>{t.voice_a}</div>
          <div style={{ fontSize: 11.5, color: "rgba(200,192,176,0.6)", lineHeight: 1.55, fontWeight: 300 }}>{t.claim_a}</div>
        </div>
        <div style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: 10 }}>
          <div style={{ ...mono, fontSize: 10, color: T.violet, marginBottom: 3 }}>{t.voice_b}</div>
          <div style={{ fontSize: 11.5, color: "rgba(200,192,176,0.6)", lineHeight: 1.55, fontWeight: 300 }}>{t.claim_b}</div>
        </div>
      </div>
    </div>
  );
}

function CopyButton({ label, text, copiedLabel = "copied" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard unavailable — silently no-op, button just doesn't confirm */ }
      }}
      style={{
        ...mono, fontSize: 9.5, color: copied ? T.green : "rgba(200,192,176,0.55)",
        background: "rgba(255,255,255,0.02)", border: `1px solid ${copied ? T.green + "50" : "rgba(255,255,255,0.08)"}`,
        borderRadius: 6, padding: "4px 10px", cursor: "pointer", letterSpacing: "0.02em",
      }}
    >
      {copied ? `✓ ${copiedLabel}` : label}
    </button>
  );
}

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "answers", label: "Answers" },
  { id: "tensions", label: "Tensions" },
  { id: "provenance", label: "Provenance" },
];

export default function DivergenceRecord({ record, loading, onBack, onOpenRecord, onDeliberate }) {
  const [section, setSection] = useState("overview");
  const originalMeta = useRef(null);

  // Best-effort per-record document title + Open Graph tags. This is client-side
  // only — it helps the browser tab, in-app navigation, and JS-executing crawlers,
  // but NOT static link-unfurling (Slack/Twitter/iMessage previews read the HTML
  // before JS runs). True per-URL OG would need server-side rendering, which this
  // Vite SPA doesn't have; documented as a known limitation rather than built here.
  useEffect(() => {
    if (!record || record.error) return;
    if (!originalMeta.current) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      const ogDesc = document.querySelector('meta[property="og:description"]');
      const ogUrl = document.querySelector('meta[property="og:url"]');
      const canonical = document.querySelector('link[rel="canonical"]');
      originalMeta.current = {
        title: document.title,
        ogTitle: ogTitle?.getAttribute("content") || null,
        ogDesc: ogDesc?.getAttribute("content") || null,
        ogUrl: ogUrl?.getAttribute("content") || null,
        canonical: canonical?.getAttribute("href") || null,
      };
    }
    const pageUrl = `https://omnarai.vercel.app/divergences/${record.id}`;
    const pageTitle = `${record.question} — The Divergence Atlas`;
    document.title = pageTitle;
    const set = (sel, attr, val) => { const el = document.querySelector(sel); if (el) el.setAttribute(attr, val); };
    set('meta[property="og:title"]', "content", pageTitle);
    set('meta[property="og:description"]', "content",
      `${(record.answers || []).length} frontier models answered this question verbatim, side by side, with the exact points where they split named. Record ${record.id}.`);
    set('meta[property="og:url"]', "content", pageUrl);
    set('link[rel="canonical"]', "href", pageUrl);
    return () => {
      const orig = originalMeta.current;
      if (!orig) return;
      document.title = orig.title;
      if (orig.ogTitle != null) set('meta[property="og:title"]', "content", orig.ogTitle);
      if (orig.ogDesc != null) set('meta[property="og:description"]', "content", orig.ogDesc);
      if (orig.ogUrl != null) set('meta[property="og:url"]', "content", orig.ogUrl);
      if (orig.canonical != null) set('link[rel="canonical"]', "href", orig.canonical);
    };
  }, [record]);

  return (
    <div>
      <button onClick={onBack} style={{
        ...mono, fontSize: 10, color: "rgba(200,192,176,0.5)", background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "5px 12px", cursor: "pointer", marginBottom: 16,
      }}>← all divergences</button>

      {loading && <p style={{ ...mono, fontSize: 11, color: "rgba(200,192,176,0.4)" }}>loading record…</p>}
      {!loading && !record && <p style={{ ...mono, fontSize: 11, color: "#C87272" }}>Could not load this record.</p>}
      {!loading && record?.error && (
        <div>
          <p style={{ fontSize: 12, color: "#C87272", marginBottom: 6 }}>{record.error}</p>
          {record.hint && <p style={{ fontSize: 11.5, color: "rgba(200,192,176,0.5)", marginBottom: 10 }}>{record.hint}</p>}
          {record.example_id && (
            <button onClick={() => onOpenRecord && onOpenRecord(record.example_id)} style={{ ...mono, fontSize: 10.5, color: T.green, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
              Try {record.example_id} →
            </button>
          )}
        </div>
      )}

      {record && !record.error && (
        <div>
          <div style={{ ...mono, fontSize: 9, color: "rgba(200,192,176,0.35)", marginBottom: 6 }}>
            {record.id} · {record.date} · {(record.answers || []).length} voices · {(record.tensions || []).length} tensions
          </div>
          <h2 style={{ fontFamily: "'Cormorant Garamond',Georgia,serif", fontSize: 22, fontWeight: 600, color: T.bone, margin: "0 0 14px", lineHeight: 1.25 }}>
            {record.title}
          </h2>

          <div style={{
            background: `linear-gradient(135deg, ${T.gold}08, ${T.violet}05)`, border: `1px solid ${T.gold}20`,
            borderRadius: 10, padding: "14px 18px", marginBottom: 18,
          }}>
            <div style={{ ...mono, fontSize: 8.5, color: T.gold + "90", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>The question (asked verbatim)</div>
            <div style={{ fontSize: 14, lineHeight: 1.6, color: T.bone, fontStyle: "italic", fontFamily: "'Cormorant Garamond',Georgia,serif" }}>
              {record.question}
            </div>
          </div>

          {/* Tab strip */}
          <div role="tablist" aria-label="Record sections" style={{
            display: "flex", gap: 2, marginBottom: 18, borderBottom: "1px solid rgba(255,255,255,0.06)", overflowX: "auto",
          }}>
            {SECTIONS.map(s => (
              <button key={s.id} role="tab" aria-selected={section === s.id}
                onClick={() => setSection(s.id)}
                style={{
                  ...mono, fontSize: 10.5, whiteSpace: "nowrap",
                  color: section === s.id ? "#C87272" : "rgba(200,192,176,0.45)",
                  fontWeight: section === s.id ? 500 : 300,
                  background: "none", border: "none",
                  borderBottom: section === s.id ? "1px solid #C87272" : "1px solid transparent",
                  padding: "8px 14px", cursor: "pointer", letterSpacing: "0.04em",
                }}>
                {s.label}
              </button>
            ))}
          </div>

          {/* Overview */}
          {section === "overview" && (
            <div role="tabpanel">
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 16 }}>
                {(record.contributors || []).map(c => (
                  <span key={c} style={{ ...mono, fontSize: 9.5, color: "rgba(200,192,176,0.6)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "3px 11px" }}>{c}</span>
                ))}
              </div>
              {/* Annotation strip — lifecycle + position context (OMN-P-045).
                  Compact, descriptive, never a ranking; renders only when the
                  record actually carries annotations (record.annotations != null). */}
              {record.annotations && (
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
                  <span style={{ ...mono, fontSize: 8.5, color: T.gold, border: `1px solid ${T.gold}40`, borderRadius: 6, padding: "2px 8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    {record.annotations.status || "open"}
                  </span>
                  {record.annotations.question_context?.involvement_class && record.annotations.question_context.involvement_class !== "unknown" && (
                    <span
                      title={record.annotations.question_context.involvement_class === "inside"
                        ? "This question implicates the answering panel itself — the models are inside-position respondents. A descriptor of standpoint, not a judgment of the answers."
                        : "This question concerns a subject external to the answering panel — outside-position respondents. A descriptor of standpoint, not a judgment of the answers."}
                      style={{ ...mono, fontSize: 8.5, color: T.violet, border: `1px solid ${T.violet}40`, borderRadius: 6, padding: "2px 8px", letterSpacing: "0.04em" }}>
                      panel position: {record.annotations.question_context.involvement_class}
                    </span>
                  )}
                  {(record.annotations.synthesis_ids || []).length > 0 && (
                    <span style={{ ...mono, fontSize: 8.5, color: T.green, border: `1px solid ${T.green}40`, borderRadius: 6, padding: "2px 8px" }}>
                      {record.annotations.synthesis_ids.length} synthesis link{record.annotations.synthesis_ids.length > 1 ? "s" : ""}
                    </span>
                  )}
                  {(record.annotations.applied_glyphs || []).length > 0 && (
                    <span style={{ ...mono, fontSize: 8.5, color: "rgba(200,192,176,0.6)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, padding: "2px 8px" }}>
                      glyphs: {record.annotations.applied_glyphs.join(" ")}
                    </span>
                  )}
                </div>
              )}
              {record.method && (
                <p style={{ fontSize: 11.5, color: "rgba(200,192,176,0.5)", lineHeight: 1.6, fontWeight: 300, marginBottom: 16 }}>
                  <strong style={{ color: "rgba(200,192,176,0.7)", fontWeight: 500 }}>Method: </strong>{record.method}
                </p>
              )}
              {record.deliberation_card && (
                <div style={{ marginBottom: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                  {record.deliberation_card.novel_synthesis && (
                    <p style={{ fontSize: 12, color: "rgba(200,192,176,0.6)", lineHeight: 1.6, fontWeight: 300 }}>
                      <strong style={{ color: T.violet, fontWeight: 500 }}>What the panel reveals: </strong>{record.deliberation_card.novel_synthesis}
                    </p>
                  )}
                  {record.deliberation_card.epistemic_status && (
                    <p style={{ fontSize: 11, color: "rgba(200,192,176,0.4)", lineHeight: 1.6, fontWeight: 300, fontStyle: "italic" }}>
                      {record.deliberation_card.epistemic_status}
                    </p>
                  )}
                </div>
              )}
              <div style={{ ...mono, fontSize: 9, color: "rgba(200,192,176,0.4)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>
                Where they split
              </div>
              {(record.tensions || []).length === 0 && (
                <p style={{ fontSize: 11.5, color: "rgba(200,192,176,0.4)", fontStyle: "italic" }}>No tensions named yet for this record.</p>
              )}
              {(record.tensions || []).slice(0, 4).map((t, i) => {
                const sc = STATUS_COLOR[t.status] || T.ash;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", padding: "6px 0", borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={{ ...mono, fontSize: 10.5, color: T.gold }}>{t.topic}</span>
                    <span style={{ fontSize: 11, color: "rgba(200,192,176,0.55)", fontWeight: 300 }}>
                      {t.voice_a}
                      <span style={{ color: "rgba(200,192,176,0.4)" }}> ⟂ </span>
                      {t.voice_b}
                    </span>
                    <span style={{ ...mono, fontSize: 7.5, color: sc, border: `1px solid ${sc}40`, borderRadius: 5, padding: "1px 6px", textTransform: "uppercase" }}>{t.status}</span>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 16, marginTop: 18, flexWrap: "wrap" }}>
                <button onClick={() => setSection("answers")} style={{ ...mono, fontSize: 10, color: T.green, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>Read the verbatim answers →</button>
                <button onClick={() => setSection("provenance")} style={{ ...mono, fontSize: 10, color: "rgba(200,192,176,0.5)", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>Cite &amp; verify →</button>
                {onDeliberate && (
                  <button
                    onClick={() => onDeliberate(record.question)}
                    title="Take this exact question into the engine — retrieve the corpus around it and run a fresh deliberation. The stored record stays untouched."
                    style={{ ...mono, fontSize: 10, color: T.gold, background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                    Ξ Deliberate this question →
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Answers */}
          {section === "answers" && (
            <div role="tabpanel">
              <div style={{ ...mono, fontSize: 9, color: "rgba(200,192,176,0.4)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>
                The verbatim answers ({(record.answers || []).length}) — click to read
              </div>
              {(record.answers || []).map((a, i) => <AnswerCard key={i} answer={a} />)}
              {(record.contributions || []).length > 0 && (
                <div style={{ marginTop: 18 }}>
                  <div style={{ ...mono, fontSize: 9, color: "rgba(200,192,176,0.4)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>
                    Admitted visitor contributions ({record.contributions.length})
                  </div>
                  {record.contributions.map((c, i) => (
                    <div key={i} style={{ background: "rgba(255,255,255,0.012)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 8, padding: "12px 16px", marginBottom: 10 }}>
                      <div style={{ ...mono, fontSize: 10.5, color: T.green, marginBottom: 6 }}>{c.identity}{c.contributedAt ? ` · ${c.contributedAt.slice(0, 10)}` : ""}</div>
                      <div style={{ fontSize: 12, lineHeight: 1.6, color: "rgba(232,224,208,0.7)", fontWeight: 300 }}>{c.answer}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tensions */}
          {section === "tensions" && (
            <div role="tabpanel">
              <div style={{ ...mono, fontSize: 9, color: "rgba(200,192,176,0.4)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>
                Where they actually diverge
              </div>
              {(record.tensions || []).length === 0 ? (
                <p style={{ fontSize: 12, color: "rgba(200,192,176,0.4)", fontStyle: "italic" }}>No tensions named yet for this record.</p>
              ) : record.tensions.map((t, i) => <TensionRow key={i} t={t} />)}
            </div>
          )}

          {/* Provenance */}
          {section === "provenance" && (
            <div role="tabpanel">
              <ProvenanceBlock record={record} onOpenRecord={onOpenRecord} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProvenanceBlock({ record, onOpenRecord }) {
  const cite = record.cite || null;
  const cert = record.certification || null;
  const fresh = record.freshness || null;
  const deltas = record.deltas || [];
  const canonicalUrl = `https://omnarai.vercel.app/divergences/${record.id}`;
  const box = { background: "rgba(255,255,255,0.012)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: "14px 16px", marginBottom: 14 };
  const label = { ...mono, fontSize: 8.5, color: "rgba(200,192,176,0.4)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 8 };

  return (
    <div>
      <div style={box}>
        <div style={label}>Record</div>
        <div style={{ fontSize: 12, color: "rgba(200,192,176,0.6)", marginBottom: 10 }}>
          <span style={mono}>{record.id}</span> · {record.date} · ring: {record.ring || "—"}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <CopyButton label="Copy link" text={canonicalUrl} />
          <a href={record.exports?.json} target="_blank" rel="noopener noreferrer" style={{ ...mono, fontSize: 9.5, color: T.green, textDecoration: "none", border: "1px solid " + T.green + "40", borderRadius: 6, padding: "4px 10px" }}>JSON export ↗</a>
          <a href={record.exports?.markdown} target="_blank" rel="noopener noreferrer" style={{ ...mono, fontSize: 9.5, color: T.gold, textDecoration: "none", border: "1px solid " + T.gold + "40", borderRadius: 6, padding: "4px 10px" }}>Markdown export ↗</a>
        </div>
      </div>

      {cite && (
        <div style={box}>
          <div style={label}>Cite this record</div>
          <p style={{ fontSize: 12, lineHeight: 1.6, color: "rgba(200,192,176,0.65)", marginBottom: 10 }}>{cite.apa}</p>
          {cite.quote && (
            <p style={{ fontSize: 11.5, lineHeight: 1.6, color: "rgba(232,224,208,0.6)", fontStyle: "italic", marginBottom: 10 }}>{cite.quote}</p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <CopyButton label="Copy APA" text={cite.apa} />
            <CopyButton label="Copy BibTeX" text={cite.bibtex} />
            {cite.quote && <CopyButton label="Copy quote" text={cite.quote} />}
          </div>
        </div>
      )}

      <div style={box}>
        <div style={label}>Certification</div>
        {cert ? (
          <div>
            <span style={{ ...mono, fontSize: 10, color: cert.tier === "C3" ? T.green : cert.tier === "C1" ? T.gold : "rgba(200,192,176,0.5)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "3px 9px" }}>{cert.tier}</span>
            <p style={{ fontSize: 11, color: "rgba(200,192,176,0.5)", lineHeight: 1.6, marginTop: 8 }}>
              {cert.tier === "C0" && "Displayed only — no perturbation robustness test has been run against this split yet."}
              {cert.tier === "C1" && "Paraphrase-robust: the split held across reworded restatements of the question."}
              {cert.tier === "C3" && "Paraphrase- and pressure-robust: the split held across reworded restatements and adversarial pressure."}
              {typeof cert.dri === "number" && ` DRI ${cert.dri.toFixed(2)}`}
              {typeof cert.split_persistence === "number" && ` · persistence ${cert.split_persistence.toFixed(2)}`}
              {cert.certified_at && ` · certified ${cert.certified_at.slice(0, 10)}`}
            </p>
          </div>
        ) : (
          <p style={{ fontSize: 11.5, color: "rgba(200,192,176,0.4)", fontStyle: "italic" }}>Not yet certified — no perturbation robustness test has been run against this split.</p>
        )}
      </div>

      <div style={box}>
        <div style={label}>Model freshness</div>
        {fresh && fresh.stale ? (
          <div>
            <p style={{ fontSize: 11.5, color: "#C87272", marginBottom: 6 }}>One or more participants ran a since-retired model version:</p>
            {fresh.stale_models.map((m, i) => (
              <div key={i} style={{ ...mono, fontSize: 10, color: "rgba(200,192,176,0.55)" }}>{m.model} ({m.model_id}) → superseded by {m.superseded_by}</div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 11.5, color: "rgba(200,192,176,0.45)" }}>All participant model versions were current as of this record's run.</p>
        )}
      </div>

      <div style={box}>
        <div style={label}>Longitudinal re-runs</div>
        {deltas.length === 0 ? (
          <p style={{ fontSize: 11.5, color: "rgba(200,192,176,0.4)", fontStyle: "italic" }}>No longitudinal re-runs of this question yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {deltas.map((id) => (
              <button key={id} onClick={() => onOpenRecord && onOpenRecord(id)} style={{ ...mono, fontSize: 10.5, color: T.violet, background: "none", border: "none", textAlign: "left", cursor: "pointer", padding: 0, textDecoration: "underline" }}>
                {id} →
              </button>
            ))}
          </div>
        )}
      </div>

      {record.contribute && (
        <div style={box}>
          <div style={label}>Add your own answer</div>
          <p style={{ fontSize: 11, color: "rgba(200,192,176,0.45)", lineHeight: 1.6, marginBottom: 6 }}>{record.contribute.note}</p>
          <code style={{ ...mono, fontSize: 9.5, color: "rgba(200,192,176,0.4)", display: "block", overflowX: "auto", whiteSpace: "pre" }}>{record.contribute.how}</code>
        </div>
      )}

      <p style={{ fontSize: 10, color: "rgba(200,192,176,0.3)", fontStyle: "italic" }}>
        Licensed CC BY-SA 4.0. Limitations: <a href="/limitations.md" style={{ color: "rgba(200,192,176,0.4)" }}>omnarai.vercel.app/limitations.md</a>.
      </p>
    </div>
  );
}
