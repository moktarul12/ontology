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

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as d3 from "d3";
import { toast } from "sonner";
import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";
import {
  ARRANGE_MODES,
  ARRANGE_MODE_LABEL,
  applyArrangeMode,
  layoutFamilyTree,
  type ArrangeMode,
} from "../_lib/rearrangeLayouts.ts";
import {
  toRelationHubs,
  isHubNode,
  isHubId,
  isCoParentEdge,
  type HubGraphNode,
} from "../_lib/relationHubs.ts";
import { edgePathAvoidingNodes, edgeLabelPoint } from "../_lib/edgeRouting.ts";
import { routeOrbitEdge, routeLabelPoint } from "../_lib/orbitEdgeRouter.ts";

// ── Layout constants ────────────────────────────────────────────────────────
const LEVEL_HEIGHT = 180;
const NODE_W = 148;
const NODE_H = 52;
const NODE_RX = 12;
const ROOT_W = 164;
const ROOT_H = 58;
const HUB_W = 86;
const HUB_H = 28;

// ── Role-based visual styles (light theme) ───────────────────────────────────
type NodeRole = "root" | "ancestor" | "ancestor2" | "descendant" | "descendant2" | "spouse" | "sibling";

const ROLE_STYLE: Record<NodeRole, { border: string; bg: string; text: string; sub: string; strokeW: number }> = {
  root:        { border: "#1D6F9F", bg: "#E8F5FC", text: "#0F3A55",  sub: "#3A7A9E",  strokeW: 2.5 },
  ancestor:    { border: "#5B6BB5", bg: "#EEF0FA", text: "#2A3270",  sub: "#5C6498",  strokeW: 1.5 },
  ancestor2:   { border: "#6B7AB0", bg: "#F2F4FA", text: "#3A4570",  sub: "#6A7498",  strokeW: 1   },
  descendant:  { border: "#2A9A6A", bg: "#E8F7F0", text: "#145038",  sub: "#3A8A62",  strokeW: 1.5 },
  descendant2: { border: "#3A9A72", bg: "#EEF8F3", text: "#1A5A40",  sub: "#4A8A68",  strokeW: 1   },
  spouse:      { border: "#C45A7A", bg: "#FCEEF2", text: "#6A2038",  sub: "#A05068",  strokeW: 1.5 },
  sibling:     { border: "#2E8B57", bg: "#EAF6EF", text: "#145030",  sub: "#3A7A52",  strokeW: 1.5 },
};

// ── Relation edge / hub colors (light-friendly) ─────────────────────────────
const REL_COLORS: Record<string, string> = {
  father:   "#6B5CA8",
  mother:   "#6B5CA8",
  parent:   "#6B5CA8",
  spouse:   "#C45A7A",
  child:    "#C48A2A",
  son:      "#C48A2A",
  daughter: "#C48A2A",
  sibling:  "#2E8B57",
};
const REL_DEFAULT = "#6A7A96";

const HUB_FILL: Record<string, string> = {
  parent: "#6B5CA8",
  spouse: "#C45A7A",
  child: "#C48A2A",
  sibling: "#2E8B57",
};

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

