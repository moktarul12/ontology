import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { fetchEntitySummary } from "@/lib/wikidata/api.ts";
import { getEntityTypeConfig } from "@/lib/wikidata/entity-types.ts";
import type { GraphNode } from "@/lib/wikidata/types.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  X, ExternalLink, Network, GitBranch,
  User, MapPin, Building2, Lightbulb, Calendar, HelpCircle, Plus, Film,
} from "lucide-react";
import type { EntityType } from "@/lib/wikidata/types.ts";
import { cn } from "@/lib/utils.ts";

const TYPE_ICONS: Record<EntityType, React.ComponentType<{ className?: string }>> = {
  person: User, place: MapPin, organization: Building2,
  concept: Lightbulb, event: Calendar, work: Film, unknown: HelpCircle,
};

type Props = {
  node: GraphNode | null;
  onClose: () => void;
  onExpand: (node: GraphNode) => void;
  isExpanding: boolean;
};

export default function NodeDetailModal({ node, onClose, onExpand, isExpanding }: Props) {
  const navigate = useNavigate();

  const { data: entity, isLoading } = useQuery({
    queryKey: ["entity", node?.id],
    queryFn: () => fetchEntitySummary(node!.id),
    enabled: Boolean(node),
    staleTime: 1000 * 60 * 10,
  });

  const cfg = node ? getEntityTypeConfig(node.type) : null;
  const Icon = node ? TYPE_ICONS[node.type] : null;

  return (
    <AnimatePresence>
      {node && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, x: 32, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 32, scale: 0.97 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute top-4 right-4 bottom-4 z-40 w-80 overflow-y-auto rounded-2xl border border-border/70 bg-card/95 backdrop-blur-md shadow-2xl shadow-black/50 flex flex-col"
          >
            {/* Header */}
            <div
              className="flex items-start justify-between gap-2 p-4 border-b border-border/50"
              style={{ background: `linear-gradient(135deg, ${cfg?.hex}12, transparent)` }}
            >
              <div className="flex items-center gap-2 min-w-0">
                {cfg && Icon && (
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-lg border", cfg.bgClass, cfg.borderClass)}>
                    <Icon className={cn("size-3.5", cfg.textClass)} />
                  </span>
                )}
                <div className="min-w-0">
                  <p className={cn("text-[10px] font-semibold uppercase tracking-wider", cfg?.textClass)}>
                    {cfg?.label}
                  </p>
                  <h3 className="font-serif text-base font-bold text-foreground leading-tight truncate">
                    {node.label}
                  </h3>
                </div>
              </div>
              <button onClick={onClose} className="shrink-0 flex size-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer">
                <X className="size-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 p-4 space-y-4">
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-32 w-full rounded-xl" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : entity ? (
                <>
                  {/* Thumbnail */}
                  {entity.thumbnail && (
                    <img
                      src={entity.thumbnail}
                      alt={entity.label}
                      className="w-full h-36 object-cover rounded-xl border border-border/50"
                    />
                  )}

                  {/* Description */}
                  {entity.description && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{entity.description}</p>
                  )}

                  {/* Wikipedia snippet */}
                  {entity.wikipediaSummary && (
                    <p className="text-xs text-foreground/70 leading-relaxed line-clamp-4">
                      {entity.wikipediaSummary}
                    </p>
                  )}

                  {/* Key facts (first 4) */}
                  {entity.facts.slice(0, 4).map((fact) => (
                    <div key={fact.propertyId}>
                      <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">{fact.property}</p>
                      <div className="flex flex-wrap gap-1">
                        {fact.values.slice(0, 3).map((v, i) =>
                          v.id ? (
                            <button
                              key={i}
                              onClick={() => navigate(`/entity/${v.id}`)}
                              className="rounded px-1.5 py-0.5 text-[10px] font-medium border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                            >
                              {v.label}
                            </button>
                          ) : (
                            <span key={i} className="text-[11px] text-foreground/80">{v.label}</span>
                          )
                        )}
                      </div>
                    </div>
                  ))}

                  {/* External links */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <a
                      href={entity.wikidataUrl}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="size-2.5" /> Wikidata
                    </a>
                  </div>
                </>
              ) : null}
            </div>

            {/* Footer actions */}
            <div className="p-4 border-t border-border/50 space-y-2">
              <button
                onClick={() => onExpand(node)}
                disabled={isExpanding}
                className={cn(
                  "flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition-all cursor-pointer",
                  "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                )}
              >
                <Plus className="size-3.5" />
                {isExpanding ? "Expanding…" : "Expand from here"}
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => navigate(`/entity/${node.id}`)}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer"
                >
                  <Network className="size-3" /> Overview
                </button>
                {node.type === "person" && (
                  <button
                    onClick={() => navigate(`/family-tree/${node.id}`)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer"
                  >
                    <GitBranch className="size-3" /> Family Tree
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
