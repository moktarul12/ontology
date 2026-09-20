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
  isHubId,
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
  // Rounded-rect people (≈148×56)
  return { hw: 74 + 12, hh: 28 + 12 };
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
    if (a === b) return;
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

  // Treat relation hubs as transparent: people on the same hub place as neighbors
  const hubPeople = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.propertyId !== "HUB" && e.propertyId !== "HUB_SHARE") continue;
    const s = idOf(e.source);
    const t = idOf(e.target);
    const hubId = isHubId(s) ? s : isHubId(t) ? t : null;
    const personId = isHubId(s) ? t : isHubId(t) ? s : null;
    if (!hubId || !personId || isHubId(personId)) continue;
    if (!hubPeople.has(hubId)) hubPeople.set(hubId, new Set());
    hubPeople.get(hubId)!.add(personId);
  }
  for (const [hubId, people] of hubPeople) {
    const hub = byId.get(hubId) as HubGraphNode | undefined;
    if (hub?.hubOf) people.add(hub.hubOf);
    const ids = [...people];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        addAdj(ids[i]!, ids[j]!);
        addAdj(ids[j]!, ids[i]!);
      }
    }
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

  // Pack kids of each extended "child" hub into a tight row under the hub
  for (const n of nodes) {
    if (!isHubNode(n)) continue;
    const h = n as HubGraphNode;
    if (h.hubRelation !== "child" || h.hubOf === rootId) continue;
    const owner = h.hubOf ? byId.get(h.hubOf) : undefined;
    if (!owner || owner.x == null || owner.y == null) continue;
    const kids = hubTargets(h.id, edges, byId);
    if (!kids.length) continue;
    const kidGap = gap + (kids.length >= 4 ? 12 : 4);
    const hubY = (owner.y ?? cy) + PERSON + gap + 20;
    const hubX = owner.x ?? cx;
    // Prefer midpoint with co-parent if present
    let ax = hubX;
    let shareCount = 1;
    for (const e of edges) {
      if (e.propertyId !== "HUB_SHARE") continue;
      const s = idOf(e.source);
      const t = idOf(e.target);
      if (t !== h.id && s !== h.id) continue;
      const otherId = t === h.id ? s : t;
      const other = byId.get(otherId);
      if (!other || other.x == null) continue;
      ax += other.x;
      shareCount += 1;
    }
    ax /= shareCount;
    pin(h, ax, hubY);
    placed.add(h.id);
    packRow(kids, ax, hubY + PERSON + gap + 8, kidGap);
    for (const k of kids) placed.add(k.id);
  }

  for (const n of nodes) {
    if (!isHubNode(n) || placed.has(n.id)) continue;
    const h = n as HubGraphNode;
    const owner = h.hubOf ? byId.get(h.hubOf) : undefined;
    if (!owner) continue;
    const dy =
      h.hubRelation === "child" ? 72
      : h.hubRelation === "parent" ? -72
      : -56;
    // Sit hub between owner and its spoke people when we can
    const spokes = hubTargets(h.id, edges, byId);
    if (spokes.length && h.hubRelation === "child") {
      const sax = spokes.reduce((s, p) => s + (p.x ?? owner.x ?? cx), 0) / spokes.length;
      const say = spokes.reduce((s, p) => s + (p.y ?? owner.y ?? cy), 0) / spokes.length;
      pin(h, (owner.x ?? cx) * 0.45 + sax * 0.55, (owner.y ?? cy) * 0.45 + say * 0.55);
    } else {
      pin(h, owner.x ?? cx, (owner.y ?? cy) + dy);
    }
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

/** Undirected hop distance from root (parents, children, spouses, siblings). */
export function hopDistanceFromRoot(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
): Map<string, number> {
  const hops = new Map<string, number>();
  hops.set(rootId, 0);
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  for (const e of edges) {
    if (e.propertyId === "HUB" || e.propertyId === "HUB_SHARE") continue;
    const s = idOf(e.source);
    const t = idOf(e.target);
    if (isHubId(s) || isHubId(t)) continue;
    link(s, t);
  }

  // Relation hubs are transparent: people on the same hub are neighbors for hop count
  const hubPeople = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.propertyId !== "HUB" && e.propertyId !== "HUB_SHARE") continue;
    const s = idOf(e.source);
    const t = idOf(e.target);
    const hubId = isHubId(s) ? s : isHubId(t) ? t : null;
    const personId = isHubId(s) ? t : isHubId(t) ? s : null;
    if (!hubId || !personId || isHubId(personId)) continue;
    if (!hubPeople.has(hubId)) hubPeople.set(hubId, new Set());
    hubPeople.get(hubId)!.add(personId);
  }
  for (const n of nodes) {
    if (!isHubNode(n)) continue;
    const h = n as HubGraphNode;
    if (!h.hubOf) continue;
    if (!hubPeople.has(n.id)) hubPeople.set(n.id, new Set());
    hubPeople.get(n.id)!.add(h.hubOf);
  }
  for (const people of hubPeople.values()) {
    const ids = [...people];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) link(ids[i]!, ids[j]!);
    }
  }

  const q = [rootId];
  while (q.length) {
    const cur = q.shift()!;
    const d = hops.get(cur) ?? 0;
    for (const n of adj.get(cur) ?? []) {
      if (hops.has(n)) continue;
      hops.set(n, d + 1);
      q.push(n);
    }
  }
  for (const n of nodes) {
    if (!hops.has(n.id) && !isHubNode(n)) hops.set(n.id, 99);
  }
  return hops;
}

