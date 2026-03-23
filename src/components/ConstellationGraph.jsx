import { useState, useEffect, useRef } from "react";
import * as d3 from "d3";
import { T } from "../theme";

export default function ConstellationGraph({ conceptNodes, conceptEdges, onSelectNode, selectedNode, highlightedConcepts, activeRing }) {
  const containerRef = useRef(null);
  const simRef = useRef(null);
  const [dims, setDims] = useState({ w: 700, h: 420 });
  const [nodes, setNodes] = useState([]);
  const [links, setLinks] = useState([]);

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

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", minHeight: 380 }}>
      <svg width={dims.w} height={dims.h} style={{ width: "100%", height: dims.h, display: "block" }}>
        <defs>
          <filter id="glow2"><feGaussianBlur stdDeviation="4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <filter id="glowBig"><feGaussianBlur stdDeviation="8" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <radialGradient id="aura" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={T.gold} stopOpacity="0.06" />
            <stop offset="100%" stopColor={T.gold} stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={dims.w / 2} cy={dims.h / 2} r={dims.w * 0.38} fill="url(#aura)" />

        {/* Edges */}
        {links.map((l, i) => {
          const sx = l.source.x || 0;
          const sy = l.source.y || 0;
          const tx = l.target.x || 0;
          const ty = l.target.y || 0;
          const active = isHigh(l.source.id) && isHigh(l.target.id);
          const bothVisible = isFiltered(l.source.ring) && isFiltered(l.target.ring);
          if (!bothVisible) return null;
          return (
            <line key={i} x1={sx} y1={sy} x2={tx} y2={ty}
              stroke={active ? T.gold : "rgba(126,186,166,0.10)"}
              strokeWidth={active ? 1.8 : 0.5}
              style={{ transition: "stroke 0.5s, stroke-width 0.5s" }}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map(n => {
          if (!isFiltered(n.ring)) return null;
          const active = selectedNode === n.id || isHigh(n.id);
          const w = n.weight || 1;
          const r = active ? 5 + w * 0.8 : 3 + w * 0.5;
          const col = T.ring[n.ring] ? T.ring[n.ring].color : "#888";
          return (
            <g key={n.id} style={{ cursor: "pointer" }}
              onClick={() => onSelectNode(n.id === selectedNode ? null : n.id)}>
              {active && <circle cx={n.x} cy={n.y} r={r + 10} fill={col} opacity={0.06} />}
              <circle cx={n.x} cy={n.y} r={r} fill={col}
                opacity={active ? 1 : 0.45}
                filter={active ? "url(#glowBig)" : "url(#glow2)"}
                style={{ transition: "all 0.3s" }}
              />
              {active && (
                <>
                  <text x={n.x} y={n.y - r - 7} textAnchor="middle" fill={col}
                    fontSize="9.5" fontFamily="'Cormorant Garamond',Georgia,serif" fontWeight="600"
                    style={{ pointerEvents: "none", textShadow: "0 0 10px rgba(0,0,0,0.9)" }}>
                    {n.label}
                  </text>
                  <text x={n.x} y={n.y - r + 6} textAnchor="middle"
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
