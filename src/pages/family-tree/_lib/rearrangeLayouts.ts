/**
 * Family tree layout — designed from scratch for readable hop 1–3 graphs.
 *
 * Visual model (focus at center):
 *
 *                    [Parent]
 *                 father · mother
 *                       |
 *     [Sibling] —— FOCUS —— [Spouse]
 *      siblings           childless spouses
 *                       |
 *                    [Child]
 *            family petals: (co-parent + child)
 *            then solo children
 *
 * Extended relatives (depth 2–3) pack into generation rows above/below,
 * anchored under the person they connect to — no nested hubs.
 */

import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";
import {
  isHubNode,
  hubsForOwner,
  isCoParentEdge,
  type HubGraphNode,
  type HubRelation,
} from "./relationHubs.ts";

export type ArrangeMode = "family" | "wide" | "mirror";

export const ARRANGE_MODES: ArrangeMode[] = ["family", "wide", "mirror"];

export const ARRANGE_MODE_LABEL: Record<ArrangeMode, string> = {
  family: "Family petals (parents ↑ · children ↓)",
  wide: "Wide spacing",
  mirror: "Mirrored (siblings ↔ spouses)",
};

export type LayoutBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

// Kept for older imports
export type OrbitRing = {
  hubId: string;
  cx: number;
  cy: number;
  radii: number[];
  relation: HubRelation;
};

const PERSON = 96;
const ROOT = 112;
const HUB_W = 86;
const HUB_H = 28;
const GAP = 28;
const ROW = 200;

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
  if (isHubNode(n)) return { hw: HUB_W / 2 + 10, hh: HUB_H / 2 + 10 };
  return { hw: PERSON / 2 + 10, hh: PERSON / 2 + 10 };
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
    if (t && !isHubNode(t)) out.push(t);
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function placeRow(people: GraphNode[], cx: number, y: number, pitch: number): void {
  if (!people.length) return;
  const total = people.length * pitch;
  let x = cx - total / 2 + pitch / 2;
  for (const p of people) {
    pin(p, x, y);
    x += pitch;
  }
}

/** Pack people in a horizontal row centered at cx. */
function packRow(people: GraphNode[], cx: number, y: number, gap = GAP): void {
  placeRow(people, cx, y, PERSON + gap);
}

type Petal = { spouse: GraphNode; children: GraphNode[] };

function buildPetals(
  spouses: GraphNode[],
  children: GraphNode[],
  edges: GraphEdge[],
): { petals: Petal[]; soloSpouses: GraphNode[]; soloChildren: GraphNode[] } {
  const childIds = new Set(children.map((c) => c.id));
  const claimedKids = new Set<string>();
  const petals: Petal[] = [];

  for (const sp of spouses) {
    const kids: GraphNode[] = [];
    for (const e of edges) {
      if (!isCoParentEdge(e)) continue;
      if (idOf(e.source) !== sp.id) continue;
      const kid = children.find((c) => c.id === idOf(e.target));
      if (kid && !claimedKids.has(kid.id)) {
        kids.push(kid);
        claimedKids.add(kid.id);
      }
    }
    // Also check raw mother/father if co-parent not yet present
    if (!kids.length) {
      for (const e of edges) {
        const s = idOf(e.source);
        const t = idOf(e.target);
        const lbl = e.label.toLowerCase();
        if (
          (lbl === "mother" || lbl === "father" || lbl === "parent") &&
          t === sp.id &&
          childIds.has(s)
        ) {
          const kid = children.find((c) => c.id === s);
          if (kid && !claimedKids.has(kid.id)) {
            kids.push(kid);
            claimedKids.add(kid.id);
          }
        }
      }
    }
    if (kids.length) petals.push({ spouse: sp, children: kids });
  }

  const petalSpouseIds = new Set(petals.map((p) => p.spouse.id));
  const soloSpouses = spouses.filter((s) => !petalSpouseIds.has(s.id));
  const soloChildren = children.filter((c) => !claimedKids.has(c.id));
  return { petals, soloSpouses, soloChildren };
}

function deoverlap(nodes: GraphNode[], rootId: string): void {
  for (let pass = 0; pass < 20; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        const as = half(a);
        const bs = half(b);
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const minX = as.hw + bs.hw;
        const minY = as.hh + bs.hh;
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

        // Prefer moving non-hubs; hubs nudge less
        const aHub = isHubNode(a);
        const bHub = isHubNode(b);
        if (preferX) {
          const push = ox / 2 + 4;
          if (!aHub) pin(a, (a.x ?? 0) - push * sx, a.y ?? 0);
          if (!bHub) pin(b, (b.x ?? 0) + push * sx, b.y ?? 0);
          if (aHub && bHub) {
            pin(a, (a.x ?? 0) - push * sx, a.y ?? 0);
            pin(b, (b.x ?? 0) + push * sx, b.y ?? 0);
          }
        } else {
          const push = oy / 2 + 4;
          if (!aHub) pin(a, a.x ?? 0, (a.y ?? 0) - push * sy);
          if (!bHub) pin(b, b.x ?? 0, (b.y ?? 0) + push * sy);
          if (aHub && bHub) {
            pin(a, a.x ?? 0, (a.y ?? 0) - push * sy);
            pin(b, b.x ?? 0, (b.y ?? 0) + push * sy);
          }
        }
      }
    }
  }
}

