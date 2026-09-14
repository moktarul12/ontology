import { useParams, useNavigate } from "react-router-dom";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Share2, Minus, Plus, RotateCcw, Layers, Info, ChevronDown, LayoutGrid, Expand } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import SearchBox from "@/components/search/SearchBox.tsx";
import { ExploreAtlasPills } from "@/components/ExploreAtlas.tsx";
import GraphCanvas from "./_components/GraphCanvas.tsx";
import NodeDetailModal from "./_components/NodeDetailModal.tsx";
import GraphLegend from "./_components/GraphLegend.tsx";
import {
  fetchEntitySummary,
  fetchGraphData,
  fetchCreativeRoleExpansion,
  isCreativeRoleProperty,
} from "@/lib/wikidata/api.ts";
import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { toKnowledgeHubs, isKnowledgeHub, isHubMoreNode, HUB_PAGE_SIZE, HIDDEN_GRAPH_PROPERTIES, hubIdFor, defaultHiddenRelations, presentLifeFamilyPids, personLifeFamilyGroupsPresent, isImportantRelation, isPersonLifeFamilyPid, defaultHubPageSize } from "./_lib/relationHubs.ts";
import {
  GRAPH_ARRANGE_MODES,
  GRAPH_ARRANGE_LABEL,
  type GraphArrangeMode,
} from "./_lib/knowledgeLayout.ts";
import { entityPath } from "@/lib/entityPath.ts";

function edgeEndpointId(v: string | GraphNode): string {
  return typeof v === "object" ? v.id : v;
}

/** Open all visible relation hubs (first page of targets each). */
function expandVisibleHubPages(
  edges: GraphEdge[],
  rootId: string,
  hidden: Set<string>,
  pageSize = HUB_PAGE_SIZE,
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const e of edges) {
    if (!e.propertyId || e.propertyId === "HUB") continue;
    if (HIDDEN_GRAPH_PROPERTIES.has(e.propertyId)) continue;
    if (hidden.has(e.propertyId)) continue;
    const s = edgeEndpointId(e.source);
    const t = edgeEndpointId(e.target);
    if (s !== rootId && t !== rootId) continue;
    counts.set(e.propertyId, (counts.get(e.propertyId) ?? 0) + 1);
  }
  const out: Record<string, number> = {};
  for (const [pid, n] of counts) {
    out[hubIdFor(rootId, pid)] = Math.min(Math.max(n, 1), pageSize);
  }
  return out;
}

