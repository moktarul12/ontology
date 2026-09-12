/**
 * Orbit edge router — lightweight graph edge package for family-tree orbit view.
 * Treats people as circles and hubs as capsules; routes SVG paths that do not
 * cut through other nodes (quadratic / multi-waypoint detours).
 */

import type { GraphNode } from "@/lib/wikidata/types.ts";
import { isHubNode } from "./relationHubs.ts";

export type OrbitObstacle = {
  id: string;
  x: number;
  y: number;
  /** Clearance radius from center (circle approximation). */
  r: number;
};

export type RouteOpts = {
  /** Straight line when clear (hub spokes). */
  preferStraight?: boolean;
  /** Soft outward loft even when clear (co-parent petals). */
  loft?: number;
  /** Extra padding around obstacles. */
  pad?: number;
  /**
   * Prefer smooth quadratic detours only — never sharp multi-segment elbows.
   * Use for hub spokes so routes stay readable.
   */
  smoothOnly?: boolean;
};

const HUB_R = 28;
const PERSON_R = 50;
const ROOT_HINT = 62;

function obstacleOf(n: GraphNode, rootId?: string): OrbitObstacle | null {
  if (n.x == null || n.y == null) return null;
  if (isHubNode(n)) {
    return { id: n.id, x: n.x, y: n.y, r: HUB_R };
  }
  const r = rootId && n.id === rootId ? ROOT_HINT : PERSON_R;
  return { id: n.id, x: n.x, y: n.y, r };
}

/** Closest distance from point to segment AB. */
function distPointSeg(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx;
  const qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function segmentHitsCircle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: OrbitObstacle,
  pad: number,
): boolean {
  // Ignore if endpoint is essentially the obstacle center (endpoint itself)
  const nearEnd =
    Math.hypot(o.x - x1, o.y - y1) < o.r * 0.35 ||
    Math.hypot(o.x - x2, o.y - y2) < o.r * 0.35;
  if (nearEnd) return false;
  return distPointSeg(o.x, o.y, x1, y1, x2, y2) < o.r + pad;
}

function sampleQuadHits(
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  obstacles: OrbitObstacle[],
  pad: number,
  skip: Set<string>,
): boolean {
  const steps = 20;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const x = u * u * x1 + 2 * u * t * cx + t * t * x2;
    const y = u * u * y1 + 2 * u * t * cy + t * t * y2;
    for (const o of obstacles) {
      if (skip.has(o.id)) continue;
      if (Math.hypot(x - o.x, y - o.y) < o.r + pad) return true;
    }
  }
  return false;
}

function samplePolyHits(
  pts: { x: number; y: number }[],
  obstacles: OrbitObstacle[],
  pad: number,
  skip: Set<string>,
): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    for (const o of obstacles) {
      if (skip.has(o.id)) continue;
      if (segmentHitsCircle(a.x, a.y, b.x, b.y, o, pad)) return true;
    }
  }
  return false;
}

function blockersOnSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacles: OrbitObstacle[],
  pad: number,
  skip: Set<string>,
): OrbitObstacle[] {
  return obstacles.filter(
    (o) => !skip.has(o.id) && segmentHitsCircle(x1, y1, x2, y2, o, pad),
  );
}

/** Waypoint pushed around a blocking circle, on the side that clears the chord. */
function detourAround(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  o: OrbitObstacle,
  pad: number,
  side: 1 | -1,
): { x: number; y: number } {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  // Vector from obstacle to chord midpoint; if tiny, use perpendicular to edge
  let vx = midX - o.x;
  let vy = midY - o.y;
  let vl = Math.hypot(vx, vy);
  if (vl < 4) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    vx = (-dy / len) * side;
    vy = (dx / len) * side;
    vl = 1;
  } else {
    vx /= vl;
    vy /= vl;
  }
  const clear = o.r + pad + 18;
  return { x: o.x + vx * clear, y: o.y + vy * clear };
}

function buildObstacles(
  nodes: GraphNode[],
  skipIds: Set<string>,
  rootId?: string,
): OrbitObstacle[] {
  const out: OrbitObstacle[] = [];
  for (const n of nodes) {
    if (skipIds.has(n.id)) continue;
    const o = obstacleOf(n, rootId);
    if (o) out.push(o);
  }
  return out;
}

/**
 * Route an edge path that avoids crossing through other orbit nodes.
 */
