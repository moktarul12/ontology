/**
 * Knowledge-graph radial sector layout (family-tree pattern).
 *
 *   root at center → relation hubs on a ring → targets fanned in wedges
 *   hop-2+ satellites beside nearest placed anchor
 */

import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";
import {
  isKnowledgeHub,
  isHubMoreNode,
  focusHubs,
} from "./relationHubs.ts";

export type LayoutBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const ENTITY_W = 120;
const ENTITY_H = 42;
const HUB_W = 110;
const HUB_H = 36;
const HUB_RING = 160;
const TARGET_RING = 280;
const MORE_RING = 360;
const SATELLITE_REACH = 150;

function idOf(v: string | GraphNode): string {
  return typeof v === "object" ? v.id : v;
}

function pin(n: GraphNode, x: number, y: number): void {
  n.x = x;
  n.y = y;
  n.fx = x;
  n.fy = y;
}

function half(n: GraphNode): { hw: number; hh: number } {
  if (isKnowledgeHub(n)) return { hw: HUB_W / 2 + 12, hh: HUB_H / 2 + 10 };
  return { hw: ENTITY_W / 2 + 10, hh: ENTITY_H / 2 + 10 };
}

function boundsOf(nodes: GraphNode[]): LayoutBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    const { hw, hh } = half(n);
    minX = Math.min(minX, (n.x ?? 0) - hw);
    maxX = Math.max(maxX, (n.x ?? 0) + hw);
    minY = Math.min(minY, (n.y ?? 0) - hh);
    maxY = Math.max(maxY, (n.y ?? 0) + hh);
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 960, minY: 0, maxY: 600 };
  return { minX, maxX, minY, maxY };
}

function hubTargets(
  hubId: string,
  edges: GraphEdge[],
  byId: Map<string, GraphNode>,
): GraphNode[] {
  const out: GraphNode[] = [];
  for (const e of edges) {
    if (idOf(e.source) !== hubId) continue;
    const t = byId.get(idOf(e.target));
    if (!t) continue;
    if (isHubMoreNode(t)) continue;
    if (isKnowledgeHub(t)) continue;
    out.push(t);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function hubMoreNode(
  hubId: string,
  edges: GraphEdge[],
  byId: Map<string, GraphNode>,
): GraphNode | null {
  for (const e of edges) {
    if (idOf(e.source) !== hubId) continue;
    const t = byId.get(idOf(e.target));
    if (t && isHubMoreNode(t)) return t;
  }
  return null;
}

function deoverlap(nodes: GraphNode[], rootId: string, minGap = 10): void {
  for (let pass = 0; pass < 24; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const as = half(a);
        const bs = half(b);
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const minX = as.hw + bs.hw + minGap;
        const minY = as.hh + bs.hh + minGap;
        if (Math.abs(dx) >= minX || Math.abs(dy) >= minY) continue;

        const ox = minX - Math.abs(dx);
        const oy = minY - Math.abs(dy);
        const sx = dx === 0 ? 1 : Math.sign(dx);
        const sy = dy === 0 ? 1 : Math.sign(dy);
        const preferX = ox <= oy;

        if (a.id === rootId) {
          if (preferX) pin(b, (b.x ?? 0) + (ox + 6) * sx, b.y ?? 0);
          else pin(b, b.x ?? 0, (b.y ?? 0) + (oy + 6) * sy);
          continue;
        }
        if (b.id === rootId) {
          if (preferX) pin(a, (a.x ?? 0) - (ox + 6) * sx, a.y ?? 0);
          else pin(a, a.x ?? 0, (a.y ?? 0) - (oy + 6) * sy);
          continue;
        }

        const aHub = isKnowledgeHub(a);
        const bHub = isKnowledgeHub(b);
        if (preferX) {
          const push = ox / 2 + 5;
          if (!aHub || bHub) pin(a, (a.x ?? 0) - push * sx, a.y ?? 0);
          if (!bHub || aHub) pin(b, (b.x ?? 0) + push * sx, b.y ?? 0);
        } else {
          const push = oy / 2 + 5;
          if (!aHub || bHub) pin(a, a.x ?? 0, (a.y ?? 0) - push * sy);
          if (!bHub || aHub) pin(b, b.x ?? 0, (b.y ?? 0) + push * sy);
        }
      }
    }
  }
}