export default function GraphPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // ── Graph state ────────────────────────────────────────────────────────────
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());
  const [expandingIds, setExpandingIds] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [depth, setDepth] = useState(1);
  const [showLegend, setShowLegend] = useState(false);
  const [graphLoading, setGraphLoading] = useState(true);
  /** Hop change while an existing graph is on screen — keep canvas, show top banner. */
  const [depthRefreshing, setDepthRefreshing] = useState(false);
  const [fetchingDepth, setFetchingDepth] = useState<number | null>(null);
  /** Unchecked relation property IDs are hidden from the canvas. */
  const [hiddenRelations, setHiddenRelations] = useState<Set<string>>(() => new Set());
  const [relationsOpen, setRelationsOpen] = useState(false);
  const relationsMenuRef = useRef<HTMLDivElement>(null);
  /** How many targets each hub shows (default HUB_PAGE_SIZE). */
  const [shownByHub, setShownByHub] = useState<Record<string, number>>({});
  const [arrangeMode, setArrangeMode] = useState<GraphArrangeMode>("orbit");
  const [arrangeNonce, setArrangeNonce] = useState(0);
  /** Family & life filter panel — collapsed by default. */
  const [lifeFamilyOpen, setLifeFamilyOpen] = useState(false);

  // ── Load root entity label ─────────────────────────────────────────────────
  const { data: rootEntity } = useQuery({
    queryKey: ["entity", id],
    queryFn: () => fetchEntitySummary(id!),
    enabled: Boolean(id),
  });

  // ── Initial graph load ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    setGraphLoading(true);
    setNodes([]);
    setEdges([]);
    setLoadedIds(new Set());
    setHiddenRelations(new Set());
    setRelationsOpen(false);
    setShownByHub({});

    fetchGraphData(id, depth, new Set())
      .then((data) => {
        setNodes(data.nodes);
        setEdges(data.edges);
        setLoadedIds(new Set(data.nodes.map((n) => n.id)));
        const root = data.nodes.find((n) => n.id === id);
        // Person: Family & life hubs start unselected (hidden) until opted in
        setHiddenRelations(
          root?.type === "person"
            ? presentLifeFamilyPids(data.edges, id)
            : new Set(),
        );
        setLifeFamilyOpen(false);
        setShownByHub({});
      })
      .catch(() => toast.error("Failed to load graph data"))
      .finally(() => setGraphLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Close relations dropdown on outside click
  useEffect(() => {
    if (!relationsOpen) return;
    const handler = (e: MouseEvent) => {
      if (relationsMenuRef.current && !relationsMenuRef.current.contains(e.target as Node)) {
        setRelationsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [relationsOpen]);

  // ── Expand a node (or relation hub → more works of that role) ─────────────
  const revealHubMore = useCallback((node: GraphNode) => {
    if (!node.hubOf || !node.hubPropertyId) return;
    const hubId = hubIdFor(node.hubOf, node.hubPropertyId);
    const pid = node.hubPropertyId;
    setShownByHub((prev) => {
      const current = prev[hubId] ?? defaultHubPageSize(pid);
      // First reveal from collapsed: open a full page; then +page more
      const next = current === 0 ? HUB_PAGE_SIZE : current + HUB_PAGE_SIZE;
      return { ...prev, [hubId]: next };
    });
  }, []);

  const pulseExpanding = useCallback((nodeId: string, ms = 420) => {
    setExpandingIds((prev) => new Set([...prev, nodeId]));
    window.setTimeout(() => {
      setExpandingIds((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
    }, ms);
  }, []);

  const expandNode = useCallback(async (node: GraphNode) => {
    setSelectedNode(null);

    if (isHubMoreNode(node)) {
      pulseExpanding(node.id);
      revealHubMore(node);
      return;
    }

    if (isKnowledgeHub(node) && node.hubOf && node.hubPropertyId) {
      const hubId = hubIdFor(node.hubOf, node.hubPropertyId);
      const shown = shownByHub[hubId] ?? defaultHubPageSize(node.hubPropertyId);
      const total = node.hubTotal ?? 0;
      if (total > shown) {
        pulseExpanding(node.id);
        revealHubMore(node);
        return;
      }
      // Family / life hub already fully revealed — nothing more to fetch for non-creative
      if (isPersonLifeFamilyPid(node.hubPropertyId) || !isCreativeRoleProperty(node.hubPropertyId)) {
        toast(`All ${node.hubRelation ?? node.label} items are shown`);
        return;
      }
    }

    if (expandingIds.has(node.id)) return;
    setExpandingIds((prev) => new Set([...prev, node.id]));

    try {
      let data: { nodes: GraphNode[]; edges: GraphEdge[] };

      if (isKnowledgeHub(node) && node.hubOf && node.hubPropertyId) {
        if (!isCreativeRoleProperty(node.hubPropertyId)) {
          toast(`All ${node.hubRelation ?? node.label} items are shown`);
          return;
        }
        data = await fetchCreativeRoleExpansion(
          node.hubOf,
          node.hubPropertyId,
          loadedIds,
        );
        if (data.nodes.length === 0) {
          toast(`No more ${node.hubRelation ?? node.label} items found`);
          return;
        }
        const hubId = hubIdFor(node.hubOf, node.hubPropertyId);
        setShownByHub((prev) => ({
          ...prev,
          [hubId]: (prev[hubId] ?? defaultHubPageSize(node.hubPropertyId!)) + data.nodes.length,
        }));
      } else {
        data = await fetchGraphData(node.id, 1, loadedIds);
        if (data.nodes.length === 0 && data.edges.length === 0) {
          toast("No new connections found for this node");
          return;
        }
      }

      setNodes((prev) => {
        const existingIds = new Set(prev.map((n) => n.id));
        const newNodes = data.nodes.filter((n) => !existingIds.has(n.id));
        return [...prev, ...newNodes];
      });

      setEdges((prev) => {
        const existingEdgeIds = new Set(prev.map((e) => e.id));
        const newEdges = data.edges.filter((e) => !existingEdgeIds.has(e.id));
        return [...prev, ...newEdges];
      });

      setLoadedIds((prev) => new Set([...prev, ...data.nodes.map((n) => n.id)]));

      const added = data.nodes.filter((n) => !loadedIds.has(n.id)).length;
      if (added > 0) {
        const role = isKnowledgeHub(node) ? (node.hubRelation ?? node.label) : null;
        toast.success(
          role
            ? `Added ${added} ${role.toLowerCase()} item${added > 1 ? "s" : ""}`
            : `Added ${added} new node${added > 1 ? "s" : ""}`,
        );
      }
    } catch {
      toast.error("Failed to expand node");
    } finally {
      setExpandingIds((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
    }
  }, [expandingIds, loadedIds, pulseExpanding, revealHubMore, shownByHub]);

  const expandAllHop1Relations = useCallback(() => {
    if (!id) return;
    const next = expandVisibleHubPages(edges, id, hiddenRelations);
    setShownByHub((prev) => ({ ...prev, ...next }));
    setSelectedNode(null);
    const n = Object.keys(next).length;
    if (n > 0) toast.success(`Expanded ${n} relation${n > 1 ? "s" : ""}`);
  }, [edges, hiddenRelations, id]);

  const relationOptions = useMemo(() => {
    const map = new Map<string, { propertyId: string; label: string; count: number }>();
    if (!id) return [];
    for (const e of edges) {
      if (!e.propertyId || e.propertyId === "HUB") continue;
      if (HIDDEN_GRAPH_PROPERTIES.has(e.propertyId)) continue;
      const s = edgeEndpointId(e.source);
      const t = edgeEndpointId(e.target);
      // Focus-only: filter lists relations that touch the root (hub arms)
      if (s !== id && t !== id) continue;
      const cur = map.get(e.propertyId);
      if (cur) cur.count += 1;
      else map.set(e.propertyId, { propertyId: e.propertyId, label: e.label || e.propertyId, count: 1 });
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [edges, id]);

  const visibleRelationCount = relationOptions.filter((r) => !hiddenRelations.has(r.propertyId)).length;

  const toggleRelation = useCallback((propertyId: string) => {
    setHiddenRelations((prev) => {
      const next = new Set(prev);
      if (next.has(propertyId)) next.delete(propertyId);
      else next.add(propertyId);
      return next;
    });
  }, []);

  /** Person canvas: show/hide a life-family group (hubs stay collapsed until click). */
  const toggleLifeFamilyGroup = useCallback((propertyIds: string[], enable: boolean) => {
    setHiddenRelations((prev) => {
      const next = new Set(prev);
      for (const pid of propertyIds) {
        if (enable) next.delete(pid);
        else next.add(pid);
      }
      return next;
    });
  }, []);

  const isPersonRoot =
    rootEntity?.type === "person" ||
    nodes.find((n) => n.id === id)?.type === "person";

  const lifeFamilyGroups = useMemo(() => {
    if (!id || !isPersonRoot) return [];
    return personLifeFamilyGroupsPresent(edges, id);
  }, [edges, id, isPersonRoot]);

  const { nodes: viewNodes, edges: viewEdges } = useMemo(() => {
    if (!id) return { nodes: [], edges: [] };
    const filteredEdges = edges.filter(
      (e) =>
        !HIDDEN_GRAPH_PROPERTIES.has(e.propertyId) &&
        (!e.propertyId || e.propertyId === "HUB" || !hiddenRelations.has(e.propertyId)),
    );
    // Keep only the undirected component reachable from the main search node
    const adj = new Map<string, string[]>();
    for (const e of filteredEdges) {
      const s = edgeEndpointId(e.source);
      const t = edgeEndpointId(e.target);
      if (!adj.has(s)) adj.set(s, []);
      if (!adj.has(t)) adj.set(t, []);
      adj.get(s)!.push(t);
      adj.get(t)!.push(s);
    }
    const reachable = new Set<string>([id]);
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const nb of adj.get(cur) ?? []) {
        if (reachable.has(nb)) continue;
        reachable.add(nb);
        queue.push(nb);
      }
    }
    const filteredNodes = nodes.filter((n) => reachable.has(n.id));
    const rootedEdges = filteredEdges.filter(
      (e) =>
        reachable.has(edgeEndpointId(e.source)) &&
        reachable.has(edgeEndpointId(e.target)),
    );
    return toKnowledgeHubs(filteredNodes, rootedEdges, shownByHub, id);
  }, [nodes, edges, hiddenRelations, id, shownByHub]);

  // ── Depth reload (reload entire graph at new depth) ────────────────────────
  const reloadWithDepth = useCallback(async (newDepth: number) => {
    if (!id) return;
    const keepExisting = nodes.length > 0;
    setSelectedNode(null);
    setFetchingDepth(newDepth);
    if (keepExisting) {
      setDepthRefreshing(true);
    } else {
      setGraphLoading(true);
      setShownByHub({});
    }
    try {
      const data = await fetchGraphData(id, newDepth, new Set());
      setNodes(data.nodes);
      setEdges(data.edges);
      setLoadedIds(new Set(data.nodes.map((n) => n.id)));
      const root = data.nodes.find((n) => n.id === id);
      const hidden =
        root?.type === "person"
          ? presentLifeFamilyPids(data.edges, id)
          : new Set<string>();
      setHiddenRelations(hidden);
      setLifeFamilyOpen(false);
      // Hops > 1: immediately expand hop-1 relation hubs (visible ones only)
      setShownByHub(
        newDepth > 1
          ? expandVisibleHubPages(data.edges, id, hidden)
          : {},
      );
    } catch {
      toast.error("Failed to reload graph");
    } finally {
      setDepthRefreshing(false);
      setFetchingDepth(null);
      setGraphLoading(false);
    }
  }, [id, nodes.length]);

  const handleDepthChange = (newDepth: number) => {
    const clamped = Math.max(1, Math.min(3, newDepth));
    setDepth(clamped);
    void reloadWithDepth(clamped);
  };

  const busy = graphLoading || depthRefreshing;

  const collapsedHop1HubCount = useMemo(() => {
    if (depth !== 1) return 0;
    return viewNodes.filter(
      (n) =>
        isKnowledgeHub(n) &&
        !isHubMoreNode(n) &&
        (n.hubShown ?? 0) === 0 &&
        (n.hubTotal ?? 0) > 0,
    ).length;
  }, [depth, viewNodes]);

  const selectedHubLinkedLabels = useMemo(() => {
    if (!selectedNode || !id) return [];

    if (isKnowledgeHub(selectedNode) && !isHubMoreNode(selectedNode)) {
      const hubId = selectedNode.id;
      const labels: string[] = [];
      for (const e of viewEdges) {
        const s = edgeEndpointId(e.source);
        const t = edgeEndpointId(e.target);
        const other = s === hubId ? t : t === hubId ? s : null;
        if (!other || other === hubId) continue;
        const n = viewNodes.find((x) => x.id === other);
        if (n && !isKnowledgeHub(n) && n.label) labels.push(n.label);
      }
      if (labels.length) return [...new Set(labels)].slice(0, 16);
      if (!selectedNode.hubPropertyId) return [];
      const fromRaw: string[] = [];
      for (const e of edges) {
        if (e.propertyId !== selectedNode.hubPropertyId) continue;
        const s = edgeEndpointId(e.source);
        const t = edgeEndpointId(e.target);
        const other = s === id ? t : t === id ? s : null;
        if (!other) continue;
        const n = nodes.find((x) => x.id === other);
        if (n?.label) fromRaw.push(n.label);
      }
      return [...new Set(fromRaw)].slice(0, 16);
    }

    // Occupation node "actor" — pull film / cast titles for the essay
    if (/\b(actor|actress|acting)\b/i.test(selectedNode.label)) {
      const fromRaw: string[] = [];
      for (const e of edges) {
        if (!["P161", "CR_FILM", "P800"].includes(e.propertyId)) continue;
        const s = edgeEndpointId(e.source);
        const t = edgeEndpointId(e.target);
        const other = s === id ? t : t === id ? s : null;
        if (!other) continue;
        const n = nodes.find((x) => x.id === other);
        if (n?.label) fromRaw.push(n.label);
      }
      return [...new Set(fromRaw)].slice(0, 16);
    }

    return [];
  }, [selectedNode, viewEdges, viewNodes, edges, nodes, id]);

  const handleReset = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__graphResetZoom?.();
  };

  const handleAutoArrange = () => {
    const idx = GRAPH_ARRANGE_MODES.indexOf(arrangeMode);
    const next = GRAPH_ARRANGE_MODES[(idx + 1) % GRAPH_ARRANGE_MODES.length]!;
    setArrangeMode(next);
    setArrangeNonce((n) => n + 1);
    toast.message(GRAPH_ARRANGE_LABEL[next]);
  };

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border/60 bg-background/95 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2.5 px-4 py-2.5 md:px-5">
          <button
            onClick={() => navigate(entityPath(id!, rootEntity?.label))}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ArrowLeft className="size-4" />
          </button>

          {/* Title */}
          <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider hidden sm:block">Knowledge Graph</p>
              <p className="text-sm font-semibold text-foreground truncate max-w-[140px]">
                {rootEntity?.label ?? id}
              </p>
            </div>
          </div>

          {rootEntity && (
            <ExploreAtlasPills
              qid={id!}
              entityType={rootEntity.type}
              entityLabel={rootEntity.label}
              active="graph"
              className="hidden lg:inline-flex"
            />
          )}

          <div className="flex-1 hidden md:block max-w-sm">
            <SearchBox size="md" />
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            {/* Depth control */}
            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card/60 px-1.5 py-1">
              <button
                onClick={() => handleDepthChange(depth - 1)}
                disabled={depth <= 1 || busy}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <Minus className="size-3" />
              </button>
              <span className="px-2 text-xs font-mono text-foreground min-w-[56px] text-center">
                {busy ? "…" : `${depth} hop${depth > 1 ? "s" : ""}`}
              </span>
              <button
                onClick={() => handleDepthChange(depth + 1)}
                disabled={depth >= 3 || busy}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <Plus className="size-3" />
              </button>
            </div>

            {depth === 1 && collapsedHop1HubCount > 0 && (
              <button
                type="button"
                onClick={expandAllHop1Relations}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/20 transition-colors cursor-pointer disabled:opacity-40"
                title="Expand all hop-1 relation hubs"
              >
                <Expand className="size-3.5" />
                Expand all
                <span className="font-mono text-[10px] opacity-80">{collapsedHop1HubCount}</span>
              </button>
            )}

            {/* Filter which relation types appear (hubs always on) */}
            <div ref={relationsMenuRef} className="relative">
              <button
                onClick={() => setRelationsOpen((v) => !v)}
                disabled={busy || relationOptions.length === 0}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                  relationsOpen || hiddenRelations.size > 0
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground hover:text-foreground",
                )}
                title="Show or hide relation types"
              >
                Relations
                {relationOptions.length > 0 && (
                  <span className="font-mono text-[10px] opacity-80">
                    {visibleRelationCount}/{relationOptions.length}
                  </span>
                )}
                <ChevronDown className={cn("size-3.5 transition-transform", relationsOpen && "rotate-180")} />
              </button>

              {relationsOpen && (
                <div className="absolute right-0 top-full z-30 mt-1.5 w-64 max-h-72 overflow-y-auto rounded-xl border border-border/70 bg-card/95 backdrop-blur-md shadow-lg p-2">
                  <div className="flex items-center justify-between px-2 py-1 mb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Relation types
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={cn(
                          "text-[10px] hover:underline cursor-pointer",
                          hiddenRelations.size === 0 ? "text-primary font-semibold" : "text-primary",
                        )}
                        onClick={() => setHiddenRelations(new Set())}
                        title="Show all relations toward the search item"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className="text-[10px] text-primary hover:underline cursor-pointer"
                        onClick={() => setHiddenRelations(defaultHiddenRelations(edges, id!))}
                        title="Enable important relations only"
                      >
                        Important
                      </button>
                      <button
                        type="button"
                        className="text-[10px] text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                        onClick={() =>
                          setHiddenRelations(new Set(relationOptions.map((r) => r.propertyId)))
                        }
                      >
                        None
                      </button>
                    </div>
                  </div>
                  <ul className="space-y-0.5">
                    {relationOptions.map((rel) => {
                      const checked = !hiddenRelations.has(rel.propertyId);
                      const important = isImportantRelation(rel.propertyId);
                      return (
                        <li key={rel.propertyId}>
                          <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs cursor-pointer hover:bg-muted/50">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleRelation(rel.propertyId)}
                              className="size-3.5 accent-primary cursor-pointer"
                            />
                            <span className={cn("flex-1 truncate", important ? "text-foreground font-medium" : "text-muted-foreground")}>
                              {rel.label}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">{rel.count}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            {/* Auto arrange — cycles orbit / spread / wide */}
            <button
              onClick={handleAutoArrange}
              disabled={busy || nodes.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={GRAPH_ARRANGE_LABEL[arrangeMode]}
            >
              <LayoutGrid className="size-3.5" />
              <span className="hidden sm:inline">Auto arrange</span>
            </button>

            {/* Legend toggle */}
            <button
              onClick={() => setShowLegend((v) => !v)}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg border transition-colors cursor-pointer",
                showLegend ? "border-primary/50 bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"
              )}
            >
              <Layers className="size-4" />
            </button>

            {/* Reset zoom */}
            <button
              onClick={handleReset}
              className="flex size-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Reset zoom"
            >
              <RotateCcw className="size-4" />
            </button>

            {/* Share */}
            <button
              onClick={() => { navigator.clipboard.writeText(window.location.href); toast.success("Link copied!"); }}
              className="flex size-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <Share2 className="size-4" />
            </button>
          </div>
        </div>

        {/* Mobile atlas + legend */}
        {rootEntity && (
          <div className="lg:hidden border-t border-border/40 px-4 py-2">
            <ExploreAtlasPills
              qid={id!}
              entityType={rootEntity.type}
              entityLabel={rootEntity.label}
              active="graph"
              className="w-full justify-center"
            />
          </div>
        )}

        {showLegend && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border/40 px-5 py-2.5"
          >
            <GraphLegend />
          </motion.div>
        )}
      </header>

      {/* ── Canvas area ───────────────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden">
        {/* Background grid */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.025]">
          <defs>
            <pattern id="graphgrid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#graphgrid)" />
        </svg>

        {/* Initial load only — full overlay when there is no graph yet */}
        {graphLoading && nodes.length === 0 && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="size-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="text-sm text-muted-foreground">
                Fetching {fetchingDepth ?? depth}-hop graph from Wikidata…
              </span>
            </div>
            <div className="flex gap-2">
              {Array.from({ length: 3 + (fetchingDepth ?? depth) * 2 }).map((_, i) => (
                <Skeleton key={i} className="size-10 rounded-full" style={{ animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
          </div>
        )}

        {/* Hop change — keep existing graph, banner on top */}
        {depthRefreshing && nodes.length > 0 && (
          <div className="absolute top-3 left-1/2 z-30 -translate-x-1/2 pointer-events-none">
            <div className="flex items-center gap-2.5 rounded-full border border-primary/30 bg-card/95 px-4 py-2 shadow-lg shadow-black/10 backdrop-blur-md">
              <div className="size-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="text-xs font-medium text-foreground whitespace-nowrap">
                Fetching {fetchingDepth ?? depth}-hop graph from Wikidata…
              </span>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!graphLoading && !depthRefreshing && nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-4">
            <Info className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No graph data available for this entity.</p>
            <p className="text-xs text-muted-foreground/60">Wikidata may not have relational data for this item.</p>
          </div>
        )}

        {/* Graph — stays mounted during hop refresh */}
        {nodes.length > 0 && (
          <div className={cn(depthRefreshing && "opacity-80 transition-opacity")}>
            <GraphCanvas
              nodes={viewNodes}
              edges={viewEdges}
              rootId={id!}
              onNodeClick={setSelectedNode}
              onNodeExpand={expandNode}
              expandingIds={expandingIds}
              arrangeMode={arrangeMode}
              arrangeNonce={arrangeNonce}
            />
          </div>
        )}

        {/* Node detail flyout — click opens; Expand / double-click expands */}
        <NodeDetailModal
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onExpand={expandNode}
          isExpanding={selectedNode ? expandingIds.has(selectedNode.id) : false}
          rootId={id}
          rootLabel={rootEntity?.label}
          linkedLabels={selectedHubLinkedLabels}
        />

        {/* Stats bar */}
        {nodes.length > 0 && (
          <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-lg border border-border/50 bg-card/80 backdrop-blur-sm px-3 py-1.5">
            <span className="text-[10px] text-muted-foreground">
              <span className="font-mono text-foreground">{nodes.length}</span> nodes
            </span>
            <span className="text-border">·</span>
            <span className="text-[10px] text-muted-foreground">
              <span className="font-mono text-foreground">{edges.length}</span> edges
            </span>
          </div>
        )}

        {/* Person only: optional filter for family / life hubs (collapsed by default) */}
        {nodes.length > 0 && isPersonRoot && lifeFamilyGroups.length > 0 && (
          <div className="absolute top-4 left-4 z-10 w-[min(16.5rem,calc(100vw-2rem))] rounded-xl border border-border/70 bg-card/95 backdrop-blur-md shadow-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setLifeFamilyOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/40 cursor-pointer"
            >
              <span>
                <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Family & life
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground/80 leading-snug">
                  {lifeFamilyOpen
                    ? "Check a group to show it on the graph"
                    : "Unselected by default · open to enable"}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  lifeFamilyOpen && "rotate-180",
                )}
              />
            </button>
            {lifeFamilyOpen && (
              <ul className="space-y-1 border-t border-border/50 px-3 pb-3 pt-2">
                {lifeFamilyGroups.map((g) => {
                  const enabled = g.propertyIds.every((pid) => !hiddenRelations.has(pid));
                  const partial =
                    !enabled &&
                    g.propertyIds.some((pid) => !hiddenRelations.has(pid));
                  return (
                    <li key={g.id}>
                      <label className="flex items-start gap-2 rounded-lg px-1.5 py-1.5 text-xs cursor-pointer hover:bg-muted/50">
                        <input
                          type="checkbox"
                          checked={enabled}
                          ref={(el) => {
                            if (el) el.indeterminate = partial;
                          }}
                          onChange={() => toggleLifeFamilyGroup(g.propertyIds, !enabled)}
                          className="mt-0.5 size-3.5 accent-primary cursor-pointer shrink-0"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground leading-tight">
                            {g.label}
                          </span>
                          <span className="block text-[10px] text-muted-foreground leading-tight">
                            {g.hint}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* Desktop hint */}
        <div className="absolute bottom-4 right-4 rounded-lg border border-border/40 bg-card/70 backdrop-blur-sm px-3 py-1.5 text-[10px] text-muted-foreground/60 hidden sm:block pointer-events-none max-w-[14rem] text-right">
          Hover Expand · Click for details · Double-click to expand
        </div>
      </div>
    </div>
  );
}
