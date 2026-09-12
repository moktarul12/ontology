/**
 * Focus-only relation hubs (presentation).
 *
 * Design:
 *   root → [Parent]  → parents (+ anyone who shares those parents)
 *   root → [Child]   → children (+ sole spouse, when only one)
 *   root → [Spouse]  → spouses
 *   root → [Sibling] → siblings
 *
 * Edge minimization (focus + hop 2–3 extended family):
 *   - Shared focus parents → Parent hub; drop father/mother.
 *   - Focus sole spouse → Child hub; drop per-child mother/father.
 *   - Focus multi-spouse → COPARENT arcs.
 *   - Anywhere: sibling cliques collapse to a star around the nearest-to-focus person
 *     (spouse’s siblings at hop 2 — no all-pairs web).
 *   - Anywhere: sole co-parent of a person's kids → drop mother/father fan;
 *     multi co-parent → COPARENT arcs.
 */

import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";

export type HubRelation = "parent" | "child" | "spouse" | "sibling";

export type HubGraphNode = GraphNode & {
  kind?: "person" | "hub";
  hubOf?: string;
  hubRelation?: HubRelation;
};

function idOf(v: string | GraphNode): string {
  return typeof v === "object" ? v.id : v;
}

export function isHubNode(n: GraphNode | HubGraphNode): boolean {
  return (n as HubGraphNode).kind === "hub" || n.id.startsWith("hub:");
}

export function isHubId(id: string): boolean {
  return id.startsWith("hub:");
}

export function isCoParentEdge(e: GraphEdge): boolean {
  return e.propertyId === "COPARENT";
}

export function isHubShareEdge(e: GraphEdge): boolean {
  return e.propertyId === "HUB_SHARE";
}

function isParentLabel(lbl: string): boolean {
  return lbl === "father" || lbl === "mother" || lbl === "parent";
}

function addHub(
  relation: HubRelation,
  rootId: string,
  targets: Map<string, GraphEdge | null>,
  allEdges: GraphEdge[],
  outNodes: HubGraphNode[],
  outEdges: GraphEdge[],
  consumed: Set<string>,
): void {
  if (targets.size === 0) return;

  const hubId = `hub:${rootId}:${relation}`;
  outNodes.push({
    id: hubId,
    label: relation,
    type: "person",
    kind: "hub",
    hubOf: rootId,
    hubRelation: relation,
  });

  outEdges.push({
    id: `${rootId}->${hubId}`,
    source: rootId,
    target: hubId,
    label: relation,
    propertyId: "HUB",
  });

  for (const otherId of targets.keys()) {
    for (const e of allEdges) {
      if (consumed.has(e.id)) continue;
      const s = idOf(e.source);
      const t = idOf(e.target);
      const lbl = e.label.toLowerCase();
      const between = (s === rootId && t === otherId) || (s === otherId && t === rootId);
      if (!between) continue;

      if (relation === "spouse" && lbl === "spouse") consumed.add(e.id);
      if (relation === "sibling" && lbl === "sibling") consumed.add(e.id);
      if (relation === "parent" && isParentLabel(lbl) && s === rootId && t === otherId) {
        consumed.add(e.id);
      }
      if (relation === "child") {
        if (isParentLabel(lbl) && s === otherId && t === rootId) consumed.add(e.id);
        if (lbl === "child" && s === rootId && t === otherId) consumed.add(e.id);
      }
    }

    outEdges.push({
      id: `${hubId}->${otherId}`,
      source: hubId,
      target: otherId,
      label: "",
      propertyId: "HUB",
    });
  }

  if (relation === "child" && targets.size > 1) {
    consumeSiblingEdgesAmong(new Set(targets.keys()), allEdges, consumed);
  }
  if (relation === "sibling" && targets.size > 1) {
    consumeSiblingEdgesAmong(new Set(targets.keys()), allEdges, consumed);
  }
}

function consumeSiblingEdgesAmong(
  personIds: Set<string>,
  allEdges: GraphEdge[],
  consumed: Set<string>,
): void {
  for (const e of allEdges) {
    if (consumed.has(e.id)) continue;
    if (e.label.toLowerCase() !== "sibling") continue;
    const s = idOf(e.source);
    const t = idOf(e.target);
    if (personIds.has(s) && personIds.has(t)) consumed.add(e.id);
  }
}