function titleCase(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Which relation hub a person hangs from (for orbit coloring). */
function personOrbitRelation(
  personId: string,
  edges: GraphEdge[],
  nodes: GraphNode[],
): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n as HubGraphNode]));
  for (const e of edges) {
    if (e.propertyId !== "HUB" || e.label.trim()) continue;
    const s = edgeEndpointId(e.source);
    const t = edgeEndpointId(e.target);
    if (t !== personId || !isHubId(s)) continue;
    return byId.get(s)?.hubRelation ?? null;
  }
  return null;
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
  if (edge.propertyId === "COPARENT") {
    return { label: edge.label || "parent", reverse: false };
  }
  if (!edge.label.trim() || edge.propertyId === "HUB") {
    return { label: edge.label, reverse: false };
  }
  const lbl = edge.label.toLowerCase();
  const src = nodes.find((n) => n.id === edgeEndpointId(edge.source));
  const tgt = nodes.find((n) => n.id === edgeEndpointId(edge.target));

  if (mode === "out") {
    return { label: edge.label, reverse: false };
  }

  if (mode === "in") {
    if (lbl === "father" || lbl === "mother" || lbl === "parent") {
      return { label: childRoleLabel(src?.gender), reverse: true };
    }
    if (lbl === "child") {
      const g = src?.gender;
      return {
        label: g === "female" ? "mother" : g === "male" ? "father" : "parent",
        reverse: true,
      };
    }
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
  const byId = new Map(nodes.map((n) => [n.id, n as HubGraphNode]));

  const deltaOut = (fromId: string, toId: string, lbl: string): number => {
    if (isHubId(toId)) {
      if (lbl === "parent") return -0.5;
      if (lbl === "child") return 0.5;
      return 0;
    }
    if (isHubId(fromId)) {
      const hub = byId.get(fromId);
      if (hub?.hubRelation === "parent") return -0.5;
      if (hub?.hubRelation === "child") return 0.5;
      return 0;
    }
    if (lbl === "father" || lbl === "mother" || lbl === "parent") return -1;
    if (lbl === "child") return 1;
    return 0;
  };

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const g = gen.get(cur) ?? 0;

    for (const edge of edges) {
      const src = edgeEndpointId(edge.source);
      const tgt = edgeEndpointId(edge.target);
      const lbl = edge.label.toLowerCase();

      if (src === cur && !gen.has(tgt)) {
        gen.set(tgt, g + deltaOut(src, tgt, lbl));
        queue.push(tgt);
      }
      if (tgt === cur && !gen.has(src)) {
        gen.set(src, g - deltaOut(src, tgt, lbl));
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
  /** Fan focus relations through parent/child/spouse/sibling hubs */
  useHubs?: boolean;
};

// ── Component ────────────────────────────────────────────────────────────────
export default function FamilyTreeCanvas({
  nodes: rawNodes,
  edges: rawEdges,
  rootId,
  onNodeClick,
  expandingIds,
  arrowDir = "out",
  arrangeNonce = 0,
  useHubs = true,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simRef = useRef<d3.Simulation<GraphNode, d3.SimulationLinkDatum<GraphNode>> | null>(null);
  const [zoom, setZoom] = useState({ x: 0, y: 0, k: 1 });
  const [, tick] = useState(0);
  const [canvasH, setCanvasH] = useState(600);
  const draggedRef = useRef(false);
  const arrangeModeIdxRef = useRef(0);
  const lastArrangeModeRef = useRef<ArrangeMode>("family");
  const pinnedArrangeRef = useRef(false);

  const { nodes, edges } = useMemo(() => {
    if (!useHubs) {
      return {
        nodes: rawNodes.map((n) => ({ ...n })) as HubGraphNode[],
        edges: rawEdges,
      };
    }
    return toRelationHubs(rawNodes, rawEdges, rootId);
  }, [rawNodes, rawEdges, useHubs, rootId]);

  const gens = useMemo(
    () => assignGenerations(nodes, edges, rootId),
    [nodes, edges, rootId],
  );

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const update = () => setCanvasH(el.clientHeight || 600);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Simulation / hub layout ────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;
    const W = Math.max(svgRef.current.clientWidth || 0, 640);
    const H = Math.max(svgRef.current.clientHeight || 0, 480);

    simRef.current?.stop();

    // Hubs on: deterministic family layout (no force tangle)
    if (useHubs) {
      pinnedArrangeRef.current = true;
      const bounds = layoutFamilyTree(nodes, edges, rootId, gens, W, H, {});

      const sim = d3
        .forceSimulation<GraphNode>(nodes)
        .force("col", null)
        .alpha(0)
        .stop();
      for (const n of nodes) {
        if (n.fx != null) n.x = n.fx;
        if (n.fy != null) n.y = n.fy;
      }
      simRef.current = sim;

      // Fit after paint / zoom ready; tick once for paint
      requestAnimationFrame(() => {
        tick((t) => t + 1);
        if (!svgRef.current || !zoomRef.current) return;
        const pad = 80;
        const bw = Math.max(bounds.maxX - bounds.minX + pad * 2, 1);
        const bh = Math.max(bounds.maxY - bounds.minY + pad * 2, 1);
        const vw = svgRef.current.clientWidth || W;
        const vh = svgRef.current.clientHeight || H;
        const k = Math.min(vw / bw, vh / bh, 1.2);
        const tx = vw / 2 - k * ((bounds.minX + bounds.maxX) / 2);
        const ty = vh / 2 - k * ((bounds.minY + bounds.maxY) / 2);
        d3.select(svgRef.current)
          .transition()
          .duration(400)
          .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
      });

      return () => { sim.stop(); };
    }

    // Hubs off: generation-seeded force layout
    pinnedArrangeRef.current = false;
    const prevPos = new Map<string, { x: number; y: number; fx?: number | null; fy?: number | null }>();
    simRef.current?.nodes().forEach((n) =>
      prevPos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0, fx: n.fx, fy: n.fy }),
    );

    const byGen = new Map<number, string[]>();
    for (const [id, g] of gens) {
      if (isHubId(id)) continue;
      if (!byGen.has(g)) byGen.set(g, []);
      byGen.get(g)!.push(id);
    }

    nodes.forEach((n) => {
      const prev = prevPos.get(n.id);
      if (prev) {
        n.x = prev.x;
        n.y = prev.y;
        n.fx = prev.fx;
        n.fy = prev.fy;
      } else {
        const g = gens.get(n.id) ?? 0;
        const row = byGen.get(g) ?? [];
        const idx = row.indexOf(n.id);
        const totalW = (NODE_W + 24) * Math.max(row.length, 1);
        n.x = W / 2 - totalW / 2 + idx * (NODE_W + 24) + NODE_W / 2;
        n.y = H / 2 + g * LEVEL_HEIGHT;
        n.fx = null;
        n.fy = null;
      }
    });

    const root = nodes.find((n) => n.id === rootId);
    if (root && root.fx === undefined) {
      root.fx = W / 2;
      root.fy = H / 2;
    }

    const linkForce = d3
      .forceLink<GraphNode, d3.SimulationLinkDatum<GraphNode>>(
        edges as d3.SimulationLinkDatum<GraphNode>[],
      )
      .id((d) => d.id)
      .distance((d) => {
        const s = String(
          typeof d.source === "object" ? (d.source as GraphNode).id : d.source,
        );
        const t = String(
          typeof d.target === "object" ? (d.target as GraphNode).id : d.target,
        );
        const gs = gens.get(s) ?? 0;
        const gt = gens.get(t) ?? 0;
        return gs === gt ? NODE_W + 40 : LEVEL_HEIGHT * 0.85;
      })
      .strength(0.4);

    const sim = d3
      .forceSimulation<GraphNode>(nodes)
      .force("link", linkForce)
      .force("charge", d3.forceManyBody().strength(-600).distanceMax(480))
      .force(
        "y",
        d3
          .forceY<GraphNode>()
          .y((d) => H / 2 + (gens.get(d.id) ?? 0) * LEVEL_HEIGHT)
          .strength(0.85),
      )
      .force("x", d3.forceX<GraphNode>(W / 2).strength(0.03))
      .force(
        "col",
        d3.forceCollide<GraphNode>(NODE_W * 0.72).strength(1),
      )
      .alphaDecay(0.022)
      .alpha(1)
      .on("tick", () => tick((t) => t + 1));

    simRef.current = sim;
    return () => {
      sim.stop();
    };
  }, [nodes, edges, rootId, gens, useHubs]);

  // ── Zoom ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = svgRef.current;
    const z = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 4])
      .on("zoom", (e: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        setZoom({ x: e.transform.x, y: e.transform.y, k: e.transform.k });
      });
    zoomRef.current = z;
    d3.select(svg).call(z);
    return () => { d3.select(svg).on(".zoom", null); };
  }, []);

  const resetZoom = useCallback(() => {
    if (!svgRef.current || !zoomRef.current) return;
    d3.select(svgRef.current).transition().duration(600).call(zoomRef.current.transform, d3.zoomIdentity);
  }, []);

  const fitToBounds = useCallback((bounds: { minX: number; maxX: number; minY: number; maxY: number }) => {
    if (!svgRef.current || !zoomRef.current) return;
    const W = svgRef.current.clientWidth || 960;
    const H = svgRef.current.clientHeight || 600;
    const pad = 80;
    const bw = Math.max(bounds.maxX - bounds.minX + pad * 2, 1);
    const bh = Math.max(bounds.maxY - bounds.minY + pad * 2, 1);
    const k = Math.min(W / bw, H / bh, 1.2);
    const tx = W / 2 - k * ((bounds.minX + bounds.maxX) / 2);
    const ty = H / 2 - k * ((bounds.minY + bounds.maxY) / 2);
    d3.select(svgRef.current)
      .transition()
      .duration(500)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
  }, []);

  const autoArrange = useCallback((opts?: { toast?: boolean }) => {
    if (!svgRef.current || nodes.length === 0) return;
    const W = Math.max(svgRef.current.clientWidth || 0, 640);
    const H = Math.max(svgRef.current.clientHeight || 0, 480);
    const showToast = opts?.toast !== false;

    pinnedArrangeRef.current = true;

    // Cycle family / wide / mirror — always a clear rearrange
    const mode = ARRANGE_MODES[arrangeModeIdxRef.current % ARRANGE_MODES.length]!;
    arrangeModeIdxRef.current = (arrangeModeIdxRef.current + 1) % ARRANGE_MODES.length;
    const bounds = applyArrangeMode(mode, nodes, edges, rootId, gens, W, H);

    const sim = d3
      .forceSimulation<GraphNode>(nodes)
      .force("col", null)
      .alpha(0)
      .stop();
    for (const n of nodes) {
      if (n.fx != null) n.x = n.fx;
      if (n.fy != null) n.y = n.fy;
    }
    simRef.current?.stop();
    simRef.current = sim;

    tick((t) => t + 1);
    fitToBounds(bounds);
    if (showToast) {
      toast.success(`Rearranged · ${ARRANGE_MODE_LABEL[mode]}`);
    }
  }, [nodes, edges, rootId, gens, fitToBounds]);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__treeResetZoom = resetZoom;
    return () => {
      delete (window as unknown as Record<string, unknown>).__treeResetZoom;
    };
  }, [resetZoom]);

  // Explicit Auto arrange from toolbar (toast on)
  const arrangeNonceRef = useRef(0);
  useEffect(() => {
    if (!arrangeNonce || arrangeNonce === arrangeNonceRef.current) return;
    arrangeNonceRef.current = arrangeNonce;
    autoArrange({ toast: true });
  }, [arrangeNonce, autoArrange]);

  // ── Drag ────────────────────────────────────────────────────────────────────
  const attachDrag = useCallback((el: SVGGElement | null, node: GraphNode) => {
    if (!el) return;
    const drag = d3.drag<SVGGElement, unknown>()
      .on("start", e => {
        draggedRef.current = false;
        pinnedArrangeRef.current = false;
        if (!e.active) simRef.current?.alphaTarget(0.2).restart();
        node.fx = node.x;
        node.fy = node.y;
      })
      .on("drag", e => { draggedRef.current = true; node.fx = e.x; node.fy = e.y; node.x = e.x; node.y = e.y; tick(t => t + 1); })
      .on("end", e => { if (!e.active) simRef.current?.alphaTarget(0); node.fx = e.x; node.fy = e.y; });
    d3.select(el).call(drag);
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const splitLabel = (label: string): [string, string | undefined] => {
    const i = label.indexOf("\n");
    return i === -1 ? [label, undefined] : [label.slice(0, i), label.slice(i + 1)];
  };

  const uniqueGens = Array.from(
    new Set(
      nodes
        .filter((n) => !isHubNode(n))
        .map((n) => Math.round(gens.get(n.id) ?? 0)),
    ),
  );
  const { x: tX, y: tY, k: tK } = zoom;
  const H = canvasH;
  const nodeSize = (n: GraphNode) => {
    if (isHubNode(n)) return { w: HUB_W, h: HUB_H };
    if (n.id === rootId) return { w: ROOT_W, h: ROOT_H };
    return { w: NODE_W, h: NODE_H };
  };

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

        {/* ── Generation bands (hubs off) ──────────────────────────────── */}
        {!useHubs && uniqueGens.map(g => {
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
          const from = reverse ? tgt : src;
          const to = reverse ? src : tgt;
          const fromSz = nodeSize(from);
          const toSz = nodeSize(to);

          const sx = from.x ?? 0, sy = from.y ?? 0;
          const tx = to.x ?? 0, ty = to.y ?? 0;
          const dx = tx - sx, dy = ty - sy;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;

          const isHubEdge = edge.propertyId === "HUB" || edge.propertyId === "HUB_SHARE";
          const isHubShare = edge.propertyId === "HUB_SHARE";
          const isCoParent = isCoParentEdge(edge);
          const isSpoke = isHubEdge && !edge.label.trim();
          const startPad = useHubs ? 2 : (arrowDir === "both" && !isSpoke ? 9 : 2);
          const endPad = useHubs ? 2 : 9;
          const x1 = sx + (dx / len) * (fromSz.w / 2 + startPad);
          const y1 = sy + (dy / len) * (fromSz.h / 2 + startPad);
          const x2 = tx - (dx / len) * (toSz.w / 2 + endPad);
          const y2 = ty - (dy / len) * (toSz.h / 2 + endPad);

          const spokeRel =
            (src as HubGraphNode).hubRelation ??
            (tgt as HubGraphNode).hubRelation ??
            "child";
          const color = isCoParent
            ? relColor(displayLabel || "mother")
            : displayLabel
              ? relColor(displayLabel)
              : isHubNode(src) || isHubNode(tgt)
                ? relColor(spokeRel === "parent" ? "parent" : spokeRel)
                : REL_DEFAULT;
          const relKey = displayLabel.toLowerCase().split(/\s*\/\s*/)[0]?.trim() ?? "";
          const hasNamed = Boolean(REL_COLORS[relKey]);
          const endMarker = hasNamed ? `ft-arr-${relKey}` : "ft-arr-default";
          const startMarker = hasNamed ? `ft-arr-start-${relKey}` : "ft-arr-start-default";
          const markerEnd =
            (useHubs && isHubEdge) || isCoParent
              ? undefined
              : isSpoke
                ? undefined
                : `url(#${endMarker})`;
          const markerStart =
            (useHubs && isHubEdge) || isCoParent
              ? undefined
              : arrowDir === "both" && !isSpoke
                ? `url(#${startMarker})`
                : undefined;

          let pathD: string;
          const skip = new Set([from.id, to.id]);
          if (useHubs) {
            // Orbit graph package: circle-aware routing (no edge-through-node)
            pathD = routeOrbitEdge(x1, y1, x2, y2, nodes, skip, {
              preferStraight: isHubEdge && !isCoParent,
              loft: isCoParent ? Math.min(70, Math.max(32, len * 0.3)) : undefined,
              pad: isCoParent ? 10 : 8,
              rootId,
            });
          } else if (isCoParent) {
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const nx = -dy / len;
            const ny = dx / len;
            const loft = Math.min(70, Math.max(28, len * 0.28));
            pathD = `M${x1},${y1} Q${mx + nx * loft},${my + ny * loft} ${x2},${y2}`;
          } else {
            pathD = edgePathAvoidingNodes(x1, y1, x2, y2, nodes, skip, {
              preferRadial: isHubEdge,
            });
          }
          const { x: lx, y: ly } = useHubs
            ? routeLabelPoint(x1, y1, x2, y2, pathD)
            : edgeLabelPoint(x1, y1, x2, y2, pathD);
          const labelW = Math.max(36, displayLabel.length * 5.2 + 10);
          const showEdgeLabel =
            Boolean(displayLabel) &&
            len > 70 &&
            !(useHubs && isHubEdge) &&
            !isCoParent;

          return (
            <g key={`${edge.id}-${arrowDir}`}>
              {isCoParent && (
                <path
                  d={pathD}
                  fill="none"
                  stroke={`${color}28`}
                  strokeWidth={6}
                  strokeLinecap="round"
                />
              )}
              <path
                d={pathD}
                fill="none"
                stroke={
                  isCoParent
                    ? `${color}aa`
                    : isHubShare
                      ? `${color}66`
                      : useHubs
                        ? `${color}99`
                        : `${color}${isSpoke ? "50" : "70"}`
                }
                strokeWidth={isCoParent ? 2 : useHubs ? (isSpoke ? 1.75 : 2) : isSpoke ? 1.5 : 2}
                strokeDasharray={isCoParent ? "5 7" : isHubShare ? "4 5" : undefined}
                strokeLinecap="round"
                markerEnd={markerEnd}
                markerStart={markerStart}
              />
              {isCoParent && len > 60 && (
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: "8px",
                    fill: color,
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    pointerEvents: "none",
                    userSelect: "none",
                    opacity: 0.85,
                  }}
                >
                  {displayLabel || "parent"}
                </text>
              )}
              {showEdgeLabel && (
                <g>
                  <rect x={lx - labelW / 2} y={ly - 8} width={labelW} height={14} rx={4} fill="#FFFFFF" opacity={0.92} stroke="#D0D8E4" strokeWidth={0.75} />
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
          const hub = isHubNode(node);
          const g = gens.get(node.id) ?? 0;
          const role = hub ? "descendant" : getRole(node.id, rootId, Math.round(g), edges);
          const style = ROLE_STYLE[role];
          const isRoot = node.id === rootId;
          const isExpanding = expandingIds.has(node.id);
          const x = node.x ?? 0, y = node.y ?? 0;
          const [nameLine, lifeLine] = splitLabel(node.label);
          const hubRel = (node as HubGraphNode).hubRelation;
          const hubColor = HUB_FILL[hubRel ?? ""] ?? "#4DC48A";

          if (hub) {
            return (
              <g
                key={node.id}
                ref={(el) => attachDrag(el, node)}
                transform={`translate(${x},${y})`}
                style={{ cursor: "grab" }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <rect
                  x={-HUB_W / 2} y={-HUB_H / 2}
                  width={HUB_W} height={HUB_H}
                  rx={14}
                  fill={hubColor}
                  stroke={hubColor}
                  strokeWidth={1}
                />
                <text
                  textAnchor="middle" dominantBaseline="middle"
                  style={{
                    fontSize: "11px",
                    fill: "#FFFFFF",
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: 700,
                    letterSpacing: "0.02em",
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {titleCase(node.label)}
                </text>
              </g>
            );
          }

          const orbitRel = useHubs && !isRoot ? personOrbitRelation(node.id, edges, nodes) : null;
          const accent = isRoot
            ? ROLE_STYLE.root.border
            : (orbitRel ? relColor(orbitRel) : style.border);
          const fill = isRoot ? ROLE_STYLE.root.bg : (orbitRel ? `${accent}18` : style.bg);
          const textMain = isRoot ? ROLE_STYLE.root.text : style.text;
          const textSub = isRoot ? ROLE_STYLE.root.sub : (orbitRel ? `${accent}` : style.sub);
          const nW = isRoot ? ROOT_W : NODE_W;
          const nH = isRoot ? ROOT_H : NODE_H;
          const rx = NODE_RX;

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
                {isRoot && (
                  <rect
                    x={-nW / 2 - 6} y={-nH / 2 - 6}
                    width={nW + 12} height={nH + 12}
                    rx={rx + 4}
                    fill="none"
                    stroke={accent}
                    strokeWidth={1}
                    opacity={0.35}
                  />
                )}
                {isExpanding && (
                  <rect
                    x={-nW / 2 - 7} y={-nH / 2 - 7}
                    width={nW + 14} height={nH + 14}
                    rx={rx + 5}
                    fill="none"
                    stroke={accent}
                    strokeWidth={1.5}
                    strokeDasharray="8 5"
                    opacity={0.8}
                    style={{ animation: "ft-spin 1.2s linear infinite", transformOrigin: "0 0" }}
                  />
                )}
                <rect
                  x={-nW / 2} y={-nH / 2}
                  width={nW} height={nH}
                  rx={rx}
                  fill={fill}
                  stroke={accent}
                  strokeWidth={isRoot ? 2.5 : 2}
                />
                <rect
                  x={-nW / 2}
                  y={-nH / 2 + rx}
                  width={3}
                  height={nH - rx * 2}
                  fill={accent}
                  opacity={0.75}
                />
                <text
                  y={lifeLine ? -8 : 0}
                  textAnchor="middle" dominantBaseline="middle"
                  style={{
                    fontSize: isRoot ? "12px" : "10.5px",
                    fill: textMain,
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontWeight: isRoot ? 700 : 600,
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {nameLine.length > 18 ? nameLine.slice(0, 17) + "…" : nameLine}
                </text>
                {lifeLine && (
                  <text
                    y={9}
                    textAnchor="middle" dominantBaseline="middle"
                    style={{
                      fontSize: "8.5px",
                      fill: textSub,
                      fontFamily: "'Space Grotesk', sans-serif",
                      fontWeight: 500,
                      pointerEvents: "none",
                      userSelect: "none",
                    }}
                  >
                    {lifeLine.length > 18 ? lifeLine.slice(0, 17) + "…" : lifeLine}
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
