/**
 * Knowledge-graph relation hubs (presentation).
 *
 * Focus-only (family-tree pattern):
 *   root → [Actor] → films… (10 at a time, +10 more)
 *   root → [Occupation] → roles…
 *
 * Expanded neighbors stay plain entities (no secondary hubs).
 * Taxonomy edges like "subclass of" / "instance of" are never shown.
 */

import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";

export type KnowledgeHubNode = GraphNode & {
  kind: "hub";
  hubOf: string;
  hubPropertyId: string;
  hubRelation: string;
};

export const HUB_PAGE_SIZE = 10;

/** Never show these as edges or hubs (taxonomy / low-signal noise). */
export const HIDDEN_GRAPH_PROPERTIES = new Set(["P279", "P31"]);

/**
 * Relations enabled by default in the Relations filter.
 * Everything else is available but unchecked until the user opts in.
 */
export const IMPORTANT_GRAPH_PROPERTIES = new Set([
  // Creative / works
  "P161", "P57", "P162", "P86", "P58", "P800", "P50", "P170",
  "CR_SONG", "CR_ALBUM", "CR_FILM",
  // Career
  "P106", "P108", "P69", "P166", "P39",
  // Family
  "P26", "P22", "P25", "P40", "P3373", "P1038",
  // Place / identity
  "P19", "P20", "P27",
]);

/** Kinship hubs — show the relation node only until the user expands. */
export const FAMILY_GRAPH_PROPERTIES = new Set([
  "P22", // father
  "P25", // mother
  "P26", // spouse
  "P40", // child
  "P3373", // sibling
  "P1038", // relative
]);

/**
 * Person graphs: family + birth/death place + citizenship.
 * Hidden (unchecked) by default; optional canvas filter to enable.
 */
export const PERSON_LIFE_FAMILY_OPT_IN: Array<{
  id: string;
  label: string;
  hint: string;
  propertyIds: string[];
}> = [
  { id: "parents", label: "Parents", hint: "Father · Mother", propertyIds: ["P22", "P25"] },
  { id: "children", label: "Children", hint: "Child", propertyIds: ["P40"] },
  { id: "spouse", label: "Spouse", hint: "Marriage", propertyIds: ["P26"] },
  { id: "siblings", label: "Siblings", hint: "Brother · Sister", propertyIds: ["P3373"] },
  { id: "relatives", label: "Relatives", hint: "Other kin", propertyIds: ["P1038"] },
  { id: "birthplace", label: "Place of birth", hint: "Born in", propertyIds: ["P19"] },
  { id: "deathplace", label: "Place of death", hint: "Died in", propertyIds: ["P20"] },
  { id: "citizenship", label: "Citizenship", hint: "Nationality", propertyIds: ["P27"] },
];

export const PERSON_LIFE_FAMILY_PIDS = new Set(
  PERSON_LIFE_FAMILY_OPT_IN.flatMap((g) => g.propertyIds),
);

export function isFamilyRelation(propertyId: string): boolean {
  return FAMILY_GRAPH_PROPERTIES.has(propertyId);
}

export function isPersonLifeFamilyPid(propertyId: string): boolean {
  return PERSON_LIFE_FAMILY_PIDS.has(propertyId);
}

/** Initial visible targets under a hub — always collapsed (relation only). */
export function defaultHubPageSize(_propertyId?: string): number {
  return 0;
}

/** Relation hub with no linked entities revealed yet. */
export function isCollapsedRelationHub(
  hubShown: number | undefined,
  isMore = false,
): boolean {
  return !isMore && (hubShown ?? 0) === 0;
}

/** Stable arm order: creative roles, then bio / people / place, then alpha. */
export const HUB_SORT_RANK: Record<string, number> = {
  P161: 10,
  CR_FILM: 15,
  P57: 20,
  P162: 30,
  P86: 40,
  CR_SONG: 50,
  CR_ALBUM: 55,
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
  P3373: 235,
  P1038: 240,
  P19: 300,
  P20: 310,
  P27: 320,
  P136: 410,
  P452: 420,
};

export function isImportantRelation(propertyId: string): boolean {
  return IMPORTANT_GRAPH_PROPERTIES.has(propertyId);
}

/** Property IDs that touch the root but are not in the default-important set. */
export function defaultHiddenRelations(
  edges: GraphEdge[],
  rootId: string,
): Set<string> {
  const hidden = new Set<string>();
  for (const e of edges) {
    if (!e.propertyId || e.propertyId === "HUB") continue;
    if (HIDDEN_GRAPH_PROPERTIES.has(e.propertyId)) continue;
    const s = typeof e.source === "object" ? e.source.id : e.source;
    const t = typeof e.target === "object" ? e.target.id : e.target;
    if (s !== rootId && t !== rootId) continue;
    if (!IMPORTANT_GRAPH_PROPERTIES.has(e.propertyId)) hidden.add(e.propertyId);
  }
  return hidden;
}

/**
 * Property IDs for family / life arms present on this person graph.
 */
export function presentLifeFamilyPids(
  edges: GraphEdge[],
  rootId: string,
): Set<string> {
  const present = new Set<string>();
  for (const e of edges) {
    if (!e.propertyId || e.propertyId === "HUB") continue;
    const s = typeof e.source === "object" ? e.source.id : e.source;
    const t = typeof e.target === "object" ? e.target.id : e.target;
    if (s !== rootId && t !== rootId) continue;
    if (PERSON_LIFE_FAMILY_PIDS.has(e.propertyId)) present.add(e.propertyId);
  }
  return present;
}