export function routeOrbitEdge(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  nodes: GraphNode[],
  skipIds: Set<string>,
  opts?: RouteOpts & { rootId?: string },
): string {
  const pad = opts?.pad ?? 8;
  const obstacles = buildObstacles(nodes, skipIds, opts?.rootId);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const px = -dy / len;
  const py = dx / len;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;

  const hits = blockersOnSegment(x1, y1, x2, y2, obstacles, pad, skipIds);

  if (!hits.length) {
    if (opts?.preferStraight && !opts.loft) {
      return `M${x1},${y1} L${x2},${y2}`;
    }
    const loft = opts?.loft ?? (opts?.preferStraight ? 0 : Math.min(28, len * 0.08));
    if (loft <= 1) return `M${x1},${y1} L${x2},${y2}`;
    // Prefer bend away from densest nearby obstacle, else mild perp loft
    let cx = midX + px * loft;
    let cy = midY + py * loft;
    return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
  }

  // Try single quadratic bends with increasing clearance
  const clearances = [1.15, 1.4, 1.75, 2.2, 2.8, 3.4];
  let bestSoft: string | null = null;
  for (const side of [1, -1] as const) {
    for (const k of clearances) {
      // Bend around the worst (closest-to-chord) blocker
      let worst = hits[0]!;
      let worstD = distPointSeg(worst.x, worst.y, x1, y1, x2, y2);
      for (const h of hits) {
        const d = distPointSeg(h.x, h.y, x1, y1, x2, y2);
        if (d < worstD) {
          worst = h;
          worstD = d;
        }
      }
      const wp = detourAround(x1, y1, x2, y2, worst, pad * k, side);
      // Nudge further along perpendicular for multi-blockers
      const cx = wp.x + px * side * 12 * k;
      const cy = wp.y + py * side * 12 * k;
      const soft = `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
      if (!sampleQuadHits(x1, y1, cx, cy, x2, y2, obstacles, pad, skipIds)) {
        return soft;
      }
      if (!bestSoft) bestSoft = soft;
    }
  }

  // Hub spokes: stay smooth even if slightly imperfect — never sharp elbows
  if (opts?.smoothOnly) {
    if (opts.preferStraight) return `M${x1},${y1} L${x2},${y2}`;
    return bestSoft ?? `M${x1},${y1} Q${midX + px * Math.min(48, len * 0.2)},${midY + py * Math.min(48, len * 0.2)} ${x2},${y2}`;
  }

  // Two-waypoint polyline around successive blockers
  const ordered = [...hits].sort(
    (a, b) =>
      distPointSeg(a.x, a.y, x1, y1, x2, y2) - distPointSeg(b.x, b.y, x1, y1, x2, y2),
  );
  for (const side of [1, -1] as const) {
    const wps: { x: number; y: number }[] = [];
    for (const o of ordered.slice(0, 3)) {
      wps.push(detourAround(x1, y1, x2, y2, o, pad + 14, side));
    }
    // Deduplicate near waypoints
    const slim: { x: number; y: number }[] = [];
    for (const w of wps) {
      const last = slim[slim.length - 1];
      if (!last || Math.hypot(w.x - last.x, w.y - last.y) > 24) slim.push(w);
    }
    const pts = [{ x: x1, y: y1 }, ...slim, { x: x2, y: y2 }];
    if (!samplePolyHits(pts, obstacles, pad, skipIds)) {
      return pts
        .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
        .join(" ");
    }
  }

  // Last resort: large perpendicular elbow
  const elbow = Math.max(160, len * 0.45);
  for (const side of [1, -1] as const) {
    const wx = midX + px * elbow * side;
    const wy = midY + py * elbow * side;
    const pts = [
      { x: x1, y: y1 },
      { x: wx, y: wy },
      { x: x2, y: y2 },
    ];
    if (!samplePolyHits(pts, obstacles, pad, skipIds)) {
      return `M${x1},${y1} L${wx},${wy} L${x2},${y2}`;
    }
  }

  const wx = midX + px * elbow;
  const wy = midY + py * elbow;
  return `M${x1},${y1} L${wx},${wy} L${x2},${y2}`;
}

/** Label anchor along a routed path. */
export function routeLabelPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pathD: string,
): { x: number; y: number } {
  const trimmed = pathD.trim();
  if (/^M[\d.-]+,[\d.-]+ L[\d.-]+,[\d.-]+$/.test(trimmed)) {
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
  const points = [...pathD.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
  if (points.length >= 3) {
    const mid = points[Math.floor(points.length / 2)]!;
    return mid;
  }
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}
