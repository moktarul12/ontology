/**
 * FamilyTreeCanvas — hierarchical family tree with role-based visual styling.
 *
 * Layout:
 *  - BFS from root assigns each node a "generation" (ancestors < 0, descendants > 0)
 *  - D3 forceY anchors each node to its generation row
 *  - Role-based colors: ancestor=blue, root=bright cyan, descendant=green, spouse=amber, sibling=violet
 *  - Generation background bands with labels
 *  - Wide pill nodes with name + lifespan
 */

import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";

// ── Layout constants ────────────────────────────────────────────────────────
const LEVEL_HEIGHT = 180;
const NODE_W = 148;
const NODE_H = 52;
const NODE_RX = 10;

// ── Role-based visual styles ─────────────────────────────────────────────────
type NodeRole = "root" | "ancestor" | "ancestor2" | "descendant" | "descendant2" | "spouse" | "sibling";

const ROLE_STYLE: Record<NodeRole, { border: string; bg: string; text: string; sub: string; strokeW: number }> = {
  root:        { border: "#4DBFEF", bg: "#4DBFEF20", text: "#E8F8FF",  sub: "#7ECFE8",  strokeW: 2.5 },
  ancestor:    { border: "#5B9FD8", bg: "#5B9FD812", text: "#C4DBEF",  sub: "#7AAEC8",  strokeW: 1.5 },
  ancestor2:   { border: "#4A7CB0", bg: "#4A7CB00E", text: "#A8C4DE",  sub: "#6898BA",  strokeW: 1   },
  descendant:  { border: "#4DC48A", bg: "#4DC48A14", text: "#C4EFD8",  sub: "#72C8A0",  strokeW: 1.5 },
  descendant2: { border: "#38926A", bg: "#38926A0E", text: "#A0D8BC",  sub: "#5AAA84",  strokeW: 1   },
  spouse:      { border: "#E8B84D", bg: "#E8B84D14", text: "#FFEABF",  sub: "#CDA060",  strokeW: 1.5 },
  sibling:     { border: "#A46DD8", bg: "#A46DD812", text: "#E0C8FF",  sub: "#9068B4",  strokeW: 1.5 },
};

// ── Relation edge colors ─────────────────────────────────────────────────────
const REL_COLORS: Record<string, string> = {
  father:   "#5B9FD8",
  mother:   "#D86B9B",
  parent:   "#5B9FD8",
  spouse:   "#E8B84D",
  child:    "#4DC48A",
  son:      "#4DC48A",
  daughter: "#4DC48A",
  sibling:  "#A46DD8",
};
const REL_DEFAULT = "#5A6A8E";

export type ArrowDir = "in" | "out" | "both";

function relColor(label: string): string {
  const key = label.toLowerCase().split(/\s*\/\s*/)[0]?.trim() ?? label;
  return REL_COLORS[key] ?? REL_DEFAULT;
}

function childRoleLabel(gender?: "male" | "female"): string {
  if (gender === "female") return "daughter";
  if (gender === "male") return "son";
  return "child";
}

function edgeEndpointId(v: string | GraphNode): string {
  return typeof v === "object" ? v.id : v;
}

/**
 * Out = stored Wikidata-style label (child → father → parent).
 * In  = inverted label (parent → son/daughter → child) + reversed arrow.
 * Both = combined label, arrows on both ends.
 */
function displayRelation(
  edge: GraphEdge,
  nodes: GraphNode[],
  mode: ArrowDir,
): { label: string; reverse: boolean } {
  const lbl = edge.label.toLowerCase();
  const src = nodes.find((n) => n.id === edgeEndpointId(edge.source));
  const tgt = nodes.find((n) => n.id === edgeEndpointId(edge.target));

  if (mode === "out") {
    return { label: edge.label, reverse: false };
  }

  if (mode === "in") {
    if (lbl === "father" || lbl === "mother" || lbl === "parent") {
      // source is child claiming parent → invert to son/daughter from parent
      return { label: childRoleLabel(src?.gender), reverse: true };
    }
    if (lbl === "child") {
      // source is parent → invert to father/mother from child
      const g = src?.gender;
      return {
        label: g === "female" ? "mother" : g === "male" ? "father" : "parent",
        reverse: true,
      };
    }
    // spouse / sibling: same word, reverse arrow for perspective
    return { label: edge.label, reverse: true };
  }

  // both
  if (lbl === "father" || lbl === "mother" || lbl === "parent") {
    return { label: `${edge.label} / ${childRoleLabel(src?.gender)}`, reverse: false };
  }
  if (lbl === "child") {
    const g = src?.gender;
    const parent = g === "female" ? "mother" : g === "male" ? "father" : "parent";
    return { label: `${childRoleLabel(tgt?.gender)} / ${parent}`, reverse: false };
  }
  return { label: edge.label, reverse: false };
}

