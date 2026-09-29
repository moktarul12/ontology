import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { GitBranch, Info, Minus, Moon, Plus, RotateCcw, Sun } from "lucide-react";
import { Link } from "react-router-dom";
import FamilyTreeCanvas, {
  type CanvasTheme,
} from "@/pages/family-tree/_components/FamilyTreeCanvas.tsx";
import NodeDetailModal from "@/pages/graph/_components/NodeDetailModal.tsx";
import { dedupeFamilyEdges, fetchFamilyData } from "@/lib/wikidata/api.ts";
import { familyTreePath } from "@/lib/entityPath.ts";
import type { GraphEdge, GraphNode } from "@/lib/wikidata/types.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";

type Props = {
  personId: string;
  personLabel: string;
  onOpenEntity: (id: string, label: string) => void;
};

const THEME_KEY = "dfw-family-canvas-theme";

function loadTheme(): CanvasTheme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return "dark";
}

export default function FamilyTreeEmbed({ personId, personLabel, onOpenEntity }: Props) {
  const [depth, setDepth] = useState(2);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [expandingIds] = useState(() => new Set<string>());
  const [arrangeNonce, setArrangeNonce] = useState(0);
  const [theme, setTheme] = useState<CanvasTheme>(loadTheme);

  const dark = theme === "dark";

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["family", personId, depth],
    queryFn: () => fetchFamilyData(personId, depth, new Set()),
    staleTime: 1000 * 60 * 15,
  });

  useEffect(() => {
    if (!data) return;
    setNodes(data.nodes);
    setEdges(dedupeFamilyEdges(data.edges));
    setSelectedNode(null);
  }, [data]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const onExpand = useCallback((_node: GraphNode) => {
    // Expansion stays on dedicated family-tree page for now
  }, []);

  const toggleTheme = () => setTheme((t) => (t === "dark" ? "light" : "dark"));

  const canvasBg = dark ? "#070b14" : "#f0f4f8";
  const muted = dark ? "#94a3b8" : "#64748b";
  const ink = dark ? "#f1f5f9" : "#0f172a";

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <GitBranch className="size-4" style={{ color: "#7dd3fc" }} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: ink }}>Family tree</h2>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: muted }}>
            Interactive genealogy from Wikidata · {depth} hop{depth === 1 ? "" : "s"}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              borderRadius: 12,
              border: dark ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(15,23,42,0.1)",
              background: dark ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.7)",
              padding: 4,
            }}
          >
            <button
              type="button"
              disabled={depth <= 1 || isFetching}
              onClick={() => setDepth((d) => Math.max(1, d - 1))}
              style={chipBtn(dark)}
              title="Fewer hops"
            >
              <Minus className="size-3.5" />
            </button>
            <span
              style={{
                minWidth: 52,
                textAlign: "center",
                fontSize: 11,
                fontFamily: "Space Mono, monospace",
                color: dark ? "#cbd5e1" : "#334155",
              }}
            >
              {depth} hop{depth === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              disabled={depth >= 3 || isFetching}
              onClick={() => setDepth((d) => Math.min(3, d + 1))}
              style={chipBtn(dark)}
              title="More hops"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setArrangeNonce((n) => n + 1)}
            style={chipBtn(dark)}
            title="Re-arrange"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            style={{
              ...chipBtn(dark),
              width: "auto",
              padding: "0 10px",
              gap: 6,
              fontSize: 11,
              fontWeight: 600,
            }}
            title={dark ? "Switch to light canvas" : "Switch to dark canvas"}
          >
            {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
            {dark ? "Light" : "Dark"}
          </button>
          <Link
            to={familyTreePath(personId, personLabel)}
            style={{ fontSize: 12, fontWeight: 600, color: "#7dd3fc", textDecoration: "none" }}
          >
            Open full tree
          </Link>
        </div>
      </div>

      <div
        style={{
          position: "relative",
          height: "min(62vh, 560px)",
          borderRadius: 16,
          overflow: "hidden",
          border: dark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(15,23,42,0.1)",
          background: canvasBg,
          boxShadow: dark
            ? "inset 0 1px 0 rgba(56,189,248,0.08)"
            : "inset 0 1px 0 rgba(255,255,255,0.8)",
        }}
      >
        {isLoading && nodes.length === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              zIndex: 5,
              background: dark ? "rgba(7,11,20,0.85)" : "rgba(240,244,248,0.85)",
            }}
          >
            <Skeleton className="h-12 w-40 rounded-xl" />
          </div>
        )}
        {error && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
            <Info className="size-6" style={{ color: muted, margin: "0 auto 8px" }} />
            <p style={{ margin: 0, fontSize: 13, color: muted }}>Could not load family data.</p>
          </div>
        )}
        {!isLoading && !error && nodes.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>
            <Info className="size-6" style={{ color: muted, margin: "0 auto 8px" }} />
            <p style={{ margin: 0, fontSize: 13, color: muted }}>No genealogy claims on Wikidata for this person.</p>
          </div>
        )}
        {nodes.length > 0 && (
          <FamilyTreeCanvas
            nodes={nodes}
            edges={edges}
            rootId={personId}
            onNodeClick={setSelectedNode}
            expandingIds={expandingIds}
            arrangeNonce={arrangeNonce}
            useHubs
            viewMode="tree"
            theme={theme}
          />
        )}
        <NodeDetailModal
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          onExpand={(n) => {
            if (/^Q\d+$/i.test(n.id)) onOpenEntity(n.id, n.label);
            onExpand(n);
          }}
          isExpanding={false}
          rootId={personId}
          rootLabel={personLabel}
        />
      </div>
    </div>
  );
}

function chipBtn(dark: boolean): CSSProperties {
  return {
    width: 32,
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    border: dark ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(15,23,42,0.12)",
    background: dark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.04)",
    color: dark ? "#e2e8f0" : "#334155",
    cursor: "pointer",
  };
}