function collectRoot(
  rootId: string,
  edges: GraphEdge[],
  nodeIds: Set<string>,
): {
  parents: Map<string, GraphEdge | null>;
  children: Map<string, GraphEdge | null>;
  spouses: Map<string, GraphEdge | null>;
  siblings: Map<string, GraphEdge | null>;
} {
  const parents = new Map<string, GraphEdge | null>();
  const children = new Map<string, GraphEdge | null>();
  const spouses = new Map<string, GraphEdge | null>();
  const siblings = new Map<string, GraphEdge | null>();

  for (const e of edges) {
    const s = idOf(e.source);
    const t = idOf(e.target);
    const lbl = e.label.toLowerCase();

    if (isParentLabel(lbl) && s === rootId && !parents.has(t)) parents.set(t, e);
    if (isParentLabel(lbl) && t === rootId && !children.has(s)) children.set(s, e);
    if (lbl === "child" && s === rootId && !children.has(t)) children.set(t, e);
    if (lbl === "spouse") {
      if (s === rootId && !spouses.has(t)) spouses.set(t, e);
      if (t === rootId && !spouses.has(s)) spouses.set(s, e);
    }
    if (lbl === "sibling") {
      if (s === rootId && !siblings.has(t)) siblings.set(t, e);
      if (t === rootId && !siblings.has(s)) siblings.set(s, e);
    }
  }

  const parentIds = [...parents.keys()];
  if (parentIds.length) {
    for (const e of edges) {
      const s = idOf(e.source);
      const t = idOf(e.target);
      if (!isParentLabel(e.label.toLowerCase())) continue;
      if (
        parentIds.includes(t) &&
        s !== rootId &&
        nodeIds.has(s) &&
        !siblings.has(s) &&
        !children.has(s)
      ) {
        siblings.set(s, null);
      }
    }
  }

  return { parents, children, spouses, siblings };
}

/** Anyone who shares focus parents → Parent hub; drop father/mother. */
function linkSharedParentsToParentHub(
  rootId: string,
  parents: Map<string, GraphEdge | null>,
  allEdges: GraphEdge[],
  nodeIds: Set<string>,
  outNodes: HubGraphNode[],
  outEdges: GraphEdge[],
  consumed: Set<string>,
): void {
  if (!parents.size) return;
  const parentHubId = `hub:${rootId}:parent`;
  if (!outNodes.some((n) => n.id === parentHubId)) return;
  const parentIds = new Set(parents.keys());

  for (const personId of nodeIds) {
    if (personId === rootId || parentIds.has(personId)) continue;

    let shares = false;
    for (const e of allEdges) {
      if (consumed.has(e.id)) continue;
      const s = idOf(e.source);
      const t = idOf(e.target);
      const lbl = e.label.toLowerCase();

      if (isParentLabel(lbl) && s === personId && parentIds.has(t)) {
        shares = true;
        consumed.add(e.id);
      } else if (lbl === "child" && parentIds.has(s) && t === personId) {
        shares = true;
        consumed.add(e.id);
      }
    }
    if (!shares) continue;

    const edgeId = `${parentHubId}->${personId}:share`;
    if (!outEdges.some((x) => x.id === edgeId)) {
      outEdges.push({
        id: edgeId,
        source: parentHubId,
        target: personId,
        label: "",
        propertyId: "HUB_SHARE",
      });
    }
  }
}

/** Focus: one spouse + children → Child hub; drop per-child mother/father. */
function linkSoleSpouseToChildHub(
  rootId: string,
  spouses: Map<string, GraphEdge | null>,
  children: Map<string, GraphEdge | null>,
  allEdges: GraphEdge[],
  outNodes: HubGraphNode[],
  outEdges: GraphEdge[],
  consumed: Set<string>,
): void {
  if (spouses.size !== 1 || !children.size) return;
  const spouseId = [...spouses.keys()][0]!;
  const childHubId = `hub:${rootId}:child`;
  if (!outNodes.some((n) => n.id === childHubId)) return;
  const childIds = new Set(children.keys());

  for (const e of allEdges) {
    if (consumed.has(e.id)) continue;
    const s = idOf(e.source);
    const t = idOf(e.target);
    const lbl = e.label.toLowerCase();
    if (isParentLabel(lbl) && t === spouseId && childIds.has(s)) {
      consumed.add(e.id);
    } else if (lbl === "child" && s === spouseId && childIds.has(t)) {
      consumed.add(e.id);
    }
  }

  const edgeId = `${childHubId}->${spouseId}:share`;
  if (!outEdges.some((x) => x.id === edgeId)) {
    outEdges.push({
      id: edgeId,
      source: childHubId,
      target: spouseId,
      label: "",
      propertyId: "HUB_SHARE",
    });
  }
}

