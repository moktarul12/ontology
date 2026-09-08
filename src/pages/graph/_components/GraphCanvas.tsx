import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";
import { getEntityTypeConfig } from "@/lib/wikidata/entity-types.ts";
import { cn } from "@/lib/utils.ts";

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootId: string;
  onNodeClick: (node: GraphNode) => void;
  onNodeExpand: (node: GraphNode) => void;
  expandingIds: Set<string>;
};

type ZoomTransform = { x: number; y: number; k: number };

// Node display sizes
const ROOT_RADIUS = 28;
const NODE_RADIUS = 20;
const MINI_RADIUS = 14;

// How many hops from root a node is
function getNodeRadius(nodeId: string, rootId: string, edges: GraphEdge[]): number {
  if (nodeId === rootId) return ROOT_RADIUS;
  const isDirectNeighbor = edges.some((e) => {
    const src = typeof e.source === "object" ? e.source.id : e.source;
    const tgt = typeof e.target === "object" ? e.target.id : e.target;
    return (src === rootId && tgt === nodeId) || (tgt === rootId && src === nodeId);
  });
  return isDirectNeighbor ? NODE_RADIUS : MINI_RADIUS;
}

export default function GraphCanvas({
  nodes,
  edges,
  rootId,
  onNodeClick,
  onNodeExpand,
  expandingIds,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, d3.SimulationLinkDatum<GraphNode>> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>({ x: 0, y: 0, k: 1 });
  const [, forceRender] = useState(0);
  const draggedRef = useRef(false);

  // ── Initialize simulation ──────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return;
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    // Preserve existing positions when adding new nodes
    const existingPositions = new Map<string, { x: number; y: number; fx?: number | null; fy?: number | null }>();
    simulationRef.current?.nodes().forEach((n) => {
      existingPositions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, fx: n.fx, fy: n.fy });
    });

    // Apply preserved positions to new nodes list
    nodes.forEach((n) => {
      const prev = existingPositions.get(n.id);
      if (prev) {
        n.x = prev.x;
        n.y = prev.y;
        n.fx = prev.fx;
        n.fy = prev.fy;
      } else if (n.x === undefined) {
        // New node — scatter near center
        n.x = width / 2 + (Math.random() - 0.5) * 120;
        n.y = height / 2 + (Math.random() - 0.5) * 120;
      }
    });

    // Pin root node to center initially
    const root = nodes.find((n) => n.id === rootId);
    if (root && root.fx === undefined) {
      root.fx = width / 2;
      root.fy = height / 2;
    }

    // Build simulation
    const linkForce = d3
      .forceLink<GraphNode, d3.SimulationLinkDatum<GraphNode>>(edges as d3.SimulationLinkDatum<GraphNode>[])
      .id((d) => d.id)
      .distance((e) => {
        const src = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
        const tgt = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
        const isRoot = src === rootId || tgt === rootId;
        return isRoot ? 160 : 110;
      })
      .strength(0.5);

    const sim = d3
      .forceSimulation<GraphNode>(nodes)
      .force("link", linkForce)
      .force("charge", d3.forceManyBody().strength(-320).distanceMax(500))
      .force("center", d3.forceCenter(width / 2, height / 2).strength(0.04))
      .force("collision", d3.forceCollide<GraphNode>().radius((d) => getNodeRadius(d.id, rootId, edges) + 12))
      .alphaDecay(0.03)
      .on("tick", () => forceRender((t) => t + 1));

    simulationRef.current?.stop();
    simulationRef.current = sim;

    return () => { sim.stop(); };
  }, [nodes, edges, rootId]);

  // ── Zoom & pan ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return;
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        setTransform({ x: event.transform.x, y: event.transform.y, k: event.transform.k });
      });
    zoomRef.current = zoom;
    d3.select(svgRef.current).call(zoom);
    return () => { d3.select(svgRef.current!).on(".zoom", null); };
  }, []);

  // ── Drag behavior per node ─────────────────────────────────────────────────
  const attachDrag = useCallback((el: SVGGElement | null, node: GraphNode) => {
    if (!el) return;
    const drag = d3.drag<SVGGElement, unknown>()
      .on("start", (event) => {
        draggedRef.current = false;
        if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
        node.fx = node.x;
        node.fy = node.y;
      })
      .on("drag", (event) => {
        draggedRef.current = true;
        node.fx = event.x;
        node.fy = event.y;
      })
      .on("end", (event) => {
        if (!event.active) simulationRef.current?.alphaTarget(0);
        // Keep pinned after drag
        node.fx = event.x;
        node.fy = event.y;
      });
    d3.select(el).call(drag);
  }, []);

  // ── Reset zoom ─────────────────────────────────────────────────────────────
  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(500)
      .call(zoomRef.current.transform, d3.zoomIdentity);
  }, []);

  // Expose reset to parent via imperative handle — pass via prop instead
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__graphResetZoom = resetZoom;
  }, [resetZoom]);

  const tX = transform.x;
  const tY = transform.y;
  const tK = transform.k;

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full"
      style={{ cursor: "grab" }}
    >
      <defs>
        {/* Arrow markers per entity type */}
        {(["person", "place", "organization", "concept", "event", "unknown"] as const).map((type) => {
          const cfg = getEntityTypeConfig(type);
          return (
            <marker
              key={type}
              id={`arrow-${type}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={cfg.hex} opacity={0.5} />
            </marker>
          );
        })}
        <marker id="arrow-default" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#4a5568" opacity={0.6} />
        </marker>
      </defs>

      <g transform={`translate(${tX},${tY}) scale(${tK})`} ref={gRef}>
        {/* ── Edges ─────────────────────────────────────────────────────── */}
        <g className="edges">
          {edges.map((edge) => {
            const src = typeof edge.source === "object" ? edge.source : nodes.find((n) => n.id === edge.source);
            const tgt = typeof edge.target === "object" ? edge.target : nodes.find((n) => n.id === edge.target);
            if (!src || !tgt || src.x === undefined || tgt.x === undefined) return null;

            const sx = src.x ?? 0, sy = src.y ?? 0;
            const tx = tgt.x ?? 0, ty = tgt.y ?? 0;
            const dx = tx - sx, dy = ty - sy;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            // Offset endpoints to edge of node circles
            const srcR = getNodeRadius(src.id, rootId, edges);
            const tgtR = getNodeRadius(tgt.id, rootId, edges) + 6; // +6 for arrow
            const x1 = sx + (dx / len) * srcR;
            const y1 = sy + (dy / len) * srcR;
            const x2 = tx - (dx / len) * tgtR;
            const y2 = ty - (dy / len) * tgtR;

            // Curved line
            const mx = (x1 + x2) / 2 - dy * 0.12;
            const my = (y1 + y2) / 2 + dx * 0.12;
            const pathD = `M${x1},${y1} Q${mx},${my} ${x2},${y2}`;

            const tgtNode = typeof edge.target === "object" ? edge.target as GraphNode : tgt;
            const markerType = tgtNode.type ?? "unknown";

            // Label midpoint along quadratic bezier at t=0.5
            const lx = 0.25 * x1 + 0.5 * mx + 0.25 * x2;
            const ly = 0.25 * y1 + 0.5 * my + 0.25 * y2;
            // Text angle
            const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
            const flipped = angle > 90 || angle < -90;

            return (
              <g key={edge.id}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={`${getEntityTypeConfig(markerType).hex}55`}
                  strokeWidth={1.2}
                  markerEnd={`url(#arrow-${markerType})`}
                />
                {/* Edge label */}
                {len > 80 && (
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${flipped ? angle + 180 : angle}, ${lx}, ${ly})`}
                    style={{
                      fontSize: "8px",
                      fill: "oklch(0.55 0.04 230)",
                      fontFamily: "'Space Grotesk', sans-serif",
                      pointerEvents: "none",
                      userSelect: "none",
                    }}
                  >
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* ── Nodes ─────────────────────────────────────────────────────── */}
        <g className="nodes">
          {nodes.map((node) => {
            const cfg = getEntityTypeConfig(node.type);
            const r = getNodeRadius(node.id, rootId, edges);
            const isRoot = node.id === rootId;
            const isExpanding = expandingIds.has(node.id);
            const x = node.x ?? 0;
            const y = node.y ?? 0;

            return (
              <g
                key={node.id}
                ref={(el) => attachDrag(el, node)}
                transform={`translate(${x},${y})`}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  if (draggedRef.current) { draggedRef.current = false; return; }
                  e.stopPropagation();
                  onNodeClick(node);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onNodeExpand(node);
                }}
              >
                {/* Glow for root */}
                {isRoot && (
                  <circle
                    r={r + 8}
                    fill="none"
                    stroke={cfg.hex}
                    strokeWidth={1}
                    opacity={0.25}
                  />
                )}

                {/* Spinning ring when expanding */}
                {isExpanding && (
                  <circle
                    r={r + 5}
                    fill="none"
                    stroke={cfg.hex}
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                    opacity={0.8}
                    style={{ animation: "spin 1.2s linear infinite", transformOrigin: "0 0" }}
                  />
                )}

                {/* Node circle */}
                <circle
                  r={r}
                  fill={`${cfg.hex}22`}
                  stroke={cfg.hex}
                  strokeWidth={isRoot ? 2.5 : 1.5}
                  className="transition-all duration-150"
                />

                {/* Type initial letter */}
                <text
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: isRoot ? "13px" : r > 16 ? "11px" : "9px",
                    fill: cfg.hex,
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 700,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {node.type === "person" ? "P" :
                   node.type === "place" ? "L" :
                   node.type === "organization" ? "O" :
                   node.type === "event" ? "E" :
                   node.type === "concept" ? "C" : "?"}
                </text>

                {/* Node label below */}
                <text
                  y={r + 10}
                  textAnchor="middle"
                  dominantBaseline="hanging"
                  style={{
                    fontSize: isRoot ? "11px" : "9px",
                    fill: isRoot ? "oklch(0.93 0.01 220)" : "oklch(0.75 0.02 220)",
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: isRoot ? 600 : 400,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {node.label.length > 18 ? node.label.slice(0, 17) + "…" : node.label}
                </text>
              </g>
            );
          })}
        </g>
      </g>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </svg>
  );
}