/** Groups that exist on this person graph. */
export function personLifeFamilyGroupsPresent(
  edges: GraphEdge[],
  rootId: string,
): typeof PERSON_LIFE_FAMILY_OPT_IN {
  const present = presentLifeFamilyPids(edges, rootId);
  return PERSON_LIFE_FAMILY_OPT_IN.filter((g) =>
    g.propertyIds.some((pid) => present.has(pid)),
  );
}

const HUB_COLORS: Record<string, string> = {
  P161: "#2A7AB0",
  P57: "#8B5A2B",
  P162: "#B8860B",
  P86: "#6B4C9A",
  CR_SONG: "#C45A7A",
  CR_ALBUM: "#A05070",
  CR_FILM: "#2A7AB0",
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
  P3373: "#8B6BB5",
  P1038: "#8B6BB5",
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

/** Keep only nodes/edges in the undirected component of rootId. */
export function pruneConnectedToRoot(
  nodes: GraphNode[],
  edges: GraphEdge[],
  rootId: string,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!rootId) return { nodes, edges };
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (HIDDEN_GRAPH_PROPERTIES.has(e.propertyId)) continue;
    const s = idOf(e.source);
    const t = idOf(e.target);
    if (!adj.has(s)) adj.set(s, []);
    if (!adj.has(t)) adj.set(t, []);
    adj.get(s)!.push(t);
    adj.get(t)!.push(s);
  }
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      queue.push(nb);
    }
  }
  return {
    nodes: nodes.filter((n) => seen.has(n.id)),
    edges: edges.filter(
      (e) => seen.has(idOf(e.source)) && seen.has(idOf(e.target)),
    ),
  };
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
 * further hops grow only when attached to that rooted tree and within maxHops.
 * Anything not connected to the main search node is dropped.
 */
export function toKnowledgeHubs(
  nodes: GraphNode[],
  edges: GraphEdge[],
  shownByHub: Record<string, number> = {},
  rootId?: string,
  maxHops = 3,
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
    return pruneConnectedToRoot(outNodes, outEdges, rootId ?? "");
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
    const fallback = defaultHubPageSize(pid);
    const requested = shownByHub[hubId] ?? fallback;
    const shown = Math.min(Math.max(requested, 0), total);
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
      description:
        shown === 0
          ? `${total} linked · expand to show`
          : remaining > 0
            ? `${shown} of ${total}`
            : `${total} linked`,
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

    if (remaining > 0 && shown > 0) {
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

  // Grow outward from the rooted hub tree only — never show floating components.
  // Hub edges don't consume hop budget; entity hops must stay within maxHops of root.
  const hopCap = Math.max(1, Math.min(3, maxHops));

  let grew = true;
  while (grew) {
    grew = false;
    const entityDist = new Map<string, number>([[rootId, 0]]);
    {
      const adj = new Map<string, string[]>();
      for (const e of outEdges) {
        const s = idOf(e.source);
        const t = idOf(e.target);
        if (!adj.has(s)) adj.set(s, []);
        if (!adj.has(t)) adj.set(t, []);
        adj.get(s)!.push(t);
        adj.get(t)!.push(s);
      }
      const q = [rootId];
      while (q.length) {
        const cur = q.shift()!;
        const d = entityDist.get(cur) ?? 0;
        for (const nb of adj.get(cur) ?? []) {
          if (entityDist.has(nb)) continue;
          const nbIsHub = nb.startsWith("khub:") || nb.startsWith("khub-more:");
          entityDist.set(nb, nbIsHub ? d : d + 1);
          q.push(nb);
        }
      }
    }

    for (const e of edges) {
      if (consumed.has(e.id)) continue;
      if (HIDDEN_GRAPH_PROPERTIES.has(e.propertyId)) continue;
      if (!e.propertyId || e.propertyId === "HUB") continue;
      const s = idOf(e.source);
      const t = idOf(e.target);
      if (!nodeIds.has(s) || !nodeIds.has(t)) continue;

      const sDist = entityDist.get(s);
      const tDist = entityDist.get(t);
      const sIn = sDist != null;
      const tIn = tDist != null;
      if (!sIn && !tIn) continue;

      if (sIn && tIn) {
        outEdges.push(e);
        consumed.add(e.id);
        continue;
      }

      // New node must land at hop <= hopCap from main search node
      if (sIn && !tIn && (sDist as number) >= hopCap) continue;
      if (tIn && !sIn && (tDist as number) >= hopCap) continue;

      outEdges.push(e);
      consumed.add(e.id);
      grew = true;
    }
  }

  const keepIds = new Set<string>([rootId]);
  for (const e of outEdges) {
    keepIds.add(idOf(e.source));
    keepIds.add(idOf(e.target));
  }
  const trimmed = outNodes.filter(
    (n) => keepIds.has(n.id) || (isKnowledgeHub(n) && n.hubOf === rootId),
  );

  const pruned = pruneConnectedToRoot(trimmed, outEdges, rootId);
  if (!pruned.nodes.some((n) => n.id === rootId)) {
    const root = entityNodes.find((n) => n.id === rootId);
    if (root) pruned.nodes.unshift({ ...root, kind: root.kind ?? "entity" });
  }
  return pruned;
}
