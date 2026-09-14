import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import {
  Award,
  BookOpen,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Clock,
  Heart,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils.ts";
import { entityPath } from "@/lib/entityPath.ts";
import {
  buildLocalNarrative,
  expandMomentDetail,
  fetchNarrativeTimeline,
} from "@/lib/ai/timeline.ts";
import type { EntitySummary, TimelineEvent, TimelineKind } from "@/lib/wikidata/types.ts";

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

const KIND_META: Record<
  TimelineKind,
  { label: string; icon: typeof Sparkles; tint: string }
> = {
  life: { label: "Life", icon: Heart, tint: "bg-rose-500/15 text-rose-200 border-rose-400/30" },
  career: { label: "Career", icon: Briefcase, tint: "bg-teal-500/15 text-teal-200 border-teal-400/30" },
  award: { label: "Award", icon: Award, tint: "bg-amber-500/15 text-amber-200 border-amber-400/30" },
  work: { label: "Work", icon: BookOpen, tint: "bg-sky-500/15 text-sky-200 border-sky-400/30" },
  tour: { label: "Tour", icon: Clock, tint: "bg-slate-500/15 text-slate-200 border-slate-400/30" },
  legacy: { label: "Legacy", icon: Sparkles, tint: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30" },
};

function MomentDepthFlyout({
  entity,
  event,
  eras,
  allEvents,
  onClose,
  onSelect,
  onNavigate,
}: {
  entity: EntitySummary;
  event: TimelineEvent;
  eras: Array<{ id: string; title: string; years: string; summary: string }>;
  allEvents: TimelineEvent[];
  onClose: () => void;
  onSelect: (ev: TimelineEvent) => void;
  onNavigate: (path: string) => void;
}) {
  const era = eras.find((e) => e.id === event.eraId);
  const pack = useMemo(
    () => expandMomentDetail(entity, event, era, allEvents),
    [entity, event, era, allEvents],
  );
  const meta = KIND_META[event.kind] ?? KIND_META.career;
  const KindIcon = meta.icon;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && pack.neighbors.prev) onSelect(pack.neighbors.prev);
      if (e.key === "ArrowRight" && pack.neighbors.next) onSelect(pack.neighbors.next);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, onSelect, pack.neighbors.prev, pack.neighbors.next]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[80] bg-slate-950/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <motion.aside
        key="panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Depth detail: ${event.title}`}
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="fixed inset-y-0 right-0 z-[90] flex w-full max-w-[440px] flex-col border-l border-white/10 bg-[#0b1524] text-slate-100 shadow-[-24px_0_60px_-20px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative shrink-0 overflow-hidden border-b border-white/10 px-5 pt-5 pb-4">
          <div
            className="pointer-events-none absolute inset-0 opacity-80"
            style={{
              background:
                "radial-gradient(ellipse 80% 70% at 100% 0%, rgba(45,212,191,0.18) 0%, transparent 55%)",
            }}
          />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]",
                    meta.tint,
                  )}
                >
                  <KindIcon className="size-3" />
                  {meta.label}
                </span>
                <span className="font-mono text-[12px] tabular-nums text-teal-200/85">
                  {event.year}
                </span>
              </div>
              <h2 className="font-serif text-[1.45rem] font-bold leading-snug tracking-tight text-white">
                {event.title}
              </h2>
              <p className="mt-1.5 text-[12px] text-slate-400 italic">{pack.scene}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/15 text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="relative mt-4 flex items-center gap-2">
            <button
              type="button"
              disabled={!pack.neighbors.prev}
              onClick={() => pack.neighbors.prev && onSelect(pack.neighbors.prev)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/12 px-2.5 py-1.5 text-[11px] text-slate-300 disabled:opacity-30 hover:bg-white/5 cursor-pointer disabled:cursor-default"
            >
              <ChevronLeft className="size-3.5" /> Prev
            </button>
            <button
              type="button"
              disabled={!pack.neighbors.next}
              onClick={() => pack.neighbors.next && onSelect(pack.neighbors.next)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/12 px-2.5 py-1.5 text-[11px] text-slate-300 disabled:opacity-30 hover:bg-white/5 cursor-pointer disabled:cursor-default"
            >
              Next <ChevronRight className="size-3.5" />
            </button>
            <span className="ml-auto text-[10px] text-slate-500">← → · Esc</span>
          </div>
        </div>

        {/* Scroll body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 space-y-6">
          <section>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-400/80 mb-2">
              The moment
            </p>
            <p className="text-[14.5px] leading-[1.75] text-slate-200">
              {pack.story}
            </p>
            {event.summary && event.summary !== pack.story && (
              <p className="mt-3 text-[13px] leading-relaxed text-slate-400 border-l-2 border-teal-400/30 pl-3">
                {event.summary}
              </p>
            )}
          </section>

          {pack.whyItMatters && (
            <section className="rounded-xl border border-teal-400/20 bg-teal-400/5 px-4 py-3.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-300/90 mb-1.5">
                Why it matters
              </p>
              <p className="text-[14px] leading-relaxed text-teal-50/95">
                {pack.whyItMatters}
              </p>
            </section>
          )}

          {(event.highlights?.length || pack.contextNotes.length > 0) && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2.5">
                Depth notes
              </p>
              <ul className="space-y-2">
                {[...(event.highlights ?? []), ...pack.contextNotes]
                  .filter((x, i, a) => x.trim() && a.indexOf(x) === i)
                  .slice(0, 12)
                  .map((note, i) => (
                    <li
                      key={`n-${i}`}
                      className="relative pl-3.5 text-[13.5px] leading-relaxed text-slate-300 before:absolute before:left-0 before:top-[0.55em] before:size-1.5 before:rounded-full before:bg-teal-400/70"
                    >
                      {note}
                    </li>
                  ))}
              </ul>
            </section>
          )}

          {pack.wikiExcerpts.length > 0 && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2.5">
                From the record
              </p>
              <div className="space-y-3">
                {pack.wikiExcerpts.map((w, i) => (
                  <blockquote
                    key={`w-${i}`}
                    className="rounded-lg border border-white/8 bg-white/[0.03] px-3.5 py-3"
                  >
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
                      {w.title}
                    </p>
                    <p className="text-[13px] leading-relaxed text-slate-300">
                      {w.excerpt}
                    </p>
                  </blockquote>
                ))}
              </div>
            </section>
          )}

          {era && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2">
                Chapter · {era.title}
              </p>
              <p className="text-[12px] font-mono text-teal-200/70 mb-1">{era.years}</p>
              {pack.eraSummary && (
                <p className="text-[13px] leading-relaxed text-slate-400">
                  {pack.eraSummary}
                </p>
              )}
            </section>
          )}

          {pack.sameYear.length > 0 && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2.5">
                Also in {event.year}
              </p>
              <div className="flex flex-col gap-1.5">
                {pack.sameYear.map((r) => (
                  <button
                    key={eventKey(r)}
                    type="button"
                    onClick={() => onSelect(r)}
                    className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-[13px] text-slate-200 hover:border-teal-400/35 hover:bg-white/[0.06] cursor-pointer"
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            </section>
          )}

          {pack.related.length > 0 && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 mb-2.5">
                Same chapter
              </p>
              <div className="flex flex-col gap-1.5">
                {pack.related.slice(0, 5).map((r) => (
                  <button
                    key={eventKey(r)}
                    type="button"
                    onClick={() => onSelect(r)}
                    className="flex items-baseline justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-left hover:border-teal-400/35 cursor-pointer"
                  >
                    <span className="text-[13px] text-slate-200 truncate">{r.title}</span>
                    <span className="font-mono text-[11px] text-slate-500 shrink-0">
                      {r.year}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer CTAs */}
        <div className="shrink-0 border-t border-white/10 px-5 py-3.5 flex flex-wrap gap-2 bg-[#09121f]">
          {event.entityId?.startsWith("Q") && (
            <button
              type="button"
              onClick={() => onNavigate(entityPath(event.entityId!, event.title))}
              className="inline-flex items-center gap-1 rounded-lg bg-teal-400 px-3 py-2 text-[12px] font-semibold text-slate-950 cursor-pointer hover:bg-teal-300"
            >
              Open linked entity <ChevronRight className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onNavigate(`/graph/${entity.id}`)}
            className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-2 text-[12px] text-slate-200 hover:bg-white/5 cursor-pointer"
          >
            Knowledge graph
          </button>
          {entity.type === "person" && (
            <button
              type="button"
              onClick={() => onNavigate(`/family-tree/${entity.id}`)}
              className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-3 py-2 text-[12px] text-slate-200 hover:bg-white/5 cursor-pointer"
            >
              Family tree
            </button>
          )}
        </div>
      </motion.aside>
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Gemini-style AI Timeline with a right-side depth flyout on header click.
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
      "v12-depth-flyout",
    ],
    queryFn: () => fetchNarrativeTimeline(entity),
    placeholderData: local,
    staleTime: 1000 * 60 * 60,
    retry: 0,
  });

  const data = narrative ?? local;
  const [filterYear, setFilterYear] = useState<string | null>(null);
  const [active, setActive] = useState<TimelineEvent | null>(null);

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
        <span className="text-[11px] text-slate-400">
          Click a title for depth
        </span>
      </div>

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

      {visibleEvents.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">
          No timeline moments yet for this entity.
        </p>
      ) : (
        <ol className="relative ml-1 sm:ml-2">
          <div
            className="pointer-events-none absolute left-[5px] top-2 bottom-2 w-px bg-slate-300"
            aria-hidden
          />

          {visibleEvents.map((ev, i) => {
            const key = eventKey(ev);
            const selected = active && eventKey(active) === key;
            const bullets = (ev.highlights ?? []).slice(0, 3);

            return (
              <li key={key} className="relative pl-8 sm:pl-10 pb-8 last:pb-2">
                <span
                  className={cn(
                    "absolute left-0 top-1.5 size-[11px] rounded-full border-[1.5px] bg-white transition-colors",
                    selected ? "border-teal-500 ring-4 ring-teal-500/20" : "border-slate-400",
                  )}
                  aria-hidden
                />

                <button
                  type="button"
                  onClick={() => setActive(ev)}
                  className="w-full text-left cursor-pointer group"
                >
                  <h3
                    className={cn(
                      "font-semibold text-[16px] sm:text-[17px] leading-snug transition-colors",
                      selected
                        ? "text-teal-800"
                        : "text-slate-900 group-hover:text-teal-700",
                    )}
                  >
                    {ev.title}
                  </h3>
                  <p className="mt-0.5 text-[13px] text-slate-500 tabular-nums">
                    {ev.year}
                    <span className="ml-2 text-[11px] text-teal-600/80 opacity-0 group-hover:opacity-100 transition-opacity">
                      Open depth →
                    </span>
                  </p>
                </button>

                {ev.summary && (
                  <p className="mt-2 text-[14.5px] sm:text-[15px] leading-[1.65] text-slate-700">
                    {ev.summary}
                  </p>
                )}

                {bullets.length > 0 && (
                  <ul className="mt-2.5 space-y-1.5 pl-1">
                    {bullets.map((b, bi) => (
                      <li
                        key={`${key}-b-${bi}`}
                        className="relative pl-4 text-[14px] leading-relaxed text-slate-600 before:absolute before:left-0 before:top-[0.55em] before:size-1.5 before:rounded-full before:bg-slate-400"
                      >
                        {b}
                      </li>
                    ))}
                  </ul>
                )}

                <button
                  type="button"
                  onClick={() => setActive(ev)}
                  className="mt-2 text-[13px] font-medium text-teal-700 hover:text-teal-900 cursor-pointer"
                >
                  More depth
                </button>

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

      <AnimatePresence>
        {active && (
          <MomentDepthFlyout
            entity={entity}
            event={active}
            eras={data.eras}
            allEvents={allSorted}
            onClose={() => setActive(null)}
            onSelect={setActive}
            onNavigate={onNavigate}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
