/**
 * Knowledge-graph relation hubs (presentation).
 *
 * Focus-only (family-tree pattern):
 *   root → [Actor] → films… (10 at a time, +10 more)
 *   root → [Occupation] → roles…
 *
 * Expanded neighbors stay plain entities (no secondary hubs).
 * Taxonomy edges like "subclass of" (P279) are never shown.
 */

import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";

export type KnowledgeHubNode = GraphNode & {
  kind: "hub";
  hubOf: string;
  hubPropertyId: string;
  hubRelation: string;
};

export const HUB_PAGE_SIZE = 10;

/** Never show these as edges or hubs (taxonomy noise). */
export const HIDDEN_GRAPH_PROPERTIES = new Set(["P279"]);

/** Stable arm order: creative roles, then bio / people / place, then alpha. */
export const HUB_SORT_RANK: Record<string, number> = {
  P161: 10,
  P57: 20,
  P162: 30,
  P86: 40,
  P175: 50,
  P58: 60,
  P800: 70,
  P106: 100,
  P108: 110,
  P69: 120,
  P166: 130,
  P39: 140,
  P26: 200,
  P22: 210,
  P25: 220,
  P40: 230,
  P19: 300,
  P20: 310,
  P27: 320,
  P31: 400,
  P136: 410,
  P452: 420,
};

const HUB_COLORS: Record<string, string> = {
  P161: "#2A7AB0",
  P57: "#8B5A2B",
  P162: "#B8860B",
  P86: "#6B4C9A",
  P175: "#C45A7A",
  P58: "#3A7A62",
  P800: "#D46EC8",
  P50: "#5B6BB5",
  P170: "#5B6BB5",
  P106: "#2E8B57",
  P166: "#C48A2A",
  P26: "#C45A7A",
  P22: "#6B5CA8",
  P25: "#6B5CA8",
  P40: "#C48A2A",
  P19: "#3A7A9E",
  P20: "#3A7A9E",
  P27: "#3A7A9E",
  P69: "#5B8A6A",
  P136: "#A06090",
  P31: "#6A7A90",
  P452: "#6A7A90",
};

function idOf(v: string | GraphNode): string {
  return typeof v === "object" ? v.id : v;
}

export function isKnowledgeHub(n: GraphNode): boolean {
  return n.kind === "hub" || n.id.startsWith("khub:") || n.id.startsWith("khub-more:");
}

export function isHubMoreNode(n: GraphNode): boolean {
  return Boolean(n.hubMore) || n.id.startsWith("khub-more:");
}

export function hubColorForProperty(pid: string): string {
  return HUB_COLORS[pid] ?? "#5A7A9A";
}

export function hubIdFor(ownerId: string, propertyId: string): string {
  return `khub:${ownerId}:${propertyId}`;
}

export function compareHubProperties(a: string, b: string): number {
  const ra = HUB_SORT_RANK[a] ?? 900;
  const rb = HUB_SORT_RANK[b] ?? 900;
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b);
}

/** Focus hubs for the root (excludes +more controls). */
export function focusHubs(nodes: GraphNode[], rootId: string): GraphNode[] {
  return nodes
    .filter((n) => isKnowledgeHub(n) && !isHubMoreNode(n) && n.hubOf === rootId)
    .sort((a, b) => compareHubProperties(a.hubPropertyId ?? "", b.hubPropertyId ?? ""));
}

/**
 * Presentation transform: hubs only on the focus root.
 * Edges that touch the root are folded through property hubs;
 * hop-2+ edges stay as direct labeled links.
 */