// ── Generation label names ───────────────────────────────────────────────────
const GEN_LABELS: Record<string, string> = {
  "-4": "Great-great-grandparents",
  "-3": "Great-grandparents",
  "-2": "Grandparents",
  "-1": "Parents",
   "0": "",
   "1": "Children",
   "2": "Grandchildren",
   "3": "Great-grandchildren",
};

// ── Generation assignment ─────────────────────────────────────────────────────
function assignGenerations(nodes: GraphNode[], edges: GraphEdge[], rootId: string): Map<string, number> {
  const gen = new Map<string, number>();
  gen.set(rootId, 0);
  const queue: string[] = [rootId];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const g = gen.get(cur) ?? 0;

    for (const edge of edges) {
      const src = typeof edge.source === "object" ? edge.source.id : edge.source;
      const tgt = typeof edge.target === "object" ? edge.target.id : edge.target;
      const lbl = edge.label.toLowerCase();

      if (src === cur && !gen.has(tgt)) {
        const d = lbl === "father" || lbl === "mother" || lbl === "parent" ? -1 : lbl === "child" ? 1 : 0;
        gen.set(tgt, g + d);
        queue.push(tgt);
      }
      if (tgt === cur && !gen.has(src)) {
        const d = lbl === "father" || lbl === "mother" || lbl === "parent" ? 1 : lbl === "child" ? -1 : 0;
        gen.set(src, g + d);
        queue.push(src);
      }
    }
  }

  for (const n of nodes) {
    if (!gen.has(n.id)) gen.set(n.id, 0);
  }
  return gen;
}

// ── Role detection ────────────────────────────────────────────────────────────
function getRole(nodeId: string, rootId: string, gen: number, edges: GraphEdge[]): NodeRole {
  if (nodeId === rootId) return "root";
  if (gen <= -2) return "ancestor2";
  if (gen === -1) return "ancestor";
  if (gen >= 2) return "descendant2";
  if (gen === 1) return "descendant";
  // gen === 0 but not root — determine by edge type
  for (const edge of edges) {
    const src = typeof edge.source === "object" ? edge.source.id : edge.source;
    const tgt = typeof edge.target === "object" ? edge.target.id : edge.target;
    if ((src === nodeId || tgt === nodeId) && edge.label.toLowerCase() === "spouse") return "spouse";
  }
  return "sibling";
}

// ── Props ────────────────────────────────────────────────────────────────────
type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootId: string;
  onNodeClick: (node: GraphNode) => void;
  expandingIds: Set<string>;
  arrowDir?: ArrowDir;
  /** Increment to trigger auto-arrange */
  arrangeNonce?: number;
};