function foldCoParentEdges(
  spouseId: string,
  childIds: Set<string>,
  allEdges: GraphEdge[],
  outEdges: GraphEdge[],
  consumed: Set<string>,
  nodes: GraphNode[],
): void {
  for (const e of allEdges) {
    if (consumed.has(e.id)) continue;
    const s = idOf(e.source);
    const t = idOf(e.target);
    const lbl = e.label.toLowerCase();
    let parentId: string | null = null;
    let childId: string | null = null;
    if (isParentLabel(lbl) && t === spouseId && childIds.has(s)) {
      parentId = spouseId;
      childId = s;
    } else if (lbl === "child" && s === spouseId && childIds.has(t)) {
      parentId = spouseId;
      childId = t;
    }
    if (!parentId || !childId) continue;

    consumed.add(e.id);
    const parent = nodes.find((n) => n.id === parentId);
    const label =
      parent?.gender === "female" ? "mother"
      : parent?.gender === "male" ? "father"
      : "parent";
    const edgeId = `coparent:${parentId}:${childId}`;
    if (!outEdges.some((x) => x.id === edgeId)) {
      outEdges.push({
        id: edgeId,
        source: parentId,
        target: childId,
        label,
        propertyId: "COPARENT",
      });
    }
  }
}

/** Focus multi-spouse → COPARENT arcs. */
function addFocusCoParentLinks(
  spouses: Map<string, GraphEdge | null>,
  children: Map<string, GraphEdge | null>,
  allEdges: GraphEdge[],
  outEdges: GraphEdge[],
  consumed: Set<string>,
  nodes: GraphNode[],
): void {
  if (spouses.size <= 1) return;
  const childIds = new Set(children.keys());
  for (const spouseId of spouses.keys()) {
    foldCoParentEdges(spouseId, childIds, allEdges, outEdges, consumed, nodes);
  }
}

/** Collect parent / child / spouse maps for every person from remaining edges. */
function buildFamilyIndex(
  allEdges: GraphEdge[],
  consumed: Set<string>,
  nodeIds: Set<string>,
): {
  parentsOf: Map<string, Set<string>>;
  childrenOf: Map<string, Set<string>>;
  spousesOf: Map<string, Set<string>>;
} {
  const parentsOf = new Map<string, Set<string>>();
  const childrenOf = new Map<string, Set<string>>();
  const spousesOf = new Map<string, Set<string>>();

  const add = (map: Map<string, Set<string>>, key: string, val: string) => {
    if (!nodeIds.has(key) || !nodeIds.has(val)) return;
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(val);
  };

  for (const e of allEdges) {
    if (consumed.has(e.id)) continue;
    const s = idOf(e.source);
    const t = idOf(e.target);
    const lbl = e.label.toLowerCase();

    if (isParentLabel(lbl)) {
      add(parentsOf, s, t);
      add(childrenOf, t, s);
    } else if (lbl === "child") {
      add(childrenOf, s, t);
      add(parentsOf, t, s);
    } else if (lbl === "spouse") {
      add(spousesOf, s, t);
      add(spousesOf, t, s);
    }
  }

  return { parentsOf, childrenOf, spousesOf };
}

/**
 * Hop 2–3: same rules as focus, without nesting hubs on every person.
 * - Drop sibling edges when parents are already known.
 * - Collapse sibling meshes to a star around the member closest to focus
 *   (e.g. Krishna's brothers/sisters — no all-pairs web).
 * - Sole co-parent: drop mother/father fan (kids keep link to the other parent).
 * - Multi co-parent: COPARENT arcs.
 */
