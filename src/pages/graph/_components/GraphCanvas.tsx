import { useEffect, useRef, useState, useCallback } from "react";
import * as d3 from "d3";
import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";
import { getEntityTypeConfig } from "@/lib/wikidata/entity-types.ts";
import {
  isKnowledgeHub,
  hubColorForProperty,
  isHubMoreNode,
  isFamilyRelation,
} from "../_lib/relationHubs.ts";
import { layoutKnowledgeGraph, type GraphArrangeMode } from "../_lib/knowledgeLayout.ts";
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
  /** Open details without expanding (e.g. double-click) */
  onNodeInspect?: (node: GraphNode) => void;
  expandingIds: Set<string>;
  arrangeMode?: GraphArrangeMode;
  /** Bump to force re-layout + fit after drag mess */
  arrangeNonce?: number;
};

type ZoomTransform = { x: number; y: number; k: number };

const HUB_SIZE = { w: 96, h: 34, rx: 14 };
const ROOT_SIZE = { w: 132, h: 48, rx: 12 };
const NEAR_SIZE = { w: 112, h: 42, rx: 10 };
const FAR_SIZE = { w: 96, h: 36, rx: 9 };

function idOf(v: string | GraphNode): string {
  return typeof v === "object" ? v.id : v;
}

/** Undirected hop distance from root (for arrow orientation toward center). */
function hopDistanceFromRoot(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
): Map<string, number> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    const s = idOf(e.source);
    const t = idOf(e.target);
    if (!adj.has(s)) adj.set(s, []);
    if (!adj.has(t)) adj.set(t, []);
    adj.get(s)!.push(t);
    adj.get(t)!.push(s);
  }
  const hops = new Map<string, number>();
  const q: string[] = [rootId];
  hops.set(rootId, 0);
  while (q.length) {
    const cur = q.shift()!;
    const d = hops.get(cur) ?? 0;
    for (const nb of adj.get(cur) ?? []) {
      if (hops.has(nb)) continue;
      hops.set(nb, d + 1);
      q.push(nb);
    }
  }
  return hops;
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
  onNodeInspect,
  expandingIds,
  arrangeMode = "orbit",
  arrangeNonce = 0,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>({ x: 0, y: 0, k: 1 });
  const [, forceRender] = useState(0);
  const draggedRef = useRef(false);
  const layoutKeyRef = useRef("");
  const arrangeNonceRef = useRef(arrangeNonce);
  const [hoveredHubId, setHoveredHubId] = useState<string | null>(null);

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

    // Clear drag pins so Auto arrange can reclaim positions
    for (const n of nodes) {
      n.fx = undefined;
      n.fy = undefined;
    }

    const key = `${rootId}|${nodes.map((n) => n.id).join(",")}|${edges.length}|${arrangeMode}|${arrangeNonce}`;
    const bounds = layoutKnowledgeGraph(nodes, edges, rootId, W, H, arrangeMode);
    forceRender((t) => t + 1);

    const arrangeChanged = arrangeNonceRef.current !== arrangeNonce;
    arrangeNonceRef.current = arrangeNonce;
    const shouldFit = layoutKeyRef.current !== key || arrangeChanged;
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
  }, [nodes, edges, rootId, arrangeMode, arrangeNonce]);

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
    for (const n of nodes) {
      n.fx = undefined;
      n.fy = undefined;
    }
    const bounds = layoutKnowledgeGraph(nodes, edges, rootId, W, H, arrangeMode);
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
  }, [nodes, edges, rootId, arrangeMode]);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__graphResetZoom = resetZoom;
    return () => {
      delete (window as unknown as Record<string, unknown>).__graphResetZoom;
    };
  }, [resetZoom]);

  const { x: tX, y: tY, k: tK } = transform;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const hops = hopDistanceFromRoot(nodes, edges, rootId);
  const rootNode = byId.get(rootId);
  const rootX = rootNode?.x ?? 0;
  const rootY = rootNode?.y ?? 0;

  /** True when `a` is closer to the focus center than `b` (hop, then geometry). */
  const closerToCenter = (a: GraphNode, b: GraphNode): boolean => {
    const ha = hops.get(a.id);
    const hb = hops.get(b.id);
    if (ha != null && hb != null && ha !== hb) return ha < hb;
    const da = Math.hypot((a.x ?? 0) - rootX, (a.y ?? 0) - rootY);
    const db = Math.hypot((b.x ?? 0) - rootX, (b.y ?? 0) - rootY);
    return da <= db;
  };

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
        <marker id="arrow-hub" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#7A8AA0" opacity={0.5} />
        </marker>
      </defs>

      <g transform={`translate(${tX},${tY}) scale(${tK})`}>
        <g className="edges">
          {edges.map((edge) => {
            const src = typeof edge.source === "object" ? edge.source : byId.get(String(edge.source));
            const tgt = typeof edge.target === "object" ? edge.target : byId.get(String(edge.target));
            if (!src || !tgt || src.x === undefined || tgt.x === undefined) return null;

            // Draw periphery → center so the arrow always points toward the main node
            const towardCenter = closerToCenter(tgt, src);
            const from = towardCenter ? src : tgt;
            const to = towardCenter ? tgt : src;

            const fx = from.x ?? 0;
            const fy = from.y ?? 0;
            const tx = to.x ?? 0;
            const ty = to.y ?? 0;
            const fromSz = getNodeSize(from, rootId, edges);
            const toSz = getNodeSize(to, rootId, edges);
            const isHubEdge = edge.propertyId === "HUB";
            const p1 = rectEdgePoint(fx, fy, fromSz.w, fromSz.h, tx, ty);
            const p2 = rectEdgePoint(tx, ty, toSz.w, toSz.h, fx, fy, isHubEdge ? 2 : 4);

            const skip = new Set([from.id, to.id]);
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
              : `${getEntityTypeConfig(to.type).hex}77`;

            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
            const flipped = angle > 90 || angle < -90;
            const arrowMarker = isHubEdge
              ? "url(#arrow-hub)"
              : `url(#arrow-${to.type ?? "unknown"})`;

            return (
              <g key={edge.id}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isHubEdge ? 1.7 : 1.35}
                  markerEnd={arrowMarker}
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
              const isFamilyCollapsed =
                !isMore &&
                isFamilyRelation(node.hubPropertyId ?? "") &&
                (node.hubShown ?? 0) === 0;
              const showExpandCue = isFamilyCollapsed && hoveredHubId === node.id;
              const countLabel =
                isFamilyCollapsed && node.hubTotal != null
                  ? `${node.hubTotal}`
                  : !isMore && node.hubTotal != null && node.hubShown != null && node.hubTotal > node.hubShown
                    ? `${node.hubShown}/${node.hubTotal}`
                    : !isMore && node.hubTotal != null
                      ? `${node.hubTotal}`
                      : null;
              return (
                <g
                  key={node.id}
                  ref={(el) => attachDrag(el, node)}
                  transform={`translate(${x},${y})`}
                  style={{ cursor: isFamilyCollapsed ? "default" : "pointer" }}
                  onMouseEnter={() => {
                    if (isFamilyCollapsed) setHoveredHubId(node.id);
                  }}
                  onMouseLeave={() => {
                    setHoveredHubId((cur) => (cur === node.id ? null : cur));
                  }}
                  onClick={(e) => {
                    if (draggedRef.current) {
                      draggedRef.current = false;
                      return;
                    }
                    e.stopPropagation();
                    if (isFamilyCollapsed) return;
                    onNodeClick(node);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (isFamilyCollapsed) {
                      onNodeExpand(node);
                      return;
                    }
                    onNodeExpand(node);
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
                    strokeWidth={isMore || isFamilyCollapsed ? 1.75 : 1}
                    strokeDasharray={isMore || isFamilyCollapsed ? "4 3" : undefined}
                    opacity={isFamilyCollapsed ? 0.92 : 1}
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
                        fill: isMore ? color : "#FFFFFF",
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
                  {showExpandCue && (
                    <g
                      transform={`translate(0, ${sz.h / 2 + 18})`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onNodeExpand(node);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <rect
                        x={-34}
                        y={-11}
                        width={68}
                        height={22}
                        rx={11}
                        fill="#0f172a"
                        stroke={color}
                        strokeWidth={1.25}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="middle"
                        style={{
                          fontSize: "10px",
                          fill: "#FFFFFF",
                          fontFamily: "'Space Grotesk', sans-serif",
                          fontWeight: 700,
                          pointerEvents: "none",
                          userSelect: "none",
                        }}
                      >
                        Expand
                      </text>
                    </g>
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
                  if (onNodeInspect) onNodeInspect(node);
                  else onNodeExpand(node);
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
