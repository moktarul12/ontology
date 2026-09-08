import { useParams, useNavigate } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, GitBranch, Share2, Minus, Plus, RotateCcw, Layers, Info } from "lucide-react";
import { toast } from "sonner";
import { motion } from "motion/react";
import SearchBox from "@/components/search/SearchBox.tsx";
import GraphCanvas from "./_components/GraphCanvas.tsx";
import NodeDetailModal from "./_components/NodeDetailModal.tsx";
import GraphLegend from "./_components/GraphLegend.tsx";
import { fetchEntitySummary, fetchGraphData } from "@/lib/wikidata/api.ts";
import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";

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

  // ── Expand a node (add its neighbors into the existing graph) ─────────────
  const expandNode = useCallback(async (node: GraphNode) => {
    if (expandingIds.has(node.id)) return;
    setExpandingIds((prev) => new Set([...prev, node.id]));
    setSelectedNode(null);

    try {
      const data = await fetchGraphData(node.id, 1, loadedIds);
      if (data.nodes.length === 0 && data.edges.length === 0) {
        toast("No new connections found for this node");
        return;
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

      const added = data.nodes.length - (loadedIds.has(node.id) ? 1 : 0);
      if (added > 0) toast.success(`Added ${added} new node${added > 1 ? "s" : ""}`);
    } catch {
      toast.error("Failed to expand node");
    } finally {
      setExpandingIds((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
    }
  }, [expandingIds, loadedIds]);

  // ── Depth reload (reload entire graph at new depth) ────────────────────────
  const reloadWithDepth = useCallback(async (newDepth: number) => {
    if (!id) return;
    setGraphLoading(true);
    setSelectedNode(null);
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
            nodes={nodes}
            edges={edges}
            rootId={id!}
            onNodeClick={setSelectedNode}
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
          Click node for details · Double-click to expand · Drag to move
        </div>
      </div>
    </div>
  );
}