function minimizeExtendedFamilyEdges(
  rootId: string,
  allEdges: GraphEdge[],
  nodeIds: Set<string>,
  outEdges: GraphEdge[],
  consumed: Set<string>,
  nodes: GraphNode[],
  focusSpouseIds: Set<string>,
): void {
  const { parentsOf, childrenOf, spousesOf } = buildFamilyIndex(
    allEdges,
    consumed,
    nodeIds,
  );

  // Sibling edges implied by shared parents
  for (const e of allEdges) {
    if (consumed.has(e.id)) continue;
    if (e.label.toLowerCase() !== "sibling") continue;
    const a = idOf(e.source);
    const b = idOf(e.target);
    const pa = parentsOf.get(a);
    const pb = parentsOf.get(b);
    if (!pa?.size || !pb?.size) continue;
    for (const p of pa) {
      if (pb.has(p)) {
        consumed.add(e.id);
        break;
      }
    }
  }

  // Siblings among children of the same parent
  for (const kids of childrenOf.values()) {
    if (kids.size > 1) consumeSiblingEdgesAmong(kids, allEdges, consumed);
  }

  // Hop-2 sibling mesh: drop sibling↔sibling when both are already 2+ hops out
  // (e.g. Uma↔Premnath↔Rajendra — keep only links to Krishna at hop 1)
  pruneDeepSiblingEdges(rootId, allEdges, consumed, nodeIds);

  // Remaining cliques (≥3) → star around focus spouse / nearest to focus
  pruneSiblingMeshesToStar(rootId, allEdges, consumed, nodeIds, focusSpouseIds);

  // Co-parent folds for every non-focus person
  for (const personId of nodeIds) {
    if (personId === rootId) continue;
    const kids = childrenOf.get(personId);
    if (!kids?.size) continue;
    const spouses = spousesOf.get(personId);
    if (!spouses?.size) continue;

    if (spouses.size === 1) {
      const spouseId = [...spouses][0]!;
      for (const e of allEdges) {
        if (consumed.has(e.id)) continue;
        const s = idOf(e.source);
        const t = idOf(e.target);
        const lbl = e.label.toLowerCase();
        const kidId =
          isParentLabel(lbl) && t === spouseId && kids.has(s) ? s
          : lbl === "child" && s === spouseId && kids.has(t) ? t
          : null;
        if (!kidId) continue;
        if (!parentsOf.get(kidId)?.has(personId)) continue;
        consumed.add(e.id);
      }
    } else {
      for (const spouseId of spouses) {
        if (spouseId === personId) continue;
        const spouseKids = new Set<string>();
        for (const kid of kids) {
          const kp = parentsOf.get(kid);
          if (kp?.has(spouseId)) spouseKids.add(kid);
        }
        if (!spouseKids.size) {
          for (const e of allEdges) {
            if (consumed.has(e.id)) continue;
            const s = idOf(e.source);
            const t = idOf(e.target);
            const lbl = e.label.toLowerCase();
            if (lbl === "child" && s === spouseId && kids.has(t)) spouseKids.add(t);
            if (isParentLabel(lbl) && t === spouseId && kids.has(s)) spouseKids.add(s);
          }
        }
        if (spouseKids.size) {
          foldCoParentEdges(spouseId, spouseKids, allEdges, outEdges, consumed, nodes);
        }
      }
    }
  }
}

/**
 * Drop sibling edges where both people are already 2+ hops from the focus.
 * Those are the noisy all-pairs links among a spouse’s siblings, cousins, etc.
 * Links that touch hop-0/1 (focus, parents, kids, spouses, siblings) stay.
 */
function pruneDeepSiblingEdges(
  rootId: string,
  allEdges: GraphEdge[],
  consumed: Set<string>,
  nodeIds: Set<string>,
): void {
  const dist = familyDistanceFromRoot(rootId, allEdges, nodeIds);
  for (const e of allEdges) {
    if (consumed.has(e.id)) continue;
    if (e.label.toLowerCase() !== "sibling") continue;
    const s = idOf(e.source);
    const t = idOf(e.target);
    if (!nodeIds.has(s) || !nodeIds.has(t)) continue;
    const ds = dist.get(s) ?? 99;
    const dt = dist.get(t) ?? 99;
    if (ds >= 2 && dt >= 2) consumed.add(e.id);
  }
}

/** BFS hop distance from root over all person–person family edges. */
function familyDistanceFromRoot(
  rootId: string,
  allEdges: GraphEdge[],
  nodeIds: Set<string>,
): Map<string, number> {
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (!nodeIds.has(a) || !nodeIds.has(b)) return;
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a)!.push(b);
  };
  for (const e of allEdges) {
    const s = idOf(e.source);
    const t = idOf(e.target);
    const lbl = e.label.toLowerCase();
    if (
      !isParentLabel(lbl) &&
      lbl !== "child" &&
      lbl !== "spouse" &&
      lbl !== "sibling"
    ) {
      continue;
    }
    link(s, t);
    link(t, s);
  }

  const dist = new Map<string, number>();
  dist.set(rootId, 0);
  const q = [rootId];
  while (q.length) {
    const cur = q.shift()!;
    const d = dist.get(cur)!;
    for (const n of adj.get(cur) ?? []) {
      if (dist.has(n)) continue;
      dist.set(n, d + 1);
      q.push(n);
    }
  }
  return dist;
}

/**
 * Within each sibling connected component, keep only edges to one anchor
 * (person closest to the focus — usually the focus spouse). Drops the
 * all-pairs sibling web at hop 2 (Uma↔Premnath↔Rajendra↔…).
 */
