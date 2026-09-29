import { useEffect, useRef, useState, useCallback, type ComponentType, type CSSProperties } from "react";
import * as d3 from "d3";
import {
  User, MapPin, Building2, Lightbulb, Calendar, HelpCircle, Film, Award, Layers,
} from "lucide-react";
import type { EntityType, GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";
import { getEntityTypeConfig } from "@/lib/wikidata/entity-types.ts";
import {
  isKnowledgeHub,
  hubColorForProperty,
  isHubMoreNode,
  isCollapsedRelationHub,
} from "../_lib/relationHubs.ts";
import { layoutKnowledgeGraph, type GraphArrangeMode } from "../_lib/knowledgeLayout.ts";
import {
  routeKnowledgeEdge,
  knowledgeEdgeLabelPoint,
} from "../_lib/knowledgeEdges.ts";

const TYPE_ICONS: Record<EntityType, ComponentType<{ className?: string; style?: CSSProperties }>> = {
  person: User,
  place: MapPin,
  organization: Building2,
  concept: Lightbulb,
  event: Calendar,
  work: Film,
  unknown: HelpCircle,
};

function iconForNode(node: GraphNode) {
  if (isKnowledgeHub(node)) return Layers;
  if (/award|prize|padma|oscar|filmfare/i.test(node.label) || node.hubPropertyId === "P166") {
    return Award;
  }
  return TYPE_ICONS[node.type] ?? HelpCircle;
}

type Props = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  rootId: string;
  /** Single click → details flyout */
  onNodeClick: (node: GraphNode) => void;
  /** Double-click → expand neighbors / hub targets */
  onNodeExpand: (node: GraphNode) => void;
  expandingIds: Set<string>;
  arrangeMode?: GraphArrangeMode;
  /** Bump to force re-layout + fit after drag mess */
  arrangeNonce?: number;
  /** Portrait for the focus root card */
  rootThumbnail?: string;
  rootSubtitle?: string;
};

type ZoomTransform = { x: number; y: number; k: number };

const HUB_SIZE = { w: 118, h: 34, rx: 17 };
const ROOT_SIZE = { w: 200, h: 72, rx: 16 };
const NEAR_SIZE = { w: 158, h: 52, rx: 12 };
const FAR_SIZE = { w: 138, h: 46, rx: 11 };

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
    const w = Math.min(220, Math.max(HUB_SIZE.w, labelWidth(node.label, 10, 48)));
    return { w, h: HUB_SIZE.h, rx: HUB_SIZE.rx };
  }
  if (node.id === rootId) {
    return {
      w: Math.min(240, Math.max(ROOT_SIZE.w, labelWidth(node.label, 13, 88))),
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
    w: Math.min(230, Math.max(base.w, labelWidth(node.label, fontSize, 56))),
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

function HoverExpandChip({
  visible,
  color,
  x,
  y,
  busy,
  onExpand,
}: {
  visible: boolean;
  color: string;
  x: number;
  y: number;
  busy?: boolean;
  onExpand: () => void;
}) {
  if (!visible && !busy) return null;
  return (
    <g
      transform={`translate(${x}, ${y})`}
      style={{
        cursor: busy ? "wait" : "pointer",
        opacity: visible || busy ? 1 : 0,
        transition: "opacity 0.15s ease, transform 0.18s ease",
        transformOrigin: "0 0",
      }}
      className="kg-expand-chip"
      onMouseDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
      }}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (!busy) onExpand();
      }}
    >
      {/* Soft bloom */}
      <circle r={18} fill={color} opacity={0.16} style={{ animation: "kg-pulse 1.6s ease-in-out infinite" }} />
      <circle r={14} fill="#FFFFFF" stroke={color} strokeWidth={1.75} />
      {/* Plus / branching mark */}
      {!busy ? (
        <>
          <line x1={-5} y1={0} x2={5} y2={0} stroke={color} strokeWidth={2.1} strokeLinecap="round" />
          <line x1={0} y1={-5} x2={0} y2={5} stroke={color} strokeWidth={2.1} strokeLinecap="round" />
          <circle r={2.2} fill={color} cx={0} cy={0} opacity={0.95} />
        </>
      ) : (
        <circle
          r={6}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="8 5"
          style={{ animation: "spin 0.8s linear infinite", transformOrigin: "0 0" }}
        />
      )}
      {/* Caption pill */}
      <g transform="translate(0, 22)">
        <rect
          x={-28}
          y={-8}
          width={56}
          height={16}
          rx={8}
          fill="#FFFFFF"
          stroke={color}
          strokeWidth={1}
          opacity={0.98}
        />
        <text
          textAnchor="middle"
          dominantBaseline="middle"
          style={{
            fontSize: "8px",
            fontWeight: 700,
            fill: "#0f172a",
            fontFamily: "'Space Grotesk', sans-serif",
            letterSpacing: "0.06em",
            pointerEvents: "none",
            userSelect: "none",
            textTransform: "uppercase",
          }}
        >
          {busy ? "…" : "Expand"}
        </text>
      </g>
    </g>
  );
}