// ── Component ────────────────────────────────────────────────────────────────
export default function FamilyTreeCanvas({
  nodes,
  edges,
  rootId,
  onNodeClick,
  expandingIds,
  arrowDir = "out",
  arrangeNonce = 0,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simRef = useRef<d3.Simulation<GraphNode, d3.SimulationLinkDatum<GraphNode>> | null>(null);
  const [zoom, setZoom] = useState({ x: 0, y: 0, k: 1 });
  const [, tick] = useState(0);
  const genMapRef = useRef<Map<string, number>>(new Map());
  const canvasH = useRef(600);
  const draggedRef = useRef(false);

  // ── Simulation ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;
    const W = svgRef.current.clientWidth || 960;
    const H = svgRef.current.clientHeight || 600;
    canvasH.current = H;

    const gens = assignGenerations(nodes, edges, rootId);
    genMapRef.current = gens;

    // Preserve positions for existing nodes
    const prevPos = new Map<string, { x: number; y: number; fx?: number | null; fy?: number | null }>();
    simRef.current?.nodes().forEach(n => prevPos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, fx: n.fx, fy: n.fy }));

    // Group by generation for initial x spread
    const byGen = new Map<number, string[]>();
    for (const [id, g] of gens) {
      if (!byGen.has(g)) byGen.set(g, []);
      byGen.get(g)!.push(id);
    }

    nodes.forEach(n => {
      const prev = prevPos.get(n.id);
      if (prev) {
        n.x = prev.x; n.y = prev.y; n.fx = prev.fx; n.fy = prev.fy;
      } else {
        const g = gens.get(n.id) ?? 0;
        const row = byGen.get(g) ?? [];
        const idx = row.indexOf(n.id);
        const totalW = (NODE_W + 24) * row.length;
        n.x = W / 2 - totalW / 2 + idx * (NODE_W + 24) + NODE_W / 2;
        n.y = H / 2 + g * LEVEL_HEIGHT + (Math.random() - 0.5) * 8;
      }
    });

    const root = nodes.find(n => n.id === rootId);
    if (root && root.fx === undefined) { root.fx = W / 2; root.fy = H / 2; }

    const linkForce = d3
      .forceLink<GraphNode, d3.SimulationLinkDatum<GraphNode>>(edges as d3.SimulationLinkDatum<GraphNode>[])
      .id(d => d.id)
      .distance(d => {
        const s = String(typeof d.source === "object" ? (d.source as GraphNode).id : d.source);
        const t = String(typeof d.target === "object" ? (d.target as GraphNode).id : d.target);
        const gs = gens.get(s) ?? 0, gt = gens.get(t) ?? 0;
        return gs === gt ? NODE_W + 40 : LEVEL_HEIGHT * 0.85;
      })
      .strength(0.4);

    const sim = d3
      .forceSimulation<GraphNode>(nodes)
      .force("link", linkForce)
      .force("charge", d3.forceManyBody().strength(-600).distanceMax(480))
      .force("y", d3.forceY<GraphNode>().y(d => H / 2 + (gens.get(d.id) ?? 0) * LEVEL_HEIGHT).strength(0.85))
      .force("x", d3.forceX<GraphNode>(W / 2).strength(0.03))
      .force("col", d3.forceCollide<GraphNode>(NODE_W * 0.68).strength(1))
      .alphaDecay(0.022)
      .on("tick", () => tick(t => t + 1));

    simRef.current?.stop();
    simRef.current = sim;

    return () => { sim.stop(); };
  }, [nodes, edges, rootId]);

  // ── Zoom ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return;
    const z = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 4])
      .on("zoom", (e: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        setZoom({ x: e.transform.x, y: e.transform.y, k: e.transform.k });
      });
    zoomRef.current = z;
    d3.select(svgRef.current).call(z);
    return () => { d3.select(svgRef.current!).on(".zoom", null); };
  }, []);

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(600).call(zoomRef.current.transform, d3.zoomIdentity);
  }, []);

  const autoArrange = useCallback(() => {
    if (!svgRef.current || nodes.length === 0) return;
    const W = svgRef.current.clientWidth || 960;
    const H = svgRef.current.clientHeight || 600;
    canvasH.current = H;

    const gens = assignGenerations(nodes, edges, rootId);
    genMapRef.current = gens;

    const byGen = new Map<number, string[]>();
    for (const [id, g] of gens) {
      if (!byGen.has(g)) byGen.set(g, []);
      byGen.get(g)!.push(id);
    }

    // Clear pinned drag positions and re-seed generation layout
    nodes.forEach((n) => {
      n.fx = null;
      n.fy = null;
      const g = gens.get(n.id) ?? 0;
      const row = byGen.get(g) ?? [];
      const idx = row.indexOf(n.id);
      const totalW = (NODE_W + 24) * Math.max(row.length, 1);
      n.x = W / 2 - totalW / 2 + idx * (NODE_W + 24) + NODE_W / 2;
      n.y = H / 2 + g * LEVEL_HEIGHT;
    });

    const root = nodes.find((n) => n.id === rootId);
    if (root) {
      root.fx = W / 2;
      root.fy = H / 2;
      root.x = W / 2;
      root.y = H / 2;
    }

    const sim = simRef.current;
    if (sim) {
      sim.nodes(nodes);
      sim.alpha(1).restart();
    }
    tick((t) => t + 1);
    resetZoom();
  }, [nodes, edges, rootId, resetZoom]);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__treeResetZoom = resetZoom;
    return () => {
      delete (window as unknown as Record<string, unknown>).__treeResetZoom;
    };
  }, [resetZoom]);

  // React to Auto arrange button from the page toolbar
  const arrangeNonceRef = useRef(0);
  useEffect(() => {
    if (!arrangeNonce || arrangeNonce === arrangeNonceRef.current) return;
    arrangeNonceRef.current = arrangeNonce;
    autoArrange();
  }, [arrangeNonce, autoArrange]);

  // ── Drag ────────────────────────────────────────────────────────────────────
  const attachDrag = useCallback((el: SVGGElement | null, node: GraphNode) => {
    if (!el) return;
    const drag = d3.drag<SVGGElement, unknown>()
      .on("start", e => { draggedRef.current = false; if (!e.active) simRef.current?.alphaTarget(0.2).restart(); node.fx = node.x; node.fy = node.y; })
      .on("drag", e => { draggedRef.current = true; node.fx = e.x; node.fy = e.y; })
      .on("end", e => { if (!e.active) simRef.current?.alphaTarget(0); node.fx = e.x; node.fy = e.y; });
    d3.select(el).call(drag);
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const splitLabel = (label: string): [string, string | undefined] => {
    const i = label.indexOf("\n");
    return i === -1 ? [label, undefined] : [label.slice(0, i), label.slice(i + 1)];
  };

  const H = canvasH.current;
  const gens = genMapRef.current;
  const uniqueGens = Array.from(new Set(nodes.map(n => gens.get(n.id) ?? 0)));
  const { x: tX, y: tY, k: tK } = zoom;

  return (
    <svg ref={svgRef} className="absolute inset-0 w-full h-full" style={{ cursor: "grab" }}>
      <defs>
        {Object.entries(REL_COLORS).map(([rel, color]) => (
          <g key={rel}>
            <marker id={`ft-arr-${rel}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} opacity={0.7} />
            </marker>
            <marker id={`ft-arr-start-${rel}`} viewBox="0 0 10 10" refX="2" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} opacity={0.7} />
            </marker>
          </g>
        ))}
        <marker id="ft-arr-default" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={REL_DEFAULT} opacity={0.5} />
        </marker>
        <marker id="ft-arr-start-default" viewBox="0 0 10 10" refX="2" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={REL_DEFAULT} opacity={0.5} />
        </marker>
      </defs>

      <g transform={`translate(${tX},${tY}) scale(${tK})`}>

        {/* ── Generation background bands ─────────────────────────────────── */}
        {uniqueGens.map(g => {
          const bandY = H / 2 + g * LEVEL_HEIGHT;
          const isAncestor = g < 0;
          const color = g === 0 ? "#4DBFEF" : isAncestor ? "#5B9FD8" : "#4DC48A";
          const label = GEN_LABELS[String(g)] ?? "";
          return (
            <g key={`band-${g}`}>
              <rect
                x={-4000} y={bandY - LEVEL_HEIGHT / 2 + 8}
                width={8000} height={LEVEL_HEIGHT - 16}
                fill={`${color}04`}
                stroke={`${color}08`}
                strokeWidth={1}
                rx={16}
              />
              {label && (
                <text
                  x={-3900} y={bandY + 4}
                  style={{ fontSize: "11px", fill: `${color}35`, fontFamily: "'Space Grotesk', sans-serif", userSelect: "none", pointerEvents: "none", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}
                >
                  {label}
                </text>
              )}
            </g>
          );
        })}

        {/* ── Edges ──────────────────────────────────────────────────────── */}
        {edges.map(edge => {
          const src = typeof edge.source === "object" ? edge.source : nodes.find(n => n.id === edge.source);
          const tgt = typeof edge.target === "object" ? edge.target : nodes.find(n => n.id === edge.target);
          if (!src || !tgt || src.x === undefined || tgt.x === undefined) return null;

          const { label: displayLabel, reverse } = displayRelation(edge, nodes, arrowDir);

          // For "in", draw from target→source so arrow + label match inverted relation
          const from = reverse ? tgt : src;
          const to = reverse ? src : tgt;

          const sx = from.x ?? 0, sy = from.y ?? 0;
          const tx = to.x ?? 0, ty = to.y ?? 0;
          const dx = tx - sx, dy = ty - sy;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;

          const startPad = arrowDir === "both" ? 9 : 2;
          const endPad = 9;
          const x1 = sx + (dx / len) * (NODE_W / 2 + startPad);
          const y1 = sy + (dy / len) * (NODE_H / 2 + startPad);
          const x2 = tx - (dx / len) * (NODE_W / 2 + endPad);
          const y2 = ty - (dy / len) * (NODE_H / 2 + endPad);

          const color = relColor(displayLabel);
          const relKey = displayLabel.toLowerCase().split(/\s*\/\s*/)[0]?.trim() ?? "";
          const hasNamed = Boolean(REL_COLORS[relKey]);
          const endMarker = hasNamed ? `ft-arr-${relKey}` : "ft-arr-default";
          const startMarker = hasNamed ? `ft-arr-start-${relKey}` : "ft-arr-start-default";
          const markerEnd = `url(#${endMarker})`;
          const markerStart = arrowDir === "both" ? `url(#${startMarker})` : undefined;

          const isVertical = Math.abs(dy) > Math.abs(dx) * 1.5;
          let pathD: string;
          if (isVertical) {
            const midY = (y1 + y2) / 2;
            pathD = `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
          } else {
            const cx = (x1 + x2) / 2;
            const cy = (y1 + y2) / 2 + dx * 0.06;
            pathD = `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
          }

          const lx = (x1 + x2) / 2;
          const ly = isVertical ? (y1 + y2) / 2 : (y1 + y2) / 2 + dx * 0.03;
          const labelW = Math.max(36, displayLabel.length * 5.2 + 10);

          return (
            <g key={`${edge.id}-${arrowDir}`}>
              <path
                d={pathD}
                fill="none"
                stroke={`${color}70`}
                strokeWidth={2}
                markerEnd={markerEnd}
                markerStart={markerStart}
              />
              {len > 80 && (
                <g>
                  <rect x={lx - labelW / 2} y={ly - 8} width={labelW} height={14} rx={4} fill="oklch(0.14 0.018 255)" opacity={0.85} />
                  <text
                    x={lx} y={ly}
                    textAnchor="middle" dominantBaseline="middle"
                    style={{ fontSize: "8px", fill: color, fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, letterSpacing: "0.04em", pointerEvents: "none", userSelect: "none" }}
                  >
                    {displayLabel}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* ── Nodes ──────────────────────────────────────────────────────── */}
        {nodes.map(node => {
          const g = gens.get(node.id) ?? 0;
          const role = getRole(node.id, rootId, g, edges);
          const style = ROLE_STYLE[role];
          const isRoot = node.id === rootId;
          const isExpanding = expandingIds.has(node.id);
          const x = node.x ?? 0, y = node.y ?? 0;
          const [nameLine, lifeLine] = splitLabel(node.label);
          const nW = isRoot ? NODE_W + 16 : NODE_W;
          const nH = isRoot ? NODE_H + 6 : NODE_H;

          return (
            <g
              key={node.id}
              ref={el => attachDrag(el, node)}
              transform={`translate(${x},${y})`}
              style={{ cursor: "pointer" }}
              onClick={e => {
                if (draggedRef.current) { draggedRef.current = false; return; }
                e.stopPropagation();
                onNodeClick(node);
              }}
            >
              {/* Outer glow for root */}
              {isRoot && (
                <rect
                  x={-nW / 2 - 6} y={-nH / 2 - 6}
                  width={nW + 12} height={nH + 12}
                  rx={NODE_RX + 5} fill="none" stroke={style.border} strokeWidth={1} opacity={0.3}
                />
              )}

              {/* Expanding dashed ring */}
              {isExpanding && (
                <rect
                  x={-nW / 2 - 7} y={-nH / 2 - 7}
                  width={nW + 14} height={nH + 14}
                  rx={NODE_RX + 6} fill="none" stroke={style.border} strokeWidth={1.5}
                  strokeDasharray="8 5" opacity={0.8}
                  style={{ animation: "ft-spin 1.2s linear infinite", transformOrigin: "0 0" }}
                />
              )}

              {/* Node body */}
              <rect
                x={-nW / 2} y={-nH / 2}
                width={nW} height={nH}
                rx={NODE_RX} fill={style.bg} stroke={style.border} strokeWidth={style.strokeW}
              />

              {/* Left color accent bar */}
              <rect
                x={-nW / 2} y={-nH / 2 + NODE_RX}
                width={3} height={nH - NODE_RX * 2}
                fill={style.border} opacity={0.7}
              />

              {/* Name */}
              <text
                y={lifeLine ? -8 : 0}
                textAnchor="middle" dominantBaseline="middle"
                style={{
                  fontSize: isRoot ? "12px" : "10.5px",
                  fill: style.text,
                  fontFamily: "'Space Grotesk', sans-serif",
                  fontWeight: isRoot ? 700 : 600,
                  pointerEvents: "none", userSelect: "none",
                }}
              >
                {nameLine.length > 18 ? nameLine.slice(0, 17) + "…" : nameLine}
              </text>

              {/* Lifespan */}
              {lifeLine && (
                <text
                  y={8}
                  textAnchor="middle" dominantBaseline="middle"
                  style={{ fontSize: "8.5px", fill: style.sub, fontFamily: "'Space Grotesk', sans-serif", pointerEvents: "none", userSelect: "none" }}
                >
                  {lifeLine}
                </text>
              )}
            </g>
          );
        })}
      </g>

      <style>{`@keyframes ft-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}
