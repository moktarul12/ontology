import { useParams, useNavigate } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { toast } from "sonner";
import {
  ArrowLeft, Network, Share2, RotateCcw, GitBranch,
  Users, Info, LayoutGrid, ChevronDown, Download,
} from "lucide-react";
import SearchBox from "@/components/search/SearchBox.tsx";
import FamilyTreeCanvas from "./_components/FamilyTreeCanvas.tsx";
import NodeDetailModal from "@/pages/graph/_components/NodeDetailModal.tsx";
import { fetchEntitySummary, fetchFamilyData, dedupeFamilyEdges } from "@/lib/wikidata/api.ts";
import type { GraphNode, GraphEdge } from "@/lib/wikidata/types.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";

// Relation legend data
const REL_LEGEND = [
  { label: "father",   color: "#5B9FD8" },
  { label: "mother",   color: "#D86B9B" },
  { label: "son",      color: "#4DC48A" },
  { label: "daughter", color: "#4DC48A" },
  { label: "spouse",   color: "#E8B84D" },
  { label: "sibling",  color: "#A46DD8" },
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
  const [arrowDir, setArrowDir] = useState<"in" | "out" | "both">("out");
  const [arrangeNonce, setArrangeNonce] = useState(0);
  const [useHubs, setUseHubs] = useState(true);

  // ── Root entity label ──────────────────────────────────────────────────
  const { data: rootEntity } = useQuery({
    queryKey: ["entity", id],
    queryFn: () => fetchEntitySummary(id!),
    enabled: Boolean(id),
  });

  // ── Initial load ───────────────────────────────────────────────────────
  const loadTree = useCallback(async (
    rootId: string,
    hops: number,
    opts?: { clear?: boolean },
  ) => {
    setLoading(true);
    setSelectedNode(null);
    if (opts?.clear) {
      setNodes([]);
      setEdges([]);
      setLoadedIds(new Set());
    }
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
    loadTree(id, depth, { clear: true });
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
      setEdges((prev) => dedupeFamilyEdges([...prev, ...newEdges]));
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
  const handleDepthSelect = (value: number) => {
    const next = Math.max(1, Math.min(3, value));
    if (next === depth) return;
    setDepth(next);
    if (id) loadTree(id, next); // keep current tree visible while fetching
  };

  const handleReset = () => {
    const w = window as unknown as Record<string, unknown>;
    const fn = w.__treeResetZoom;
    if (typeof fn === "function") fn();
  };

  const handleAutoArrange = () => {
    setArrangeNonce((n) => n + 1);
  };

  const handleDownloadJson = () => {
    if (!id || nodes.length === 0) return;

    const endpointId = (v: string | GraphNode) =>
      typeof v === "object" ? v.id : v;

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      rootId: id,
      rootLabel: rootEntity?.label ?? id,
      depth,
      useHubs,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      nodes: nodes.map((n) => ({
        id: n.id,
        label: n.label,
        type: n.type,
        description: n.description,
        thumbnail: n.thumbnail,
        gender: n.gender,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: endpointId(e.source),
        target: endpointId(e.target),
        label: e.label,
        propertyId: e.propertyId,
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeName = (rootEntity?.label ?? id)
      .replace(/[^\w\-]+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 60);
    a.href = url;
    a.download = `family-tree-${safeName}-${id}-d${depth}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Family tree JSON downloaded");
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
            {/* Relation arrow direction: out (default) / in / both */}
            <div className="flex items-center rounded-lg border border-border/60 bg-card/60 p-0.5" title="Relation perspective: Out = father/mother, In = son/daughter">
              {([
                { id: "in" as const, label: "In" },
                { id: "out" as const, label: "Out" },
                { id: "both" as const, label: "Both" },
              ]).map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setArrowDir(opt.id)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer",
                    arrowDir === opt.id
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Depth / hops dropdown */}
            <label className="relative flex items-center gap-1.5 rounded-lg border border-border/60 bg-card/60 pl-2.5 pr-1 py-1" title="Generation depth / hops">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Depth</span>
              <div className="relative">
                <select
                  value={depth}
                  disabled={loading}
                  onChange={(e) => handleDepthSelect(Number(e.target.value))}
                  className="appearance-none cursor-pointer rounded-md border-0 bg-transparent py-1 pl-1.5 pr-6 text-xs font-mono font-semibold text-foreground outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <option value={1}>1 hop</option>
                  <option value={2}>2 hops</option>
                  <option value={3}>3 hops</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-0.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </label>

            {/* Relation hubs */}
            <button
              onClick={() => setUseHubs((v) => !v)}
              disabled={loading || nodes.length === 0}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                useHubs
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/60 text-muted-foreground hover:text-foreground",
              )}
              title="Fan focus relations through parent / child / spouse / sibling hubs"
            >
              Hubs
            </button>

            {/* Auto arrange */}
            <button
              onClick={handleAutoArrange}
              disabled={loading || nodes.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-primary hover:bg-primary/20 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Rearrange: family · wide · mirrored"
            >
              <LayoutGrid className="size-3.5" />
              Auto arrange
            </button>

            {/* Download JSON */}
            <button
              onClick={handleDownloadJson}
              disabled={loading || nodes.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title="Download current family tree as JSON"
            >
              <Download className="size-3.5" />
              <span className="hidden sm:inline">JSON</span>
            </button>

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
              Out = father/mother · In = son/daughter · Both = both labels
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

        {/* Loading — keep existing tree visible; only full-screen on first load */}
        {loading && nodes.length === 0 && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-background/70 backdrop-blur-[2px]">
            <div className="flex items-center gap-3">
              <div className="size-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="text-sm text-muted-foreground">
                Loading family data from Wikidata…
              </span>
            </div>
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
        {loading && nodes.length > 0 && (
          <div className="absolute top-4 left-1/2 z-20 -translate-x-1/2 pointer-events-none">
            <div className="flex items-center gap-2.5 rounded-full border border-border/60 bg-card/90 px-3.5 py-2 shadow-md backdrop-blur-sm">
              <div className="size-3.5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              <span className="text-xs font-medium text-muted-foreground">
                Loading family data from Wikidata…
              </span>
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

        {/* Tree canvas — stay mounted while reloading so the previous tree stays visible */}
        {nodes.length > 0 && (
          <FamilyTreeCanvas
            nodes={nodes}
            edges={edges}
            rootId={id!}
            onNodeClick={setSelectedNode}
            expandingIds={expandingIds}
            arrowDir={arrowDir}
            arrangeNonce={arrangeNonce}
            useHubs={useHubs}
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
        {nodes.length > 0 && (
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

        {/* Floating auto arrange */}
        {nodes.length > 0 && (
          <button
            onClick={handleAutoArrange}
            disabled={loading}
            className="absolute bottom-4 right-4 flex items-center gap-2 rounded-xl border border-primary/40 bg-card/90 backdrop-blur-sm px-3.5 py-2 text-xs font-semibold text-primary shadow-lg shadow-black/20 hover:bg-primary/15 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            title="Re-layout tree by generation"
          >
            <LayoutGrid className="size-3.5" />
            Auto arrange
          </button>
        )}
      </div>
    </div>
  );
}
