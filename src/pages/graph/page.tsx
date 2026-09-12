import { useParams, useNavigate } from "react-router-dom";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, GitBranch, Share2, Minus, Plus, RotateCcw, Layers, Info, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import SearchBox from "@/components/search/SearchBox.tsx";
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
import { toKnowledgeHubs, isKnowledgeHub, isHubMoreNode, HUB_PAGE_SIZE, HIDDEN_GRAPH_PROPERTIES, hubIdFor } from "./_lib/relationHubs.ts";

function edgeEndpointId(v: string | GraphNode): string {
  return typeof v === "object" ? v.id : v;
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
  /** Unchecked relation property IDs are hidden from the canvas. */
  const [hiddenRelations, setHiddenRelations] = useState<Set<string>>(() => new Set());
  const [relationsOpen, setRelationsOpen] = useState(false);
  const relationsMenuRef = useRef<HTMLDivElement>(null);
  /** How many targets each hub shows (default HUB_PAGE_SIZE). */
  const [shownByHub, setShownByHub] = useState<Record<string, number>>({});

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
    setShownByHub((prev) => ({
      ...prev,
      [hubId]: (prev[hubId] ?? HUB_PAGE_SIZE) + HUB_PAGE_SIZE,
    }));
  }, []);

  const expandNode = useCallback(async (node: GraphNode) => {
    if (isHubMoreNode(node)) {
      revealHubMore(node);
      return;
    }

    if (isKnowledgeHub(node) && node.hubOf && node.hubPropertyId) {
      const hubId = hubIdFor(node.hubOf, node.hubPropertyId);
      const shown = shownByHub[hubId] ?? HUB_PAGE_SIZE;
      const total = node.hubTotal ?? 0;
      if (total > shown) {
        revealHubMore(node);
        return;
      }
    }

    if (expandingIds.has(node.id)) return;
    setExpandingIds((prev) => new Set([...prev, node.id]));
    setSelectedNode(null);

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
          [hubId]: (prev[hubId] ?? HUB_PAGE_SIZE) + data.nodes.length,
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
  }, [expandingIds, loadedIds, revealHubMore, shownByHub]);

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

  const { nodes: viewNodes, edges: viewEdges } = useMemo(() => {
    const filteredEdges = edges.filter(
      (e) =>
        !HIDDEN_GRAPH_PROPERTIES.has(e.propertyId) &&
        (!e.propertyId || e.propertyId === "HUB" || !hiddenRelations.has(e.propertyId)),
    );
    const keep = new Set<string>();
    if (id) keep.add(id);
    for (const e of filteredEdges) {
      keep.add(edgeEndpointId(e.source));
      keep.add(edgeEndpointId(e.target));
    }
    const filteredNodes = nodes.filter((n) => keep.has(n.id));
    return toKnowledgeHubs(filteredNodes, filteredEdges, shownByHub, id);
  }, [nodes, edges, hiddenRelations, id, shownByHub]);

  // ── Depth reload (reload entire graph at new depth) ────────────────────────
  const reloadWithDepth = useCallback(async (newDepth: number) => {
    if (!id) return;
    setGraphLoading(true);
    setSelectedNode(null);
    setShownByHub({});
    try {
      const data = await fetchGraphData(id, newDepth, new Set());
      setNodes(data.nodes);
      setEdges(data.edges);
      setLoadedIds(new Set(data.nodes.map((n) => n.id)));
    } catch {
      toast.error("Failed to reload graph");
    } finally {
      setGraphLoading(false);
    }
  }, [id]);

  const handleDepthChange = (newDepth: number) => {
    const clamped = Math.max(1, Math.min(3, newDepth));
    setDepth(clamped);
    reloadWithDepth(clamped);
  };

  const handleReset = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__graphResetZoom?.();
  };

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-border/60 bg-background/95 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2.5 px-4 py-2.5 md:px-5">
          <button
            onClick={() => navigate(`/entity/${id}`)}
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

          <div className="flex-1 hidden md:block max-w-sm">
            <SearchBox size="md" />
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            {/* Depth control */}
            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card/60 px-1.5 py-1">
              <button
                onClick={() => handleDepthChange(depth - 1)}
                disabled={depth <= 1 || graphLoading}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <Minus className="size-3" />
              </button>
              <span className="px-2 text-xs font-mono text-foreground min-w-[56px] text-center">
                {graphLoading ? "…" : `${depth} hop${depth > 1 ? "s" : ""}`}
              </span>
              <button
                onClick={() => handleDepthChange(depth + 1)}
                disabled={depth >= 3 || graphLoading}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors cursor-pointer disabled:cursor-not-allowed"
              >
                <Plus className="size-3" />
              </button>
            </div>

            {/* Filter which relation types appear (hubs always on) */}
            <div ref={relationsMenuRef} className="relative">
              <button
                onClick={() => setRelationsOpen((v) => !v)}
                disabled={graphLoading || relationOptions.length === 0}
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
                        className="text-[10px] text-primary hover:underline cursor-pointer"
                        onClick={() => setHiddenRelations(new Set())}
                      >
                        All
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
                      return (
                        <li key={rel.propertyId}>
                          <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs cursor-pointer hover:bg-muted/50">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleRelation(rel.propertyId)}
                              className="size-3.5 accent-primary cursor-pointer"
                            />
                            <span className="flex-1 truncate text-foreground">{rel.label}</span>
                            <span className="font-mono text-[10px] text-muted-foreground">{rel.count}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

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

            {/* Family tree link */}
            <button
              onClick={() => navigate(`/family-tree/${id}`)}
              className="hidden md:flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer"
            >
              <GitBranch className="size-3.5" />
              Family Tree
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

        {/* Legend */}
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

        {/* Loading overlay */}
        {graphLoading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-background/80 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="size-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="text-sm text-muted-foreground">
                Fetching {depth}-hop graph from Wikidata…
              </span>
            </div>
            <div className="flex gap-2">
              {Array.from({ length: 3 + depth * 2 }).map((_, i) => (
                <Skeleton key={i} className="size-10 rounded-full" style={{ animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!graphLoading && nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center px-4">
            <Info className="size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No graph data available for this entity.</p>
            <p className="text-xs text-muted-foreground/60">Wikidata may not have relational data for this item.</p>
          </div>
        )}

        {/* Graph */}
        {!graphLoading && nodes.length > 0 && (
          <GraphCanvas
            nodes={viewNodes}
            edges={viewEdges}
            rootId={id!}
            onNodeClick={(n) => {
              if (isKnowledgeHub(n)) {
                expandNode(n);
                return;
              }
              setSelectedNode(n);
            }}
            onNodeExpand={expandNode}
            expandingIds={expandingIds}
          />
        )}

        {/* Node detail modal */}
        <NodeDetailModal
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onExpand={expandNode}
          isExpanding={selectedNode ? expandingIds.has(selectedNode.id) : false}
        />

        {/* Stats bar */}
        {!graphLoading && nodes.length > 0 && (
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

        {/* Mobile hint */}
        <div className="absolute bottom-4 right-4 rounded-lg border border-border/40 bg-card/70 backdrop-blur-sm px-3 py-1.5 text-[10px] text-muted-foreground/60 hidden sm:block pointer-events-none">
          Click hub · +10 more · Double-click entity · expand · Reset re-centers
        </div>
      </div>
    </div>
  );
}