/** Place hop-2+ entities beside nearest already-placed neighbor. */
function placeExtended(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
  placed: Set<string>,
  cx: number,
  cy: number,
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, string[]>();
  const addAdj = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  };
  for (const e of edges) {
    const s = idOf(e.source);
    const t = idOf(e.target);
    const sn = byId.get(s);
    const tn = byId.get(t);
    if (!sn || !tn) continue;
    if (isKnowledgeHub(sn) || isKnowledgeHub(tn)) continue;
    addAdj(s, t);
    addAdj(t, s);
  }

  const pitch = ENTITY_W + 16;
  let guard = 0;
  while (guard++ < 20) {
    const leftover = nodes.filter((n) => !isKnowledgeHub(n) && !placed.has(n.id));
    if (!leftover.length) break;

    const byAnchor = new Map<string, GraphNode[]>();
    const stranded: GraphNode[] = [];

    for (const n of leftover) {
      const neighbors = adj.get(n.id) ?? [];
      let best: GraphNode | null = null;
      let bestD = Infinity;
      for (const oid of neighbors) {
        if (!placed.has(oid)) continue;
        const o = byId.get(oid);
        if (!o || o.x == null || o.y == null) continue;
        const d = Math.hypot((o.x ?? 0) - cx, (o.y ?? 0) - cy);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (!best) {
        stranded.push(n);
        continue;
      }
      const list = byAnchor.get(best.id) ?? [];
      list.push(n);
      byAnchor.set(best.id, list);
    }

    if (!byAnchor.size && stranded.length) {
      const n = stranded.length;
      stranded.forEach((node, i) => {
        const a = -Math.PI / 2 + (i / Math.max(n, 1)) * Math.PI * 2;
        pin(node, cx + Math.cos(a) * (MORE_RING + 80), cy + Math.sin(a) * (MORE_RING + 80));
        placed.add(node.id);
      });
      break;
    }

    for (const [anchorId, group] of byAnchor) {
      const anchor = byId.get(anchorId)!;
      const ax = anchor.x ?? cx;
      const ay = anchor.y ?? cy;
      const ang = Math.atan2(ay - cy, ax - cx);
      const reach = Math.hypot(ax - cx, ay - cy) + SATELLITE_REACH;
      const span = Math.min(Math.PI / 3, (group.length - 1) * 0.22);
      group.sort((a, b) => a.label.localeCompare(b.label));
      group.forEach((node, i) => {
        const t = group.length === 1 ? 0 : i / (group.length - 1) - 0.5;
        const a = ang + t * span;
        const radial = reach + (i % 3) * (pitch * 0.15);
        pin(node, cx + Math.cos(a) * radial, cy + Math.sin(a) * radial);
        placed.add(node.id);
      });
    }
  }
}

/**
 * Pin all nodes into a readable radial knowledge map. Mutates node x/y/fx/fy.
 */
export function layoutKnowledgeGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
  width: number,
  height: number,
): LayoutBounds {
  const cx = width / 2;
  const cy = height / 2;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placed = new Set<string>();

  const root = byId.get(rootId);
  if (root) {
    pin(root, cx, cy);
    placed.add(rootId);
  }

  const hubs = focusHubs(nodes, rootId);
  const nHubs = hubs.length;
  const startAngle = -Math.PI / 2;

  hubs.forEach((hub, i) => {
    const angle =
      nHubs === 1
        ? startAngle
        : startAngle + (i / nHubs) * Math.PI * 2;
    pin(hub, cx + Math.cos(angle) * HUB_RING, cy + Math.sin(angle) * HUB_RING);
    placed.add(hub.id);

    const targets = hubTargets(hub.id, edges, byId);
    const wedge =
      nHubs <= 1
        ? Math.PI * 0.7
        : Math.min((Math.PI * 2) / nHubs * 0.75, Math.PI * 0.55);
    const count = targets.length;
    targets.forEach((t, ti) => {
      const tNorm = count === 1 ? 0 : ti / (count - 1) - 0.5;
      const a = angle + tNorm * wedge;
      // Outer rows when many targets
      const ring = count > 6 && Math.abs(tNorm) > 0.28 ? TARGET_RING + 70 : TARGET_RING;
      pin(t, cx + Math.cos(a) * ring, cy + Math.sin(a) * ring);
      placed.add(t.id);
    });

    const more = hubMoreNode(hub.id, edges, byId);
    if (more) {
      pin(more, cx + Math.cos(angle) * MORE_RING, cy + Math.sin(angle) * MORE_RING);
      placed.add(more.id);
    }
  });

  placeExtended(nodes, edges, rootId, placed, cx, cy);

  // Any leftover hubs/nodes (shouldn't happen often)
  for (const n of nodes) {
    if (placed.has(n.id)) continue;
    if (n.x == null || n.y == null) {
      pin(n, cx + (Math.random() - 0.5) * 80, cy + (Math.random() - 0.5) * 80);
    } else {
      n.fx = n.x;
      n.fy = n.y;
    }
    placed.add(n.id);
  }

  deoverlap(nodes, rootId);
  return boundsOf(nodes);
}
