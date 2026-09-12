/**
 * Family tree layout — readable hop 1–3 graphs with generous spacing.
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
 *            family petals (co-parent + child)
 *
 * Hop 2–3: satellite clusters around their hop-1 anchor, pushed outward
 * from the focus — not packed onto the same ring as ring-1.
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
  wide: "Wide spacing (hop-2 satellites)",
  mirror: "Mirrored (siblings ↔ spouses)",
};

export type LayoutBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

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
  if (isHubNode(n)) return { hw: HUB_W / 2 + 14, hh: HUB_H / 2 + 14 };
  return { hw: PERSON / 2 + 16, hh: PERSON / 2 + 16 };
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
    if (e.propertyId === "HUB_SHARE") continue;
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

function packRow(people: GraphNode[], cx: number, y: number, gap: number): void {
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

  if (spouses.length === 1 && children.length && petals.length === 0) {
    return {
      petals: [{ spouse: spouses[0]!, children: [...children] }],
      soloSpouses: [],
      soloChildren: [],
    };
  }

  // Multi-spouse focus: each spouse with any of focus's kids → petal;
  // remaining spouses stay on the side. Also nestle when COPARENT was folded away
  // but spouse↔child still exists as plain mother/father (handled above).
  const petalSpouseIds = new Set(petals.map((p) => p.spouse.id));
  const soloSpouses = spouses.filter((s) => !petalSpouseIds.has(s.id));
  const soloChildren = children.filter((c) => !claimedKids.has(c.id));
  return { petals, soloSpouses, soloChildren };
}

function deoverlap(nodes: GraphNode[], rootId: string, minGap = 12): void {
  for (let pass = 0; pass < 28; pass++) {
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
          if (preferX) pin(b, (b.x ?? 0) + (ox + 8) * sx, b.y ?? 0);
          else pin(b, b.x ?? 0, (b.y ?? 0) + (oy + 8) * sy);
          continue;
        }
        if (b.id === rootId) {
          if (preferX) pin(a, (a.x ?? 0) - (ox + 8) * sx, a.y ?? 0);
          else pin(a, a.x ?? 0, (a.y ?? 0) - (oy + 8) * sy);
          continue;
        }

        const aHub = isHubNode(a);
        const bHub = isHubNode(b);
        if (preferX) {
          const push = ox / 2 + 6;
          if (!aHub) pin(a, (a.x ?? 0) - push * sx, a.y ?? 0);
          if (!bHub) pin(b, (b.x ?? 0) + push * sx, b.y ?? 0);
          if (aHub && bHub) {
            pin(a, (a.x ?? 0) - push * sx, a.y ?? 0);
            pin(b, (b.x ?? 0) + push * sx, b.y ?? 0);
          }
        } else {
          const push = oy / 2 + 6;
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
 * Hop 2–3: grow satellite clusters around already-placed anchors,
 * pushed further from the focus so they don't sit on the ring-1 orbit.
 */