function pruneSiblingMeshesToStar(
  rootId: string,
  allEdges: GraphEdge[],
  consumed: Set<string>,
  nodeIds: Set<string>,
  focusSpouseIds: Set<string>,
): void {
  const dist = familyDistanceFromRoot(rootId, allEdges, nodeIds);

  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a)!.add(b);
  };

  for (const e of allEdges) {
    if (consumed.has(e.id)) continue;
    if (e.label.toLowerCase() !== "sibling") continue;
    const s = idOf(e.source);
    const t = idOf(e.target);
    if (!nodeIds.has(s) || !nodeIds.has(t)) continue;
    add(s, t);
    add(t, s);
  }

  const seen = new Set<string>();
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      for (const n of adj.get(cur) ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    if (comp.length < 3) continue; // pair is already a star of 1 edge

    // Prefer: focus → focus spouse → nearer to focus
    let anchor = comp[0]!;
    let best = Infinity;
    for (const id of comp) {
      let score = dist.get(id) ?? 99;
      if (id === rootId) score = -2;
      else if (focusSpouseIds.has(id)) score = -1;
      if (score < best || (score === best && id < anchor)) {
        best = score;
        anchor = id;
      }
    }

    // Drop every sibling edge that does not touch the anchor
    for (const e of allEdges) {
      if (consumed.has(e.id)) continue;
      if (e.label.toLowerCase() !== "sibling") continue;
      const s = idOf(e.source);
      const t = idOf(e.target);
      if (!comp.includes(s) || !comp.includes(t)) continue;
      if (s === anchor || t === anchor) continue;
      consumed.add(e.id);
    }
  }
}

/** Ensure every person keeps at least one edge (repair over-aggressive prunes). */
function reconnectOrphans(
  nodes: GraphNode[],
  allEdges: GraphEdge[],
  outEdges: GraphEdge[],
  consumed: Set<string>,
): void {
  const linked = new Set<string>();
  for (const e of outEdges) {
    linked.add(idOf(e.source));
    linked.add(idOf(e.target));
  }

  for (const n of nodes) {
    if (isHubNode(n)) continue;
    if (linked.has(n.id)) continue;

    // Restore the first original family edge involving this person
    for (const e of allEdges) {
      const s = idOf(e.source);
      const t = idOf(e.target);
      if (s !== n.id && t !== n.id) continue;
      if (e.propertyId === "HUB" || e.propertyId === "HUB_SHARE") continue;
      consumed.delete(e.id);
      if (!outEdges.some((x) => x.id === e.id)) {
        outEdges.push(e);
        linked.add(s);
        linked.add(t);
      }
      break;
    }
  }
}

/**
 * Focus hubs + shared-parent / sole-spouse folds + hop 2–3 edge minimization.
 */
export function toRelationHubs(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
): { nodes: HubGraphNode[]; edges: GraphEdge[] } {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const outNodes: HubGraphNode[] = nodes.map((n) => ({ ...n, kind: "person" as const }));
  const outEdges: GraphEdge[] = [];
  const consumed = new Set<string>();

  const { parents, children, spouses, siblings } = collectRoot(rootId, edges, nodeIds);

  addHub("parent", rootId, parents, edges, outNodes, outEdges, consumed);
  addHub("child", rootId, children, edges, outNodes, outEdges, consumed);
  addHub("spouse", rootId, spouses, edges, outNodes, outEdges, consumed);
  addHub("sibling", rootId, siblings, edges, outNodes, outEdges, consumed);

  linkSharedParentsToParentHub(
    rootId,
    parents,
    edges,
    nodeIds,
    outNodes,
    outEdges,
    consumed,
  );
  linkSoleSpouseToChildHub(rootId, spouses, children, edges, outNodes, outEdges, consumed);
  addFocusCoParentLinks(spouses, children, edges, outEdges, consumed, nodes);

  minimizeExtendedFamilyEdges(
    rootId,
    edges,
    nodeIds,
    outEdges,
    consumed,
    nodes,
    new Set(spouses.keys()),
  );

  for (const e of edges) {
    if (!consumed.has(e.id)) outEdges.push(e);
  }

  reconnectOrphans(nodes, edges, outEdges, consumed);

  return { nodes: outNodes, edges: outEdges };
}

export function toRootRelationHubs(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
): { nodes: HubGraphNode[]; edges: GraphEdge[] } {
  return toRelationHubs(nodes, edges, rootId);
}

export function hubsForOwner(
  nodes: GraphNode[],
  ownerId: string,
): Map<HubRelation, HubGraphNode> {
  const map = new Map<HubRelation, HubGraphNode>();
  for (const n of nodes) {
    if (!isHubNode(n)) continue;
    const h = n as HubGraphNode;
    if (h.hubOf === ownerId && h.hubRelation) map.set(h.hubRelation, h);
  }
  return map;
}
