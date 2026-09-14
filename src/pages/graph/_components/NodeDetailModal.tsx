import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { fetchEntitySummary } from "@/lib/wikidata/api.ts";
import { entityPath } from "@/lib/entityPath.ts";
import { getEntityTypeConfig } from "@/lib/wikidata/entity-types.ts";
import type { GraphNode } from "@/lib/wikidata/types.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  X, ExternalLink, Network, GitBranch,
  User, MapPin, Building2, Lightbulb, Calendar, HelpCircle, Plus, Film, Layers, Sparkles,
} from "lucide-react";
import type { EntityType } from "@/lib/wikidata/types.ts";
import { cn } from "@/lib/utils.ts";
import { isHubMoreNode, isKnowledgeHub } from "../_lib/relationHubs.ts";
import {
  buildLocalRelationStory,
  fetchRelationStory,
} from "@/lib/ai/relationStory.ts";

const TYPE_ICONS: Record<EntityType, React.ComponentType<{ className?: string }>> = {
  person: User, place: MapPin, organization: Building2,
  concept: Lightbulb, event: Calendar, work: Film, unknown: HelpCircle,
};

type Props = {
  node: GraphNode | null;
  onClose: () => void;
  onExpand: (node: GraphNode) => void;
  isExpanding: boolean;
  /** Person at the center of the knowledge graph */
  rootId?: string;
  rootLabel?: string;
  /** Labels of entities currently linked under a selected hub */
  linkedLabels?: string[];
};

function expandLabel(node: GraphNode): string {
  if (isHubMoreNode(node)) return "Show more";
  if (isKnowledgeHub(node)) {
    const shown = node.hubShown ?? 0;
    const total = node.hubTotal ?? 0;
    if (shown === 0 && total > 0) return `Expand · ${total} linked`;
    if (total > shown) return `Show more · ${total - shown} left`;
    return "Expand from here";
  }
  return "Expand from here";
}

function RelationStoryPanel({
  rootId,
  rootLabel,
  relationLabel,
  propertyId,
  linkedLabels,
}: {
  rootId: string;
  rootLabel: string;
  relationLabel: string;
  propertyId?: string;
  linkedLabels: string[];
}) {
  const { data: rootEntity } = useQuery({
    queryKey: ["entity", rootId],
    queryFn: () => fetchEntitySummary(rootId),
    staleTime: 1000 * 60 * 10,
  });

  const occupations = useMemo(
    () =>
      (rootEntity?.facts.find((f) => f.propertyId === "P106")?.values ?? [])
        .slice(0, 8)
        .map((v) => v.label),
    [rootEntity],
  );

  const local = useMemo(
    () =>
      buildLocalRelationStory({
        personLabel: rootEntity?.label ?? rootLabel,
        relationLabel,
        propertyId,
        description: rootEntity?.description,
        wikipediaLead: rootEntity?.wikipedia?.lead ?? rootEntity?.wikipediaSummary,
        linkedWorks: linkedLabels,
      }),
    [rootEntity, rootLabel, relationLabel, propertyId, linkedLabels],
  );

  const { data: story, isFetching } = useQuery({
    queryKey: [
      "relation-story",
      rootId,
      propertyId ?? relationLabel,
      rootEntity?.wikipedia?.revisedAt ?? "norev",
      linkedLabels.slice(0, 8).join("|"),
      "v1",
    ],
    queryFn: () =>
      fetchRelationStory({
        personId: rootId,
        personLabel: rootEntity?.label ?? rootLabel,
        relationLabel,
        propertyId,
        description: rootEntity?.description,
        wikipediaLead: rootEntity?.wikipedia?.lead ?? rootEntity?.wikipediaSummary,
        wikiRevisedAt: rootEntity?.wikipedia?.revisedAt,
        linkedWorks: linkedLabels,
        occupations,
      }),
    enabled: Boolean(rootEntity),
    placeholderData: local,
    staleTime: 1000 * 60 * 60,
    retry: 0,
  });

  const brief = story ?? local;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-transparent to-rose-500/10 px-3.5 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Sparkles className="size-3.5 text-amber-300" />
          {brief.kicker && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-200/90">
              {brief.kicker}
            </span>
          )}
          {isFetching && (
            <span className="text-[10px] text-muted-foreground">Writing…</span>
          )}
          {!isFetching && !brief.fallback && (
            <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-100">
              AI
            </span>
          )}
        </div>
        <h4 className="font-serif text-[1.15rem] font-bold leading-snug text-foreground tracking-tight">
          {brief.heading}
        </h4>
        <p className="mt-2 text-[13px] leading-relaxed text-foreground/85">
          {brief.summary}
        </p>
      </div>

      <div className="space-y-3.5">
        {brief.paragraphs.map((p, i) => (
          <p
            key={i}
            className={cn(
              "text-[13px] leading-[1.7] text-foreground/80",
              i === 0 && "text-[13.5px] text-foreground/90",
            )}
          >
            {p}
          </p>
        ))}
      </div>

      {brief.beats && brief.beats.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Beats
          </p>
          <div className="flex flex-wrap gap-1.5">
            {brief.beats.map((b) => (
              <span
                key={b}
                className="rounded-lg border border-border/60 bg-muted/30 px-2 py-1 text-[11px] text-foreground/80"
              >
                {b}
              </span>
            ))}
          </div>
        </div>
      )}

      {brief.hint && (
        <p className="text-[10px] text-muted-foreground/80">{brief.hint}</p>
      )}
    </div>
  );
}