function placeExtended(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
  placed: Set<string>,
  cx: number,
  cy: number,
  gap: number,
  satelliteReach: number,
  focusSpouseIds: Set<string>,
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
    if (!sn || !tn || isHubNode(sn) || isHubNode(tn)) continue;
    addAdj(s, t);
    addAdj(t, s);
  }

  const pitch = PERSON + gap;
  let guard = 0;
  while (guard++ < 24) {
    const leftover = nodes.filter((n) => !isHubNode(n) && !placed.has(n.id));
    if (!leftover.length) break;

    const byAnchor = new Map<string, GraphNode[]>();
    const stranded: GraphNode[] = [];

    for (const n of leftover) {
      const neighbors = adj.get(n.id) ?? [];
      let best: GraphNode | null = null;
      let bestD = -1;
      for (const oid of neighbors) {
        if (!placed.has(oid)) continue;
        const o = byId.get(oid);
        if (!o || o.x == null || o.y == null) continue;
        const d = (o.x - cx) ** 2 + (o.y - cy) ** 2;
        if (!best || d > bestD || (d === bestD && oid < best.id)) {
          best = o;
          bestD = d;
        }
      }
      if (!best) {
        stranded.push(n);
        continue;
      }
      if (!byAnchor.has(best.id)) byAnchor.set(best.id, []);
      byAnchor.get(best.id)!.push(n);
    }

    if (!byAnchor.size) {
      if (stranded.length) {
        const r = satelliteReach * 2.2;
        const start = -Math.PI / 2;
        stranded.forEach((n, i) => {
          const a = start + (i / Math.max(stranded.length, 1)) * Math.PI * 1.6;
          pin(n, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          placed.add(n.id);
        });
      }
      break;
    }

    for (const [anchorId, group] of byAnchor) {
      const anchor = byId.get(anchorId)!;
      const ax = anchor.x ?? cx;
      const ay = anchor.y ?? cy;
      group.sort((a, b) => a.label.localeCompare(b.label));

      // Spouse’s siblings (hop 2): park beside the spouse, not through the kids
      if (focusSpouseIds.has(anchorId)) {
        const side = ax >= cx ? 1 : -1;
        const colX = ax + side * (satelliteReach + PERSON * 0.4);
        if (group.length === 1) {
          pin(group[0]!, colX, ay);
          placed.add(group[0]!.id);
        } else {
          const total = (group.length - 1) * pitch;
          let y = ay - total / 2;
          for (const n of group) {
            pin(n, colX, y);
            placed.add(n.id);
            y += pitch;
          }
        }
        continue;
      }

      let dx = ax - cx;
      let dy = ay - cy;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const clusterCx = ax + dx * satelliteReach;
      const clusterCy = ay + dy * satelliteReach;

      if (group.length === 1) {
        pin(group[0]!, clusterCx, clusterCy);
        placed.add(group[0]!.id);
        continue;
      }

      const px = -dy;
      const py = dx;
      const total = (group.length - 1) * pitch;
      for (let i = 0; i < group.length; i++) {
        const t = -total / 2 + i * pitch;
        const bulge =
          Math.sin((i / Math.max(group.length - 1, 1)) * Math.PI) * (gap * 0.35);
        pin(
          group[i]!,
          clusterCx + px * t + dx * bulge,
          clusterCy + py * t + dy * bulge,
        );
        placed.add(group[i]!.id);
      }
    }
  }
}

