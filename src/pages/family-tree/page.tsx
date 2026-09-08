import { useParams, useNavigate } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowLeft, Network, Share2, RotateCcw, GitBranch,
  ChevronUp, ChevronDown, Users, Info,
} from "lucide-react";
import SearchBox from "@/components/search/SearchBox.tsx";
import FamilyTreeCanvas from "./_components/FamilyTreeCanvas.tsx";
import NodeDetailModal from "@/pages/graph/_components/NodeDetailModal.tsx";
import { fetchEntitySummary, fetchFamilyData } from "@/lib/wikidata/api.ts";
import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";

// Relation legend data
const REL_LEGEND = [
  { label: "father",  color: "#4DBFEF" },
  { label: "mother",  color: "#E86B9B" },
  { label: "spouse",  color: "#E8B84D" },
  { label: "child",   color: "#4DC48A" },
  { label: "sibling", color: "#B46DE8" },
] as const;

export default function FamilyTreePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // ── Graph state ──────────────────────────────────────────────────────────
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());
  const [expandingIds, setExpandingIds] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [depth, setDepth] = useState(1);

  // ── Root entity label ──────────────────────────────────────────────────
  const { data: rootEntity } = useQuery({
    queryKey: ["entity", id],
    queryFn: () => fetchEntitySummary(id!),
    enabled: Boolean(id),
  });

  // ── Initial load ───────────────────────────────────────────────────────
  const loadTree = useCallback(async (rootId: string, hops: number) => {
    setLoading(true);
    setSelectedNode(null);
    setNodes([]);
    setEdges([]);
    setLoadedIds(new Set());
    try {
      const data = await fetchFamilyData(rootId, hops, new Set());
      setNodes(data.nodes);
      setEdges(data.edges);
      setLoadedIds(new Set(data.nodes.map((n) => n.id)));
    } catch {
      toast.error("Failed to load family data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    loadTree(id, depth);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Expand a node ──────────────────────────────────────────────────────
  const expandNode = useCallback(async (node: GraphNode) => {
    if (expandingIds.has(node.id)) return;
    setExpandingIds((prev) => new Set([...prev, node.id]));
    setSelectedNode(null);

    try {
      const data = await fetchFamilyData(node.id, 1, loadedIds);
      const newNodes = data.nodes.filter((n) => !loadedIds.has(n.id));
      const newEdgeIds = new Set(edges.map((e) => e.id));
      const newEdges = data.edges.filter((e) => !newEdgeIds.has(e.id));

      if (newNodes.length === 0 && newEdges.length === 0) {
        toast("No additional family members found");
        return;
      }

      setNodes((prev) => [...prev, ...newNodes]);
      setEdges((prev) => [...prev, ...newEdges]);
      setLoadedIds((prev) => new Set([...prev, ...data.nodes.map((n) => n.id)]));

      if (newNodes.length > 0) {
        toast.success(`Added ${newNodes.length} new member${newNodes.length > 1 ? "s" : ""}`);
      }
    } catch {
      toast.error("Failed to expand family node");
    } finally {
      setExpandingIds((prev) => {
        const next = new Set(prev);
        next.delete(node.id);
        return next;
      });
    }
  }, [expandingIds, loadedIds, edges]);

  // ── Depth reload ───────────────────────────────────────────────────────
  const handleDepthChange = (delta: number) => {
    const newDepth = Math.max(1, Math.min(3, depth + delta));
    setDepth(newDepth);
    if (id) loadTree(id, newDepth);
  };

  const handleReset = () => {
    const w = window as unknown as Record<string, unknown>;
    const fn = w.__treeResetZoom;
    if (typeof fn === "function") fn();
  };

  // Count ancestor/descendant nodes for stats
  const ancestorCount = nodes.filter((_, i) => {
    const n = nodes[i];
    return edges.some((e) => {
      const tgt = typeof e.target === "object" ? e.target.id : e.target;
      const lbl = e.label.toLowerCase();
      return tgt === n.id && (lbl === "father" || lbl === "mother");
    });
  }).length;

  const descendantCount = nodes.filter((n) => {
    return edges.some((e) => {
      const src = typeof e.source === "object" ? e.source.id : e.source;
      return src === n.id && e.label.toLowerCase() === "child";
    });
  }).length;

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Top bar ────────────────────────────────────────────────────── */}
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
            <span className="hidden sm:flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 border border-primary/30">
              <GitBranch className="size-3.5 text-primary" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider hidden sm:block">Family Tree</p>
              <p className="text-sm font-semibold text-foreground truncate max-w-[140px]">
                {rootEntity?.label ?? id}
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="flex-1 hidden md:block max-w-sm">
            <SearchBox size="md" />
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            {/* Depth control */}
            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-card/60 px-1.5 py-1">
              <button
                onClick={() => handleDepthChange(-1)}
                disabled={depth <= 1 || loading}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-colors"
                title="Fewer generations"
              >
                <ChevronUp className="size-3.5" />
              </button>
              <span className="px-2 text-xs font-mono text-foreground min-w-[58px] text-center">
                {loading ? "…" : `${depth} gen${depth > 1 ? "s" : ""}`}
              </span>
              <button
                onClick={() => handleDepthChange(1)}
                disabled={depth >= 3 || loading}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed transition-colors"
                title="More generations"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>

            {/* Legend toggle */}
            <button
              onClick={() => setShowLegend((v) => !v)}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg border transition-colors cursor-pointer",
                showLegend
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground"
              )}
              title="Toggle legend"
            >
              <Users className="size-4" />
            </button>

            {/* Reset zoom */}
            <button
              onClick={handleReset}
              className="flex size-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Reset zoom"
            >
              <RotateCcw className="size-4" />
            </button>

            {/* Knowledge graph link */}
            <button
              onClick={() => navigate(`/graph/${id}`)}
              className="hidden md:flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer"
            >
              <Network className="size-3.5" />
              Knowledge Graph
            </button>

            {/* Share */}
            <button
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                toast.success("Link copied!");
              }}
              className="flex size-8 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <Share2 className="size-4" />
            </button>
          </div>
        </div>

        {/* Legend bar */}
        {showLegend && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border/40 px-5 py-2.5 flex flex-wrap items-center gap-4"
          >
            {REL_LEGEND.map(({ label, color }) => (
              <div key={label} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-px w-6 rounded-full"
                  style={{ backgroundColor: color, height: "2px" }}
                />
                <span className="text-[10px] capitalize text-muted-foreground">{label}</span>
              </div>
            ))}
            <span className="text-[10px] text-muted-foreground/50 ml-auto hidden md:block">
              Ancestors above · Descendants below · Spouses &amp; siblings same row
            </span>
          </motion.div>
        )}
      </header>

      {/* ── Canvas ─────────────────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden">
        {/* Background dot grid */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.03]">
          <defs>
            <pattern id="ftdots" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="12" cy="12" r="0.8" fill="currentColor" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#ftdots)" />
        </svg>

        {/* Loading */}
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-background/80 backdrop-blur-sm">
            <div className="flex items-center gap-3">
              <div className="size-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="text-sm text-muted-foreground">
                Loading family data from Wikidata…
              </span>
            </div>
            {/* Skeleton tree preview */}
            <div className="flex flex-col items-center gap-3 pointer-events-none select-none">
              <div className="flex gap-6">
                {[0, 1].map((i) => (
                  <Skeleton key={i} className="h-10 w-28 rounded-lg" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <div className="h-6 w-px bg-border/30" />
              <Skeleton className="h-11 w-32 rounded-lg border-2 border-primary/30" />
              <div className="h-6 w-px bg-border/30" />
              <div className="flex gap-6">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 w-28 rounded-lg" style={{ animationDelay: `${i * 0.1}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-6">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-border/50 bg-card/50">
              <Info className="size-6 text-muted-foreground/50" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground mb-1">No family data found</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Wikidata doesn{"'"}t have genealogy data for this entity. Try searching for a historical person.
              </p>
            </div>
            <button
              onClick={() => navigate("/")}
              className="rounded-lg border border-border/60 px-4 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer"
            >
              Back to search
            </button>
          </div>
        )}

        {/* Tree canvas */}
        {!loading && nodes.length > 0 && (
          <FamilyTreeCanvas
            nodes={nodes}
            edges={edges}
            rootId={id!}
            onNodeClick={setSelectedNode}
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
        {!loading && nodes.length > 0 && (
          <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-lg border border-border/50 bg-card/80 backdrop-blur-sm px-3 py-1.5 text-[10px] text-muted-foreground">
            <span><span className="font-mono text-foreground">{nodes.length}</span> people</span>
            {ancestorCount > 0 && (
              <>
                <span className="text-border">·</span>
                <span><span className="font-mono text-foreground">{ancestorCount}</span> ancestors</span>
              </>
            )}
            {descendantCount > 0 && (
              <>
                <span className="text-border">·</span>
                <span><span className="font-mono text-foreground">{descendantCount}</span> descendants</span>
              </>
            )}
          </div>
        )}

        {/* Hint */}
        {!loading && nodes.length > 0 && (
          <div className="absolute bottom-4 right-4 rounded-lg border border-border/40 bg-card/70 backdrop-blur-sm px-3 py-1.5 text-[10px] text-muted-foreground/60 hidden sm:block pointer-events-none">
            Click node for details · Click expand to grow · Drag to reposition
          </div>
        )}
      </div>
    </div>
  );
}
