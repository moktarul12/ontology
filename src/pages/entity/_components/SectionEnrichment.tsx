import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils.ts";
import { entityPath } from "@/lib/entityPath.ts";
import {
  buildLocalSectionBrief,
  fetchSectionEnrichment,
  isFactsEnrichSection,
  type BriefField,
  type EnrichSection,
  type FactsEnrichSection,
  type SectionBrief,
} from "@/lib/ai/enrich.ts";
import type { EntitySummary } from "@/lib/wikidata/types.ts";

function StatusPills({
  isFetching,
  fallback,
}: {
  isFetching: boolean;
  fallback?: boolean;
}) {
  if (isFetching) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-slate-500">
        Polishing…
      </span>
    );
  }
  if (!fallback) {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-emerald-700">
        AI
      </span>
    );
  }
  return null;
}

function BriefFields({
  fields,
  onNavigate,
}: {
  fields: BriefField[];
  onNavigate?: (path: string) => void;
}) {
  if (!fields.length) return null;
  return (
    <dl className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
      {fields.map((f) => {
        const valueNode =
          f.entityId && onNavigate ? (
            <button
              type="button"
              onClick={() => onNavigate(entityPath(f.entityId!, f.value))}
              className="text-left font-medium text-cyan-800 hover:underline cursor-pointer"
            >
              {f.value}
            </button>
          ) : (
            <span className="font-medium text-slate-800">{f.value}</span>
          );
        return (
          <div
            key={`${f.label}-${f.value}`}
            className="grid grid-cols-1 gap-1 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4 sm:items-baseline"
          >
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {f.label}
            </dt>
            <dd className="text-[15px] leading-snug">{valueNode}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function SectionBriefCard({
  brief,
  isFetching,
  onNavigate,
  accentClass = "text-cyan-600",
}: {
  brief: SectionBrief;
  isFetching: boolean;
  onNavigate?: (path: string) => void;
  accentClass?: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 shadow-sm">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
        <Sparkles className={cn("size-3.5", accentClass)} />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          {brief.heading}
        </h3>
        <StatusPills isFetching={isFetching} fallback={brief.fallback} />
      </header>

      <p className="mt-4 font-serif text-[17px] sm:text-lg leading-[1.65] text-slate-900">
        {brief.summary}
      </p>

      {brief.paragraphs && brief.paragraphs.length > 0 && (
        <div className="mt-4 space-y-3">
          {brief.paragraphs.map((p, i) => (
            <p key={i} className="text-[15px] leading-[1.75] text-slate-700">
              {p}
            </p>
          ))}
        </div>
      )}

      <BriefFields fields={brief.fields} onNavigate={onNavigate} />

      {brief.hint && (
        <p className="mt-4 text-[11px] text-slate-400">{brief.hint}</p>
      )}
    </article>
  );
}

function useSectionBrief(section: EnrichSection, entity: EntitySummary) {
  const local = useMemo(() => buildLocalSectionBrief(section, entity), [section, entity]);
  const query = useQuery({
    queryKey: ["section-enrich", section, entity.id, entity.wikipedia?.revisedAt ?? "norev", "v5"],
    queryFn: () => fetchSectionEnrichment(section, entity),
    placeholderData: local,
    staleTime: 1000 * 60 * 60,
    retry: 0,
  });
  return { brief: (query.data ?? local) as SectionBrief, isFetching: query.isFetching, local };
}

export function OverviewCapsuleBlock({ entity }: { entity: EntitySummary }) {
  const { brief, isFetching } = useSectionBrief("overview", entity);
  return (
    <SectionBriefCard
      brief={brief}
      isFetching={isFetching}
      accentClass="text-cyan-600"
    />
  );
}

export function FactsBriefBlock({
  section,
  entity,
  onNavigate,
}: {
  section: FactsEnrichSection;
  entity: EntitySummary;
  onNavigate: (path: string) => void;
}) {
  const { brief, isFetching } = useSectionBrief(section, entity);
  const accent =
    section === "life"
      ? "text-sky-600"
      : section === "family"
        ? "text-rose-600"
        : section === "career"
          ? "text-indigo-600"
          : "text-amber-600";

  return (
    <SectionBriefCard
      brief={brief}
      isFetching={isFetching}
      onNavigate={onNavigate}
      accentClass={accent}
    />
  );
}

export function CreativeBriefBlock({
  entity,
  onNavigate,
}: {
  entity: EntitySummary;
  onNavigate: (path: string) => void;
}) {
  return <FactsBriefBlock section="creative" entity={entity} onNavigate={onNavigate} />;
}

export function maybeFactsEnrichSection(id: string): FactsEnrichSection | null {
  return isFactsEnrichSection(id) ? id : null;
}