export type FamilyLayoutOpts = {
  wide?: boolean;
  mirror?: boolean;
  /** Extra scale for arms / satellites (auto-arrange cycles this) */
  spread?: number;
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
  void gens;
  const spread = opts.spread ?? (opts.wide ? 1.45 : 1);
  const cx = W / 2;
  const cy = H / 2;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = byId.get(rootId);
  if (!root) return boundsOf(nodes);

  for (const n of nodes) {
    n.fx = undefined;
    n.fy = undefined;
  }

  const gap = Math.round((opts.wide ? 72 : 52) * spread);
  const arm = Math.round((opts.wide ? 260 : 210) * spread);
  const outer = arm + Math.round(180 * spread);
  const satelliteReach = Math.round((opts.wide ? 220 : 170) * spread);
  const pitch = PERSON + gap;

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

  const parentHub = hubs.get("parent");
  if (parentHub) {
    pin(parentHub, cx, cy - arm);
    placed.add(parentHub.id);
  }
  if (parents.length) {
    packRow(parents, cx, cy - outer, gap);
    for (const p of parents) placed.add(p.id);
  }

  const siblingHub = hubs.get("sibling");
  if (siblingHub) {
    pin(siblingHub, cx + sibSide * arm, cy);
    placed.add(siblingHub.id);
  }
  if (siblings.length) {
    const total = siblings.length * pitch;
    let y = cy - total / 2 + pitch / 2;
    const x = cx + sibSide * outer;
    for (const s of siblings) {
      pin(s, x, y);
      placed.add(s.id);
      y += pitch;
    }
  }

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

  const childHub = hubs.get("child");
  if (childHub) {
    pin(childHub, cx, cy + arm);
    placed.add(childHub.id);
  }

  const focusSpouseIds = new Set(spouses.map((s) => s.id));

  // Sole spouse + shared kids: vertical family stack (no spouse/child hub collision)
  const soleFamily =
    spouses.length === 1 &&
    petals.length === 1 &&
    soloSpouses.length === 0 &&
    soloChildren.length === 0;

  type Unit = { kind: "petal"; petal: Petal } | { kind: "child"; node: GraphNode };
  const units: Unit[] = soleFamily
    ? []
    : [
        ...petals.map((p) => ({ kind: "petal" as const, petal: p })),
        ...soloChildren.map((n) => ({ kind: "child" as const, node: n })),
      ];

  if (soleFamily) {
    const petal = petals[0]!;
    const kids = petal.children;
    const spouse = petal.spouse;
    const stack = PERSON + gap + 28;
    const spouseHubY = cy + Math.round(arm * 0.65);
    const spouseY = spouseHubY + stack;
    const childHubY = spouseY + stack;
    const childY = childHubY + stack + 12;
    const kidGap = gap + (kids.length >= 4 ? 20 : 8);

    if (spouseHub) {
      pin(spouseHub, cx, spouseHubY);
      placed.add(spouseHub.id);
    }
    pin(spouse, cx, spouseY);
    placed.add(spouse.id);

    if (childHub) {
      pin(childHub, cx, childHubY);
      placed.add(childHub.id);
    }
    packRow(kids, cx, childY, kidGap);
    for (const k of kids) placed.add(k.id);
  } else if (units.length) {
    const unitPitch = pitch + (petals.length ? 48 : 0);
    const total = units.length * unitPitch;
    let x = cx - total / 2 + unitPitch / 2;
    const childY = cy + outer;
    const spouseY = childY - (PERSON + gap + 40);
    const kidGap = gap + 8;

    for (const u of units) {
      if (u.kind === "petal") {
        const kids = u.petal.children;
        packRow(kids, x, childY, kidGap);
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

    if (childHub && children.length) {
      const ay = children.reduce((s, p) => s + (p.y ?? childY), 0) / children.length;
      const hubY = Math.min(ay - (PERSON + gap), cy + arm + 40);
      const ax = children.reduce((s, p) => s + (p.x ?? cx), 0) / children.length;
      pin(childHub, cx * 0.25 + ax * 0.75, hubY);
    }
    if (spouseHub && spouses.length) {
      const ax = spouses.reduce((s, p) => s + (p.x ?? cx), 0) / spouses.length;
      const ay = spouses.reduce((s, p) => s + (p.y ?? cy), 0) / spouses.length;
      const below = ay > cy + arm * 0.4;
      if (below) {
        pin(spouseHub, ax, Math.min(ay - (PERSON * 0.75 + gap * 0.5), cy + arm));
      } else {
        pin(spouseHub, cx * 0.35 + ax * 0.65, cy * 0.35 + ay * 0.65);
      }
    }
  } else {
    if (spouseHub && spouses.length) {
      const ax = spouses.reduce((s, p) => s + (p.x ?? cx), 0) / spouses.length;
      const ay = spouses.reduce((s, p) => s + (p.y ?? cy), 0) / spouses.length;
      pin(spouseHub, cx * 0.35 + ax * 0.65, cy * 0.35 + ay * 0.65);
    }
    if (childHub && children.length) {
      const ax = children.reduce((s, p) => s + (p.x ?? cx), 0) / children.length;
      const ay = children.reduce((s, p) => s + (p.y ?? cy), 0) / children.length;
      pin(childHub, cx * 0.3 + ax * 0.7, Math.max(ay - (PERSON + gap), cy + arm));
    }
  }

  placeExtended(
    nodes,
    edges,
    rootId,
    placed,
    cx,
    cy,
    gap,
    satelliteReach,
    focusSpouseIds,
  );

  for (const n of nodes) {
    if (!isHubNode(n) || placed.has(n.id)) continue;
    const h = n as HubGraphNode;
    const owner = h.hubOf ? byId.get(h.hubOf) : undefined;
    if (!owner) continue;
    pin(h, owner.x ?? cx, (owner.y ?? cy) - 80);
    placed.add(h.id);
  }

  deoverlap(nodes, rootId, Math.round(10 * spread));
  return boundsOf(nodes);
}

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
  return layoutFamilyTree(nodes, edges, rootId, gens, W, H, { wide: true, spread: 1.45 });
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
  return layoutFamilyTree(nodes, edges, rootId, gens, W, H, { mirror: true, spread: 1.2 });
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
    return layoutFamilyTree(nodes, edges, rootId, gens, W, H, {
      wide: true,
      spread: 1.55,
    });
  }
  if (mode === "mirror" || mode === "radial") {
    return layoutFamilyTree(nodes, edges, rootId, gens, W, H, {
      mirror: true,
      spread: 1.25,
    });
  }
  return layoutFamilyTree(nodes, edges, rootId, gens, W, H, { spread: 1 });
}

export function getOrbitRings(_nodes: GraphNode[], _edges: GraphEdge[]): OrbitRing[] {
  void _nodes;
  void _edges;
  return [];
}

export function orbitRadiusForCount(count: number): number {
  if (count <= 1) return 90;
  const gap = 52;
  return Math.max(90, (PERSON + gap) / (2 * Math.sin(Math.PI / count)));
}
