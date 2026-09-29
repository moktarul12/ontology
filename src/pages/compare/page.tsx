import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce.ts";
import {
  fetchCompareAwardHighlights,
  fetchCompareCareerStats,
  fetchCompareHighlightFilms,
  fetchComparePeers,
  fetchEntitySummary,
  searchEntities,
  type CompareAwardHighlights,
  type CompareCareerStats,
} from "@/lib/wikidata/api.ts";
import { entityPath, parseEntityParam, slugifyLabel } from "@/lib/entityPath.ts";
import {
  buildLocalCompareBrief,
  fetchCompareEnrichment,
  orgCompareStats,
  type CompareBrief,
  type CompareContrast,
} from "@/lib/ai/compare.ts";
import {
  ArrowLeft,
  ArrowLeftRight,
  Award,
  BookOpen,
  Building2,
  Check,
  Copy,
  Film,
  GitCompareArrows,
  Heart,
  LayoutGrid,
  Loader2,
  Mic2,
  Music2,
  Network,
  Package,
  Play,
  RefreshCw,
  Route,
  Search,
  Share2,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils.ts";
import type { EntitySummary, SearchResult } from "@/lib/wikidata/types.ts";

/* ── palette (mockup) ───────────────────────────────────────────────────── */
const GOLD = {
  soft: "bg-[#fff8e1]",
  border: "border-[#f5d76e]/80",
  text: "text-[#b8860b]",
  solid: "bg-[#f5c518]",
  ring: "ring-[#f5c518]",
  chip: "bg-[#f5c518]/20 text-[#8a6a00]",
};
const BLUE = {
  soft: "bg-[#e8f1fb]",
  border: "border-[#7eb6e8]/70",
  text: "text-[#1a5f9e]",
  solid: "bg-[#1e6bb8]",
  ring: "ring-[#1e6bb8]",
  chip: "bg-[#1e6bb8]/15 text-[#1a5f9e]",
};

type NavSection = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const PERSON_SECTIONS: NavSection[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "career", label: "Career & Journey", icon: Route },
  { id: "awards", label: "Awards & Recognitions", icon: Award },
  { id: "films", label: "Top Films & Highlights", icon: Film },
  { id: "songs", label: "Songs & Music Style", icon: Music2 },
  { id: "shared", label: "Shared Traits", icon: Heart },
];

const ORG_SECTIONS: NavSection[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "career", label: "Business Model", icon: Building2 },
  { id: "products", label: "Products & Services", icon: Package },
  { id: "shared", label: "People & Culture", icon: Heart },
  { id: "leadership", label: "Leadership", icon: Users },
];

function CompareAtmosphere({
  leftThumb,
  rightThumb,
  mood,
}: {
  leftThumb?: string;
  rightThumb?: string;
  mood: "music" | "film" | "org" | "default";
}) {
  return (
    <div className="cmp-atmosphere" aria-hidden>
      <div className="cmp-atmosphere-base" />
      <div className="cmp-orb cmp-orb-gold" />
      <div className="cmp-orb cmp-orb-blue" />
      <div className="cmp-orb cmp-orb-warm" />

      {leftThumb && (
        <div className="cmp-portrait cmp-portrait-left">
          <img src={leftThumb} alt="" />
        </div>
      )}
      {rightThumb && (
        <div className="cmp-portrait cmp-portrait-right">
          <img src={rightThumb} alt="" />
        </div>
      )}

      <div className="cmp-mesh" />
      <div className="cmp-grain" />

      {mood === "music" && (
        <div className="cmp-notes">
          {Array.from({ length: 8 }).map((_, i) => (
            <span key={i} className="cmp-note" style={{ ["--i" as string]: i }} />
          ))}
        </div>
      )}
      {mood === "film" && (
        <div className="cmp-frames">
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className="cmp-frame" style={{ ["--i" as string]: i }} />
          ))}
        </div>
      )}
      {mood === "org" && (
        <div className="cmp-gridlines" />
      )}

      <div className="cmp-vignette" />
    </div>
  );
}

function pick(entity: EntitySummary | undefined, pid: string) {
  return entity?.facts.find((f) => f.propertyId === pid)?.values.map((v) => v.label).join(" · ") ?? "—";
}

function pickList(entity: EntitySummary | undefined, pid: string, max = 4) {
  const vals = entity?.facts.find((f) => f.propertyId === pid)?.values.map((v) => v.label) ?? [];
  if (!vals.length) return "—";
  const shown = vals.slice(0, max);
  return vals.length > max ? `${shown.join(" · ")} +${vals.length - max}` : shown.join(" · ");
}

function occupationsOf(entity: EntitySummary | undefined): string[] {
  return entity?.facts.find((f) => f.propertyId === "P106")?.values.map((v) => v.label) ?? [];
}

