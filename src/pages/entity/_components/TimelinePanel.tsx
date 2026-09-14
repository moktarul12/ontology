import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import { ChevronRight, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils.ts";
import { entityPath } from "@/lib/entityPath.ts";
import {
  buildLocalNarrative,
  expandMomentDetail,
  fetchNarrativeTimeline,
} from "@/lib/ai/timeline.ts";
import type { EntitySummary, TimelineEvent } from "@/lib/wikidata/types.ts";

function eventKey(ev: TimelineEvent): string {
  return `${ev.sortKey}|${ev.title}`;
}

function yearNum(ev: TimelineEvent): number {
  const m = ev.year.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  if (m) return Number(m[1]);
  const s = ev.sortKey.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return s ? Number(s[1]) : 0;
}

type YearGroup = { year: string; yearN: number; events: TimelineEvent[] };

function groupByYear(events: TimelineEvent[]): YearGroup[] {
  const map = new Map<string, TimelineEvent[]>();
  const order: string[] = [];
  for (const ev of events) {
    const y = ev.year?.trim() || String(yearNum(ev) || "—");
    if (!map.has(y)) {
      map.set(y, []);
      order.push(y);
    }
    map.get(y)!.push(ev);
  }
  return order
    .map((year) => ({
      year,
      yearN: yearNum({
        year,
        sortKey: year,
        title: "",
        summary: "",
        kind: "life",
        eraId: "",
      }),
      events: map.get(year)!,
    }))
    .sort((a, b) => a.yearN - b.yearN || a.year.localeCompare(b.year));
}

function detailBullets(
  entity: EntitySummary,
  ev: TimelineEvent,
  eras: Array<{ id: string }>,
  allEvents: TimelineEvent[],
): string[] {
  const era = eras.find((e) => e.id === ev.eraId);
  const pack = expandMomentDetail(entity, ev, era as never, allEvents);
  const out: string[] = [];
  for (const h of ev.highlights ?? []) {
    if (h.trim() && !out.includes(h.trim())) out.push(h.trim());
  }
  // Prefer source highlights; only add whyItMatters when still thin
  if (out.length < 2 && pack.whyItMatters?.trim() && !out.includes(pack.whyItMatters.trim())) {
    out.push(pack.whyItMatters.trim());
  }
  return out.slice(0, 8);
}

/**
 * Gemini-style AI Timeline: intro + portrait, vertical spine,
 * year-by-year entries with title → year → summary → nested bullets.
 * All | year filter; click entry to expand deeper detail.
 */
export default function TimelinePanel({
  entity,
  color: _color,
  onNavigate,
  portraitUrl,
}: {
  entity: EntitySummary;
  color: string;
  onNavigate: (path: string) => void;
  portraitUrl?: string;
}) {
  const local = useMemo(() => buildLocalNarrative(entity), [entity]);

  const { data: narrative, isFetching, isError } = useQuery({
    queryKey: [
      "narrative-timeline",
      entity.id,
      entity.wikipedia?.revisedAt ?? "norev",
      "v11-gemini-dense",
    ],
    queryFn: () => fetchNarrativeTimeline(entity),
    placeholderData: local,
    staleTime: 1000 * 60 * 60,
    retry: 0,
  });

  const data = narrative ?? local;
  /** null = All */
  const [filterYear, setFilterYear] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const allSorted = useMemo(
    () => [...(data.events ?? [])].sort((a, b) => a.sortKey.localeCompare(b.sortKey)),
    [data.events],
  );

  const yearGroups = useMemo(() => groupByYear(allSorted), [allSorted]);

  const visibleEvents = useMemo(() => {
    if (filterYear == null) return allSorted;
    return allSorted.filter((e) => (e.year?.trim() || String(yearNum(e))) === filterYear);
  }, [allSorted, filterYear]);

  const intro =
    data.tagline ||
    entity.wikipedia?.lead?.split(/(?<=\.)\s+/).slice(0, 2).join(" ") ||
    entity.description ||
    `A chronological look at the life and career of ${entity.label}.`;

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const exploreChips = useMemo(() => {
    const chips: Array<{ label: string; action: () => void }> = [];
    if (entity.type === "person") {
      chips.push({
        label: `${entity.label}'s family tree`,
        action: () => onNavigate(`/family-tree/${entity.id}`),
      });
    }
    chips.push({
      label: `Knowledge graph for ${entity.label}`,
      action: () => onNavigate(`/graph/${entity.id}`),
    });
    chips.push({
      label: `Compare ${entity.label}`,
      action: () => onNavigate(`/compare/${entity.id}`),
    });
    return chips.slice(0, 3);
  }, [entity, onNavigate]);

  return (
    <div className="mx-auto max-w-3xl">
      {/* Status */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
          <Sparkles className="size-3 text-cyan-600" />
          AI Timeline
        </span>
        {isFetching && (
          <span className="text-[11px] text-slate-400">Polishing…</span>
        )}
        {!data.fallback && !isFetching && (
          <span className="text-[11px] text-emerald-700">AI polished</span>
        )}
        {(isError || data.fallback) && !isFetching && (
          <span className="text-[11px] text-amber-700">Local chronology</span>
        )}
      </div>

      {/* Gemini-style intro */}
      <p className="text-[15px] sm:text-[16px] leading-[1.7] text-slate-700">
        {intro}
      </p>

      {portraitUrl && (
        <figure className="mt-6 mb-8 flex flex-col items-center">
          <img
            src={portraitUrl}
            alt={entity.label}
            referrerPolicy="no-referrer"
            className="max-h-72 w-auto max-w-full rounded-xl object-cover object-top shadow-sm"
          />
          <figcaption className="mt-2 text-center text-[13px] text-slate-500">
            {entity.label}
            {entity.lifespan ? ` (${entity.lifespan})` : ""}
          </figcaption>
        </figure>
      )}

      {/* All | years */}
      {yearGroups.length > 0 && (
        <div className="mb-8 flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          <button
            type="button"
            onClick={() => setFilterYear(null)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium cursor-pointer transition",
              filterYear == null
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200",
            )}
          >
            All
          </button>
          {yearGroups.map((g) => (
            <button
              key={g.year}
              type="button"
              onClick={() => setFilterYear(g.year)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium tabular-nums cursor-pointer transition",
                filterYear === g.year
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200",
              )}
            >
              {g.year}
            </button>
          ))}
        </div>
      )}

      {/* Vertical spine timeline (Gemini) */}
      {visibleEvents.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">
          No timeline moments yet for this entity.
        </p>
      ) : (
        <ol className="relative ml-1 sm:ml-2">
          {/* continuous spine */}
          <div
            className="pointer-events-none absolute left-[5px] top-2 bottom-2 w-px bg-slate-300"
            aria-hidden
          />

          {visibleEvents.map((ev, i) => {
            const key = eventKey(ev);
            const isOpen = expanded.has(key);
            const bullets = detailBullets(entity, ev, data.eras, data.events);
            const showBullets = isOpen ? bullets : bullets.slice(0, 5);
            const hasMore =
              bullets.length > 5 ||
              Boolean(ev.detail && ev.detail.length > (ev.summary?.length ?? 0) + 40);

            return (
              <li key={key} className="relative pl-8 sm:pl-10 pb-8 last:pb-2">
                {/* hollow node */}
                <span
                  className="absolute left-0 top-1.5 size-[11px] rounded-full border-[1.5px] border-slate-400 bg-white"
                  aria-hidden
                />

                <button
                  type="button"
                  onClick={() => toggleExpand(key)}
                  className="w-full text-left cursor-pointer group"
                >
                  <h3 className="font-semibold text-[16px] sm:text-[17px] text-slate-900 leading-snug group-hover:text-slate-700">
                    {ev.title}
                  </h3>
                  <p className="mt-0.5 text-[13px] text-slate-500 tabular-nums">
                    {ev.year}
                  </p>
                </button>

                {(ev.summary || ev.detail) && (
                  <p className="mt-2 text-[14.5px] sm:text-[15px] leading-[1.65] text-slate-700">
                    {isOpen && ev.detail && ev.detail.length > (ev.summary?.length ?? 0)
                      ? ev.detail
                      : ev.summary || ev.detail}
                  </p>
                )}

                <AnimatePresence initial={false}>
                  {(showBullets.length > 0 || isOpen) && (
                    <motion.ul
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2.5 space-y-1.5 overflow-hidden pl-1"
                    >
                      {showBullets.map((b, bi) => (
                        <li
                          key={`${key}-b-${bi}`}
                          className="relative pl-4 text-[14px] leading-relaxed text-slate-600 before:absolute before:left-0 before:top-[0.55em] before:size-1.5 before:rounded-full before:bg-slate-400"
                        >
                          {b}
                        </li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>

                {hasMore && (
                  <button
                    type="button"
                    onClick={() => toggleExpand(key)}
                    className="mt-2 text-[13px] font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    {isOpen ? "Show less" : "Show more details"}
                  </button>
                )}

                {isOpen && ev.entityId?.startsWith("Q") && (
                  <button
                    type="button"
                    onClick={() => onNavigate(entityPath(ev.entityId!, ev.title))}
                    className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-cyan-700 hover:underline cursor-pointer"
                  >
                    Open linked entity <ChevronRight className="size-3.5" />
                  </button>
                )}

                {/* subtle year divider when year changes */}
                {i < visibleEvents.length - 1 &&
                  yearNum(ev) !== yearNum(visibleEvents[i + 1]!) &&
                  filterYear == null && (
                    <span className="sr-only">
                      Next year {visibleEvents[i + 1]!.year}
                    </span>
                  )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Explore more — Gemini suggestion chips */}
      {exploreChips.length > 0 && (
        <div className="mt-10 border-t border-slate-200 pt-6">
          <p className="mb-3 text-[14px] font-medium text-slate-700">
            Explore more about {entity.label}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {exploreChips.map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={chip.action}
                className="inline-flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-[14px] text-slate-700 shadow-sm hover:bg-slate-50 cursor-pointer transition"
              >
                <span>{chip.label}</span>
                <ChevronRight className="size-4 shrink-0 text-slate-400" />
              </button>
            ))}
          </div>
        </div>
      )}

      {data.legacy && (
        <p className="mt-8 text-[14px] leading-relaxed text-slate-500 italic">
          {data.legacy}
        </p>
      )}
    </div>
  );
}
