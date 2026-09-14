/**
 * Soft knowledge-graph edges — flowing curves only, never angled polylines.
 */

/** Stable 0…1 from a string (edge id) so bends stay consistent across renders. */
function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export type KnowledgeEdgeKind = "spoke" | "leaf" | "link";

/**
 * Organic SVG path between two attach points.
 * - spoke: root → relation hub (gentle petal arc)
 * - leaf: hub → entity (deeper ribbon curve)
 * - link: hop-2 / misc (mild S-curve)
 */
export function routeKnowledgeEdge(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  opts?: { seed?: string; kind?: KnowledgeEdgeKind },
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;

  if (len < 8) return `M${x1},${y1} L${x2},${y2}`;

  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  const kind = opts?.kind ?? "link";
  const t = opts?.seed ? hash01(opts.seed) : 0.5;
  // Alternate bend side + vary amplitude so fans don’t stack
  const side = t < 0.5 ? -1 : 1;
  const ampJitter = 0.72 + t * 0.55;

  if (kind === "spoke") {
    // Petal: single quadratic loft — readable radial arms
    const loft = Math.min(42, Math.max(14, len * 0.14)) * ampJitter;
    const cx = (x1 + x2) / 2 + px * loft * side;
    const cy = (y1 + y2) / 2 + py * loft * side;
    return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
  }

  if (kind === "leaf") {
    // Ribbon: cubic with asymmetric handles so leaves feel organic
    const bow = Math.min(72, Math.max(22, len * 0.22)) * ampJitter;
    const pull = Math.min(0.38, 48 / len);
    const c1x = x1 + ux * len * pull + px * bow * side;
    const c1y = y1 + uy * len * pull + py * bow * side;
    const c2x = x2 - ux * len * pull + px * bow * side * 0.55;
    const c2y = y2 - uy * len * pull + py * bow * side * 0.55;
    return `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
  }

  // Mild S-curve for other links
  const loft = Math.min(36, Math.max(10, len * 0.12)) * ampJitter;
  const c1x = x1 + dx * 0.35 + px * loft * side;
  const c1y = y1 + dy * 0.35 + py * loft * side;
  const c2x = x1 + dx * 0.65 - px * loft * side * 0.65;
  const c2y = y1 + dy * 0.65 - py * loft * side * 0.65;
  return `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
}

/** Midpoint sample along the knowledge edge for labels. */
export function knowledgeEdgeLabelPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  pathD: string,
): { x: number; y: number } {
  const cMatch = pathD.match(
    /C\s*([-\d.]+)\s*,\s*([-\d.]+)\s+([-\d.]+)\s*,\s*([-\d.]+)/,
  );
  if (cMatch) {
    const c1x = Number(cMatch[1]);
    const c1y = Number(cMatch[2]);
    const c2x = Number(cMatch[3]);
    const c2y = Number(cMatch[4]);
    const t = 0.5;
    const u = 1 - t;
    return {
      x: u * u * u * x1 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x2,
      y: u * u * u * y1 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y2,
    };
  }
  const qMatch = pathD.match(/Q\s*([-\d.]+)\s*,\s*([-\d.]+)/);
  if (qMatch) {
    const cx = Number(qMatch[1]);
    const cy = Number(qMatch[2]);
    const t = 0.5;
    const u = 1 - t;
    return {
      x: u * u * x1 + 2 * u * t * cx + t * t * x2,
      y: u * u * y1 + 2 * u * t * cy + t * t * y2,
    };
  }
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}