/**
 * Place remaining people in generation rows, centered under their
 * nearest already-placed neighbor.
 */
function placeExtended(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
  gens: Map<string, number>,
  placed: Set<string>,
  cx: number,
  cy: number,
  pitch: number,
): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const leftover = nodes.filter((n) => !isHubNode(n) && !placed.has(n.id));
  if (!leftover.length) return;

  // Group by rounded generation
  const byGen = new Map<number, GraphNode[]>();
  for (const n of leftover) {
    const g = Math.round(gens.get(n.id) ?? 0);
    if (!byGen.has(g)) byGen.set(g, []);
    byGen.get(g)!.push(n);
  }

  const gensSorted = [...byGen.keys()].sort((a, b) => a - b);
  for (const g of gensSorted) {
    const row = byGen.get(g)!;
    row.sort((a, b) => a.label.localeCompare(b.label));

    // Anchor X: average of connected placed people, else focus
    const xs: number[] = [];
    for (const n of row) {
      for (const e of edges) {
        const s = idOf(e.source);
        const t = idOf(e.target);
        const other = s === n.id ? t : t === n.id ? s : null;
        if (!other || !placed.has(other)) continue;
        const o = byId.get(other);
        if (o?.x != null) xs.push(o.x);
      }
    }
    const rowCx = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : cx;
    const y = cy + g * ROW;
    packRow(row, rowCx, y, pitch - PERSON);
    for (const n of row) placed.add(n.id);
  }
}

export type FamilyLayoutOpts = {
  /** Extra horizontal gap */
  wide?: boolean;
  /** Swap sibling (left) and spouse (right) sides */
  mirror?: boolean;
};

/**
 * Main readable layout for hubs-on mode.
 */
