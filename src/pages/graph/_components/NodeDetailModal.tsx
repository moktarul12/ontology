import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { fetchEntityLite } from "@/lib/wikidata/api.ts";
import { entityPath, familyTreePath } from "@/lib/entityPath.ts";
import { getEntityTypeConfig } from "@/lib/wikidata/entity-types.ts";
import type { GraphNode } from "@/lib/wikidata/types.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  X, ExternalLink, Network, GitBranch,
  User, MapPin, Building2, Lightbulb, Calendar, HelpCircle, Plus, Film, Layers, Sparkles,
  Cake, Flag,
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

export type RelationCount = {
  label: string;
  count: number;
  propertyId?: string;
};

type Props = {
  node: GraphNode | null;
  onClose: () => void;
  onExpand: (node: GraphNode) => void;
  isExpanding: boolean;
  rootId?: string;
  rootLabel?: string;
  linkedLabels?: string[];
  /** Relation tallies for the selected node (from live graph edges) */
  relationCounts?: RelationCount[];
};

function expandLabel(node: GraphNode): string {
  if (isHubMoreNode(node)) return "Show more";
  if (isKnowledgeHub(node)) {
    const shown = node.hubShown ?? 0;
    const total = node.hubTotal ?? 0;
    if (shown === 0 && total > 0) return `Expand connections · ${total}`;
    if (total > shown) return `Show more · ${total - shown} left`;
    return "Expand connections";
  }
  return "Expand connections";
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
    queryKey: ["entity-lite", rootId],
    queryFn: () => fetchEntityLite(rootId),
    staleTime: 1000 * 60 * 30,
  });

  const [aiReady, setAiReady] = useState(false);
  useEffect(() => {
    setAiReady(false);
    const t = window.setTimeout(() => setAiReady(true), 900);
    return () => window.clearTimeout(t);
  }, [rootId, propertyId, relationLabel]);

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
    enabled: Boolean(rootEntity) && aiReady,
    placeholderData: local,
    staleTime: 1000 * 60 * 60,
    retry: 0,
  });

  const brief = story ?? local;

  return (
    <div className="rounded-xl border border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50/60 px-3.5 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Sparkles className="size-3.5 text-amber-600" />
        {brief.kicker && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-700/90">
            {brief.kicker}
          </span>
        )}
        {isFetching && (
          <span className="text-[10px] text-slate-400">Writing…</span>
        )}
      </div>
      <h4 className="font-serif text-[1.05rem] font-bold leading-snug text-slate-900 tracking-tight">
        {brief.heading}
      </h4>
      {brief.summary && (
        <p className="mt-2 text-[13px] leading-relaxed text-slate-600">{brief.summary}</p>
      )}
      {linkedLabels.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {linkedLabels.slice(0, 8).map((l) => (
            <span
              key={l}
              className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600"
            >
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function factIcon(propertyId: string) {
  if (propertyId === "P569" || propertyId === "P570") return Cake;
  if (propertyId === "P19" || propertyId === "P20") return MapPin;
  if (propertyId === "P106" || propertyId === "P39") return User;
  if (propertyId === "P27") return Flag;
  if (propertyId === "P166") return Sparkles;
  return Lightbulb;
}

export default function NodeDetailModal({
  node,
  onClose,
  onExpand,
  isExpanding,
  rootId,
  rootLabel,
  linkedLabels = [],
  relationCounts = [],
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
    queryKey: ["entity-lite", node?.id],
    queryFn: () => fetchEntityLite(node!.id),
    enabled: isWikidata,
    staleTime: 1000 * 60 * 30,
  });

  const cfg = node ? getEntityTypeConfig(node.type) : null;
  const Icon = node ? (isHub ? Layers : TYPE_ICONS[node.type]) : null;

  const aboutText =
    entity?.wikipediaSummary ||
    entity?.wikipedia?.lead ||
    entity?.description ||
    node?.description ||
    "";

  const keyFacts = (entity?.facts ?? []).filter((f) =>
    ["P569", "P570", "P19", "P20", "P106", "P27", "P69", "P108"].includes(f.propertyId),
  ).slice(0, 5);

  const tags = useMemo(() => {
    const out: string[] = [];
    if (relationCounts.some((r) => /film|actor|work|song|album/i.test(r.label))) out.push("Films");
    if (relationCounts.some((r) => /award/i.test(r.label))) out.push("Awards");
    if (relationCounts.some((r) => /spouse|father|mother|child|sibling|relative/i.test(r.label))) {
      out.push("People");
    }
    if (entity?.type === "person") out.push("People");
    if (entity?.type === "work") out.push("Films");
    if (entity?.type === "organization") out.push("Organizations");
    if (entity?.type === "event") out.push("Events");
    return [...new Set(out)].slice(0, 5);
  }, [relationCounts, entity?.type]);

  return (
    <AnimatePresence>
      {node && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 bg-slate-900/10"
            onClick={onClose}
          />

          <motion.aside
            initial={{ opacity: 0, x: 28 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 28 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className={cn(
              "absolute top-3 right-3 bottom-3 z-40 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_20px_50px_-20px_rgba(15,23,42,0.35)]",
              showRelationStory && "w-[min(26rem,calc(100vw-1.5rem))]",
            )}
          >
            {/* Header */}
            <div className="relative shrink-0 border-b border-slate-100 px-4 pb-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
              >
                <X className="size-4" />
              </button>

              <div className="flex gap-3 pr-8">
                {isWikidata && entity?.thumbnail ? (
                  <img
                    src={entity.thumbnail}
                    alt=""
                    className="size-16 shrink-0 rounded-xl object-cover object-top ring-1 ring-slate-200"
                  />
                ) : (
                  <div
                    className="flex size-16 shrink-0 items-center justify-center rounded-xl ring-1 ring-slate-200"
                    style={{ background: `${cfg?.hex ?? "#64748b"}18` }}
                  >
                    {Icon && <Icon className="size-7" style={{ color: cfg?.hex }} />}
                  </div>
                )}
                <div className="min-w-0 pt-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                    {isHub ? "Relation" : cfg?.label ?? "Entity"}
                  </p>
                  <h3 className="mt-0.5 font-serif text-lg font-bold leading-snug text-slate-900">
                    {node.label}
                  </h3>
                  {(entity?.description || node.description) && (
                    <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-slate-500">
                      {entity?.description || node.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-2">
                {(isHub || isWikidata) && (
                  <button
                    type="button"
                    onClick={() => onExpand(node)}
                    disabled={isExpanding}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm shadow-sky-600/25 hover:bg-sky-500 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Plus className="size-4" />
                    {isExpanding ? "Expanding…" : expandLabel(node)}
                  </button>
                )}
                {isWikidata && (
                  <button
                    type="button"
                    onClick={() => navigate(entityPath(node.id, node.label))}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <Network className="size-3.5 text-sky-600" />
                    Open profile
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
              {showRelationStory && rootId && (
                <RelationStoryPanel
                  rootId={rootId}
                  rootLabel={rootLabel ?? rootId}
                  relationLabel={
                    isActingOccupation
                      ? "Acting career"
                      : (node.hubRelation ?? node.label)
                  }
                  propertyId={isActingOccupation ? "P161" : node.hubPropertyId}
                  linkedLabels={linkedLabels}
                />
              )}

              {!showRelationStory && isHub && (
                <section>
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    About
                  </h4>
                  <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
                    {node.description ||
                      (isMore
                        ? "Load the next page of linked entities for this relation."
                        : "Relation hub on the knowledge graph. Expand to reveal linked entities.")}
                  </p>
                  {node.hubTotal != null && (
                    <p className="mt-2 font-mono text-[12px] text-slate-500">
                      {node.hubShown != null && node.hubShown > 0
                        ? `${node.hubShown} / ${node.hubTotal} shown`
                        : `${node.hubTotal} linked`}
                    </p>
                  )}
                </section>
              )}

              {!showRelationStory && isWikidata && (
                isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-20 w-full rounded-xl" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                ) : (
                  <>
                    {aboutText && (
                      <section>
                        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                          About
                        </h4>
                        <p className="mt-2 text-[13px] leading-relaxed text-slate-600 line-clamp-6">
                          {aboutText}
                        </p>
                      </section>
                    )}

                    {keyFacts.length > 0 && (
                      <section>
                        <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                          Key facts
                        </h4>
                        <ul className="mt-2 space-y-2.5">
                          {keyFacts.map((fact) => {
                            const FIcon = factIcon(fact.propertyId);
                            return (
                              <li key={fact.propertyId} className="flex gap-2.5">
                                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                                  <FIcon className="size-3.5" />
                                </span>
                                <div className="min-w-0">
                                  <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                                    {fact.property}
                                  </p>
                                  <p className="text-[13px] font-medium text-slate-800">
                                    {fact.values.slice(0, 3).map((v) => v.label).join(" · ")}
                                  </p>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    )}
                  </>
                )
              )}

              {!showRelationStory && !isHub && !isWikidata && (
                <section>
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    About
                  </h4>
                  <p className="mt-2 text-[13px] leading-relaxed text-slate-600">
                    {node.description ||
                      "This release is linked from MusicBrainz and is not yet a Wikidata item."}
                  </p>
                </section>
              )}

              {relationCounts.length > 0 && (
                <section>
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Relationships
                  </h4>
                  <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 overflow-hidden">
                    {relationCounts.slice(0, 8).map((r) => (
                      <li
                        key={r.propertyId ?? r.label}
                        className="flex items-center justify-between gap-2 bg-white px-3 py-2.5"
                      >
                        <span className="text-[13px] text-slate-700">{r.label}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600">
                          {r.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {tags.length > 0 && (
                <section>
                  <h4 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Related
                  </h4>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <div className="shrink-0 border-t border-slate-100 px-4 py-3 flex gap-2">
              {isWikidata && entity?.type === "person" && (
                <button
                  type="button"
                  onClick={() => navigate(familyTreePath(node.id, node.label))}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  <GitBranch className="size-3.5" /> Family
                </button>
              )}
              {isWikidata && entity?.wikidataUrl && (
                <a
                  href={entity.wikidataUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <ExternalLink className="size-3.5" /> Wikidata
                </a>
              )}
              {node.externalUrl && (
                <a
                  href={node.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <ExternalLink className="size-3.5" /> MusicBrainz
                </a>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
