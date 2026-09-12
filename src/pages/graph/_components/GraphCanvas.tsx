import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";
import { getEntityTypeConfig } from "@/lib/wikidata/entity-types.ts";
import {
  isKnowledgeHub,
  hubColorForProperty,
  isHubMoreNode,
} from "../_lib/relationHubs.ts";
import { layoutKnowledgeGraph } from "../_lib/knowledgeLayout.ts";
import {
  routeOrbitEdge,
  routeLabelPoint,
} from "@/pages/family-tree/_lib/orbitEdgeRouter.ts";

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootId: string;
  onNodeClick: (node: GraphNode) => void;
  onNodeExpand: (node: GraphNode) => void;
  expandingIds: Set<string>;
};

type ZoomTransform = { x: number; y: number; k: number };

const HUB_SIZE = { w: 96, h: 34, rx: 14 };
const ROOT_SIZE = { w: 132, h: 48, rx: 12 };
const NEAR_SIZE = { w: 112, h: 42, rx: 10 };
const FAR_SIZE = { w: 96, h: 36, rx: 9 };

function idOf(v: string | GraphNode): string {
  return typeof v === "object" ? v.id : v;
}

/** Approximate text width so labels are never clipped with ellipsis. */
function labelWidth(label: string, fontSize: number, pad = 28): number {
  return Math.ceil(label.length * fontSize * 0.62) + pad;
}

function getNodeSize(node: GraphNode, rootId: string, edges: GraphEdge[]) {
  if (isHubMoreNode(node)) {
    return { w: Math.max(HUB_SIZE.w, labelWidth(node.label, 10, 24)), h: HUB_SIZE.h, rx: HUB_SIZE.rx };
  }
  if (isKnowledgeHub(node)) {
    const w = Math.min(200, Math.max(HUB_SIZE.w, labelWidth(node.label, 10, 26)));
    const h = node.hubTotal != null ? 36 : HUB_SIZE.h;
    return { w, h, rx: HUB_SIZE.rx };
  }
  if (node.id === rootId) {
    return {
      w: Math.min(240, Math.max(ROOT_SIZE.w, labelWidth(node.label, 11, 36))),
      h: ROOT_SIZE.h,
      rx: ROOT_SIZE.rx,
    };
  }
  const isDirectNeighbor = edges.some((e) => {
    const src = idOf(e.source);
    const tgt = idOf(e.target);
    return (
      (src === rootId && tgt === node.id) ||
      (tgt === rootId && src === node.id) ||
      (src.startsWith("khub:") && tgt === node.id) ||
      (tgt.startsWith("khub:") && src === node.id)
    );
  });
  const base = isDirectNeighbor ? NEAR_SIZE : FAR_SIZE;
  const fontSize = isDirectNeighbor ? 10 : 9;
  return {
    w: Math.min(220, Math.max(base.w, labelWidth(node.label, fontSize, 32))),
    h: base.h,
    rx: base.rx,
  };
}

