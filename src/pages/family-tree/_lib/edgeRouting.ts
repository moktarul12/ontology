/**
 * Edge path helpers: prefer straight radial spokes for hub links;
 * bend around node rectangles when a straight path would cut through nodes.
 */

import type { GraphNode } from "@/lib/wikidata/types.ts";
import { isHubNode } from "./relationHubs.ts";

const NODE_W = 148;
const NODE_H = 52;
const HUB_W = 78;
const HUB_H = 30;

type Rect = { x: number; y: number; hw: number; hh: number; id: string };

function nodeRect(n: GraphNode): Rect {
  const hub = isHubNode(n);
  return {
    id: n.id,
    x: n.x ?? 0,
    y: n.y ?? 0,
    hw: (hub ? HUB_W : NODE_W) / 2 + 6,
    hh: (hub ? HUB_H : NODE_H) / 2 + 6,
  };
}

function segmentHitsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  r: Rect,
): boolean {
  const steps = 12;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    if (Math.abs(x - r.x) <= r.hw && Math.abs(y - r.y) <= r.hh) return true;
  }
  return false;
}

function quadHits(
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  obstacles: Rect[],
): boolean {
  const steps = 16;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * x1 + 2 * u * t * cx + t * t * x2;
    const y = u * u * y1 + 2 * u * t * cy + t * t * y2;
    for (const r of obstacles) {
      if (Math.abs(x - r.x) <= r.hw && Math.abs(y - r.y) <= r.hh) return true;
    }
  }
  return false;
}

export type EdgePathOptions = {
  /** Prefer a straight line when clear (hub↔person orbit spokes). */
  preferRadial?: boolean;
};

/**
 * Build an SVG path from (x1,y1) → (x2,y2) that bends around other nodes.
 */
export function edgePathAvoidingNodes(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  nodes: GraphNode[],
  skipIds: Set<string>,
  opts?: EdgePathOptions,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const obstacles = nodes
    .filter((n) => !skipIds.has(n.id) && n.x != null && n.y != null)
    .map(nodeRect);

  const hitsStraight = obstacles.some((r) => segmentHitsRect(x1, y1, x2, y2, r));

  if (!hitsStraight) {
    if (opts?.preferRadial) {
      return `M${x1},${y1} L${x2},${y2}`;
    }
    const isVertical = Math.abs(dy) > Math.abs(dx) * 1.5;
    if (isVertical) {
      const midY = (y1 + y2) / 2;
      return `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`;
    }
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2 + dx * 0.04;
    return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
  }

  const px = -dy / len;
  const py = dx / len;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  const offsets = [80, 120, 180, 260, 340, -80, -120, -180, -260, -340];
  for (const off of offsets) {
    const cx = midX + px * off;
    const cy = midY + py * off;
    if (!quadHits(x1, y1, cx, cy, x2, y2, obstacles)) {
      return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
    }
  }

  const detour = Math.max(140, len * 0.35);
  const wx = midX + px * detour;
  const wy = midY + py * detour;
  return `M${x1},${y1} L${wx},${wy} L${x2},${y2}`;
}

/** Midpoint suitable for an edge label along a simple path. */
export function edgeLabelPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pathD: string,
): { x: number; y: number } {
  if (/^M[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+$/.test(pathD.trim())) {
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }
  const q = pathD.match(/Q([\d.-]+),([\d.-]+)/);
  if (q) {
    const cx = Number(q[1]);
    const cy = Number(q[2]);
    return {
      x: 0.25 * x1 + 0.5 * cx + 0.25 * x2,
      y: 0.25 * y1 + 0.5 * cy + 0.25 * y2,
    };
  }
  const l = pathD.match(/L([\d.-]+),([\d.-]+) L/);
  if (l) {
    return { x: Number(l[1]), y: Number(l[2]) };
  }
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}