function yearFrom(label?: string): number | null {
  const m = label?.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function extractQuote(text: string, fallback: string): string {
  const m = text.match(/[“"]([^”"]{24,140})[”"]/);
  if (m?.[1]) return m[1].trim();
  const sentence = text.split(/(?<=[.!?])\s+/).find((s) => s.length > 40 && s.length < 160);
  return sentence?.replace(/^["']|["']$/g, "").trim() || fallback;
}

function awardCount(entity?: EntitySummary) {
  return entity?.facts.find((f) => f.propertyId === "P166")?.values.length ?? 0;
}

function craftTitle(entity?: EntitySummary, angle?: string): string {
  if (angle && angle.length < 48) return angle.replace(/\.$/, "");
  if (entity?.type === "organization") {
    const industry =
      entity.facts.find((f) => f.propertyId === "P452")?.values[0]?.label;
    if (industry) return industry;
    return entity.description?.split(",")[0]?.trim() || "Company at scale";
  }
  const occ = occupationsOf(entity);
  const desc = entity?.description ?? "";
  if (occ.some((o) => /playback/i.test(o))) return "The Voice of a Generation";
  if (occ.some((o) => /actress/i.test(o)) || /actress/i.test(desc)) {
    return "A Life on Screen";
  }
  if (occ.some((o) => /actor/i.test(o)) && occ.some((o) => /singer/i.test(o))) {
    return "The Versatile Legend";
  }
  if (occ.some((o) => /actor/i.test(o))) return "A Life on Screen";
  if (occ.some((o) => /singer/i.test(o))) return "The Voice of a Generation";
  if (occ[0]) return `The ${occ[0]}`;
  return entity?.description?.split(",")[0]?.trim() || "Legend";
}

function SuggestionRow({
  r,
  selected,
  onPick,
}: {
  r: SearchResult;
  selected?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer",
        selected ? "bg-amber-50 ring-1 ring-amber-200" : "hover:bg-slate-50",
      )}
    >
      {r.thumbnail ? (
        <img src={r.thumbnail} alt="" className="size-10 rounded-lg object-cover object-top shrink-0" />
      ) : (
        <span className="size-10 rounded-lg bg-slate-100 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900 truncate">{r.label}</span>
        {r.description && (
          <span className="block text-[11px] text-slate-500 truncate">{r.description}</span>
        )}
      </span>
      {selected && <Check className="size-4 text-amber-600 shrink-0" />}
    </button>
  );
}

function FindMatchBody({
  query,
  setQuery,
  results,
  showSearchHits,
  searchFetching,
  peerCategory,
  peerList,
  peersFetching,
  otherId,
  onPick,
  onClearQuery,
  onEnterPick,
  compact,
}: {
  query: string;
  setQuery: (v: string) => void;
  results: SearchResult[];
  showSearchHits: boolean;
  searchFetching: boolean;
  peerCategory: string;
  peerList: SearchResult[];
  peersFetching: boolean;
  otherId: string | null;
  onPick: (r: SearchResult) => void;
  onClearQuery: () => void;
  onEnterPick: () => void;
  compact?: boolean;
}) {
  return (
    <>
      <div className={cn("border-b border-slate-100", compact ? "p-3" : "p-4")}>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 focus-within:ring-2 focus-within:ring-sky-200">
          <Search className="size-4 text-slate-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEnterPick();
            }}
            placeholder="Search a match…"
            className="flex-1 bg-transparent outline-none text-sm min-w-0"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              onClick={onClearQuery}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-200/80 cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          )}
          {searchFetching && <Loader2 className="size-3.5 animate-spin text-slate-400" />}
        </div>
        {showSearchHits && (
          <ul className={cn("mt-2 overflow-y-auto space-y-0.5", compact ? "max-h-40" : "max-h-48")}>
            {results.map((r) => (
              <li key={r.id}>
                <SuggestionRow r={r} selected={r.id === otherId} onPick={() => onPick(r)} />
              </li>
            ))}
            {!searchFetching && results.length === 0 && (
              <li className="px-2 py-3 text-xs text-slate-500">No matches</li>
            )}
          </ul>
        )}
      </div>
      <div className={cn(compact ? "px-3 pt-3 pb-2" : "px-4 pt-3 pb-3")}>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 px-1 mb-2">
          {peerCategory}
          {peerList.length > 0 ? ` · ${peerList.length}` : ""}
        </p>
        {peersFetching && peerList.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-4 text-xs text-slate-500">
            <Loader2 className="size-3.5 animate-spin" /> Finding peers…
          </div>
        ) : peerList.length === 0 ? (
          <p className="px-2 py-3 text-xs text-slate-500">Search above to find a peer.</p>
        ) : (
          <ul
            className={cn(
              "overflow-y-auto space-y-0.5 pb-1",
              compact ? "max-h-[min(22rem,40vh)]" : "max-h-[min(36rem,58vh)]",
            )}
          >
            {peerList.map((r) => (
              <li key={r.id}>
                <SuggestionRow r={r} selected={r.id === otherId} onPick={() => onPick(r)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** Mobile sticky chips — desktop aside lives in the main flex row */
function QuickNavChips({
  activeId,
  onJump,
  sections,
}: {
  activeId: string;
  onJump: (id: string) => void;
  sections: NavSection[];
}) {
  return (
    <nav
      aria-label="Compare sections"
      className="lg:hidden sticky top-[3.25rem] z-30 -mx-4 px-4 py-2.5 bg-[#f7f4ec]/95 backdrop-blur-md border-b border-slate-200/70"
    >
      <ul className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((s) => {
          const Icon = s.icon;
          const on = activeId === s.id;
          return (
            <li key={s.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onJump(s.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold cursor-pointer transition-colors",
                  on
                    ? "bg-[#1a3a5c] text-white shadow-sm"
                    : "bg-white text-slate-600 border border-slate-200 hover:border-slate-300",
                )}
              >
                <Icon className="size-3" />
                {s.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function QuickNavAside({
  activeId,
  onJump,
  sections,
}: {
  activeId: string;
  onJump: (id: string) => void;
  sections: NavSection[];
}) {
  return (
    <aside className="hidden lg:block w-[13.5rem] shrink-0">
      <div className="sticky top-24 rounded-2xl border border-[#cfe0f0] bg-gradient-to-b from-[#eef5fb] to-white shadow-sm overflow-hidden">
        <div className="px-4 py-3.5 border-b border-[#d7e6f4]">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#1a5f9e]">
            Quick Nav
          </p>
        </div>
        <ul className="p-2 space-y-0.5">
          {sections.map((s) => {
            const Icon = s.icon;
            const on = activeId === s.id;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onJump(s.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[12px] font-semibold cursor-pointer transition-all",
                    on
                      ? "bg-[#1a3a5c] text-white shadow-md shadow-slate-900/10"
                      : "text-slate-600 hover:bg-white hover:text-slate-900",
                  )}
                >
                  <Icon className={cn("size-3.5 shrink-0", on ? "text-amber-300" : "text-slate-400")} />
                  <span className="leading-snug">{s.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="px-4 py-4 text-[11px] italic text-slate-400 border-t border-[#d7e6f4] leading-relaxed">
          {sections.some((s) => s.id === "career" && /Business/i.test(s.label))
            ? "“Two giants, one retail map.”"
            : sections.some((s) => s.id === "songs")
              ? "“Two voices, one golden era.”"
              : "“Two screens, one golden era.”"}
        </p>
      </div>
    </aside>
  );
}

function HeroPortrait({
  entity,
  quote,
  accent,
  loading,
  empty,
}: {
  entity?: EntitySummary;
  quote: string;
  accent: "gold" | "blue";
  loading?: boolean;
  empty?: ReactNode;
}) {
  const tone = accent === "gold" ? GOLD : BLUE;
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <div className={cn("size-36 md:size-44 rounded-full animate-pulse", tone.soft)} />
        <Loader2 className="size-4 animate-spin text-slate-400" />
      </div>
    );
  }
  if (!entity) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center text-sm text-slate-500">
        {empty}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center text-center max-w-[16rem] mx-auto">
      <div
        className={cn(
          "relative size-36 md:size-44 rounded-full overflow-hidden shadow-xl ring-4 ring-white",
          accent === "gold" ? "shadow-amber-900/15" : "shadow-sky-900/15",
        )}
      >
        <div className={cn("absolute inset-0", tone.soft)} />
        {entity.thumbnail ? (
          <img
            src={entity.thumbnail}
            alt=""
            className={cn(
              "relative size-full",
              entity.type === "organization"
                ? "object-contain bg-white p-4"
                : "object-cover object-top",
            )}
          />
        ) : null}
      </div>
      <p
        className={cn(
          "mt-4 text-[13px] md:text-[14px] italic leading-snug font-serif",
          tone.text,
        )}
      >
        “{quote}”
      </p>
      <p
        className={cn(
          "mt-2 text-[15px] font-semibold tracking-wide",
          tone.text,
        )}
        style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontStyle: "italic" }}
      >
        {entity.label}
      </p>
    </div>
  );
}

function ProfileCard({
  entity,
  accent,
  title,
  career,
  awardHighlights,
  loadingAi,
  headerAction,
}: {
  entity: EntitySummary;
  accent: "gold" | "blue";
  title: string;
  career?: CompareCareerStats | null;
  awardHighlights?: CompareAwardHighlights | null;
  loadingAi?: boolean;
  headerAction?: ReactNode;
}) {
  const tone = accent === "gold" ? GOLD : BLUE;
  const isOrg = entity.type === "organization";
  const occ = occupationsOf(entity);
  const isSinger = occ.some((o) => /singer|vocalist|playback/i.test(o));
  const isActor =
    occ.some((o) => /actor|actress/i.test(o)) ||
    /actress|actor/i.test(entity.description ?? "");
  const songs = career?.recordedWorks;
  const filmfareN = awardHighlights?.filmfareWins.length ?? 0;
  const awards = filmfareN || awardCount(entity);
  const filmsN =
    awardHighlights?.filmHighlights?.length ||
    career?.filmCredits ||
    null;
  const span =
    career?.firstSinging && career?.lastSinging
      ? `${career.firstSinging.year}–${career.lastSinging.year}`
      : entity.lifespan?.replace(/[–-]/g, "–") || "—";
  const stats = isOrg
    ? orgCompareStats(entity)
    : isSinger && !isActor
      ? [
          { label: "Songs", value: songs != null ? `${songs}+` : "—" },
          {
            label: filmfareN ? "Filmfare" : "Awards",
            value: awards ? String(awards) : "—",
          },
          { label: "Years Active", value: span },
        ]
      : isActor
        ? [
            {
              label: "Films",
              value: filmsN != null ? `${filmsN}+` : "—",
            },
            {
              label: filmfareN ? "Filmfare" : "Awards",
              value: awards ? String(awards) : "—",
            },
            { label: "Years Active", value: span },
          ]
        : [
            {
              label: filmfareN ? "Filmfare" : "Awards",
              value: awards ? String(awards) : "—",
            },
            { label: "Works", value: songs != null ? `${songs}+` : "—" },
            { label: "Years Active", value: span },
          ];

  return (
    <article
      className={cn(
        "relative rounded-2xl border bg-white overflow-hidden shadow-sm",
        tone.border,
      )}
    >
      {headerAction && (
        <div className="absolute top-3 right-3 z-10">{headerAction}</div>
      )}
      <div className={cn("p-4 sm:p-5", tone.soft)}>
        <div className="flex items-start gap-3.5">
          {entity.thumbnail ? (
            <img
              src={entity.thumbnail}
              alt=""
              className={cn(
                "size-16 sm:size-[4.5rem] rounded-full shrink-0 ring-[3px] ring-white shadow-md",
                isOrg ? "object-contain bg-white p-1.5" : "object-cover object-top",
              )}
            />
          ) : (
            <div className="size-16 rounded-full bg-white/80 shrink-0 grid place-items-center">
              {isOrg ? <Building2 className="size-6 text-slate-300" /> : null}
            </div>
          )}
          <div className={cn("min-w-0 flex-1", headerAction && "pr-20")}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-bold text-[1.15rem] text-slate-900 leading-tight">{entity.label}</h3>
              {loadingAi && (
                <Loader2 className="size-3.5 animate-spin text-slate-400 shrink-0 mt-1" />
              )}
            </div>
            <p className="mt-0.5 text-[12px] text-slate-600 line-clamp-2">
              {entity.description || entity.id}
            </p>
            <p className={cn("mt-2 text-[13px] font-semibold italic", tone.text)}>{title}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl bg-white/80 border border-white/90 px-2 py-2.5 text-center shadow-sm"
            >
              <p className="text-[15px] sm:text-base font-bold text-slate-900 tabular-nums leading-none">
                {s.value}
              </p>
              <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                {s.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function CompareTable({
  leftLabel,
  rightLabel,
  rows,
}: {
  leftLabel: string;
  rightLabel: string;
  rows: CompareContrast[];
}) {
  if (!rows.length) return null;
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden">
      <div className="grid grid-cols-[1fr_minmax(7rem,9.5rem)_1fr] border-b border-slate-100 bg-slate-50/80">
        <div className="px-3 py-3 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#b8860b]">
            {leftLabel}
          </p>
        </div>
        <div className="px-2 py-3 text-center border-x border-slate-100">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Attribute
          </p>
        </div>
        <div className="px-3 py-3 text-center">
          <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#1a5f9e]">
            {rightLabel}
          </p>
        </div>
      </div>
      <ul>
        {rows.map((r) => (
          <li
            key={r.label}
            className="grid grid-cols-[1fr_minmax(7rem,9.5rem)_1fr] border-b border-slate-100 last:border-0"
          >
            <div className="px-3 sm:px-4 py-3.5 text-center sm:text-left">
              <p className="text-[13px] font-medium text-slate-800 leading-snug">{r.left || "—"}</p>
            </div>
            <div className="px-2 py-3.5 flex items-center justify-center border-x border-slate-100 bg-[#fafbfc]">
              <p className="text-[10px] sm:text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 text-center leading-snug">
                {r.label}
              </p>
            </div>
            <div className="px-3 sm:px-4 py-3.5 text-center sm:text-right">
              <p className="text-[13px] font-medium text-slate-800 leading-snug">{r.right || "—"}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilmGrid({
  entity,
  highlights,
  accent,
}: {
  entity?: EntitySummary;
  highlights?: CompareAwardHighlights | null;
  accent: "gold" | "blue";
}) {
  const tone = accent === "gold" ? GOLD : BLUE;
  const cards = highlights?.filmHighlights ?? [];
  const isPlayback = Boolean(highlights?.filmfareWins.some((w) => w.song));
  return (
    <div className={cn("rounded-2xl border bg-white p-4 shadow-sm", tone.border)}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2.5 min-w-0">
          {entity?.thumbnail && (
            <img
              src={entity.thumbnail}
              alt=""
              className="size-7 rounded-full object-cover object-top shrink-0"
            />
          )}
          <p className={cn("text-[12px] font-bold truncate leading-none", tone.text)}>
            {entity?.label ?? "—"}
          </p>
        </div>
        {highlights?.filmfareWins.length ? (
          <span className={cn("text-[10px] font-semibold shrink-0", tone.text)}>
            {highlights.filmfareWins.length} Filmfare wins
          </span>
        ) : null}
      </div>
      <p className="text-[11px] text-slate-500 mb-3">
        {isPlayback
          ? "Iconic film associations via award-winning songs"
          : "Standout films and award-winning roles"}
      </p>
      {cards.length === 0 ? (
        <p className="text-[13px] text-slate-500 py-6 text-center">
          No film highlights found yet.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {cards.slice(0, 6).map((f) => (
            <div key={`${f.film}-${f.year ?? ""}`} className="min-w-0">
              <p className={cn("text-[11px] font-bold mb-1.5 leading-snug line-clamp-2", tone.text)}>
                {f.year != null ? `${f.year} — ${f.film}` : f.film}
              </p>
              <div className="aspect-[2/3] overflow-hidden rounded-lg bg-slate-100 border border-slate-200/80 relative">
                {f.thumbnail ? (
                  <img
                    src={f.thumbnail}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="absolute inset-0 grid place-items-center">
                    <Film className="size-5 text-slate-400" />
                  </div>
                )}
              </div>
              {f.song ? (
                <p className="mt-1.5 text-[10px] text-slate-500 line-clamp-2 italic leading-snug">
                  {f.song}
                </p>
              ) : null}
              {f.note ? (
                <p className={cn("mt-0.5 text-[9px] font-semibold uppercase tracking-wide", tone.text)}>
                  {f.note}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AwardsPanel({
  entity,
  highlights,
  accent,
}: {
  entity?: EntitySummary;
  highlights?: CompareAwardHighlights | null;
  accent: "gold" | "blue";
}) {
  const tone = accent === "gold" ? GOLD : BLUE;
  const wins = highlights?.filmfareWins ?? [];
  const other = highlights?.otherRecognition ?? [];
  const wdAwards = [...(entity?.facts.find((f) => f.propertyId === "P166")?.values ?? [])].sort(
    (a, b) => (b.year ?? 0) - (a.year ?? 0),
  );

  const showFilmfare = wins.length > 0;
  const showWdFallback = !showFilmfare && wdAwards.length > 0;
  const categoryLabel =
    highlights?.filmfareCategory ||
    (wins.some((w) => w.song) ? "Best Male Playback Singer" : "Filmfare Awards");

  return (
    <div className={cn("rounded-2xl border bg-white p-4 shadow-sm h-full flex flex-col", tone.border)}>
      <div className="flex items-center gap-2 mb-3">
        <Award className={cn("size-4 shrink-0", tone.text)} />
        <p className={cn("text-[12px] font-bold leading-none", tone.text)}>{entity?.label ?? "—"}</p>
      </div>

      {showFilmfare && (
        <div className="mb-4">
          <div className="flex items-baseline gap-2 mb-2">
            <p className="text-[18px] font-bold text-slate-900 tabular-nums">
              {wins.length}×
            </p>
            <div>
              <p className="text-[12px] font-bold text-slate-800 leading-tight">Filmfare Awards</p>
              <p className="text-[10px] text-slate-500">{categoryLabel}</p>
            </div>
          </div>
          <ul className="space-y-2 max-h-[18rem] overflow-y-auto pr-1">
            {wins.map((w) => {
              const secondary = w.song
                ? w.film
                : w.category && w.category !== categoryLabel
                  ? w.category
                  : undefined;
              return (
                <li
                  key={`${w.year}-${w.song ?? ""}-${w.film}-${w.category ?? ""}`}
                  className="text-[12px] border-b border-slate-100 last:border-0 pb-2 last:pb-0"
                >
                  <p className="font-medium text-slate-800 leading-snug">
                    <span className={cn("font-bold tabular-nums", tone.text)}>{w.year}</span>
                    {" — "}
                    {w.song || w.film}
                  </p>
                  {secondary ? (
                    <p className="mt-0.5 text-[11px] text-slate-500 truncate">{secondary}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {showWdFallback && (
        <ul className="space-y-2.5 mb-3">
          {wdAwards.slice(0, 8).map((a, i) => (
            <li
              key={`${a.id ?? a.label}-${a.year ?? i}`}
              className="flex gap-2.5 text-[13px] text-slate-700 items-start"
            >
              <Star className={cn("size-3.5 shrink-0 mt-0.5", tone.text)} />
              <span className="min-w-0 flex-1 leading-snug">
                {a.label}
                {a.year != null && (
                  <span className={cn("ml-1.5 tabular-nums font-semibold", tone.text)}>
                    ({a.year})
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {other.length > 0 && (
        <div className={cn(showFilmfare || showWdFallback ? "border-t border-slate-100 pt-3 mt-auto" : "")}>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-2">
            Other recognition
          </p>
          <ul className="space-y-1.5">
            {other.slice(0, 5).map((t) => (
              <li key={t} className="flex gap-2 text-[12px] text-slate-600 leading-snug">
                <span className={cn("mt-1 size-1.5 rounded-full shrink-0", tone.solid)} />
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!showFilmfare && !showWdFallback && other.length === 0 && (
        <p className="text-[13px] text-slate-500">No awards listed yet.</p>
      )}
    </div>
  );
}

function SharedTraitsStrip({ traits }: { traits: string[] }) {
  const icons = [Users, Mic2, Sparkles, Heart, Star];
  const items = traits.slice(0, 5);
  if (!items.length) return null;
  return (
    <div className="rounded-2xl border border-amber-200/60 bg-gradient-to-br from-[#fbf6e8] via-white to-[#eef5fb] p-5 sm:p-6 shadow-sm">
      <p className="text-center text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 mb-5">
        Shared Traits & Common Ground
      </p>
      <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {items.map((t, i) => {
          const Icon = icons[i % icons.length]!;
          return (
            <li
              key={t}
              className="rounded-xl bg-white/90 border border-slate-200/80 px-3 py-4 text-center shadow-sm"
            >
              <span className="mx-auto mb-2 flex size-9 items-center justify-center rounded-full bg-[#1a3a5c]/90 text-amber-300">
                <Icon className="size-4" />
              </span>
              <p className="text-[12px] font-semibold text-slate-800 leading-snug">{t}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OrgInsightPanels({
  overlap,
  differences,
  leadership,
}: {
  overlap: string[];
  differences?: string[];
  leadership?: string[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-2xl border border-sky-200/70 bg-[#eef5fb] p-4 sm:p-5 shadow-sm">
        <p className="flex items-center gap-2 text-[12px] font-bold text-[#1a5f9e] mb-3">
          <Heart className="size-3.5" />
          Common Ground
        </p>
        <ul className="space-y-2">
          {overlap.slice(0, 5).map((t) => (
            <li key={t} className="flex gap-2 text-[12px] text-slate-700 leading-snug">
              <span className="mt-1.5 size-1.5 rounded-full bg-[#1e6bb8] shrink-0" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
        <p className="flex items-center gap-2 text-[12px] font-bold text-slate-800 mb-3">
          <ArrowLeftRight className="size-3.5 text-slate-500" />
          Key Differences
        </p>
        <ul className="space-y-2.5">
          {(differences?.length ? differences : ["Different industry focus and product mix"]).map(
            (t) => (
              <li key={t} className="text-[12px] text-slate-700 leading-snug">
                {t}
              </li>
            ),
          )}
        </ul>
      </div>
      <div className="rounded-2xl border border-sky-200/70 bg-[#eef5fb] p-4 sm:p-5 shadow-sm">
        <p className="flex items-center gap-2 text-[12px] font-bold text-[#1a5f9e] mb-3">
          <Users className="size-3.5" />
          Leadership / Careers
        </p>
        <ul className="space-y-2">
          {(leadership?.length
            ? leadership
            : ["Both have established leadership teams"]
          ).map((t) => (
            <li key={t} className="flex gap-2 text-[12px] text-slate-700 leading-snug">
              <span className="mt-1.5 size-1.5 rounded-full bg-[#1e6bb8] shrink-0" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function JourneySection({
  left,
  right,
  brief,
  leftCareer,
  rightCareer,
}: {
  left: EntitySummary;
  right?: EntitySummary;
  brief?: CompareBrief | null;
  leftCareer?: CompareCareerStats | null;
  rightCareer?: CompareCareerStats | null;
}) {
  const bothOrgs =
    left.type === "organization" && (!right || right.type === "organization");
  const bothActors =
    !bothOrgs &&
    [left, right].every((e) => {
      if (!e) return false;
      const occ = e.facts.find((f) => f.propertyId === "P106")?.values.map((v) => v.label) ?? [];
      return (
        occ.some((o) => /actor|actress/i.test(o)) ||
        /actress|actor/i.test(e.description ?? "")
      );
    });
  const moments: Array<{ year: string; label: string }> = [];

  if (bothOrgs) {
    for (const side of [right, left].filter(Boolean) as EntitySummary[]) {
      const years = (side.facts.find((f) => f.propertyId === "P571")?.values ?? [])
        .map((v) => yearFrom(v.label))
        .filter((y): y is number => y != null)
        .sort((a, b) => a - b);
      if (years[0]) {
        moments.push({ year: String(years[0]), label: `${side.label} founded` });
      }
      if (years.length > 1 && years[years.length - 1] !== years[0]) {
        moments.push({
          year: String(years[years.length - 1]),
          label: `${side.label} modern brand`,
        });
      }
    }
  } else {
    const lb = yearFrom(pick(left, "P569"));
    const rb = right ? yearFrom(pick(right, "P569")) : null;
    if (rb) moments.push({ year: String(rb), label: `${right!.label} born` });
    if (lb) moments.push({ year: String(lb), label: `${left.label} born` });
    if (rightCareer?.firstSinging) {
      moments.push({
        year: String(rightCareer.firstSinging.year),
        label: `${right!.label} first credit`,
      });
    }
    if (leftCareer?.firstSinging) {
      moments.push({
        year: String(leftCareer.firstSinging.year),
        label: `${left.label} first credit`,
      });
    }
    const ld = yearFrom(pick(left, "P570"));
    const rd = right ? yearFrom(pick(right, "P570")) : null;
    if (rd) moments.push({ year: String(rd), label: `${right!.label} · final chapter` });
    if (ld) moments.push({ year: String(ld), label: `${left.label} · final chapter` });
  }

  const unique = moments
    .sort((a, b) => Number(a.year) - Number(b.year))
    .filter((m, i, arr) => arr.findIndex((x) => x.year === m.year && x.label === m.label) === i)
    .slice(0, 6);

  return (
    <section
      id="journey"
      className="relative overflow-hidden rounded-2xl bg-[#0e1624] text-white px-5 py-8 sm:px-8 sm:py-10"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.85fr)] items-start">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300/80">
            {bothOrgs ? "The Scale Story" : "The Journey Together"}
          </p>
          <h3 className="mt-2 font-serif text-xl font-bold text-white">
            {bothOrgs
              ? "Two chains, one map"
              : bothActors
                ? "Two screen eras"
                : "Two legends, one era"}
          </h3>
          <p className="mt-3 text-[13px] leading-relaxed text-slate-300">
            {brief?.verdict?.slice(0, 280) ||
              (bothOrgs
                ? `${left.label}${right ? ` and ${right.label}` : ""} — industry, founding, and scale from Wikidata.`
                : bothActors
                  ? `${left.label}${right ? ` and ${right.label}` : ""} — eras, roles, and Filmfare legacy side by side.`
                  : `${left.label}${right ? ` and ${right.label}` : ""} shaped playback forever — different paths, shared stardom.`)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 mb-4">
            Key Moments
          </p>
          <div className="relative">
            <div className="absolute left-0 right-0 top-[7px] h-px bg-gradient-to-r from-amber-400/20 via-amber-400/70 to-amber-400/20" />
            <ol className="grid grid-cols-2 sm:grid-cols-3 gap-4 relative">
              {unique.map((m) => (
                <li key={`${m.year}-${m.label}`}>
                  <span className="relative z-10 mb-2 block size-2 rounded-full bg-amber-400 ring-4 ring-[#0e1624]" />
                  <p className="text-sm font-bold text-amber-200">{m.year}</p>
                  <p className="mt-0.5 text-[11px] text-slate-400 leading-snug">{m.label}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="relative rounded-xl overflow-hidden border border-white/10 bg-white/5 min-h-[10rem]">
          <div className="absolute inset-0 flex">
            {left.thumbnail && (
              <img
                src={left.thumbnail}
                alt=""
                className={cn(
                  "w-1/2 opacity-90",
                  bothOrgs ? "object-contain bg-white/90 p-4" : "object-cover object-top",
                )}
              />
            )}
            {right?.thumbnail && (
              <img
                src={right.thumbnail}
                alt=""
                className={cn(
                  "w-1/2 opacity-90",
                  bothOrgs ? "object-contain bg-white/90 p-4" : "object-cover object-top",
                )}
              />
            )}
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-[#0e1624] via-transparent to-transparent" />
          <p
            className="absolute bottom-3 left-3 right-3 text-[12px] text-amber-100/90 italic"
            style={{ fontFamily: "Georgia, serif" }}
          >
            {bothOrgs
              ? "Scale never sleeps · their footprints still shape the aisle ♥"
              : bothActors
                ? "Legends never fade · their roles still live on screen ♥"
                : "Legends never fade · their songs still live ♥"}
          </p>
        </div>
      </div>
    </section>
  );
}

export default function ComparePage() {
  const { id: rawId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = useMemo(() => parseEntityParam(rawId ?? ""), [rawId]);
  const id = parsed.qid;
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced] = useDebounce(query, 400);
  const [otherId, setOtherId] = useState<string | null>(() => {
    const vs = searchParams.get("vs");
    return vs && /^Q\d+$/i.test(vs) ? vs.toUpperCase() : null;
  });
  const [activeSection, setActiveSection] = useState("overview");
  const mainRef = useRef<HTMLDivElement>(null);

  const left = useQuery({
    queryKey: ["entity", id],
    queryFn: () =>
      fetchEntitySummary(id!, {
        includeMainArticles: false,
        includeOtherLanguages: false,
      }),
    enabled: Boolean(id),
    staleTime: 1000 * 60 * 30,
  });

  const right = useQuery({
    queryKey: ["entity", otherId],
    queryFn: () =>
      fetchEntitySummary(otherId!, {
        includeMainArticles: false,
        includeOtherLanguages: false,
      }),
    enabled: Boolean(otherId),
    staleTime: 1000 * 60 * 30,
  });

  const crafts = useMemo(() => occupationsOf(left.data), [left.data]);
  const [matchOpen, setMatchOpen] = useState(() => !otherId);

  useEffect(() => {
    if (!otherId) setMatchOpen(true);
    else setMatchOpen(false);
  }, [otherId]);

  const peers = useQuery({
    queryKey: ["compare-peers-v5", id],
    queryFn: () => fetchComparePeers(id!, 40),
    enabled: Boolean(id),
    staleTime: 1000 * 60 * 30,
  });

  const search = useQuery({
    queryKey: ["search", debounced, "compare"],
    queryFn: ({ signal }) => searchEntities(debounced, 14, signal),
    enabled: debounced.trim().length >= 2 && query.trim() === debounced.trim(),
  });

  const leftFilmsQ = useQuery({
    queryKey: ["compare-highlight-films-v5", id],
    queryFn: () => fetchCompareHighlightFilms(id!, 5),
    enabled: Boolean(id && left.data?.type === "person"),
    staleTime: 1000 * 60 * 30,
  });
  const rightFilmsQ = useQuery({
    queryKey: ["compare-highlight-films-v5", otherId],
    queryFn: () => fetchCompareHighlightFilms(otherId!, 5),
    enabled: Boolean(otherId && right.data?.type === "person"),
    staleTime: 1000 * 60 * 30,
  });

  const leftAwardsQ = useQuery({
    queryKey: [
      "compare-award-highlights-v3",
      id,
      left.data?.label,
      leftFilmsQ.dataUpdatedAt,
    ],
    queryFn: () =>
      fetchCompareAwardHighlights(id!, left.data!.label, {
        castFilms: leftFilmsQ.data,
      }),
    enabled: Boolean(id && left.data?.label && leftFilmsQ.isFetched),
    staleTime: 1000 * 60 * 60,
  });
  const rightAwardsQ = useQuery({
    queryKey: [
      "compare-award-highlights-v3",
      otherId,
      right.data?.label,
      rightFilmsQ.dataUpdatedAt,
    ],
    queryFn: () =>
      fetchCompareAwardHighlights(otherId!, right.data!.label, {
        castFilms: rightFilmsQ.data,
      }),
    enabled: Boolean(
      otherId &&
        right.data?.label &&
        rightFilmsQ.isFetched &&
        (leftAwardsQ.isFetched || !left.data),
    ),
    staleTime: 1000 * 60 * 60,
  });

  const leftCareerQ = useQuery({
    queryKey: ["compare-career-stats-v1", id],
    queryFn: () => fetchCompareCareerStats(id!),
    enabled: Boolean(id && left.data?.type === "person"),
    staleTime: 1000 * 60 * 60,
  });
  const rightCareerQ = useQuery({
    queryKey: ["compare-career-stats-v1", otherId],
    queryFn: () => fetchCompareCareerStats(otherId!),
    enabled: Boolean(
      otherId &&
        right.data?.type === "person" &&
        (left.data?.type !== "person" || leftCareerQ.isFetched),
    ),
    staleTime: 1000 * 60 * 60,
  });

  const careerPair = useMemo(
    () => ({
      left: leftCareerQ.data ?? null,
      right: rightCareerQ.data ?? null,
    }),
    [leftCareerQ.data, rightCareerQ.data],
  );

  const localBrief = useMemo(() => {
    if (!left.data || !right.data) return null;
    return buildLocalCompareBrief(left.data, right.data, careerPair);
  }, [left.data, right.data, careerPair]);

  const aiBrief = useQuery({
    queryKey: [
      "compare-ai-v7-org-retail",
      left.data?.id,
      right.data?.id,
      left.data?.type,
      right.data?.type,
      left.data?.wikipedia?.revisedAt ?? "",
      right.data?.wikipedia?.revisedAt ?? "",
      leftCareerQ.dataUpdatedAt,
      rightCareerQ.dataUpdatedAt,
    ],
    queryFn: () => fetchCompareEnrichment(left.data!, right.data!, careerPair),
    enabled: Boolean(
      left.data &&
        right.data &&
        (!left.data.type || left.data.type !== "person" || leftCareerQ.isFetched) &&
        (!right.data.type || right.data.type !== "person" || rightCareerQ.isFetched),
    ),
    placeholderData: localBrief ?? undefined,
    staleTime: 1000 * 60 * 60,
    retry: 0,
  });

  const brief = (aiBrief.data ?? localBrief) as CompareBrief | null;
  const peerList = peers.data?.peers ?? [];
  const peerCategory = peers.data?.categoryLabel ?? (
    crafts.length
      ? `Same category · ${crafts.slice(0, 2).join(", ")}`
      : `Same type · ${left.data?.type ?? "…"}`
  );

  const results = useMemo(
    () => (search.data ?? []).filter((r) => r.id !== id),
    [search.data, id],
  );
  const showSearchHits = query.trim().length >= 2;

  useEffect(() => {
    const current = searchParams.get("vs");
    if (otherId) {
      if (current !== otherId) setSearchParams({ vs: otherId }, { replace: true });
    } else if (current) {
      setSearchParams({}, { replace: true });
    }
  }, [otherId, searchParams, setSearchParams]);

  useEffect(() => {
    if (!id || !left.data || !rawId) return;
    const canonical = `${slugifyLabel(left.data.label)}-${id}`;
    if (rawId !== canonical && rawId !== id) {
      const vs = otherId ? `?vs=${otherId}` : "";
      navigate(`/compare/${canonical}${vs}`, { replace: true });
    } else if (rawId === id) {
      const vs = otherId ? `?vs=${otherId}` : "";
      navigate(`/compare/${canonical}${vs}`, { replace: true });
    }
  }, [id, left.data, rawId, otherId, navigate]);

  const bothOrgs =
    left.data?.type === "organization" &&
    (!right.data || right.data.type === "organization");
  const showPersonExtras =
    left.data?.type === "person" &&
    (!right.data || right.data.type === "person");

  const atmosphereMood = useMemo(() => {
    if (bothOrgs) return "org" as const;
    const singer = (e?: EntitySummary) =>
      occupationsOf(e).some((o) => /singer|vocalist|playback/i.test(o));
    const actor = (e?: EntitySummary) =>
      occupationsOf(e).some((o) => /actor|actress|film/i.test(o));
    if (singer(left.data) || singer(right.data)) return "music" as const;
    if (actor(left.data) || actor(right.data)) return "film" as const;
    return "default" as const;
  }, [bothOrgs, left.data, right.data]);

  const onSectionIntersect = useEffectEvent((entries: IntersectionObserverEntry[]) => {
    const visible = entries
      .filter((e) => e.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    const idAttr = visible[0]?.target.getAttribute("id");
    if (idAttr) setActiveSection(idAttr);
  });

  useEffect(() => {
    const root = mainRef.current;
    if (!root) return;
    const catalog = bothOrgs ? ORG_SECTIONS : PERSON_SECTIONS;
    const nodes = catalog.map((s) => root.querySelector(`#${s.id}`)).filter(
      (n): n is Element => Boolean(n),
    );
    if (!nodes.length) return;
    const io = new IntersectionObserver(onSectionIntersect, {
      rootMargin: "-20% 0px -55% 0px",
      threshold: [0.1, 0.35, 0.6],
    });
    for (const n of nodes) io.observe(n);
    return () => io.disconnect();
  }, [left.data, right.data, brief?.contrasts?.length, bothOrgs]);

  const jumpTo = (sectionId: string) => {
    const el = document.getElementById(sectionId);
    if (!el) return;
    setActiveSection(sectionId);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const pickOther = (r: SearchResult) => {
    setOtherId(r.id);
    setQuery("");
  };

  const clearOther = () => {
    setOtherId(null);
    setQuery("");
  };

  const sharePath =
    id && otherId
      ? `/compare/${slugifyLabel(left.data?.label ?? "")}-${id}?vs=${otherId}`
      : id
        ? `/compare/${slugifyLabel(left.data?.label ?? "")}-${id}`
        : "/compare";
  const shareUrl =
    typeof window !== "undefined" ? `${window.location.origin}${sharePath}` : sharePath;

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Compare link copied");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Could not copy link");
    }
  };

  const leftQuote = extractQuote(
    left.data?.wikipedia?.lead || left.data?.description || "",
    brief?.leftMotto ||
      brief?.leftAngle?.slice(0, 90) ||
      (left.data?.type === "organization"
        ? "Built to operate at continental scale."
        : "A voice that could laugh, cry, and soar."),
  );
  const rightQuote = extractQuote(
    right.data?.wikipedia?.lead || right.data?.description || "",
    brief?.rightMotto ||
      brief?.rightAngle?.slice(0, 90) ||
      (right.data?.type === "organization"
        ? "Home improvement at national reach."
        : "Range, purity, and unmatched control."),
  );

  const sharedTraits = brief?.overlap?.length
    ? brief.overlap
    : [
        left.data && right.data && left.data.type === right.data.type
          ? `Both are ${left.data.type}s`
          : null,
        ...crafts.slice(0, 2).map((c) => `Shared craft: ${c}`),
      ].filter(Boolean) as string[];

  const polishingAi = Boolean(otherId && aiBrief.isFetching && brief?.fallback);
  const contrastRows = (brief?.contrasts ?? []).slice(0, 12);
  const productRows = contrastRows.filter((r) =>
    /key products|technology focus|retail category|products/i.test(r.label),
  );

  const songStyleRows: CompareContrast[] = [];
  const leftIsSinger = occupationsOf(left.data).some((o) =>
    /singer|vocalist|playback/i.test(o),
  );
  const rightIsSinger = occupationsOf(right.data).some((o) =>
    /singer|vocalist|playback/i.test(o),
  );
  const singingMatchup = leftIsSinger && rightIsSinger;
  if (singingMatchup && (leftCareerQ.data || rightCareerQ.data)) {
    const L = leftCareerQ.data;
    const R = rightCareerQ.data;
    const hasSinging =
      Boolean(L?.recordedWorks || L?.firstSinging) ||
      Boolean(R?.recordedWorks || R?.firstSinging);
    if (hasSinging) {
      if (L?.firstSinging || R?.firstSinging) {
        songStyleRows.push({
          label: "First recorded song",
          left: L?.firstSinging
            ? `${L.firstSinging.year} — ${L.firstSinging.title}`
            : "—",
          right: R?.firstSinging
            ? `${R.firstSinging.year} — ${R.firstSinging.title}`
            : "—",
        });
      }
      if (L?.topMusicDirectors?.[0] || R?.topMusicDirectors?.[0]) {
        songStyleRows.push({
          label: "Top music director",
          left: L?.topMusicDirectors?.[0]
            ? `${L.topMusicDirectors[0].label} (${L.topMusicDirectors[0].count})`
            : "—",
          right: R?.topMusicDirectors?.[0]
            ? `${R.topMusicDirectors[0].label} (${R.topMusicDirectors[0].count})`
            : "—",
        });
      }
      const lataL = L?.lataCollaborations;
      const lataR = R?.lataCollaborations;
      if ((lataL != null && lataL > 0) || (lataR != null && lataR > 0)) {
        songStyleRows.push({
          label: "With Lata Mangeshkar",
          left: lataL != null ? `${lataL} shared credits` : "—",
          right: lataR != null ? `${lataR} shared credits` : "—",
        });
      }
    }
  }

  const navSections = useMemo(() => {
    if (bothOrgs) return ORG_SECTIONS;
    return PERSON_SECTIONS.filter((s) =>
      s.id === "songs" ? songStyleRows.length > 0 : true,
    );
  }, [bothOrgs, songStyleRows.length]);

  if (!id) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#f7f4ec] text-slate-600">
        Missing entity id
      </div>
    );
  }

  return (
    <div className="cmp-page min-h-screen text-slate-800 pb-20 relative">
      <CompareAtmosphere
        leftThumb={left.data?.thumbnail}
        rightThumb={right.data?.thumbnail}
        mood={atmosphereMood}
      />

      {/* Chrome */}
      <header className="sticky top-0 z-40 border-b border-slate-800/80 bg-[#0b1220]/96 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1480px] items-center gap-2 px-4 py-2.5 sm:gap-3 md:px-5">
          <button type="button" onClick={() => navigate("/")} className="flex shrink-0 items-center gap-2 cursor-pointer">
            <div className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/20 border border-cyan-400/30">
              <Network className="size-4 text-cyan-300" />
            </div>
            <span className="hidden sm:inline text-sm font-semibold text-white tracking-tight">
              Wikigraph
            </span>
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-white cursor-pointer"
            title="Back"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="hidden sm:flex min-w-0 items-center gap-2 pl-1">
            <GitCompareArrows className="size-3.5 text-teal-300 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500 leading-none mb-0.5">
                Compare
              </p>
              <p className="text-sm font-serif font-semibold text-white truncate max-w-[280px] leading-tight">
                {left.data?.label ?? id}
                {right.data ? ` vs ${right.data.label}` : ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={copyShare}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-white/10 cursor-pointer"
          >
            {copied ? <Check className="size-3.5 text-emerald-400" /> : <Share2 className="size-3.5" />}
            {copied ? "Copied" : "Share"}
          </button>
        </div>
      </header>

      {/* Hero — circular portraits + VS */}
      <section className="relative overflow-hidden border-b border-amber-200/30 z-[1]">
        <div className="cmp-hero-sheen" aria-hidden />
        <div className="cmp-hero-beam cmp-hero-beam-gold" aria-hidden />
        <div className="cmp-hero-beam cmp-hero-beam-blue" aria-hidden />
        <div className="relative mx-auto max-w-[1280px] px-4 py-8 md:px-6 md:py-12">
          <div className="grid items-start gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)_minmax(0,1fr)]">
            <HeroPortrait
              entity={left.data}
              quote={leftQuote}
              accent="gold"
              loading={left.isLoading}
            />
            <div className="text-center px-2 order-first md:order-none">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                {bothOrgs
                  ? "Two giants · One market · Side by side"
                  : "Two icons · One era · Timeless talent"}
              </p>
              <h1 className="mt-3 font-serif text-[clamp(1.75rem,3.8vw,2.85rem)] font-bold leading-[1.1] text-balance">
                <span className="text-[#b8860b]">{left.data?.label ?? "…"}</span>{" "}
                <span className="text-slate-400 font-semibold italic text-[0.85em]">VS</span>{" "}
                <span className="text-[#1a5f9e]">{right.data?.label ?? "—"}</span>
              </h1>
              <p className="mt-4 text-[14px] leading-relaxed text-slate-600 max-w-xl mx-auto font-serif">
                {brief?.verdict?.slice(0, 320) ||
                  (left.data
                    ? bothOrgs
                      ? `${left.data.label}${right.data ? ` and ${right.data.label}` : ""} — industry, founding, and scale lined up from Wikidata.`
                      : `${left.data.label}${right.data ? ` and ${right.data.label}` : ""} — craft, eras, and legacy lined up from Wikidata.`
                    : "Loading comparison…")}
              </p>
              {right.data && (
                <p
                  className="mt-4 text-[#8a6a00] text-[14px] italic"
                  style={{ fontFamily: "Georgia, serif" }}
                >
                  {bothOrgs
                    ? "Different aisles · Same retail race ♥"
                    : "Different paths · Same stardom ♥"}
                </p>
              )}
            </div>
            <HeroPortrait
              entity={right.data}
              quote={rightQuote}
              accent="blue"
              loading={Boolean(otherId && right.isLoading)}
              empty={
                <span className="text-slate-500 text-sm px-4">
                  Pick a match below to complete the duel
                </span>
              }
            />
          </div>
        </div>
      </section>

      <div className="relative z-[1] mx-auto max-w-[1280px] px-4 py-6 md:px-6 space-y-5" ref={mainRef}>
        <QuickNavChips activeId={activeSection} onJump={jumpTo} sections={navSections} />

        <div className="flex gap-5 items-start">
          <QuickNavAside activeId={activeSection} onJump={jumpTo} sections={navSections} />

          <div className="min-w-0 flex-1 space-y-6">
              {/* Overview */}
              <section id="overview" className="scroll-mt-28 space-y-4">
                {!otherId || matchOpen ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {left.data && (
                      <ProfileCard
                        entity={left.data}
                        accent="gold"
                        title={craftTitle(left.data, brief?.leftAngle)}
                        career={leftCareerQ.data}
                        awardHighlights={leftAwardsQ.data}
                        loadingAi={polishingAi}
                      />
                    )}
                    <div className="rounded-2xl border border-blue-200/80 bg-white shadow-sm overflow-hidden min-h-[16rem] flex flex-col">
                      <div className="border-b border-blue-100 bg-gradient-to-r from-[#e8f1fb] to-white px-4 py-3.5 flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#1a5f9e]/80">
                            Find a match
                          </p>
                          <p className="mt-0.5 text-sm font-serif font-semibold text-slate-900">
                            Search or pick a peer
                          </p>
                        </div>
                        {otherId && (
                          <button
                            type="button"
                            onClick={() => setMatchOpen(false)}
                            className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 cursor-pointer"
                          >
                            Done
                          </button>
                        )}
                      </div>
                      <FindMatchBody
                        query={query}
                        setQuery={setQuery}
                        results={results}
                        showSearchHits={showSearchHits}
                        searchFetching={search.isFetching}
                        peerCategory={peerCategory}
                        peerList={peerList}
                        peersFetching={peers.isFetching}
                        otherId={otherId}
                        onPick={(r) => {
                          pickOther(r);
                          setMatchOpen(false);
                        }}
                        onClearQuery={() => setQuery("")}
                        onEnterPick={() => {
                          if (results[0]) {
                            pickOther(results[0]);
                            setMatchOpen(false);
                          }
                        }}
                        compact
                      />
                      {otherId && (
                        <button
                          type="button"
                          onClick={clearOther}
                          className="mx-4 mb-3 text-left text-[11px] font-medium text-slate-500 hover:text-rose-600 cursor-pointer"
                        >
                          Clear comparison
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {left.data && (
                      <ProfileCard
                        entity={left.data}
                        accent="gold"
                        title={craftTitle(left.data, brief?.leftAngle)}
                        career={leftCareerQ.data}
                        awardHighlights={leftAwardsQ.data}
                        loadingAi={polishingAi}
                      />
                    )}
                    {right.data && (
                      <ProfileCard
                        entity={right.data}
                        accent="blue"
                        title={craftTitle(right.data, brief?.rightAngle)}
                        career={rightCareerQ.data}
                        awardHighlights={rightAwardsQ.data}
                        loadingAi={polishingAi}
                        headerAction={
                          <button
                            type="button"
                            onClick={() => setMatchOpen(true)}
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-[#1a5f9e] hover:bg-blue-100 cursor-pointer"
                          >
                            <RefreshCw className="size-3" />
                            Change
                          </button>
                        }
                      />
                    )}
                  </div>
                )}
              </section>

              {/* Career / business table */}
              {right.data && contrastRows.length > 0 && (
                <section id="career" className="scroll-mt-28 space-y-3">
                  <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    {bothOrgs ? "Business Model" : "Career & Journey"}
                  </h2>
                  <CompareTable
                    leftLabel={left.data?.label ?? "Left"}
                    rightLabel={right.data.label}
                    rows={contrastRows}
                  />
                </section>
              )}

              {right.data && bothOrgs && productRows.length > 0 && (
                <section id="products" className="scroll-mt-28 space-y-3">
                  <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Products & Services
                  </h2>
                  <CompareTable
                    leftLabel={left.data?.label ?? "Left"}
                    rightLabel={right.data.label}
                    rows={productRows}
                  />
                </section>
              )}

              {/* Awards */}
              {right.data && showPersonExtras && (
                <section id="awards" className="scroll-mt-28 space-y-3">
                  <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Awards & Recognitions
                  </h2>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <AwardsPanel
                      entity={left.data}
                      highlights={leftAwardsQ.data}
                      accent="gold"
                    />
                    <AwardsPanel
                      entity={right.data}
                      highlights={rightAwardsQ.data}
                      accent="blue"
                    />
                  </div>
                </section>
              )}

              {/* Films */}
              {right.data && showPersonExtras && (
                <section id="films" className="scroll-mt-28 space-y-3">
                  <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Top Films & Highlights
                  </h2>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <FilmGrid
                      entity={left.data}
                      highlights={leftAwardsQ.data}
                      accent="gold"
                    />
                    <FilmGrid
                      entity={right.data}
                      highlights={rightAwardsQ.data}
                      accent="blue"
                    />
                  </div>
                </section>
              )}

              {/* Songs */}
              {right.data && songStyleRows.length > 0 && (
                <section id="songs" className="scroll-mt-28 space-y-3">
                  <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Songs & Music Style
                  </h2>
                  <CompareTable
                    leftLabel={left.data?.label ?? "Left"}
                    rightLabel={right.data.label}
                    rows={songStyleRows}
                  />
                </section>
              )}

              {/* Shared */}
              {right.data && sharedTraits.length > 0 && (
                <section id="shared" className="scroll-mt-28 space-y-4">
                  {bothOrgs ? (
                    <OrgInsightPanels
                      overlap={sharedTraits}
                      differences={brief?.differences}
                      leadership={brief?.leadership}
                    />
                  ) : (
                    <SharedTraitsStrip traits={sharedTraits} />
                  )}
                </section>
              )}

              {right.data && bothOrgs && (brief?.leadership?.length ?? 0) > 0 && (
                <section id="leadership" className="scroll-mt-28 space-y-3">
                  <h2 className="text-[13px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    Leadership
                  </h2>
                  <div className="rounded-2xl border border-sky-200/70 bg-[#eef5fb] p-5 shadow-sm">
                    <ul className="space-y-2.5">
                      {brief!.leadership!.map((t) => (
                        <li key={t} className="flex gap-2.5 text-[13px] text-slate-700 leading-snug">
                          <Users className="size-3.5 text-[#1a5f9e] shrink-0 mt-0.5" />
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}

              {left.data && (
                <JourneySection
                  left={left.data}
                  right={right.data}
                  brief={brief}
                  leftCareer={leftCareerQ.data}
                  rightCareer={rightCareerQ.data}
                />
              )}

              {/* Share */}
              <div className="flex flex-wrap items-center gap-3 justify-between rounded-2xl border border-amber-200/70 bg-gradient-to-br from-amber-50 to-white shadow-sm px-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-800/80 flex items-center gap-1.5">
                    <Share2 className="size-3.5" />
                    Share this compare
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500 font-mono truncate max-w-[min(100%,28rem)]">
                    {shareUrl}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={copyShare}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[12px] font-semibold text-white hover:bg-slate-800 cursor-pointer"
                  >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? "Copied" : "Copy URL"}
                  </button>
                  {left.data && (
                    <Link
                      to={entityPath(left.data.id, left.data.label)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-600 hover:border-sky-200 hover:text-sky-800"
                    >
                      <BookOpen className="size-3.5" />
                      Profile
                    </Link>
                  )}
                </div>
              </div>
          </div>
        </div>
      </div>

      {/* Bottom legend bar (mockup player strip) */}
      {left.data && right.data && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-slate-800/60 bg-[#0b1220]/95 backdrop-blur-md">
          <div className="mx-auto max-w-[1280px] px-4 py-2.5 flex items-center gap-3 md:px-6">
            <button
              type="button"
              className="flex size-9 items-center justify-center rounded-full bg-amber-400 text-slate-900 shadow cursor-pointer"
              aria-label="Play vibe"
            >
              <Play className="size-3.5 fill-current" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-white truncate">
                {left.data.label} × {right.data.label}
              </p>
              <p className="text-[10px] text-slate-400 truncate">
                {bothOrgs
                  ? "Scale never sleeps · Two chains, one map"
                  : occupationsOf(left.data).some((o) => /singer|playback/i.test(o)) &&
                      occupationsOf(right.data).some((o) => /singer|playback/i.test(o))
                    ? "Legends never fade · Their songs still live in our hearts"
                    : "Legends never fade · Their roles still light the screen"}
              </p>
            </div>
            <div className="hidden sm:flex items-end gap-[3px] h-5 opacity-70" aria-hidden>
              {Array.from({ length: 16 }).map((_, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-amber-300/80"
                  style={{ height: `${6 + ((i * 7) % 14)}px` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