/** Approximate edge attach point on a rounded rect (for orbit router endpoints). */
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
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>({ x: 0, y: 0, k: 1 });
  const [, forceRender] = useState(0);
  const draggedRef = useRef(false);
  const layoutKeyRef = useRef("");

  // Zoom behavior
  useEffect(() => {
    if (!svgRef.current) return;
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.08, 4])
      .on("zoom", (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        setTransform({ x: event.transform.x, y: event.transform.y, k: event.transform.k });
      });
    zoomRef.current = zoom;
    d3.select(svgRef.current).call(zoom);
    return () => {
      d3.select(svgRef.current!).on(".zoom", null);
    };
  }, []);

  // Deterministic sector layout (no force tangle)
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;
    const W = Math.max(svgRef.current.clientWidth || 0, 640);
    const H = Math.max(svgRef.current.clientHeight || 0, 480);

    const key = `${rootId}|${nodes.map((n) => n.id).join(",")}|${edges.length}`;
    const bounds = layoutKnowledgeGraph(nodes, edges, rootId, W, H);
    forceRender((t) => t + 1);

    const shouldFit = layoutKeyRef.current !== key;
    layoutKeyRef.current = key;

    if (shouldFit) {
      requestAnimationFrame(() => {
        if (!svgRef.current || !zoomRef.current) return;
        const pad = 80;
        const bw = Math.max(bounds.maxX - bounds.minX + pad * 2, 1);
        const bh = Math.max(bounds.maxY - bounds.minY + pad * 2, 1);
        const vw = svgRef.current.clientWidth || W;
        const vh = svgRef.current.clientHeight || H;
        const k = Math.min(vw / bw, vh / bh, 1.15);
        const tx = vw / 2 - k * ((bounds.minX + bounds.maxX) / 2);
        const ty = vh / 2 - k * ((bounds.minY + bounds.maxY) / 2);
        d3.select(svgRef.current)
          .transition()
          .duration(380)
          .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
      });
    }
  }, [nodes, edges, rootId]);

  const attachDrag = useCallback((el: SVGGElement | null, node: GraphNode) => {
    if (!el) return;
    const drag = d3
      .drag<SVGGElement, unknown>()
      .on("start", () => {
        draggedRef.current = false;
      })
      .on("drag", (event) => {
        draggedRef.current = true;
        node.x = event.x;
        node.y = event.y;
        node.fx = event.x;
        node.fy = event.y;
        forceRender((t) => t + 1);
      })
      .on("end", (event) => {
        node.fx = event.x;
        node.fy = event.y;
      });
    d3.select(el).call(drag);
  }, []);

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current || nodes.length === 0) return;
    const W = Math.max(svgRef.current.clientWidth || 0, 640);
    const H = Math.max(svgRef.current.clientHeight || 0, 480);
    const bounds = layoutKnowledgeGraph(nodes, edges, rootId, W, H);
    forceRender((t) => t + 1);
    const pad = 80;
    const bw = Math.max(bounds.maxX - bounds.minX + pad * 2, 1);
    const bh = Math.max(bounds.maxY - bounds.minY + pad * 2, 1);
    const k = Math.min(W / bw, H / bh, 1.15);
    const tx = W / 2 - k * ((bounds.minX + bounds.maxX) / 2);
    const ty = H / 2 - k * ((bounds.minY + bounds.maxY) / 2);
    d3.select(svgRef.current)
      .transition()
      .duration(450)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }, [nodes, edges, rootId]);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__graphResetZoom = resetZoom;
    return () => {
      delete (window as unknown as Record<string, unknown>).__graphResetZoom;
    };
  }, [resetZoom]);

  const { x: tX, y: tY, k: tK } = transform;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 w-full h-full"
      style={{ cursor: "grab" }}
    >
      <defs>
        {(["person", "place", "organization", "event", "concept", "work", "unknown"] as const).map((type) => {
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

      <g transform={`translate(${tX},${tY}) scale(${tK})`}>
        <g className="edges">
          {edges.map((edge) => {
            const src = typeof edge.source === "object" ? edge.source : byId.get(String(edge.source));
            const tgt = typeof edge.target === "object" ? edge.target : byId.get(String(edge.target));
            if (!src || !tgt || src.x === undefined || tgt.x === undefined) return null;

            const sx = src.x ?? 0;
            const sy = src.y ?? 0;
            const tx = tgt.x ?? 0;
            const ty = tgt.y ?? 0;
            const srcSz = getNodeSize(src, rootId, edges);
            const tgtSz = getNodeSize(tgt, rootId, edges);
            const isHubEdge = edge.propertyId === "HUB";
            const p1 = rectEdgePoint(sx, sy, srcSz.w, srcSz.h, tx, ty);
            const p2 = rectEdgePoint(tx, ty, tgtSz.w, tgtSz.h, sx, sy, isHubEdge ? 2 : 4);

            const skip = new Set([src.id, tgt.id]);
            const pathD = routeOrbitEdge(p1.x, p1.y, p2.x, p2.y, nodes, skip, {
              preferStraight: isHubEdge,
              pad: 8,
              rootId,
            });
            const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
            const { x: lx, y: ly } = routeLabelPoint(p1.x, p1.y, p2.x, p2.y, pathD);

            const hubNode = isKnowledgeHub(src) ? src : isKnowledgeHub(tgt) ? tgt : null;
            const stroke = hubNode?.hubPropertyId
              ? `${hubColorForProperty(hubNode.hubPropertyId)}99`
              : `${getEntityTypeConfig(tgt.type).hex}77`;

            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
            const flipped = angle > 90 || angle < -90;

            return (
              <g key={edge.id}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isHubEdge ? 1.7 : 1.35}
                  markerEnd={isHubEdge ? undefined : `url(#arrow-${tgt.type ?? "unknown"})`}
                />
                {!isHubEdge && edge.label && len > 80 && (
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
            const isHub = isKnowledgeHub(node);
            const cfg = getEntityTypeConfig(node.type);
            const sz = getNodeSize(node, rootId, edges);
            const isRoot = node.id === rootId;
            const isExpanding = expandingIds.has(node.id);
            const x = node.x ?? 0;
            const y = node.y ?? 0;

            if (isHub) {
              const color = hubColorForProperty(node.hubPropertyId ?? "");
              const isMore = isHubMoreNode(node);
              const countLabel =
                !isMore && node.hubTotal != null && node.hubShown != null && node.hubTotal > node.hubShown
                  ? `${node.hubShown}/${node.hubTotal}`
                  : !isMore && node.hubTotal != null
                    ? `${node.hubTotal}`
                    : null;
              return (
                <g
                  key={node.id}
                  ref={(el) => attachDrag(el, node)}
                  transform={`translate(${x},${y})`}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    if (draggedRef.current) {
                      draggedRef.current = false;
                      return;
                    }
                    e.stopPropagation();
                    onNodeClick(node);
                  }}
                >
                  {isExpanding && (
                    <rect
                      x={-sz.w / 2 - 5}
                      y={-sz.h / 2 - 5}
                      width={sz.w + 10}
                      height={sz.h + 10}
                      rx={sz.rx + 2}
                      fill="none"
                      stroke={color}
                      strokeWidth={1.5}
                      strokeDasharray="5 4"
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
                    fill={isMore ? "#FFFFFF" : color}
                    stroke={color}
                    strokeWidth={isMore ? 1.75 : 1}
                    strokeDasharray={isMore ? "4 3" : undefined}
                  />
                  <text
                    y={countLabel ? -5 : 0}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{
                      fontSize: "10px",
                      fill: isMore ? color : "#FFFFFF",
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontWeight: 700,
                      letterSpacing: "0.02em",
                      pointerEvents: "none",
                      userSelect: "none",
                    }}
                  >
                    {node.label}
                  </text>
                  {countLabel && (
                    <text
                      y={8}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      style={{
                        fontSize: "8px",
                        fill: "#FFFFFF",
                        fontFamily: "'Space Grotesk', sans-serif",
                        fontWeight: 600,
                        opacity: 0.9,
                        pointerEvents: "none",
                        userSelect: "none",
                      }}
                    >
                      {countLabel}
                    </text>
                  )}
                </g>
              );
            }

            const fill = isRoot ? `${cfg.hex}22` : "#FFFFFF";
            const textColor = isRoot ? "#123048" : "#1A2438";

            return (
              <g
                key={node.id}
                ref={(el) => attachDrag(el, node)}
                transform={`translate(${x},${y})`}
                style={{ cursor: "pointer" }}
                onClick={(e) => {
                  if (draggedRef.current) {
                    draggedRef.current = false;
                    return;
                  }
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
                  {node.label}
                </text>
                <text
                  y={10}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: "8px",
                    fill: cfg.hex,
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