export default function GraphCanvas({
  nodes,
  edges,
  rootId,
  onNodeClick,
  onNodeExpand,
  expandingIds,
  arrangeMode = "orbit",
  arrangeNonce = 0,
  rootThumbnail,
  rootSubtitle,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>({ x: 0, y: 0, k: 1 });
  const [, forceRender] = useState(0);
  const draggedRef = useRef(false);
  const layoutKeyRef = useRef("");
  const arrangeNonceRef = useRef(arrangeNonce);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clickNodeIdRef = useRef<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleNodePointerClick = useCallback(
    (node: GraphNode) => {
      if (draggedRef.current) {
        draggedRef.current = false;
        return;
      }
      if (clickTimerRef.current && clickNodeIdRef.current === node.id) {
        // Second click within window — wait for dblclick
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        clickNodeIdRef.current = null;
        return;
      }
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      clickNodeIdRef.current = node.id;
      clickTimerRef.current = setTimeout(() => {
        clickTimerRef.current = null;
        clickNodeIdRef.current = null;
        onNodeClick(node);
      }, 240);
    },
    [onNodeClick],
  );

  const handleNodePointerDblClick = useCallback(
    (node: GraphNode) => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        clickNodeIdRef.current = null;
      }
      onNodeExpand(node);
    },
    [onNodeExpand],
  );

  const handleExpandFromHover = useCallback(
    (node: GraphNode) => {
      if (clickTimerRef.current) {
        clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
        clickNodeIdRef.current = null;
      }
      onNodeExpand(node);
    },
    [onNodeExpand],
  );

  useEffect(() => {
    return () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    };
  }, []);

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

  const zoomBy = useCallback((factor: number) => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(220)
      .call(zoomRef.current.scaleBy, factor);
  }, []);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__graphResetZoom = resetZoom;
    w.__graphZoomBy = zoomBy;
    return () => {
      delete w.__graphResetZoom;
      delete w.__graphZoomBy;
    };
  }, [resetZoom, zoomBy]);

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

            const fromIsRoot = from.id === rootId;
            const toIsRoot = to.id === rootId;
            const fromIsHub = isKnowledgeHub(from);
            const toIsHub = isKnowledgeHub(to);
            const edgeKind =
              (fromIsRoot && toIsHub) || (toIsRoot && fromIsHub)
                ? "spoke"
                : fromIsHub || toIsHub
                  ? "leaf"
                  : "link";

            const pathD = routeKnowledgeEdge(p1.x, p1.y, p2.x, p2.y, {
              seed: edge.id,
              kind: edgeKind,
            });
            const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
            const { x: lx, y: ly } = knowledgeEdgeLabelPoint(p1.x, p1.y, p2.x, p2.y, pathD);

            const hubNode = isKnowledgeHub(src) ? src : isKnowledgeHub(tgt) ? tgt : null;
            const stroke = hubNode?.hubPropertyId
              ? `${hubColorForProperty(hubNode.hubPropertyId)}aa`
              : `${getEntityTypeConfig(to.type).hex}88`;
            const glow = hubNode?.hubPropertyId
              ? `${hubColorForProperty(hubNode.hubPropertyId)}28`
              : `${getEntityTypeConfig(to.type).hex}22`;

            const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
            const flipped = angle > 90 || angle < -90;
            const arrowMarker = isHubEdge
              ? "url(#arrow-hub)"
              : `url(#arrow-${to.type ?? "unknown"})`;

            return (
              <g key={edge.id}>
                {/* Soft underglow — no hard corners */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={glow}
                  strokeWidth={isHubEdge ? 5.5 : 4.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={pathD}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isHubEdge ? 1.85 : 1.45}
                  strokeLinecap="round"
                  strokeLinejoin="round"
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
              const isCollapsed = isCollapsedRelationHub(node.hubShown, isMore);
              const countLabel =
                isCollapsed && node.hubTotal != null
                  ? `${node.hubTotal}`
                  : !isMore && node.hubTotal != null && node.hubShown != null && node.hubTotal > node.hubShown
                    ? `${node.hubShown}/${node.hubTotal}`
                    : !isMore && node.hubTotal != null
                      ? `${node.hubTotal}`
                      : null;
              const HubIcon = iconForNode(node);
              return (
                <g
                  key={node.id}
                  ref={(el) => attachDrag(el, node)}
                  transform={`translate(${x},${y})`}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() =>
                    setHoveredId((cur) => (cur === node.id ? null : cur))
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNodePointerClick(node);
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleNodePointerDblClick(node);
                  }}
                >
                  {isExpanding && (
                    <g style={{ pointerEvents: "none" }}>
                      <circle
                        r={Math.max(sz.w, sz.h) / 2 + 10}
                        fill="none"
                        stroke={color}
                        strokeWidth={2.25}
                        strokeDasharray="10 8"
                        opacity={0.85}
                        style={{ animation: "spin 0.85s linear infinite", transformOrigin: "0 0" }}
                      />
                    </g>
                  )}
                  <rect
                    x={-sz.w / 2 + 1.5}
                    y={-sz.h / 2 + 2}
                    width={sz.w}
                    height={sz.h}
                    rx={sz.rx}
                    fill="rgba(15,23,42,0.08)"
                  />
                  <foreignObject
                    x={-sz.w / 2}
                    y={-sz.h / 2}
                    width={sz.w}
                    height={sz.h}
                    style={{ overflow: "visible", pointerEvents: "none" }}
                  >
                    <div
                      xmlns="http://www.w3.org/1999/xhtml"
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 5,
                        padding: "0 10px",
                        boxSizing: "border-box",
                        borderRadius: sz.rx,
                        background: isMore ? "#FFFFFF" : color,
                        border: `1.5px ${isMore || isCollapsed ? "dashed" : "solid"} ${color}`,
                        boxShadow: isMore ? "0 4px 12px rgba(15,23,42,0.08)" : "0 6px 14px rgba(15,23,42,0.12)",
                        fontFamily: "'Space Grotesk', system-ui, sans-serif",
                        opacity: isCollapsed ? 0.92 : 1,
                      }}
                    >
                      <HubIcon
                        className="size-3.5 shrink-0"
                        style={{ color: isMore ? color : "#FFFFFF" }}
                      />
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: "0.02em",
                          color: isMore ? color : "#FFFFFF",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {node.label}
                        {countLabel ? ` · ${countLabel}` : ""}
                      </span>
                    </div>
                  </foreignObject>
                  <HoverExpandChip
                    visible={hoveredId === node.id}
                    color={color}
                    x={sz.w / 2 + 2}
                    y={-sz.h / 2 - 2}
                    busy={isExpanding}
                    onExpand={() => handleExpandFromHover(node)}
                  />
                </g>
              );
            }

            const accent = cfg.hex;
            const LeafIcon = iconForNode(node);
            const title = node.label.length > 28 ? `${node.label.slice(0, 26)}…` : node.label;
            const subtitle = isRoot
              ? (rootSubtitle || node.description || cfg.label)
              : (node.description
                  ? (node.description.length > 32 ? `${node.description.slice(0, 30)}…` : node.description)
                  : cfg.label);

            return (
              <g
                key={node.id}
                ref={(el) => attachDrag(el, node)}
                transform={`translate(${x},${y})`}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() =>
                  setHoveredId((cur) => (cur === node.id ? null : cur))
                }
                onClick={(e) => {
                  e.stopPropagation();
                  handleNodePointerClick(node);
                }}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleNodePointerDblClick(node);
                }}
              >
                {isRoot && (
                  <rect
                    x={-sz.w / 2 - 6}
                    y={-sz.h / 2 - 6}
                    width={sz.w + 12}
                    height={sz.h + 12}
                    rx={sz.rx + 4}
                    fill="none"
                    stroke={accent}
                    strokeWidth={1.25}
                    opacity={0.28}
                  />
                )}

                {isExpanding && (
                  <g style={{ pointerEvents: "none" }}>
                    <circle
                      r={Math.max(sz.w, sz.h) / 2 + 12}
                      fill="none"
                      stroke={accent}
                      strokeWidth={2.25}
                      strokeDasharray="10 8"
                      opacity={0.85}
                      style={{ animation: "spin 0.85s linear infinite", transformOrigin: "0 0" }}
                    />
                  </g>
                )}

                <rect
                  x={-sz.w / 2 + 2}
                  y={-sz.h / 2 + 3}
                  width={sz.w}
                  height={sz.h}
                  rx={sz.rx}
                  fill="rgba(15,23,42,0.07)"
                />

                <foreignObject
                  x={-sz.w / 2}
                  y={-sz.h / 2}
                  width={sz.w}
                  height={sz.h}
                  style={{ overflow: "visible", pointerEvents: "none" }}
                >
                  <div
                    xmlns="http://www.w3.org/1999/xhtml"
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: isRoot ? 10 : 8,
                      padding: isRoot ? "8px 12px" : "6px 10px",
                      boxSizing: "border-box",
                      borderRadius: sz.rx,
                      background: "#FFFFFF",
                      border: `1.75px solid ${accent}`,
                      boxShadow: isRoot
                        ? "0 10px 28px rgba(15,23,42,0.14)"
                        : "0 6px 16px rgba(15,23,42,0.1)",
                      fontFamily: "'Space Grotesk', system-ui, sans-serif",
                    }}
                  >
                    {isRoot && rootThumbnail ? (
                      <img
                        src={rootThumbnail}
                        alt=""
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: "50%",
                          objectFit: "cover",
                          objectPosition: "top",
                          flexShrink: 0,
                          border: `2px solid ${accent}55`,
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          width: isRoot ? 40 : 28,
                          height: isRoot ? 40 : 28,
                          borderRadius: isRoot ? "50%" : 8,
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: `${accent}18`,
                          color: accent,
                        }}
                      >
                        <LeafIcon className={isRoot ? "size-5" : "size-3.5"} />
                      </span>
                    )}
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div
                        style={{
                          fontSize: isRoot ? 13 : 11,
                          fontWeight: 700,
                          color: "#0f172a",
                          lineHeight: 1.2,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {title}
                      </div>
                      {subtitle && (
                        <div
                          style={{
                            marginTop: 2,
                            fontSize: isRoot ? 10 : 9,
                            fontWeight: 500,
                            color: "#64748b",
                            lineHeight: 1.25,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {subtitle}
                        </div>
                      )}
                    </div>
                  </div>
                </foreignObject>
                <HoverExpandChip
                  visible={hoveredId === node.id}
                  color={accent}
                  x={sz.w / 2 + 2}
                  y={-sz.h / 2 - 2}
                  busy={isExpanding}
                  onExpand={() => handleExpandFromHover(node)}
                />
              </g>
            );
          })}
        </g>
      </g>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes kg-pulse {
          0%, 100% { opacity: 0.12; transform: scale(0.92); }
          50% { opacity: 0.3; transform: scale(1.12); }
        }
      `}</style>
    </svg>
  );
}
