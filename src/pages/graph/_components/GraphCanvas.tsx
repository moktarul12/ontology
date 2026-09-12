import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";
import { getEntityTypeConfig } from "@/lib/wikidata/entity-types.ts";

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootId: string;
  onNodeClick: (node: GraphNode) => void;
  onNodeExpand: (node: GraphNode) => void;
  expandingIds: Set<string>;
};

type ZoomTransform = { x: number; y: number; k: number };

/** Rounded-rect sizes by hop from root */
const ROOT_SIZE = { w: 132, h: 48, rx: 12 };
const NEAR_SIZE = { w: 112, h: 42, rx: 10 };
const FAR_SIZE = { w: 96, h: 36, rx: 9 };

function getNodeSize(nodeId: string, rootId: string, edges: GraphEdge[]) {
  if (nodeId === rootId) return ROOT_SIZE;
  const isDirectNeighbor = edges.some((e) => {
    const src = typeof e.source === "object" ? e.source.id : e.source;
    const tgt = typeof e.target === "object" ? e.target.id : e.target;
    return (src === rootId && tgt === nodeId) || (tgt === rootId && src === nodeId);
  });
  return isDirectNeighbor ? NEAR_SIZE : FAR_SIZE;
}

/** Edge attach point on rounded-rect boundary toward (tx,ty). */
function rectEdgePoint(
  cx: number,
  cy: number,
  w: number,
  h: number,
  tx: number,
  ty: number,
  pad = 0,
): { x: number; y: number } {
  const dx = tx - cx;
  const dy = ty - cy;
  const hw = w / 2 + pad;
  const hh = h / 2 + pad;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = Math.abs(dx) / hw;
  const sy = Math.abs(dy) / hh;
  const t = Math.max(sx, sy) || 1;
  return { x: cx + dx / t, y: cy + dy / t };
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

  useEffect(() => {
    if (!svgRef.current) return;
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    const existingPositions = new Map<string, { x: number; y: number; fx?: number | null; fy?: number | null }>();
    simulationRef.current?.nodes().forEach((n) => {
      existingPositions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, fx: n.fx, fy: n.fy });
    });

    nodes.forEach((n) => {
      const prev = existingPositions.get(n.id);
      if (prev) {
        n.x = prev.x;
        n.y = prev.y;
        n.fx = prev.fx;
        n.fy = prev.fy;
      } else if (n.x === undefined) {
        n.x = width / 2 + (Math.random() - 0.5) * 120;
        n.y = height / 2 + (Math.random() - 0.5) * 120;
      }
    });

    const root = nodes.find((n) => n.id === rootId);
    if (root && root.fx === undefined) {
      root.fx = width / 2;
      root.fy = height / 2;
    }

    const linkForce = d3
      .forceLink<GraphNode, d3.SimulationLinkDatum<GraphNode>>(edges as d3.SimulationLinkDatum<GraphNode>[])
      .id((d) => d.id)
      .distance((e) => {
        const src = typeof e.source === "object" ? (e.source as GraphNode).id : e.source;
        const tgt = typeof e.target === "object" ? (e.target as GraphNode).id : e.target;
        const isRoot = src === rootId || tgt === rootId;
        return isRoot ? 180 : 130;
      })
      .strength(0.5);

    const sim = d3
      .forceSimulation<GraphNode>(nodes)
      .force("link", linkForce)
      .force("charge", d3.forceManyBody().strength(-380).distanceMax(500))
      .force("center", d3.forceCenter(width / 2, height / 2).strength(0.04))
      .force(
        "collision",
        d3.forceCollide<GraphNode>().radius((d) => {
          const s = getNodeSize(d.id, rootId, edges);
          return Math.max(s.w, s.h) * 0.55 + 14;
        }),
      )
      .alphaDecay(0.03)
      .on("tick", () => forceRender((t) => t + 1));

    simulationRef.current?.stop();
    simulationRef.current = sim;

    return () => { sim.stop(); };
  }, [nodes, edges, rootId]);

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
        node.fx = event.x;
        node.fy = event.y;
      });
    d3.select(el).call(drag);
  }, []);

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(500)
      .call(zoomRef.current.transform, d3.zoomIdentity);
  }, []);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__graphResetZoom = resetZoom;
    return () => {
      delete (window as unknown as Record<string, unknown>).__graphResetZoom;
    };
  }, [resetZoom]);

  const { x: tX, y: tY, k: tK } = transform;

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full"
      style={{ cursor: "grab" }}
    >
      <defs>
        {(["person", "place", "organization", "event", "concept", "creative", "unknown"] as const).map((type) => {
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
              <path d="M 0 0 L 10 5 L 0 10 z" fill={cfg.hex} opacity={0.55} />
            </marker>
          );
        })}
        <marker id="arrow-default" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#6A7A96" opacity={0.55} />
        </marker>
      </defs>

      <g transform={`translate(${tX},${tY}) scale(${tK})`} ref={gRef}>
        <g className="edges">
          {edges.map((edge) => {
            const src = typeof edge.source === "object" ? edge.source : nodes.find((n) => n.id === edge.source);
            const tgt = typeof edge.target === "object" ? edge.target : nodes.find((n) => n.id === edge.target);
            if (!src || !tgt || src.x === undefined || tgt.x === undefined) return null;

            const sx = src.x ?? 0, sy = src.y ?? 0;
            const tx = tgt.x ?? 0, ty = tgt.y ?? 0;
            const srcSz = getNodeSize(src.id, rootId, edges);
            const tgtSz = getNodeSize(tgt.id, rootId, edges);
            const p1 = rectEdgePoint(sx, sy, srcSz.w, srcSz.h, tx, ty);
            const p2 = rectEdgePoint(tx, ty, tgtSz.w, tgtSz.h, sx, sy, 6);

            const mx = (p1.x + p2.x) / 2 - (p2.y - p1.y) * 0.12;
            const my = (p1.y + p2.y) / 2 + (p2.x - p1.x) * 0.12;
            const pathD = `M${p1.x},${p1.y} Q${mx},${my} ${p2.x},${p2.y}`;
            const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;

            const tgtNode = typeof edge.target === "object" ? edge.target as GraphNode : tgt;
            const markerType = tgtNode.type ?? "unknown";
            const lx = 0.25 * p1.x + 0.5 * mx + 0.25 * p2.x;
            const ly = 0.25 * p1.y + 0.5 * my + 0.25 * p2.y;
            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
            const flipped = angle > 90 || angle < -90;

            return (
              <g key={edge.id}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={`${getEntityTypeConfig(markerType).hex}66`}
                  strokeWidth={1.35}
                  markerEnd={`url(#arrow-${markerType})`}
                />
                {len > 80 && (
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${flipped ? angle + 180 : angle}, ${lx}, ${ly})`}
                    style={{
                      fontSize: "8px",
                      fill: "#5A6A80",
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

        <g className="nodes">
          {nodes.map((node) => {
            const cfg = getEntityTypeConfig(node.type);
            const sz = getNodeSize(node.id, rootId, edges);
            const isRoot = node.id === rootId;
            const isExpanding = expandingIds.has(node.id);
            const x = node.x ?? 0;
            const y = node.y ?? 0;
            const fill = isRoot ? `${cfg.hex}22` : "#FFFFFF";
            const textColor = isRoot ? "#123048" : "#1A2438";
            const subColor = cfg.hex;

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
                {isRoot && (
                  <rect
                    x={-sz.w / 2 - 5}
                    y={-sz.h / 2 - 5}
                    width={sz.w + 10}
                    height={sz.h + 10}
                    rx={sz.rx + 3}
                    fill="none"
                    stroke={cfg.hex}
                    strokeWidth={1}
                    opacity={0.35}
                  />
                )}

                {isExpanding && (
                  <rect
                    x={-sz.w / 2 - 6}
                    y={-sz.h / 2 - 6}
                    width={sz.w + 12}
                    height={sz.h + 12}
                    rx={sz.rx + 4}
                    fill="none"
                    stroke={cfg.hex}
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                    opacity={0.8}
                    style={{ animation: "spin 1.2s linear infinite", transformOrigin: "0 0" }}
                  />
                )}

                <rect
                  x={-sz.w / 2}
                  y={-sz.h / 2}
                  width={sz.w}
                  height={sz.h}
                  rx={sz.rx}
                  fill={fill}
                  stroke={cfg.hex}
                  strokeWidth={isRoot ? 2.5 : 1.75}
                  className="transition-all duration-150"
                />
                <rect
                  x={-sz.w / 2}
                  y={-sz.h / 2 + sz.rx}
                  width={3}
                  height={sz.h - sz.rx * 2}
                  fill={cfg.hex}
                  opacity={0.8}
                />

                <text
                  y={-5}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: isRoot ? "11px" : sz.w > 100 ? "10px" : "9px",
                    fill: textColor,
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 700,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {node.label.length > 16 ? node.label.slice(0, 15) + "…" : node.label}
                </text>
                <text
                  y={10}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: "8px",
                    fill: subColor,
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 600,
                    letterSpacing: "0.04em",
                    pointerEvents: "none",
                    userSelect: "none",
                    textTransform: "uppercase",
                  }}
                >
                  {cfg.label}
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