function isParentLbl(lbl: string): boolean {
  return lbl === "father" || lbl === "mother" || lbl === "parent";
}

type CompassBucket = "parent" | "child" | "spouse" | "sibling";

/** Classify hop-1 neighbors of the focus into compass buckets. */
function classifyFocusNeighbors(
  rootId: string,
  edges: GraphEdge[],
): Map<string, CompassBucket> {
  const role = new Map<string, CompassBucket>();
  for (const e of edges) {
    const s = idOf(e.source);
    const t = idOf(e.target);
    const lbl = e.label.toLowerCase();
    if (isParentLbl(lbl) && s === rootId) role.set(t, "parent");
    if (isParentLbl(lbl) && t === rootId) role.set(s, "child");
    if (lbl === "child" && s === rootId) role.set(t, "child");
    if (lbl === "spouse") {
      if (s === rootId) role.set(t, "spouse");
      if (t === rootId) role.set(s, "spouse");
    }
    if (lbl === "sibling") {
      if (s === rootId) role.set(t, "sibling");
      if (t === rootId) role.set(s, "sibling");
    }
  }
  return role;
}

/**
 * Orbit portals around the focus, then extended family nestled outward.
 * `phase` (0–3) rotates which portal sits N/S/W/E so Rearrange visibly changes.
 */
