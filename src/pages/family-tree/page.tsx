import { useParams, useNavigate } from "react-router-dom";
import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Share2, GitBranch, Circle, Network, GitCompareArrows,
  Info, Minus, Plus, ZoomIn, ZoomOut, LayoutGrid, Check,
} from "lucide-react";
import SearchBox from "@/components/search/SearchBox.tsx";
import { SearchNamePeers } from "@/components/search/SearchNamePeers.tsx";
import FamilyTreeCanvas, { type FamilyViewMode } from "./_components/FamilyTreeCanvas.tsx";
import NodeDetailModal from "@/pages/graph/_components/NodeDetailModal.tsx";
import { fetchEntitySummary, fetchFamilyData, dedupeFamilyEdges } from "@/lib/wikidata/api.ts";
import type { GraphNode } from "@/lib/wikidata/types.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { entityPath } from "@/lib/entityPath.ts";

function canvasCall(name: string, ...args: unknown[]) {
  const fn = (window as unknown as Record<string, unknown>)[name];
  if (typeof fn === "function") (fn as (...a: unknown[]) => void)(...args);
}

export default function FamilyTreePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<import("@/lib/wikidata/types.ts").GraphEdge[]>([]);
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());
  const [expandingIds, setExpandingIds] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [depth, setDepth] = useState(3);
  const [arrangeNonce, setArrangeNonce] = useState(0);
  const [useHubs] = useState(true);
  const [viewMode, setViewMode] = useState<FamilyViewMode>("tree");
  const [copied, setCopied] = useState(false);

  const { data: rootEntity } = useQuery({
    queryKey: ["entity", id],
    queryFn: () => fetchEntitySummary(id!),
    enabled: Boolean(id),
  });

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
    setDepth(3);
    loadTree(id, 3, { clear: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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

  const bumpDepth = (delta: number) => {
    const next = Math.max(1, Math.min(3, depth + delta));
    if (next === depth || !id) return;
    setDepth(next);
    loadTree(id, next);
  };

  const navBtn =
    "inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-[12px] font-medium text-slate-300 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer";
  const chromeBtn =
    "flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer";
  const canvasBtn =
    "flex size-9 items-center justify-center rounded-lg border border-slate-200/80 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 shadow-sm transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="flex flex-col h-screen bg-[#f4f7fb] overflow-hidden">
      <header className="shrink-0 border-b border-slate-800/80 bg-[#0b1220]/96 backdrop-blur-md z-30">
        <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-4 py-2 sm:gap-3 md:px-5 md:py-2.5">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex shrink-0 items-center gap-2 cursor-pointer"
          >
            <div className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/20 border border-cyan-400/30">
              <Network className="size-4 text-cyan-300" />
            </div>
            <span className="hidden sm:inline font-serif font-semibold text-white tracking-tight">
              Wikigraph
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigate(entityPath(id!, rootEntity?.label))}
            className={chromeBtn}
            title="Back to overview"
          >
            <ArrowLeft className="size-4" />
          </button>

          <div className="hidden md:flex flex-1 min-w-0 items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <SearchBox size="md" />
            </div>
            {id && rootEntity && (
              <SearchNamePeers name={rootEntity.label} currentId={id} />
            )}
          </div>

          {id && rootEntity && (
            <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
              <button
                type="button"
                onClick={() => navigate(`/graph/${id}`)}
                className={navBtn}
                title="Knowledge graph"
              >
                <Network className="size-3.5 text-teal-300 shrink-0" />
                <span className="hidden lg:inline">Graph</span>
              </button>

              {/* One Family feature: Tree + Orbit side by side */}
              <div
                className="inline-flex items-center rounded-lg border border-cyan-400/40 bg-cyan-500/15 p-0.5"
                title="Family views"
              >
                <span className="hidden sm:inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 text-[11px] sm:text-[12px] font-medium text-cyan-100/90 select-none">
                  <GitBranch className="size-3.5 text-teal-300 shrink-0" />
                  Family
                </span>
                <span className="hidden sm:block w-px self-stretch my-1 bg-white/15" />
                {([
                  { id: "tree" as const, label: "Tree", icon: GitBranch },
                  { id: "orbit" as const, label: "Orbit", icon: Circle },
                ]).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setViewMode(opt.id);
                      setArrangeNonce((n) => n + 1);
                    }}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer",
                      viewMode === opt.id
                        ? "bg-white text-slate-900 shadow-sm"
                        : "text-cyan-100/70 hover:text-white hover:bg-white/10",
                    )}
                  >
                    <opt.icon className="size-3" />
                    {opt.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => navigate(`/compare/${id}`)}
                className={navBtn}
                title="Compare"
              >
                <GitCompareArrows className="size-3.5 text-teal-300 shrink-0" />
                <span className="hidden lg:inline">Compare</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(window.location.href).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
                toast.success("Link copied!");
              });
            }}
            className={cn(chromeBtn, !(id && rootEntity) && "ml-auto")}
            title="Copy link"
          >
            {copied ? <Check className="size-4 text-emerald-400" /> : <Share2 className="size-4" />}
          </button>
        </div>

        <div className="md:hidden border-t border-white/10 px-4 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <SearchBox size="md" />
            </div>
            {id && rootEntity && (
              <SearchNamePeers name={rootEntity.label} currentId={id} />
            )}
          </div>
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        {/* Soft paper + dotted grid — reads as a map surface */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `
              radial-gradient(ellipse 90% 55% at 50% -5%, rgba(14,165,233,0.09), transparent 50%),
              radial-gradient(ellipse 50% 40% at 100% 100%, rgba(45,139,87,0.05), transparent 45%),
              radial-gradient(ellipse 40% 35% at 0% 80%, rgba(107,92,168,0.05), transparent 40%),
              #f0f4f8
            `,
          }}
        />
        <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
          <defs>
            <pattern id="ft-dots" width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="1.2" cy="1.2" r="1.05" fill="#94a3b8" opacity="0.35" />
            </pattern>
            <pattern id="ft-dots-lg" width="88" height="88" patternUnits="userSpaceOnUse">
              <circle cx="44" cy="44" r="1.6" fill="#64748b" opacity="0.2" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#ft-dots)" />
          <rect width="100%" height="100%" fill="url(#ft-dots-lg)" />
        </svg>

        {loading && nodes.length === 0 && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-5 bg-[#f4f7fb]/80 backdrop-blur-[2px]">
            <div className="flex items-center gap-3">
              <div className="size-5 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
              <span className="text-sm text-slate-500">Loading family data from Wikidata…</span>
            </div>
            <Skeleton className="h-11 w-32 rounded-lg border-2 border-cyan-300/40 bg-slate-200/80" />
          </div>
        )}
        {loading && nodes.length > 0 && (
          <div className="absolute top-4 left-1/2 z-20 -translate-x-1/2 pointer-events-none">
            <div className="flex items-center gap-2.5 rounded-full border border-slate-200/80 bg-white/90 px-3.5 py-2 shadow-sm">
              <div className="size-3.5 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
              <span className="text-xs font-medium text-slate-500">Updating…</span>
            </div>
          </div>
        )}

        {!loading && nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center px-6">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-slate-200/80 bg-white shadow-sm">
              <Info className="size-6 text-slate-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800 mb-1">No family data found</p>
              <p className="text-xs text-slate-500 max-w-xs">
                Wikidata doesn{"'"}t have genealogy data for this entity.
              </p>
            </div>
          </div>
        )}

        {nodes.length > 0 && (
          <FamilyTreeCanvas
            nodes={nodes}
            edges={edges}
            rootId={id!}
            onNodeClick={setSelectedNode}
            expandingIds={expandingIds}
            arrowDir="out"
            arrangeNonce={arrangeNonce}
            useHubs={useHubs}
            viewMode={viewMode}
          />
        )}

        <NodeDetailModal
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onExpand={expandNode}
          isExpanding={selectedNode ? expandingIds.has(selectedNode.id) : false}
        />

        {nodes.length > 0 && (
          <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-2">
            <div className="inline-flex items-center gap-0.5 self-start rounded-xl border border-slate-200/80 bg-white/95 p-1 shadow-sm backdrop-blur-sm">
              <button
                type="button"
                onClick={() => bumpDepth(-1)}
                disabled={loading || depth <= 1}
                className={canvasBtn}
                title="Fewer hops"
              >
                <Minus className="size-3.5" />
              </button>
              <span className="min-w-[3.5rem] text-center text-[11px] font-mono font-semibold text-slate-700">
                {depth} hop{depth === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                onClick={() => bumpDepth(1)}
                disabled={loading || depth >= 3}
                className={canvasBtn}
                title="More hops"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            <div className="rounded-xl border border-slate-200/80 bg-white/90 px-3 py-1.5 text-[10px] text-slate-500 shadow-sm">
              <span className="font-mono text-slate-800">{nodes.length}</span> people
            </div>
          </div>
        )}

        {nodes.length > 0 && (
          <div className="absolute bottom-4 right-4 z-10 flex flex-col gap-1.5 rounded-xl border border-slate-200/80 bg-white/95 p-1.5 shadow-sm backdrop-blur-sm">
            <button
              type="button"
              onClick={() => canvasCall("__treeZoomBy", 1.25)}
              className={canvasBtn}
              title="Zoom in"
            >
              <ZoomIn className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => canvasCall("__treeZoomBy", 0.8)}
              className={canvasBtn}
              title="Zoom out"
            >
              <ZoomOut className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => canvasCall("__treeAutoArrange")}
              className={canvasBtn}
              title="Auto arrange"
            >
              <LayoutGrid className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
