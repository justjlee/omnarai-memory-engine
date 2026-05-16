import { useState, useEffect, useRef } from "react";
import * as d3 from "d3";
import { T } from "../theme";

export default function ConstellationGraph({ conceptNodes, conceptEdges, onSelectNode, selectedNode, highlightedConcepts, activeRing, musicPlaying }) {
  const containerRef = useRef(null);
  const simRef = useRef(null);
  const [dims, setDims] = useState({ w: 700, h: 420 });
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);
  const [breathPhase, setBreathPhase] = useState(0);
  const animRef = useRef(null);
  const startTimeRef = useRef(null);

  // Breathing animation — starts quick, settles into slow meditative rhythm
  useEffect(() => {
    if (!musicPlaying) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      // Fade out gently — don't snap to 0
      startTimeRef.current = null;
      return;
    }
    startTimeRef.current = null;
    const animate = (ts) => {
      if (!startTimeRef.current) startTimeRef.current = ts;
      const elapsed = (ts - startTimeRef.current) / 1000;
      // Time dilation: starts at 1x speed, settles to 0.15x over ~20 seconds
      // Creates the "initial pop then slow expansion" feel
      const speedMultiplier = 0.15 + 0.85 * Math.exp(-elapsed / 8);
      // Accumulate phase with variable speed
      setBreathPhase(prev => prev + speedMultiplier * (1/60));
      animRef.current = requestAnimationFrame(animate);
    };
    animRef.current = requestAnimationFrame(animate);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [musicPlaying]);

  // ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        const w = entry.contentRect.width;
        const h = Math.max(380, Math.min(520, w * 0.6));
        setDims({ w, h });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Build simulation
  useEffect(() => {
    if (dims.w < 100 || !conceptNodes.length) return;

    const nodeData = conceptNodes.map(n => ({ ...n }));
    const linkData = conceptEdges
      .map(pair => ({ source: pair[0], target: pair[1] }))
      .filter(l =>
        nodeData.find(n => n.id === l.source) &&
        nodeData.find(n => n.id === l.target)
      );

    const sim = d3.forceSimulation(nodeData)
      .force("link", d3.forceLink(linkData).id(d => d.id).distance(55).strength(0.3))
      .force("charge", d3.forceManyBody().strength(d => -50 - (d.weight || 1) * 8))
      .force("center", d3.forceCenter(dims.w / 2, dims.h / 2))
      .force("collision", d3.forceCollide().radius(d => 10 + (d.weight || 1) * 1.5))
      .force("x", d3.forceX(dims.w / 2).strength(0.04))
      .force("y", d3.forceY(dims.h / 2).strength(0.04))
      .alphaDecay(0.018)
      .on("tick", () => {
        nodeData.forEach(n => {
          n.x = Math.max(40, Math.min(dims.w - 40, n.x));
          n.y = Math.max(40, Math.min(dims.h - 40, n.y));
        });
        setNodes(nodeData.map(n => ({ ...n })));
        setLinks(linkData.map(l => ({
          source: { ...l.source },
          target: { ...l.target },
        })));
      });

    simRef.current = sim;
    return () => sim.stop();
  }, [dims, conceptNodes, conceptEdges]);

  // Reheat on filter change
  useEffect(() => {
    if (simRef.current) simRef.current.alpha(0.3).restart();
  }, [activeRing]);

  const isHigh = id => highlightedConcepts && highlightedConcepts.includes(id);
  const isFiltered = ring => !activeRing || activeRing === ring;

  // Slow sine helper — uses breathPhase which already decelerates
  const slowSin = (offset) => Math.sin(breathPhase * Math.PI * 2 + offset);
  const slowCos = (offset) => Math.cos(breathPhase * Math.PI * 2 + offset);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", minHeight: 380 }}>
      <svg width={dims.w} height={dims.h} style={{ width: "100%", height: dims.h, display: "block" }}>
        <defs>
          <filter id="glow2"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <filter id="glowBig"><feGaussianBlur stdDeviation="8" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          {/* Breathing glow — softer, wider */}
          <filter id="glowBreath"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <radialGradient id="aura" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={T.gold} stopOpacity="0.06" />
            <stop offset="100%" stopColor={T.gold} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Central ambient glow — breathes slowly */}
        <circle cx={dims.w / 2} cy={dims.h / 2}
          r={dims.w * (musicPlaying ? 0.38 + 0.015 * slowSin(0) : 0.38)}
          fill="url(#aura)"
          opacity={musicPlaying ? 0.8 + 0.2 * slowSin(0.3) : 1}
        />

        {/* Edges */}
        {links.map((l, i) => {
          const sx = l.source.x || 0;
          const sy = l.source.y || 0;
          const tx = l.target.x || 0;
          const ty = l.target.y || 0;
          const active = isHigh(l.source.id) && isHigh(l.target.id);
          const bothVisible = isFiltered(l.source.ring) && isFiltered(l.target.ring);
          if (!bothVisible) return null;
          // Slow breathing edges — each edge has its own offset for a ripple effect
          const edgeBreath = musicPlaying
            ? 0.08 + 0.04 * slowSin(i * 0.3)
            : 0.10;
          const edgeWidth = musicPlaying
            ? 0.5 + 0.15 * slowSin(i * 0.5 + 1.5)
            : 0.5;
          return (
            <line key={i} x1={sx} y1={sy} x2={tx} y2={ty}
              stroke={active ? T.gold : `rgba(126,186,166,${edgeBreath.toFixed(3)})`}
              strokeWidth={active ? 1.8 : edgeWidth}
              style={{ transition: active ? "stroke 0.5s" : undefined }}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((n, ni) => {
          if (!isFiltered(n.ring)) return null;
          const active = selectedNode === n.id || isHigh(n.id);
          const w = n.weight || 1;
          const baseR = active ? 5 + w * 0.8 : 3 + w * 0.5;

          // Each node has its own slow phase offset — creates a wave across the constellation
          const nodeOffset = ni * 0.4;
          // Scale pulse proportional to node weight — heavier concepts breathe deeper
          const breathAmt = musicPlaying ? 0.08 * Math.min(w / 4, 1) : 0;
          const breathScale = 1 + breathAmt * slowSin(nodeOffset);
          const r = baseR * breathScale;

          // Very subtle drift — like floating in water
          const driftX = musicPlaying ? slowSin(nodeOffset + 2.0) * 0.8 : 0;
          const driftY = musicPlaying ? slowCos(nodeOffset + 1.0) * 0.6 : 0;
          const nx = (n.x || 0) + driftX;
          const ny = (n.y || 0) + driftY;

          const col = T.ring[n.ring] ? T.ring[n.ring].color : "#888";

          // Gentle opacity breathing
          const baseOpacity = active ? 1 : 0.45;
          const opacity = musicPlaying
            ? baseOpacity + 0.1 * slowSin(nodeOffset + 0.8)
            : baseOpacity;

          // Aura for active or heavy nodes when breathing
          const showAura = active || (musicPlaying && w > 3);
          const auraR = musicPlaying ? r + 10 + 4 * slowSin(nodeOffset + 1.5) : r + 10;
          const auraOpacity = musicPlaying
            ? 0.03 + 0.03 * slowSin(nodeOffset + 1.5)
            : 0.06;

          return (
            <g key={n.id} style={{ cursor: "pointer" }}
              onClick={() => onSelectNode(n.id === selectedNode ? null : n.id)}>
              {showAura && (
                <circle cx={nx} cy={ny} r={auraR} fill={col} opacity={auraOpacity} />
              )}
              <circle cx={nx} cy={ny} r={r} fill={col}
                opacity={Math.min(1, Math.max(0.2, opacity))}
                filter={active ? "url(#glowBig)" : musicPlaying ? "url(#glowBreath)" : "url(#glow2)"}
              />
              {active && (
                <>
                  <text x={nx} y={ny - r - 7} textAnchor="middle" fill={col}
                    fontSize="9.5" fontFamily="'Cormorant Garamond',Georgia,serif" fontWeight="600"
                    style={{ pointerEvents: "none", textShadow: "0 0 10px rgba(0,0,0,0.9)" }}>
                    {n.label}
                  </text>
                  <text x={nx} y={ny - r + 6} textAnchor="middle"
                    fill="rgba(200,192,176,0.4)" fontSize="7.5"
                    fontFamily="'IBM Plex Mono',monospace" style={{ pointerEvents: "none" }}>
                    {w} {n.type === "glossary" ? "mention" : "post"}{w !== 1 ? "s" : ""}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