export function toKnowledgeHubs(
  nodes: GraphNode[],
  edges: GraphEdge[],
  shownByHub: Record<string, number> = {},
  rootId?: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const entityNodes = nodes.filter((n) => !isKnowledgeHub(n));
  const nodeIds = new Set(entityNodes.map((n) => n.id));
  const outNodes: GraphNode[] = entityNodes.map((n) => ({
    ...n,
    kind: n.kind ?? "entity",
  }));
  const outEdges: GraphEdge[] = [];
  const consumed = new Set<string>();

  if (!rootId || !nodeIds.has(rootId)) {
    for (const e of edges) {
      if (HIDDEN_GRAPH_PROPERTIES.has(e.propertyId)) continue;
      outEdges.push(e);
    }
    return { nodes: outNodes, edges: outEdges };
  }

  // propertyId → edges touching root (other endpoint is the leaf)
  const byProp = new Map<string, Array<{ edge: GraphEdge; otherId: string }>>();

  for (const e of edges) {
    if (HIDDEN_GRAPH_PROPERTIES.has(e.propertyId)) {
      consumed.add(e.id);
      continue;
    }
    if (!e.propertyId || e.propertyId === "HUB") continue;

    const s = idOf(e.source);
    const t = idOf(e.target);
    if (!nodeIds.has(s) || !nodeIds.has(t)) continue;

    let otherId: string | null = null;
    if (s === rootId && t !== rootId) otherId = t;
    else if (t === rootId && s !== rootId) otherId = s;
    if (!otherId) continue;

    const list = byProp.get(e.propertyId) ?? [];
    list.push({ edge: e, otherId });
    byProp.set(e.propertyId, list);
  }

  const propertyIds = [...byProp.keys()].sort(compareHubProperties);

  for (const pid of propertyIds) {
    const list = byProp.get(pid)!;
    // Dedupe by otherId (prefer first)
    const seen = new Set<string>();
    const unique = list.filter((item) => {
      if (seen.has(item.otherId)) {
        consumed.add(item.edge.id);
        return false;
      }
      seen.add(item.otherId);
      return true;
    });
    if (unique.length < 1) continue;

    const hubId = hubIdFor(rootId, pid);
    const label = unique[0]!.edge.label || pid;
    const total = unique.length;
    const shown = Math.min(Math.max(shownByHub[hubId] ?? HUB_PAGE_SIZE, HUB_PAGE_SIZE), total);
    const visible = unique.slice(0, shown);
    const remaining = total - shown;

    outNodes.push({
      id: hubId,
      label,
      type: "concept",
      kind: "hub",
      hubOf: rootId,
      hubPropertyId: pid,
      hubRelation: label,
      hubTotal: total,
      hubShown: shown,
      description: remaining > 0 ? `${shown} of ${total}` : `${total} linked`,
    });

    outEdges.push({
      id: `${rootId}->${hubId}`,
      source: rootId,
      target: hubId,
      label: "",
      propertyId: "HUB",
    });

    for (const { edge, otherId } of visible) {
      consumed.add(edge.id);
      outEdges.push({
        id: `${hubId}->${otherId}`,
        source: hubId,
        target: otherId,
        label: "",
        propertyId: "HUB",
      });
    }

    for (const { edge } of unique.slice(shown)) {
      consumed.add(edge.id);
    }

    if (remaining > 0) {
      const moreId = `khub-more:${rootId}:${pid}`;
      const step = Math.min(HUB_PAGE_SIZE, remaining);
      outNodes.push({
        id: moreId,
        label: `+${step} more`,
        type: "concept",
        kind: "hub",
        hubOf: rootId,
        hubPropertyId: pid,
        hubRelation: label,
        hubMore: true,
        hubTotal: total,
        hubShown: shown,
        description: `${remaining} hidden`,
      });
      outEdges.push({
        id: `${hubId}->${moreId}`,
        source: hubId,
        target: moreId,
        label: "",
        propertyId: "HUB",
      });
    }
  }

  // Hop-2+ (and any non-root) edges stay direct
  for (const e of edges) {
    if (consumed.has(e.id)) continue;
    if (HIDDEN_GRAPH_PROPERTIES.has(e.propertyId)) continue;
    outEdges.push(e);
  }

  const linked = new Set<string>([rootId]);
  for (const e of outEdges) {
    linked.add(idOf(e.source));
    linked.add(idOf(e.target));
  }

  const finalNodes = outNodes.filter((n) => isKnowledgeHub(n) || linked.has(n.id));
  if (!finalNodes.some((n) => n.id === rootId)) {
    const root = entityNodes.find((n) => n.id === rootId);
    if (root) finalNodes.unshift({ ...root, kind: root.kind ?? "entity" });
  }

  return { nodes: finalNodes, edges: outEdges };
}