export function layoutFamilyTree(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
  gens: Map<string, number>,
  W: number,
  H: number,
  opts: FamilyLayoutOpts = {},
): LayoutBounds {
  const cx = W / 2;
  const cy = H / 2;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = byId.get(rootId);
  if (!root) return boundsOf(nodes);

  for (const n of nodes) {
    n.fx = undefined;
    n.fy = undefined;
  }

  const pitch = PERSON + (opts.wide ? GAP + 20 : GAP);
  const arm = opts.wide ? 200 : 170;
  const outer = arm + 150;

  const hubs = hubsForOwner(nodes, rootId);
  const parents = hubs.has("parent") ? hubTargets(hubs.get("parent")!.id, edges, byId) : [];
  const children = hubs.has("child") ? hubTargets(hubs.get("child")!.id, edges, byId) : [];
  const spouses = hubs.has("spouse") ? hubTargets(hubs.get("spouse")!.id, edges, byId) : [];
  const siblings = hubs.has("sibling") ? hubTargets(hubs.get("sibling")!.id, edges, byId) : [];

  const { petals, soloSpouses, soloChildren } = buildPetals(spouses, children, edges);

  const sibSide = opts.mirror ? 1 : -1;
  const spoSide = opts.mirror ? -1 : 1;

  pin(root, cx, cy);
  const placed = new Set<string>([rootId]);

  // ── Parents (↑) ────────────────────────────────────────────────────────
  const parentHub = hubs.get("parent");
  if (parentHub) {
    pin(parentHub, cx, cy - arm);
    placed.add(parentHub.id);
  }
  if (parents.length) {
    packRow(parents, cx, cy - outer, pitch - PERSON);
    for (const p of parents) placed.add(p.id);
    // If parents are spouses of each other, keep them close (already in a row)
  }

  // ── Siblings (← or →) ──────────────────────────────────────────────────
  const siblingHub = hubs.get("sibling");
  if (siblingHub) {
    pin(siblingHub, cx + sibSide * arm, cy);
    placed.add(siblingHub.id);
  }
  if (siblings.length) {
    // Vertical stack on the sibling side
    const total = siblings.length * pitch;
    let y = cy - total / 2 + pitch / 2;
    const x = cx + sibSide * outer;
    for (const s of siblings) {
      pin(s, x, y);
      placed.add(s.id);
      y += pitch;
    }
  }

  // ── Childless spouses on spouse side ───────────────────────────────────
  const spouseHub = hubs.get("spouse");
  if (spouseHub) {
    pin(spouseHub, cx + spoSide * arm, cy);
    placed.add(spouseHub.id);
  }
  if (soloSpouses.length) {
    const total = soloSpouses.length * pitch;
    let y = cy - total / 2 + pitch / 2;
    const x = cx + spoSide * outer;
    for (const s of soloSpouses) {
      pin(s, x, y);
      placed.add(s.id);
      y += pitch;
    }
  }

  // ── Children + family petals (↓) ───────────────────────────────────────
  const childHub = hubs.get("child");
  if (childHub) {
    pin(childHub, cx, cy + arm);
    placed.add(childHub.id);
  }

  // Build ordered units along the child arc/row: petal (spouse above child) then solos
  type Unit = { kind: "petal"; petal: Petal } | { kind: "child"; node: GraphNode };
  const units: Unit[] = [
    ...petals.map((p) => ({ kind: "petal" as const, petal: p })),
    ...soloChildren.map((n) => ({ kind: "child" as const, node: n })),
  ];

  if (units.length) {
    const unitPitch = pitch + (petals.length ? 36 : 0);
    const total = units.length * unitPitch;
    let x = cx - total / 2 + unitPitch / 2;
    const childY = cy + outer;
    const spouseY = cy + outer - (PERSON + 36);

    for (const u of units) {
      if (u.kind === "petal") {
        const kids = u.petal.children;
        packRow(kids, x, childY, pitch - PERSON);
        // Co-parent centered above their kids
        const kx = kids.reduce((s, k) => s + (k.x ?? x), 0) / kids.length;
        pin(u.petal.spouse, kx, spouseY);
        placed.add(u.petal.spouse.id);
        for (const k of kids) placed.add(k.id);
      } else {
        pin(u.node, x, childY);
        placed.add(u.node.id);
      }
      x += unitPitch;
    }
  }

  // Reposition spouse hub toward average of all spouses
  if (spouseHub && spouses.length) {
    const ax = spouses.reduce((s, p) => s + (p.x ?? cx), 0) / spouses.length;
    const ay = spouses.reduce((s, p) => s + (p.y ?? cy), 0) / spouses.length;
    pin(spouseHub, cx * 0.4 + ax * 0.6, cy * 0.4 + ay * 0.6);
  }
  // Child hub toward children
  if (childHub && children.length) {
    const ax = children.reduce((s, p) => s + (p.x ?? cx), 0) / children.length;
    const ay = children.reduce((s, p) => s + (p.y ?? cy), 0) / children.length;
    pin(childHub, cx * 0.35 + ax * 0.65, cy * 0.35 + ay * 0.65);
  }

  // ── Extended family (depth 2–3) ─────────────────────────────────────────
  placeExtended(nodes, edges, rootId, gens, placed, cx, cy, pitch);

  // Any leftover hubs (shouldn't happen with focus-only)
  for (const n of nodes) {
    if (!isHubNode(n) || placed.has(n.id)) continue;
    const h = n as HubGraphNode;
    const owner = h.hubOf ? byId.get(h.hubOf) : undefined;
    if (!owner) continue;
    pin(h, (owner.x ?? cx), (owner.y ?? cy) - 80);
    placed.add(h.id);
  }

  deoverlap(nodes, rootId);
  return boundsOf(nodes);
}

/** @deprecated name — maps to family tree layout */
export function layoutCompass(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
  gens: Map<string, number>,
  W: number,
  H: number,
  _orbitPhase = 0,
): LayoutBounds {
  void _orbitPhase;
  return layoutFamilyTree(nodes, edges, rootId, gens, W, H, {});
}

export function layoutPedigree(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
  gens: Map<string, number>,
  W: number,
  H: number,
): LayoutBounds {
  return layoutFamilyTree(nodes, edges, rootId, gens, W, H, { wide: true });
}

export function layoutRadial(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
  gens: Map<string, number>,
  W: number,
  H: number,
  _orbitPhase = 0,
): LayoutBounds {
  void _orbitPhase;
  return layoutFamilyTree(nodes, edges, rootId, gens, W, H, { mirror: true });
}

export function applyArrangeMode(
  mode: ArrangeMode | string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
  gens: Map<string, number>,
  W: number,
  H: number,
  _orbitPhase = 0,
): LayoutBounds {
  void _orbitPhase;
  if (mode === "wide" || mode === "pedigree") {
    return layoutFamilyTree(nodes, edges, rootId, gens, W, H, { wide: true });
  }
  if (mode === "mirror" || mode === "radial") {
    return layoutFamilyTree(nodes, edges, rootId, gens, W, H, { mirror: true });
  }
  return layoutFamilyTree(nodes, edges, rootId, gens, W, H, {});
}

/** Stub for older ring drawing — focus layout does not use dashed rings. */
export function getOrbitRings(_nodes: GraphNode[], _edges: GraphEdge[]): OrbitRing[] {
  void _nodes;
  void _edges;
  return [];
}

export function orbitRadiusForCount(count: number): number {
  if (count <= 1) return 90;
  return Math.max(90, (PERSON + GAP) / (2 * Math.sin(Math.PI / count)));
}