export default function NodeDetailModal({
  node,
  onClose,
  onExpand,
  isExpanding,
  rootId,
  rootLabel,
  linkedLabels = [],
}: Props) {
  const navigate = useNavigate();
  const isHub = Boolean(node && isKnowledgeHub(node));
  const isMore = Boolean(node && isHubMoreNode(node));
  const isWikidata = Boolean(node && !isHub && /^Q\d+$/i.test(node.id));
  const isActingOccupation =
    Boolean(
      isWikidata &&
        rootId &&
        node &&
        node.id !== rootId &&
        /\b(actor|actress|acting)\b/i.test(node.label),
    );

  const showRelationStory =
    Boolean(isHub && !isMore && rootId && (rootLabel || rootId)) ||
    isActingOccupation;

  const { data: entity, isLoading } = useQuery({
    queryKey: ["entity", node?.id],
    queryFn: () => fetchEntitySummary(node!.id),
    enabled: isWikidata,
    staleTime: 1000 * 60 * 10,
  });

  const cfg = node ? getEntityTypeConfig(node.type) : null;
  const Icon = node ? (isHub ? Layers : TYPE_ICONS[node.type]) : null;

  return (
    <AnimatePresence>
      {node && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, x: 32, scale: 0.97 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 32, scale: 0.97 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={cn(
              "absolute top-4 right-4 bottom-4 z-40 overflow-y-auto rounded-2xl border border-border/70 bg-card/95 backdrop-blur-md shadow-2xl shadow-black/50 flex flex-col",
              showRelationStory ? "w-[min(26rem,calc(100vw-2rem))]" : "w-80",
            )}
          >
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
                    {isHub ? (showRelationStory ? "Career facet" : "Relation") : cfg?.label}
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

            <div className="flex-1 p-4 space-y-4">
              {showRelationStory && rootId && (
                <RelationStoryPanel
                  rootId={rootId}
                  rootLabel={rootLabel ?? rootId}
                  relationLabel={
                    isActingOccupation
                      ? "Acting career"
                      : (node.hubRelation ?? node.label)
                  }
                  propertyId={
                    isActingOccupation ? "P161" : node.hubPropertyId
                  }
                  linkedLabels={linkedLabels}
                />
              )}

              {isActingOccupation && entity && (
                <div className="border-t border-border/40 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">
                    Occupation
                  </p>
                  {entity.description && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{entity.description}</p>
                  )}
                </div>
              )}

              {!showRelationStory && isHub && (
                <>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {node.description ||
                      (isMore
                        ? "Load the next page of linked entities for this relation."
                        : "Relation hub on the knowledge graph. Expand to reveal linked entities.")}
                  </p>
                  {(node.hubTotal != null || node.hubRelation) && (
                    <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 space-y-1.5">
                      {node.hubRelation && (
                        <div className="flex justify-between gap-2 text-[11px]">
                          <span className="text-muted-foreground">Relation</span>
                          <span className="font-medium text-foreground text-right">{node.hubRelation}</span>
                        </div>
                      )}
                      {node.hubTotal != null && (
                        <div className="flex justify-between gap-2 text-[11px]">
                          <span className="text-muted-foreground">Linked</span>
                          <span className="font-mono font-medium text-foreground">
                            {node.hubShown != null && node.hubShown > 0
                              ? `${node.hubShown} / ${node.hubTotal}`
                              : node.hubTotal}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {!showRelationStory && !isHub && !isWikidata && (
                <>
                  {node.description && (
                    <p className="text-xs text-muted-foreground leading-relaxed">{node.description}</p>
                  )}
                  <p className="text-xs text-foreground/70 leading-relaxed">
                    This release is linked from MusicBrainz and is not yet a Wikidata item.
                  </p>
                  {node.externalUrl && (
                    <a
                      href={node.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ExternalLink className="size-2.5" /> Open on MusicBrainz
                    </a>
                  )}
                </>
              )}

              {!showRelationStory && isWikidata && (
                isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-32 w-full rounded-xl" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : entity ? (
                  <>
                    {entity.thumbnail && (
                      <img
                        src={entity.thumbnail}
                        alt={entity.label}
                        className="w-full h-36 object-cover rounded-xl border border-border/50"
                      />
                    )}

                    {entity.description && (
                      <p className="text-xs text-muted-foreground leading-relaxed">{entity.description}</p>
                    )}

                    {entity.wikipediaSummary && (
                      <p className="text-xs text-foreground/70 leading-relaxed line-clamp-4">
                        {entity.wikipediaSummary}
                      </p>
                    )}

                    {entity.facts.slice(0, 4).map((fact) => (
                      <div key={fact.propertyId}>
                        <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">{fact.property}</p>
                        <div className="flex flex-wrap gap-1">
                          {fact.values.slice(0, 3).map((v, i) =>
                            v.id ? (
                              <button
                                key={i}
                                onClick={() => navigate(entityPath(v.id!, v.label))}
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
                ) : null
              )}
            </div>

            <div className="p-4 border-t border-border/50 space-y-2">
              {(isHub || isWikidata) && (
                <button
                  onClick={() => onExpand(node)}
                  disabled={isExpanding}
                  className={cn(
                    "flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition-all cursor-pointer",
                    "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  )}
                >
                  <Plus className="size-3.5" />
                  {isExpanding ? "Expanding…" : expandLabel(node)}
                </button>
              )}
              <div className="flex gap-2">
                {isWikidata ? (
                  <button
                    onClick={() => navigate(entityPath(node.id, node.label))}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer"
                  >
                    <Network className="size-3" /> Overview
                  </button>
                ) : node.externalUrl ? (
                  <a
                    href={node.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                  >
                    <ExternalLink className="size-3" /> MusicBrainz
                  </a>
                ) : null}
                {isWikidata && node.type === "person" && (
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