export function layoutOrbitCircles(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
  W: number,
  H: number,
  opts?: { phase?: number },
): LayoutBounds {
  const cx = W / 2;
  const cy = H / 2;
  const phase = ((opts?.phase ?? 0) % 4 + 4) % 4;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const root = byId.get(rootId);
  if (!root) return boundsOf(nodes);

  for (const n of nodes) {
    n.fx = undefined;
    n.fy = undefined;
  }

  pin(root, cx, cy);

  type Rel = "parent" | "child" | "spouse" | "sibling";
  const REL_ORDER: Rel[] = ["parent", "child", "sibling", "spouse"];

  const hubs = nodes.filter(
    (n) => isHubNode(n) && (n as HubGraphNode).hubOf === rootId,
  ) as HubGraphNode[];

  const membersOf = (hubId: string): GraphNode[] => {
    const out: GraphNode[] = [];
    const seen = new Set<string>();
    for (const e of edges) {
      if (e.propertyId !== "HUB") continue;
      const s = idOf(e.source);
      const t = idOf(e.target);
      if (s !== hubId) continue;
      if (isHubId(t) || t === rootId || seen.has(t)) continue;
      const person = byId.get(t);
      if (person) {
        seen.add(t);
        out.push(person);
      }
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  };

  const GAP = 172;
  const HUB_GAP = 230;
  const ARM = 310;

  const placeRow = (list: GraphNode[], y: number) => {
    const n = list.length;
    if (!n) return;
    const totalW = (n - 1) * GAP;
    list.forEach((p, i) => {
      const x = n === 1 ? cx : cx - totalW / 2 + i * GAP;
      pin(p, x, y);
    });
  };

  const placeCol = (list: GraphNode[], baseX: number, outward: number) => {
    const n = list.length;
    if (!n) return;
    const cols = n > 5 ? 2 : 1;
    const perCol = Math.ceil(n / cols);
    list.forEach((p, i) => {
      const col = Math.floor(i / perCol);
      const row = i % perCol;
      const colCount = Math.min(perCol, n - col * perCol);
      const totalH = (colCount - 1) * GAP;
      const y = colCount === 1 ? cy : cy - totalH / 2 + row * GAP;
      const x = baseX + outward * col * GAP;
      pin(p, x, y);
    });
  };

  // Cardinal slots: 0=N, 1=S, 2=W, 3=E — phase rotates relation → slot
  const slots = [
    {
      placeHub: (h: GraphNode) => pin(h, cx, cy - HUB_GAP),
      placeMembers: (m: GraphNode[]) => placeRow(m, cy - HUB_GAP - ARM),
    },
    {
      placeHub: (h: GraphNode) => pin(h, cx, cy + HUB_GAP),
      placeMembers: (m: GraphNode[]) => placeRow(m, cy + HUB_GAP + ARM),
    },
    {
      placeHub: (h: GraphNode) => pin(h, cx - HUB_GAP, cy),
      placeMembers: (m: GraphNode[]) => placeCol(m, cx - HUB_GAP - ARM, -1),
    },
    {
      placeHub: (h: GraphNode) => pin(h, cx + HUB_GAP, cy),
      placeMembers: (m: GraphNode[]) => placeCol(m, cx + HUB_GAP + ARM, 1),
    },
  ];

  for (const hub of hubs) {
    const rel = (hub.hubRelation ?? "sibling") as Rel;
    const base = REL_ORDER.indexOf(rel);
    const slot = slots[(base < 0 ? 0 : base + phase) % 4]!;
    slot.placeHub(hub);
    slot.placeMembers(membersOf(hub.id));
  }

  const focusHubIds = new Set(hubs.map((h) => h.id));

  const extHubs = nodes.filter(
    (n) => isHubNode(n) && (n as HubGraphNode).hubOf && (n as HubGraphNode).hubOf !== rootId,
  ) as HubGraphNode[];

  const placeFan = (list: GraphNode[], hx: number, hy: number, baseAng: number) => {
    const n = list.length;
    if (!n) return;
    // Arc radius so neighbor chord ≈ GAP
    const halfSpread = n === 1 ? 0 : Math.min(0.85, ((n - 1) * 0.32) / 2);
    const radius =
      n === 1 ? 150 : Math.max(150, GAP / (2 * Math.sin(Math.max(halfSpread / Math.max(n - 1, 1), 0.12))));
    list.forEach((p, i) => {
      const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (halfSpread * 2);
      const ang = baseAng + t;
      pin(p, hx + Math.cos(ang) * radius, hy + Math.sin(ang) * radius);
    });
  };

  const clearOfFocusHubs = (x: number, y: number, minD = 95): { x: number; y: number } => {
    let px = x;
    let py = y;
    for (let guard = 0; guard < 6; guard++) {
      let moved = false;
      for (const hub of hubs) {
        if (hub.fx == null || hub.fy == null) continue;
        const dx = px - hub.fx;
        const dy = py - hub.fy;
        const dist = Math.hypot(dx, dy) || 0.01;
        if (dist >= minD) continue;
        const push = minD - dist + 4;
        px += (dx / dist) * push;
        py += (dy / dist) * push;
        moved = true;
      }
      if (!moved) break;
    }
    return { x: px, y: py };
  };

  for (const hub of extHubs) {
    if (hub.fx != null) continue;
    const owner = byId.get(hub.hubOf!);
    if (!owner || owner.fx == null || owner.fy == null) continue;
    const ox = owner.fx;
    const oy = owner.fy;
    const baseAng = Math.atan2(oy - cy, ox - cx) + phase * 0.4;
    const rel = hub.hubRelation ?? "child";
    const hubDist = 120;
    const hubAng =
      rel === "child" ? baseAng + 0.55
      : rel === "parent" ? baseAng - 0.55
      : baseAng + Math.PI / 2;
    const raw = {
      x: ox + Math.cos(hubAng) * hubDist,
      y: oy + Math.sin(hubAng) * hubDist,
    };
    const cleared = clearOfFocusHubs(raw.x, raw.y, 140);
    pin(hub, cleared.x, cleared.y);
  }

  for (const hub of extHubs) {
    if (hub.fx == null || hub.fy == null) continue;
    const members = membersOf(hub.id).filter((p) => p.fx == null);
    if (!members.length) continue;
    const owner = byId.get(hub.hubOf!);
    const baseAng =
      owner?.fx != null && owner.fy != null
        ? Math.atan2(hub.fy - owner.fy, hub.fx - owner.fx)
        : Math.atan2(hub.fy - cy, hub.fx - cx);
    placeFan(members, hub.fx, hub.fy, baseAng);
  }

  const peopleOnly = nodes.filter((n) => !isHubNode(n));
  const hops = hopDistanceFromRoot(peopleOnly, edges, rootId);
  const pending = nodes.filter((n) => n.fx == null);
  pending.sort((a, b) => {
    const ha = isHubNode(a) ? 0 : (hops.get(a.id) ?? 99);
    const hb = isHubNode(b) ? 0 : (hops.get(b.id) ?? 99);
    return ha - hb;
  });

  const slotCount = new Map<string, number>();
  for (const n of pending) {
    let best: GraphNode | undefined;
    let bestScore = Infinity;
    for (const e of edges) {
      const s = idOf(e.source);
      const t = idOf(e.target);
      const other = s === n.id ? t : t === n.id ? s : null;
      if (!other) continue;
      const o = byId.get(other);
      if (!o || o.fx == null || o.fy == null) continue;
      const hubPenalty = focusHubIds.has(other) ? 5e5 : 0;
      const h = isHubId(other)
        ? ((byId.get(other) as HubGraphNode | undefined)?.hubOf
          ? hops.get((byId.get(other) as HubGraphNode).hubOf!) ?? 2
          : 2)
        : (hops.get(other) ?? 99);
      const d = (o.fx - cx) ** 2 + (o.fy - cy) ** 2;
      const score = hubPenalty + h * 1e6 + d;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (best && best.fx != null && best.fy != null) {
      const key = best.id;
      const slot = slotCount.get(key) ?? 0;
      slotCount.set(key, slot + 1);
      const baseAng = Math.atan2(best.fy - cy, best.fx - cx) + phase * 0.25;
      const ang = baseAng + (slot - 0.5) * 0.48;
      const dist = 130 + (slot % 4) * 22;
      const raw = {
        x: best.fx + Math.cos(ang) * dist,
        y: best.fy + Math.sin(ang) * dist,
      };
      const cleared = clearOfFocusHubs(raw.x, raw.y, 130);
      pin(n, cleared.x, cleared.y);
    } else {
      const hop = Math.min(hops.get(n.id) ?? 3, 4);
      const ring = 300 + hop * 90;
      const i = slotCount.get("__ring") ?? 0;
      slotCount.set("__ring", i + 1);
      const ang = -Math.PI / 2 + phase * (Math.PI / 2) + i * 0.5;
      const cleared = clearOfFocusHubs(
        cx + Math.cos(ang) * ring,
        cy + Math.sin(ang) * ring,
        100,
      );
      pin(n, cleared.x, cleared.y);
    }
  }

  // Soft pull only for extreme outliers — don't pack siblings tight again
  for (const hub of [...hubs, ...extHubs]) {
    if (hub.fx == null || hub.fy == null) continue;
    const members = membersOf(hub.id);
    if (members.length < 2) continue;
    const mx = members.reduce((s, p) => s + (p.x ?? 0), 0) / members.length;
    const my = members.reduce((s, p) => s + (p.y ?? 0), 0) / members.length;
    for (const p of members) {
      if (p.id === rootId) continue;
      const px = p.x ?? mx;
      const py = p.y ?? my;
      const dx = px - mx;
      const dy = py - my;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const maxR = 120 + members.length * 55;
      if (dist <= maxR) continue;
      const t = maxR / dist;
      pin(p, mx + dx * t, my + dy * t);
    }
  }

  // Collision: people ↔ people and people ↔ hubs
  const allHubs = [...hubs, ...extHubs];
  const personR = (id: string) => (id === rootId ? 64 : 58);
  const hubR = 78;
  const air = 28;

  for (let pass = 0; pass < 18; pass++) {
    let moved = false;
    const people = nodes.filter((n) => !isHubNode(n));

    for (let i = 0; i < people.length; i++) {
      for (let j = i + 1; j < people.length; j++) {
        const a = people[i]!;
        const b = people[j]!;
        const ax = a.x ?? 0, ay = a.y ?? 0;
        const bx = b.x ?? 0, by = b.y ?? 0;
        let dx = bx - ax, dy = by - ay;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minDist = personR(a.id) + personR(b.id) + air;
        if (dist >= minDist) continue;
        const push = Math.min(22, (minDist - dist) / 2 + 1);
        dx /= dist;
        dy /= dist;
        if (a.id !== rootId) {
          pin(a, ax - dx * push, ay - dy * push);
          moved = true;
        }
        if (b.id !== rootId) {
          pin(b, bx + dx * push, by + dy * push);
          moved = true;
        }
      }
    }

    for (const p of people) {
      if (p.id === rootId) continue;
      const px = p.x ?? 0;
      const py = p.y ?? 0;
      const pr = personR(p.id);
      for (const hub of allHubs) {
        if (hub.fx == null || hub.fy == null) continue;
        const hx = hub.fx;
        const hy = hub.fy;
        let dx = px - hx;
        let dy = py - hy;
        let dist = Math.hypot(dx, dy) || 0.01;
        const minDist = pr + hubR + 12;
        if (dist >= minDist) continue;
        const push = minDist - dist + 2;
        dx /= dist;
        dy /= dist;
        pin(p, px + dx * push, py + dy * push);
        if (!focusHubIds.has(hub.id)) {
          pin(hub, hx - dx * push * 0.35, hy - dy * push * 0.35);
        }
        moved = true;
      }
    }

    if (!moved) break;
  }

  return boundsOf(nodes);
}

export function filterCompassEdges(
  edges: GraphEdge[],
  rootId: string,
  hops: Map<string, number>,
): GraphEdge[] {
  const out: GraphEdge[] = [];
  const seenPair = new Set<string>();

  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

  for (const e of edges) {
    if (e.propertyId === "HUB" || e.propertyId === "HUB_SHARE" || e.propertyId === "COPARENT") {
      continue;
    }
    const s = idOf(e.source);
    const t = idOf(e.target);
    if (isHubId(s) || isHubId(t)) continue;

    const hs = hops.get(s) ?? 99;
    const ht = hops.get(t) ?? 99;
    const lbl = e.label.toLowerCase();

    // Drop same-hop sibling webs (biggest clutter)
    if (lbl === "sibling" && hs === ht && hs !== 0) continue;
    // Only keep sibling edges that touch the root
    if (lbl === "sibling" && s !== rootId && t !== rootId) continue;

    // Orient outward: closer-to-root → farther.
    // Wikidata-style "father" is child→parent; after flip it becomes root→child.
    let source = s;
    let target = t;
    let label = e.label;
    let propertyId = e.propertyId;
    if (ht < hs || (t === rootId && s !== rootId)) {
      source = t;
      target = s;
      if (isParentLbl(lbl)) {
        // was "X's father is root" (X→root) → root→X as child
        label = "child";
        propertyId = "P40";
      } else if (lbl === "child") {
        // was "X's child is root" (X→root) → root→X as parent
        label = "parent";
        propertyId = "P22";
      }
    }

    // Keep focus kinship + one-hop generational spokes (no cousin/spouse mesh)
    const touchesRoot = source === rootId || target === rootId;
    const ll = label.toLowerCase();
    const stepOut = Math.abs(hs - ht) === 1;
    const generational = isParentLbl(ll) || ll === "child" || ll === "parent";
    if (!touchesRoot && !(stepOut && generational)) {
      continue;
    }

    // One edge per pair (after filters so we don't drop a better edge)
    const pk = pairKey(source, target);
    if (seenPair.has(pk)) continue;
    seenPair.add(pk);

    out.push({
      ...e,
      id: `compass:${source}->${target}:${label}`,
      source,
      target,
      label,
      propertyId,
    });
  }

  return out;
}

/** Sector caption anchors for the compass view (relative to root). */
export function compassSectorLabels(
  rootX: number,
  rootY: number,
): Array<{ id: string; label: string; x: number; y: number; color: string }> {
  const r = 105;
  return [
    { id: "parent", label: "Parents", x: rootX, y: rootY - r, color: "#6B5CA8" },
    { id: "child", label: "Children", x: rootX, y: rootY + r, color: "#C48A2A" },
    { id: "spouse", label: "Spouses", x: rootX + r, y: rootY, color: "#C45A7A" },
    { id: "sibling", label: "Siblings", x: rootX - r, y: rootY, color: "#2E8B57" },
  ];
}
