/**
 * Focus-only relation hubs (presentation).
 *
 * Design:
 *   root → [Parent]  → parents
 *   root → [Child]   → children
 *   root → [Spouse]  → spouses
 *   root → [Sibling] → siblings
 *
 * Shared kids (Amit↔Ruma, Sumit↔Leena) become soft COPARENT arcs —
 * no nested hubs on every person (that made depth 2–3 unreadable).
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

  // Infer siblings via shared parents
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

/** Soft mother/father arc when a spouse shares a child with the focus. */
function addCoParentLinks(
  rootId: string,
  spouses: Map<string, GraphEdge | null>,
  children: Map<string, GraphEdge | null>,
  allEdges: GraphEdge[],
  outEdges: GraphEdge[],
  consumed: Set<string>,
  nodes: GraphNode[],
): void {
  const childIds = new Set(children.keys());
  for (const spouseId of spouses.keys()) {
    for (const e of allEdges) {
      if (consumed.has(e.id)) continue;
      const s = idOf(e.source);
      const t = idOf(e.target);
      const lbl = e.label.toLowerCase();
      // child → mother/father → spouse, or spouse → child → child
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
}

/**
 * Focus-only hubs + co-parent arcs. Extended family keeps direct edges.
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

  addCoParentLinks(rootId, spouses, children, edges, outEdges, consumed, nodes);

  for (const e of edges) {
    if (!consumed.has(e.id)) outEdges.push(e);
  }

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
