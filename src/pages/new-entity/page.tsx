import { useEffect, useMemo, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Award,
  Bell,
  Bookmark,
  Briefcase,
  Calendar,
  Check,
  ChevronDown,
  Film,
  Flag,
  GitBranch,
  Heart,
  Home,
  Layers,
  MapPin,
  MoreHorizontal,
  Network,
  Quote,
  Share2,
  Sparkles,
  Star,
  Sun,
  TreePine,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import SearchBox from "@/components/search/SearchBox.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  entityPath,
  familyTreePath,
  graphPath,
  newEntityPath,
  parseEntityParam,
} from "@/lib/entityPath.ts";
import { fetchCreativeRolesForPerson, fetchEntitySummary, fetchEntityThumbnails, fetchCompareAwardHighlights, type CompareAwardHighlights, type FilmfareWin } from "@/lib/wikidata/api.ts";
import type { EntityFact, EntitySummary, RelatedEntity } from "@/lib/wikidata/types.ts";
import { cn } from "@/lib/utils.ts";
import TimelinePanel from "@/pages/entity/_components/TimelinePanel.tsx";
import MoviesPanel from "@/pages/new-entity/_components/MoviesPanel.tsx";
import FamilyTreeEmbed from "@/pages/new-entity/_components/FamilyTreeEmbed.tsx";
import ClassicMorePanel from "@/pages/new-entity/_components/ClassicMorePanel.tsx";

type TabId =
  | "overview"
  | "timeline"
  | "movies"
  | "awards"
  | "family"
  | "relationships"
  | "more";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "movies", label: "Movies" },
  { id: "awards", label: "Awards" },
  { id: "family", label: "Family" },
  { id: "relationships", label: "Relationships" },
  { id: "more", label: "More" },
];

const RELATION_FILTER_META: Record<string, { label: string; color: string; pids: string[] }> = {
  parent: { label: "Parent", color: "#60a5fa", pids: ["P22", "P25"] },
  spouse: { label: "Spouse", color: "#f472b6", pids: ["P26"] },
  child: { label: "Child", color: "#34d399", pids: ["P40"] },
  sibling: { label: "Sibling", color: "#a78bfa", pids: ["P3373"] },
  relative: { label: "Relative", color: "#c084fc", pids: ["P1038"] },
  cast: { label: "Cast / crew", color: "#fbbf24", pids: ["P161", "P57", "P58", "P86", "P162", "P1040"] },
  educated: { label: "Education", color: "#22d3ee", pids: ["P69"] },
  employer: { label: "Employer", color: "#fb7185", pids: ["P108"] },
  award: { label: "Award body", color: "#fcd34d", pids: ["P166", "P1411"] },
};

function relationFilterKey(propertyId: string): string | null {
  for (const [key, meta] of Object.entries(RELATION_FILTER_META)) {
    if (meta.pids.includes(propertyId)) return key;
  }
  return null;
}

const TAG_STYLES = [
  { bg: "rgba(139,92,246,0.2)", border: "rgba(167,139,250,0.35)", color: "#ddd6fe" },
  { bg: "rgba(16,185,129,0.2)", border: "rgba(52,211,153,0.35)", color: "#a7f3d0" },
  { bg: "rgba(245,158,11,0.2)", border: "rgba(251,191,36,0.35)", color: "#fde68a" },
  { bg: "rgba(14,165,233,0.2)", border: "rgba(56,189,248,0.35)", color: "#bae6fd" },
];

function factOf(entity: EntitySummary, pid: string) {
  return entity.facts.find((f) => f.propertyId === pid);
}

function valuesOf(entity: EntitySummary, pid: string, limit = 8) {
  return factOf(entity, pid)?.values.slice(0, limit) ?? [];
}

function ageFromBorn(label?: string): number | null {
  if (!label) return null;
  const y = label.match(/\b(1[8-9]\d{2}|20\d{2})\b/)?.[1];
  if (!y) return null;
  const age = new Date().getFullYear() - Number(y);
  return age >= 0 && age < 130 ? age : null;
}

function yearFromLabel(label?: string): string | null {
  return label?.match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1] ?? null;
}

function initials(label: string) {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

function Avatar({
  label,
  src,
  size = "md",
}: {
  label: string;
  src?: string;
  size?: "sm" | "md" | "lg";
}) {
  const px = size === "lg" ? 56 : size === "sm" ? 36 : 44;
  return (
    <div
      style={{
        width: px,
        height: px,
        borderRadius: "9999px",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg,#334155,#0f172a)",
        color: "#e2e8f0",
        fontSize: 11,
        fontWeight: 600,
        boxShadow: "0 0 0 2px #38bdf8",
        overflow: "hidden",
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
      ) : (
        initials(label) || "?"
      )}
    </div>
  );
}

function Card({
  id,
  sectionKey,
  title,
  action,
  children,
  className,
  style,
}: {
  id?: string;
  sectionKey?: string;
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section
      id={id}
      data-ov-section={sectionKey ?? id}
      className={cn("dfw-card", className)}
      style={{ scrollMarginTop: 96, ...style }}
    >
      {(title || action) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          {title ? <h2 className="dfw-card-title" style={{ margin: 0 }}>{title}</h2> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function MetaChip({
  icon: Icon,
  label,
  value,
  wide,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        minWidth: 0,
        alignItems: "flex-start",
        gap: 8,
        gridColumn: wide ? "1 / -1" : undefined,
      }}
    >
      <span
        style={{
          marginTop: 2,
          width: 28,
          height: 28,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          background: "rgba(255,255,255,0.08)",
          color: "#7dd3fc",
          boxShadow: "0 1px 0 rgba(0,0,0,0.25)",
        }}
      >
        <Icon className="size-3.5" />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p
          style={{
            margin: 0,
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#cbd5e1",
            textShadow: "0 1px 3px rgba(0,0,0,0.65)",
          }}
        >
          {label}
        </p>
        <p
          style={{
            margin: "3px 0 0",
            fontSize: 13,
            fontWeight: 550,
            color: "#f8fafc",
            lineHeight: 1.35,
            textShadow: "0 1px 4px rgba(0,0,0,0.7)",
            display: "-webkit-box",
            WebkitLineClamp: wide ? 3 : 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            wordBreak: "break-word",
          }}
          title={value}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

function PersonChip({
  person,
  onOpen,
  thumb,
}: {
  person: { id?: string; label: string; relation: string };
  onOpen: (id: string, label: string) => void;
  thumb?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => person.id && onOpen(person.id, person.label)}
      disabled={!person.id}
      style={{
        display: "flex",
        width: "100%",
        alignItems: "center",
        gap: 12,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.03)",
        padding: "10px 12px",
        textAlign: "left",
        cursor: person.id ? "pointer" : "default",
        color: "inherit",
      }}
    >
      <Avatar label={person.label} src={thumb} size="sm" />
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {person.label}
        </p>
        <p style={{ margin: "2px 0 0", fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {person.relation}
        </p>
      </div>
    </button>
  );
}

function groupRelated(related: RelatedEntity[]) {
  const parents = related.filter((r) => r.propertyId === "P22" || r.propertyId === "P25");
  const spouse = related.filter((r) => r.propertyId === "P26");
  const siblings = related.filter((r) =>
    ["P3373", "P1038", "P40"].includes(r.propertyId),
  );
  return { parents, spouse, siblings };
}

function AwardsList({ awards }: { awards: EntityFact["values"] }) {
  if (!awards.length) {
    return <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>No awards listed.</p>;
  }
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
      {awards.map((a) => (
        <li key={`${a.id ?? a.label}-${a.year ?? ""}`} style={{ display: "flex", gap: 10 }}>
          <span
            style={{
              marginTop: 2,
              width: 28,
              height: 28,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              background: "rgba(251,191,36,0.12)",
              color: "#fbbf24",
            }}
          >
            <Star className="size-3.5" />
          </span>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#f1f5f9" }}>
              {a.label}
              {a.year != null ? (
                <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, color: "#fcd34d" }}>({a.year})</span>
              ) : null}
            </p>
            {a.qualifiers?.length ? (
              <p style={{ margin: "2px 0 0", fontSize: 11, color: "#64748b" }}>
                {a.qualifiers.slice(0, 3).map((q) => `${q.property}: ${q.label}`).join(" · ")}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function FilmfareWinsList({
  wins,
  categoryLabel,
}: {
  wins: FilmfareWin[];
  categoryLabel?: string;
}) {
  if (!wins.length) return null;
  const header = categoryLabel || (wins.some((w) => w.song) ? "Best Male Playback Singer" : "Filmfare Awards");
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <p style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#fcd34d", fontFamily: "Space Mono, monospace" }}>
          {wins.length}×
        </p>
        <div>
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>Filmfare Awards</p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94a3b8" }}>{header}</p>
        </div>
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
        {wins.map((w) => {
          const primary = w.song || w.film;
          const secondary = w.song
            ? [w.film, w.category && w.category !== header ? w.category : null].filter(Boolean).join(" · ")
            : w.category && w.category !== header
              ? w.category
              : undefined;
          return (
            <li
              key={`${w.year}-${w.song ?? ""}-${w.film}-${w.category ?? ""}`}
              style={{
                display: "grid",
                gridTemplateColumns: "64px minmax(0, 1fr)",
                gap: 12,
                alignItems: "start",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.02)",
                padding: "10px 12px",
              }}
            >
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 800,
                  color: "#fcd34d",
                  fontFamily: "Space Mono, monospace",
                }}
              >
                {w.year}
              </span>
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#f8fafc", lineHeight: 1.35 }}>
                  {primary}
                </p>
                {secondary ? (
                  <p style={{ margin: "3px 0 0", fontSize: 11, color: "#94a3b8" }}>{secondary}</p>
                ) : null}
                {w.song ? (
                  <p style={{ margin: "4px 0 0", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#64748b" }}>
                    Song · Filmfare win
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function RichAwardsPanel({
  awards,
  highlights,
  loading,
}: {
  awards: EntityFact["values"];
  highlights?: CompareAwardHighlights | null;
  loading?: boolean;
}) {
  const wins = highlights?.filmfareWins ?? [];
  const other = highlights?.otherRecognition ?? [];
  const showFilmfare = wins.length > 0;

  if (loading && !showFilmfare && !awards.length) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <Skeleton className="h-8 w-48" style={{ background: "rgba(255,255,255,0.06)" }} />
        <Skeleton className="h-16 w-full rounded-xl" style={{ background: "rgba(255,255,255,0.06)" }} />
        <Skeleton className="h-16 w-full rounded-xl" style={{ background: "rgba(255,255,255,0.06)" }} />
      </div>
    );
  }

  if (!showFilmfare && !awards.length && !other.length) {
    return <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>No awards listed yet.</p>;
  }

  return (
    <div style={{ display: "grid", gap: 22 }}>
      {showFilmfare && (
        <FilmfareWinsList wins={wins} categoryLabel={highlights?.filmfareCategory} />
      )}

      {!showFilmfare && awards.length > 0 && <AwardsList awards={awards} />}

      {showFilmfare && awards.length > 0 && (
        <div>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            Also on Wikidata
          </p>
          <AwardsList awards={awards.slice(0, 8)} />
        </div>
      )}

      {other.length > 0 && (
        <div>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            Other recognition
          </p>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {other.map((t) => (
              <li
                key={t}
                style={{
                  display: "flex",
                  gap: 10,
                  fontSize: 13,
                  color: "#cbd5e1",
                  lineHeight: 1.45,
                }}
              >
                <span
                  style={{
                    marginTop: 7,
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    flexShrink: 0,
                    background: "#fbbf24",
                  }}
                />
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      {highlights?.source && (
        <p style={{ margin: 0, fontSize: 11, color: "#475569" }}>
          Details via digidarpan.com · Wikipedia · {highlights.source}
        </p>
      )}
      {!highlights?.source && (
        <p style={{ margin: 0, fontSize: 11, color: "#475569" }}>Tagged on digidarpan.com</p>
      )}
    </div>
  );
}

export default function NewEntityPage() {
  const { id: rawParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const parsed = useMemo(() => parseEntityParam(rawParam ?? ""), [rawParam]);
  const id = parsed.qid ?? undefined;
  const [tab, setTab] = useState<TabId>("overview");
  const [copied, setCopied] = useState(false);
  const [highlightsOpen, setHighlightsOpen] = useState(true);
  const [activeRelationFilters, setActiveRelationFilters] = useState<Set<string>>(new Set());
  const [activeSection, setActiveSection] = useState<string>("ov-about");

  const { data: entity, isLoading, error } = useQuery({
    queryKey: ["entity", id],
    queryFn: () => fetchEntitySummary(id!),
    enabled: Boolean(id),
    staleTime: 1000 * 60 * 30,
  });

  const rootIsPerson = entity?.type === "person";
  const { data: creativeHits } = useQuery({
    queryKey: ["graph-creative", id],
    queryFn: () => fetchCreativeRolesForPerson(id!),
    enabled: Boolean(id && rootIsPerson),
    staleTime: 1000 * 60 * 15,
  });

  const { data: awardHighlights, isLoading: awardsLoading } = useQuery({
    queryKey: ["entity-award-highlights", id, entity?.label],
    queryFn: () => fetchCompareAwardHighlights(id!, entity!.label),
    enabled: Boolean(id && entity?.label && rootIsPerson),
    staleTime: 1000 * 60 * 60,
  });

  useEffect(() => {
    if (!id || !entity || !rawParam) return;
    const canonical = newEntityPath(id, entity.label).replace(/^\/new\/entity\//, "");
    if (rawParam !== canonical) {
      navigate(`/new/entity/${canonical}`, { replace: true });
    }
  }, [id, entity, rawParam, navigate]);

  useEffect(() => {
    if (error) toast.error("Failed to load entity");
  }, [error]);

  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = "#070b14";
    document.documentElement.style.colorScheme = "dark";
    return () => {
      document.body.style.background = prev;
      document.documentElement.style.colorScheme = "";
    };
  }, []);

  const openEntity = (qid: string, label: string) => {
    navigate(newEntityPath(qid, label));
  };

  const about =
    entity?.wikipedia?.lead ||
    entity?.wikipediaSummary ||
    entity?.description ||
    "";

  const born = entity ? valuesOf(entity, "P569", 1)[0]?.label : undefined;
  const birthplace = entity ? valuesOf(entity, "P19", 1)[0]?.label : undefined;
  const nationality = entity ? valuesOf(entity, "P27", 2).map((v) => v.label).join(", ") : undefined;
  const occupations = entity ? valuesOf(entity, "P106", 4) : [];
  const spouse = entity ? valuesOf(entity, "P26", 2) : [];
  const children = entity ? valuesOf(entity, "P40", 4) : [];
  const education = entity ? valuesOf(entity, "P69", 2) : [];
  const awards = entity ? valuesOf(entity, "P166", 40) : [];
  // Also surface award-like timeline rows if claims are thin
  const awardExtras = useMemo(() => {
    if (!entity || awards.length >= 8) return [] as EntityFact["values"];
    const out: EntityFact["values"] = [];
    const seen = new Set(awards.map((a) => a.label.toLowerCase()));
    for (const t of entity.timeline) {
      if (!/award|prize|padma|filmfare|national film/i.test(`${t.label} ${t.value ?? ""}`)) continue;
      const label = t.value || t.label;
      if (seen.has(label.toLowerCase())) continue;
      seen.add(label.toLowerCase());
      out.push({ label, id: undefined });
      if (out.length >= 12) break;
    }
    return out;
  }, [entity, awards]);
  const allAwards = useMemo(() => [...awards, ...awardExtras], [awards, awardExtras]);
  const notableFromFacts = entity ? valuesOf(entity, "P800", 8) : [];
  const notableWorks = useMemo(() => {
    if (notableFromFacts.length) return notableFromFacts;
    if (!creativeHits?.length) return [];
    const seen = new Set<string>();
    const out: Array<{ label: string; id?: string }> = [];
    for (const hit of creativeHits) {
      const key = hit.qid || hit.workLabel;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ label: hit.workLabel, id: hit.qid.startsWith("Q") ? hit.qid : undefined });
      if (out.length >= 8) break;
    }
    return out;
  }, [notableFromFacts, creativeHits]);
  const age = ageFromBorn(born);

  const tags = useMemo(() => {
    if (!entity) return [] as string[];
    const out: string[] = [];
    for (const o of occupations) {
      const clean = o.label.replace(/\bfilm actor\b/i, "Actress").replace(/\bactor\b/i, "Actress");
      out.push(clean);
    }
    const awardHit = awards.find((a) => /padma|nobel|oscar|bharat/i.test(a.label));
    if (awardHit) out.push(awardHit.label.split("(")[0]!.trim());
    if (entity.type === "person" && occupations.some((o) => /actor|actress|film/i.test(o.label))) {
      out.push("Film Icon");
    }
    return [...new Set(out)].slice(0, 4);
  }, [entity, occupations, awards]);

  const familyGroups = useMemo(() => {
    if (!entity) return { parents: [] as RelatedEntity[], spouse: [] as RelatedEntity[], siblings: [] as RelatedEntity[] };
    const fromRelated = groupRelated(entity.related);
    const pick = (pid: string, relation: string): RelatedEntity[] =>
      valuesOf(entity, pid, 4).map((v) => ({
        id: v.id ?? v.label,
        label: v.label,
        relation,
        propertyId: pid,
      }));
    return {
      parents:
        fromRelated.parents.length > 0
          ? fromRelated.parents
          : [...pick("P22", "Father"), ...pick("P25", "Mother")],
      spouse: fromRelated.spouse.length > 0 ? fromRelated.spouse : pick("P26", "Spouse"),
      siblings:
        fromRelated.siblings.length > 0
          ? fromRelated.siblings
          : [...pick("P3373", "Sibling"), ...pick("P1038", "Relative")],
    };
  }, [entity]);

  const relatedPeople = useMemo(() => {
    if (!entity) return [] as RelatedEntity[];
    const preferred = new Set(["P26", "P22", "P25", "P3373", "P1038", "P40", "P161", "P57"]);
    const ranked = [...entity.related].sort((a, b) => {
      const pa = preferred.has(a.propertyId) ? 0 : 1;
      const pb = preferred.has(b.propertyId) ? 0 : 1;
      return pa - pb;
    });
    const seen = new Set<string>();
    const out: RelatedEntity[] = [];
    for (const r of ranked) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
      if (out.length >= 24) break;
    }
    return out;
  }, [entity]);

  const dynamicFilters = useMemo(() => {
    if (!entity) {
      return {
        relations: [] as Array<{ key: string; label: string; color: string; count: number }>,
        occupations: [] as string[],
        decades: [] as string[],
        nationalities: [] as string[],
      };
    }
    const relCounts = new Map<string, number>();
    for (const r of entity.related) {
      const key = relationFilterKey(r.propertyId);
      if (!key) continue;
      relCounts.set(key, (relCounts.get(key) ?? 0) + 1);
    }
    const relations = [...relCounts.entries()]
      .map(([key, count]) => {
        const meta = RELATION_FILTER_META[key]!;
        return { key, label: meta.label, color: meta.color, count };
      })
      .sort((a, b) => b.count - a.count);

    const occupations = valuesOf(entity, "P106", 8).map((v) => v.label);
    const nationalities = valuesOf(entity, "P27", 6).map((v) => v.label);

    const decadeSet = new Set<string>();
    for (const t of entity.timeline) {
      const y = yearFromLabel(t.date) ?? yearFromLabel(t.label);
      if (!y) continue;
      const n = Number(y);
      if (!Number.isFinite(n)) continue;
      if (n >= 2020) decadeSet.add("2020s");
      else if (n >= 2010) decadeSet.add("2010s");
      else if (n >= 2000) decadeSet.add("2000s");
      else if (n >= 1990) decadeSet.add("1990s");
      else if (n >= 1980) decadeSet.add("1980s");
      else decadeSet.add("Earlier");
    }
    const decadeOrder = ["2020s", "2010s", "2000s", "1990s", "1980s", "Earlier"];
    const decades = decadeOrder.filter((d) => decadeSet.has(d));

    return { relations, occupations, decades, nationalities };
  }, [entity]);

  // Seed relation filters once entity content arrives (all on by default)
  useEffect(() => {
    if (!entity) return;
    setActiveRelationFilters(new Set(dynamicFilters.relations.map((r) => r.key)));
  }, [entity?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredRelatedPeople = useMemo(() => {
    let list = relatedPeople;
    if (dynamicFilters.relations.length && activeRelationFilters.size) {
      list = list.filter((r) => {
        const key = relationFilterKey(r.propertyId);
        if (!key) return activeRelationFilters.size === dynamicFilters.relations.length;
        return activeRelationFilters.has(key);
      });
    }
    return list.slice(0, 8);
  }, [relatedPeople, activeRelationFilters, dynamicFilters.relations.length]);

  const thumbIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of relatedPeople) {
      if (/^Q\d+$/.test(r.id)) ids.add(r.id);
    }
    for (const g of Object.values(familyGroups)) {
      for (const p of g) {
        if (/^Q\d+$/.test(p.id)) ids.add(p.id);
      }
    }
    if (entity) {
      for (const v of valuesOf(entity, "P40", 8)) {
        if (v.id && /^Q\d+$/.test(v.id)) ids.add(v.id);
      }
    }
    for (const w of notableWorks) {
      if (w.id && /^Q\d+$/.test(w.id)) ids.add(w.id);
    }
    return [...ids];
  }, [relatedPeople, familyGroups, notableWorks, entity]);

  const { data: entityThumbs } = useQuery({
    queryKey: ["entity-thumbs-v2", id, thumbIds.join("|")],
    queryFn: () => fetchEntityThumbnails(thumbIds, { width: 160 }),
    enabled: Boolean(id && thumbIds.length),
    staleTime: 1000 * 60 * 60,
  });

  const timelineItems = useMemo(() => {
    if (!entity) return [];
    return entity.timeline.slice(0, 10);
  }, [entity]);

  const careerHighlights = useMemo(() => {
    if (!entity) return [] as Array<{ title: string; detail?: string }>;
    const fromTimeline = entity.timeline
      .filter((t) => /award|debut|film|marri|born|won|nominat|jury|padma|work/i.test(`${t.label} ${t.value ?? ""}`))
      .slice(0, 7)
      .map((t) => {
        const verb = t.label.replace(/^award received$/i, "Won").replace(/^nominated for$/i, "Nominated");
        const title = t.value ? `${verb}: ${t.value}` : verb;
        return { title, detail: t.date };
      });
    if (fromTimeline.length) return fromTimeline;
    const bornY = yearFromLabel(born);
    const items: Array<{ title: string; detail?: string }> = [];
    if (bornY) items.push({ title: `Born in ${birthplace ?? "—"}`, detail: bornY });
    for (const w of notableWorks.slice(0, 4)) {
      items.push({ title: `Notable work: ${w.label}` });
    }
    for (const a of awards.slice(0, 3)) {
      items.push({ title: `Award: ${a.label}` });
    }
    return items.slice(0, 7);
  }, [entity, born, birthplace, notableWorks, awards]);

  const stats = useMemo(() => {
    if (!entity) return [] as Array<{ label: string; value: string; icon: ComponentType<{ className?: string }> }>;
    const bornY = yearFromLabel(born);
    const years = bornY ? Math.max(1, new Date().getFullYear() - Number(bornY) - 18) : null;
    const out: Array<{ label: string; value: string; icon: ComponentType<{ className?: string }> }> = [];
    if (years && years > 0) out.push({ label: "Years in film", value: `${years}+`, icon: Calendar });
    if (awards.length) out.push({ label: "Awards & honours", value: `${awards.length}+`, icon: Award });
    const worksN = Math.max(notableWorks.length, creativeHits?.length ?? 0);
    if (worksN) out.push({ label: "Films & works", value: `${worksN}+`, icon: Film });
    return out.slice(0, 3);
  }, [entity, born, awards.length, notableWorks.length, creativeHits?.length]);

  const heroPortrait = useMemo(() => {
    if (!entity) return undefined;
    return (
      entity.thumbnail ||
      entity.images.find((i) => i.propertyId === "P18")?.url ||
      entity.images.find(
        (i) =>
          i.propertyId !== "P109" &&
          !/signatur|autograph/i.test(i.filename) &&
          /\.(jpe?g|png|webp)$/i.test(i.filename),
      )?.url
    );
  }, [entity]);

  const heroGallery = useMemo(() => {
    if (!entity) return [] as string[];
    const urls: string[] = [];
    for (const img of entity.images) {
      if (img.propertyId === "P109" || /signatur|autograph|logo|flag|map|coa|icon|svg/i.test(img.filename)) {
        continue;
      }
      if (!/\.(jpe?g|png|webp)$/i.test(img.filename)) continue;
      if (img.propertyId !== "P18" && img.propertyId !== "wiki-gallery") continue;
      if (img.url && !urls.includes(img.url)) urls.push(img.url);
    }
    for (const g of entity.wikipedia?.gallery ?? []) {
      if (/signatur|autograph|logo|flag|map|coa|icon|svg/i.test(g.filename)) continue;
      if (g.url && !urls.includes(g.url)) urls.push(g.url);
    }
    return urls.slice(0, 12);
  }, [entity]);

  const heroAtmosphere = useMemo(() => {
    const alts = heroGallery.filter((u) => u && u !== heroPortrait);
    const isPlace = (url: string) =>
      /house|home|kunj|building|temple|street|memorial|panoramio|logo|flag|signature|\bmap\b|stamp/i.test(url);
    const people = alts.filter((u) => !isPlace(u));
    const scene = people.find((u) => /and_|film|movie|with_|scene|still/i.test(u));
    return scene || people[0] || heroPortrait;
  }, [heroGallery, heroPortrait]);

  const quote = useMemo(() => {
    if (!entity) return "";
    const lead = entity.wikipedia?.lead ?? entity.wikipediaSummary ?? "";
    // Curly quotes only — avoid matching apostrophes in Women's, etc.
    const curly = lead.match(/[“«]([^”»]{24,120})[”»]/);
    if (curly?.[1] && !/born|died|january|august|pronunciation/i.test(curly[1])) {
      return curly[1].trim();
    }
    const motto = entity.facts.find((f) => f.propertyId === "P1451")?.values[0]?.label;
    if (motto && motto.length >= 8 && motto.length <= 120) return motto;
    const sentences = lead
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.replace(/^["'“”]+|["'“”]+$/g, "").trim())
      .filter(Boolean);
    const pick = sentences.find(
      (s) =>
        s.length >= 36 &&
        s.length <= 130 &&
        !/born|graduated|pronunciation|recipient of multiple|hindustani/i.test(s) &&
        !/^she began acting/i.test(s),
    );
    if (pick) return pick;
    // Fallback: second sentence of the lead if usable
    const second = sentences[1];
    if (second && second.length >= 28 && second.length <= 140) return second;
    return entity.description && entity.description.length <= 110
      ? entity.description
      : "Stories that shaped the screen — and beyond.";
  }, [entity]);

  const quickFacts: Array<{ label: string; value: string; id?: string }> = [];
  if (entity) {
    quickFacts.push({ label: "Full name", value: entity.label });
    if (born) quickFacts.push({ label: "Born", value: age != null ? `${born} (age ${age})` : born });
    if (birthplace) quickFacts.push({ label: "Birthplace", value: birthplace });
    if (occupations.length) {
      quickFacts.push({ label: "Occupation", value: occupations.map((o) => o.label).join(", ") });
    }
    if (nationality) quickFacts.push({ label: "Nationality", value: nationality });
    if (spouse.length) {
      quickFacts.push({
        label: "Spouse",
        value: spouse.map((s) => s.label).join(", "),
        id: spouse[0]?.id,
      });
    }
    quickFacts.push({
      label: "Children",
      value: children.length ? children.map((c) => c.label).join(", ") : "—",
      id: children[0]?.id,
    });
    if (education.length) {
      quickFacts.push({ label: "Education", value: education.map((e) => e.label).join(", ") });
    }
  }

  const lifeHighlights = useMemo(() => {
    if (!entity) {
      return {
        pulse: "",
        craft: [] as string[],
        sparks: [] as Array<{
          id: string;
          title: string;
          body: string;
          sectionId?: string;
          accent: string;
        }>,
        faces: [] as Array<{ id: string; label: string; relation: string }>,
        whisper: "",
      };
    }

    const died = valuesOf(entity, "P570", 1)[0]?.label;
    const bornY = yearFromLabel(born);
    const diedY = yearFromLabel(died);
    const pulseParts = [
      bornY && diedY ? `${bornY}–${diedY}` : bornY ? `b. ${bornY}` : null,
      birthplace,
      occupations[0]?.label,
    ].filter(Boolean);
    const pulse = pulseParts.join(" · ");

    const craft = occupations.map((o) => o.label).slice(0, 6);

    const sparks: Array<{
      id: string;
      title: string;
      body: string;
      sectionId?: string;
      accent: string;
    }> = [];

    if (born || birthplace) {
      sparks.push({
        id: "spark-origin",
        title: "Where it began",
        body: [born, birthplace ? `in ${birthplace}` : null].filter(Boolean).join(" "),
        sectionId: "ov-facts",
        accent: "#38bdf8",
      });
    }

    const spouseNames = familyGroups.spouse.map((s) => s.label).slice(0, 3);
    if (spouseNames.length) {
      sparks.push({
        id: "spark-love",
        title: spouseNames.length > 1 ? "Loves & marriages" : "Married to",
        body: spouseNames.join(" · "),
        sectionId: "ov-family",
        accent: "#f472b6",
      });
    }

    const startWork = entity.timeline.find((t) => /start of work|debut|career/i.test(t.label));
    if (startWork) {
      sparks.push({
        id: "spark-debut",
        title: "First light",
        body: `${startWork.label}${startWork.date ? ` · ${startWork.date}` : startWork.value ? ` · ${startWork.value}` : ""}`,
        sectionId: "ov-career",
        accent: "#a78bfa",
      });
    } else if (careerHighlights[0]) {
      sparks.push({
        id: "spark-debut",
        title: "Career spark",
        body: careerHighlights[0].title,
        sectionId: "ov-career",
        accent: "#a78bfa",
      });
    }

    if (allAwards.length) {
      const top = allAwards[0]!;
      sparks.push({
        id: "spark-laurel",
        title: allAwards.length > 1 ? `${allAwards.length} honours on record` : "Recognised for",
        body: top.label,
        sectionId: "ov-awards",
        accent: "#fbbf24",
      });
    }

    if (notableWorks[0]) {
      sparks.push({
        id: "spark-work",
        title: "On the reel",
        body: notableWorks
          .slice(0, 3)
          .map((w) => w.label)
          .join(" · "),
        sectionId: "ov-works",
        accent: "#34d399",
      });
    }

    if (nationality) {
      sparks.push({
        id: "spark-roots",
        title: "Belonging",
        body: nationality,
        sectionId: "ov-facts",
        accent: "#22d3ee",
      });
    }

    const faces = [
      ...familyGroups.spouse,
      ...familyGroups.parents,
      ...familyGroups.siblings,
    ]
      .filter((p) => /^Q\d+$/.test(p.id))
      .slice(0, 6)
      .map((p) => ({ id: p.id, label: p.label, relation: p.relation }));

    const whisper =
      (quote && quote.length > 28 ? quote : "") ||
      (about
        ? about.replace(/\s+/g, " ").trim().slice(0, 140) + (about.length > 140 ? "…" : "")
        : "");

    return { pulse, craft, sparks: sparks.slice(0, 6), faces, whisper };
  }, [
    entity,
    born,
    birthplace,
    occupations,
    familyGroups,
    careerHighlights,
    allAwards,
    notableWorks,
    nationality,
    quote,
    about,
  ]);

  const overviewSectionIds = useMemo(
    () => [
      "ov-about",
      "ov-facts",
      "ov-family",
      "ov-career",
      "ov-awards",
      "ov-echo",
      "ov-timeline",
      "ov-related",
      "ov-works",
    ],
    [],
  );

  const jumpToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    const run = () => {
      const nodes = [...document.querySelectorAll<HTMLElement>(`[data-ov-section="${sectionId}"]`)];
      const el = nodes.find((n) => n.getClientRects().length > 0) ?? nodes[0];
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    if (tab !== "overview") {
      setTab("overview");
      window.setTimeout(run, 80);
    } else {
      run();
    }
  };

  useEffect(() => {
    if (tab !== "overview") return;
    const nodes = overviewSectionIds
      .flatMap((id) => [...document.querySelectorAll<HTMLElement>(`[data-ov-section="${id}"]`)])
      .filter((n) => n.getClientRects().length > 0);
    if (!nodes.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target.getAttribute("data-ov-section");
        if (top) setActiveSection(top);
      },
      { rootMargin: "-18% 0px -58% 0px", threshold: [0.1, 0.35, 0.6] },
    );
    for (const n of nodes) io.observe(n);
    return () => io.disconnect();
  }, [tab, overviewSectionIds, entity?.id]);

  const share = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Link copied");
    });
  };

  if (!id) {
    return (
      <div className="dfw" style={{ alignItems: "center", justifyContent: "center" }}>
        Invalid entity URL
      </div>
    );
  }

  return (
    <div className="dfw">
      {/* Left sidebar */}
      <aside className="dfw-sidebar">
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px" }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, rgba(251,191,36,0.3), rgba(14,165,233,0.2))",
              border: "1px solid rgba(252,211,77,0.25)",
              color: "#fcd34d",
            }}
          >
            <TreePine className="size-4" />
          </div>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#fff" }}>Digidarpan</p>
            <p style={{ margin: 0, fontSize: 10, color: "#64748b" }}>digidarpan.com</p>
          </div>
        </div>

        <nav style={{ padding: "0 8px", display: "grid", gap: 2 }}>
          {[
            { label: "Home", icon: Home, to: "/" },
            { label: "Family Tree", icon: GitBranch, to: entity ? familyTreePath(id, entity.label) : "#" },
            { label: "People", icon: Users, to: "#", active: true },
            { label: "Graph", icon: Network, to: entity ? graphPath(id, entity.label) : "#" },
            { label: "Classic", icon: Layers, to: entity ? entityPath(id, entity.label) : "#" },
          ].map((item) => (
            <Link
              key={item.label}
              to={item.to}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                borderRadius: 12,
                padding: "8px 12px",
                fontSize: 13,
                textDecoration: "none",
                color: item.active ? "#e0f2fe" : "#94a3b8",
                background: item.active ? "rgba(14,165,233,0.15)" : "transparent",
                border: item.active ? "1px solid rgba(56,189,248,0.25)" : "1px solid transparent",
              }}
            >
              <item.icon className="size-4" style={{ opacity: 0.85 }} />
              {item.label}
            </Link>
          ))}
        </nav>

        <div style={{ marginTop: 20, borderTop: "1px solid rgba(255,255,255,0.06)", padding: "16px 12px 0" }}>
          <button
            type="button"
            onClick={() => setHighlightsOpen((v) => !v)}
            style={{
              marginBottom: 8,
              display: "flex",
              width: "100%",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "#64748b",
              background: "transparent",
              border: 0,
              cursor: "pointer",
            }}
          >
            Highlights
            <ChevronDown className="size-3.5" style={{ transform: highlightsOpen ? "rotate(180deg)" : undefined }} />
          </button>
          {highlightsOpen && (
            <div style={{ display: "grid", gap: 14 }}>
              {lifeHighlights.pulse && (
                <div
                  style={{
                    borderRadius: 14,
                    border: "1px solid rgba(251,191,36,0.22)",
                    background: "linear-gradient(145deg, rgba(251,191,36,0.1), rgba(14,165,233,0.05))",
                    padding: "12px 12px",
                  }}
                >
                  <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#fbbf24" }}>
                    Pulse
                  </p>
                  <p style={{ margin: "6px 0 0", fontSize: 13, fontWeight: 600, color: "#f8fafc", lineHeight: 1.4 }}>
                    {lifeHighlights.pulse}
                  </p>
                </div>
              )}

              {lifeHighlights.whisper && (
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    lineHeight: 1.55,
                    color: "#94a3b8",
                    fontStyle: "italic",
                    borderLeft: "2px solid rgba(251,191,36,0.35)",
                    paddingLeft: 10,
                  }}
                >
                  {lifeHighlights.whisper.length > 160
                    ? `${lifeHighlights.whisper.slice(0, 157)}…`
                    : lifeHighlights.whisper}
                </p>
              )}

              {lifeHighlights.sparks.length > 0 && (
                <div>
                  <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 500, color: "#94a3b8" }}>
                    Worth a look
                  </p>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
                    {lifeHighlights.sparks.map((spark) => {
                      const active = spark.sectionId ? activeSection === spark.sectionId : false;
                      return (
                        <li key={spark.id}>
                          <button
                            type="button"
                            onClick={() => spark.sectionId && jumpToSection(spark.sectionId)}
                            style={{
                              display: "block",
                              width: "100%",
                              textAlign: "left",
                              borderRadius: 12,
                              border: active
                                ? `1px solid ${spark.accent}66`
                                : "1px solid rgba(255,255,255,0.06)",
                              background: active ? `${spark.accent}14` : "rgba(255,255,255,0.02)",
                              padding: "10px 11px",
                              cursor: spark.sectionId ? "pointer" : "default",
                              color: "inherit",
                            }}
                          >
                            <span
                              style={{
                                display: "block",
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                color: spark.accent,
                              }}
                            >
                              {spark.title}
                            </span>
                            <span
                              style={{
                                display: "block",
                                marginTop: 4,
                                fontSize: 12,
                                color: "#cbd5e1",
                                lineHeight: 1.4,
                              }}
                            >
                              {spark.body}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {lifeHighlights.faces.length > 0 && (
                <div>
                  <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 500, color: "#94a3b8" }}>
                    People nearby
                  </p>
                  <div style={{ display: "grid", gap: 6 }}>
                    {lifeHighlights.faces.map((face) => (
                      <button
                        key={face.id}
                        type="button"
                        onClick={() => openEntity(face.id, face.label)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          width: "100%",
                          borderRadius: 10,
                          border: "1px solid rgba(255,255,255,0.06)",
                          background: "rgba(255,255,255,0.02)",
                          padding: "6px 8px",
                          cursor: "pointer",
                          color: "inherit",
                          textAlign: "left",
                        }}
                      >
                        <Avatar label={face.label} src={entityThumbs?.[face.id]} size="sm" />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {face.label}
                          </span>
                          <span style={{ display: "block", fontSize: 10, color: "#64748b" }}>{face.relation}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {lifeHighlights.craft.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {lifeHighlights.craft.map((c) => (
                    <span
                      key={c}
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "#94a3b8",
                        borderRadius: 999,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.03)",
                        padding: "3px 8px",
                      }}
                    >
                      {c}
                    </span>
                  ))}
                </div>
              )}

              {dynamicFilters.relations.length > 0 && (
                <div>
                  <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 500, color: "#94a3b8" }}>
                    Related people filter
                  </p>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4 }}>
                    {dynamicFilters.relations.map((r) => {
                      const checked = activeRelationFilters.has(r.key);
                      return (
                        <li key={r.key}>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              borderRadius: 8,
                              padding: "4px 6px",
                              fontSize: 12,
                              color: "#cbd5e1",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                setActiveRelationFilters((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(r.key)) next.delete(r.key);
                                  else next.add(r.key);
                                  return next;
                                });
                              }}
                              style={{ accentColor: "#38bdf8" }}
                            />
                            <span style={{ width: 8, height: 8, borderRadius: 999, background: r.color }} />
                            <span style={{ flex: 1 }}>{r.label}</span>
                            <span style={{ fontSize: 10, color: "#64748b" }}>{r.count}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {!entity && (
                <p style={{ margin: 0, fontSize: 12, color: "#64748b" }}>
                  Highlights appear once this profile loads.
                </p>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            marginTop: "auto",
            margin: 12,
            borderRadius: 16,
            border: "1px solid rgba(251,191,36,0.2)",
            background: "linear-gradient(135deg, rgba(251,191,36,0.12), rgba(14,165,233,0.06))",
            padding: 14,
          }}
        >
          <div
            style={{
              marginBottom: 8,
              width: 36,
              height: 36,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(251,191,36,0.15)",
              color: "#fcd34d",
            }}
          >
            <Sparkles className="size-4" />
          </div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: "#cbd5e1" }}>
            Stories, songs &amp; family memory — tagged on{" "}
            <a
              href="https://digidarpan.com"
              target="_blank"
              rel="noreferrer"
              style={{ color: "#fcd34d", textDecoration: "none", fontWeight: 600 }}
            >
              digidarpan.com
            </a>
          </p>
        </div>
      </aside>

      {/* Main */}
      <div className="dfw-main">
        <header className="dfw-topbar">
          <div className="dfw-search-wrap" style={{ flex: 1, maxWidth: 560, margin: "0 auto" }}>
            <SearchBox
              size="md"
              placeholder="Search people, movies, places, concepts…"
              hrefFor={newEntityPath}
              className="max-w-none"
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" title="Theme" style={iconBtnStyle}>
              <Sun className="size-4" />
            </button>
            <button type="button" title="Notifications" style={iconBtnStyle}>
              <Bell className="size-4" />
            </button>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(14,165,233,0.2)",
                color: "#bae6fd",
                fontSize: 11,
                fontWeight: 600,
                boxShadow: "0 0 0 1px rgba(56,189,248,0.3)",
              }}
            >
              WG
            </div>
          </div>
        </header>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {isLoading && !entity ? (
            <div style={{ padding: 24, display: "grid", gap: 16 }}>
              <Skeleton className="h-56 w-full rounded-2xl" style={{ background: "rgba(255,255,255,0.06)" }} />
              <div style={{ display: "grid", gap: 16, gridTemplateColumns: "2fr 1fr" }}>
                <Skeleton className="h-64 rounded-2xl" style={{ background: "rgba(255,255,255,0.06)" }} />
                <Skeleton className="h-64 rounded-2xl" style={{ background: "rgba(255,255,255,0.06)" }} />
              </div>
            </div>
          ) : entity ? (
            <>
              {/* Hero — cinematic bg matches /entity EntityHero */}
              <section className="dfw-hero">
                <div className="dfw-hero-bg" aria-hidden>
                  {heroPortrait && (
                    <div className="dfw-hero-bg-portrait">
                      <img src={heroPortrait} alt="" referrerPolicy="no-referrer" />
                    </div>
                  )}
                  {heroAtmosphere && (
                    <div className="dfw-hero-bg-atmosphere">
                      <img src={heroAtmosphere} alt="" referrerPolicy="no-referrer" />
                    </div>
                  )}
                </div>
                <div className="dfw-hero-veil" aria-hidden />

                <div className="dfw-hero-inner">
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginBottom: 16 }}>
                    <button type="button" style={ghostBtnStyle}>
                      <Bookmark className="size-3.5" /> Save
                    </button>
                    <button type="button" onClick={share} style={ghostBtnStyle}>
                      {copied ? <Check className="size-3.5" style={{ color: "#34d399" }} /> : <Share2 className="size-3.5" />}
                      Share
                    </button>
                    <button type="button" style={{ ...ghostBtnStyle, padding: "6px 8px" }}>
                      <MoreHorizontal className="size-4" />
                    </button>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 24,
                      alignItems: "flex-end",
                      paddingRight: quote ? "min(24rem, 34%)" : 0,
                    }}
                  >
                    <div className="dfw-avatar">
                      {entity.thumbnail ? (
                        <img src={entity.thumbnail} alt="" />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, fontWeight: 600, color: "#cbd5e1" }}>
                          {initials(entity.label)}
                        </div>
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 240, paddingBottom: 4, maxWidth: quote ? 560 : 720 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <h1 style={{ margin: 0, fontFamily: "Syne, sans-serif", fontSize: "clamp(1.75rem, 3vw, 2.25rem)", fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>
                          {entity.label}
                        </h1>
                        <span
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 999,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "#0ea5e9",
                            color: "#fff",
                          }}
                        >
                          <Check className="size-3" strokeWidth={3} />
                        </span>
                      </div>
                      {entity.description && (
                        <p style={{ margin: "6px 0 0", fontSize: 15, color: "#cbd5e1" }}>{entity.description}</p>
                      )}

                      <div
                        style={{
                          marginTop: 16,
                          display: "grid",
                          gap: 14,
                          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                        }}
                      >
                        {born && (
                          <MetaChip icon={Calendar} label="Born" value={age != null ? `${born} · age ${age}` : born} />
                        )}
                        {birthplace && <MetaChip icon={MapPin} label="Birthplace" value={birthplace} />}
                        {nationality && <MetaChip icon={Flag} label="Nationality" value={nationality} />}
                        {occupations.length > 0 && (
                          <MetaChip
                            icon={Briefcase}
                            label="Occupation"
                            value={occupations.map((o) => o.label).join(", ")}
                            wide
                          />
                        )}
                      </div>

                      {tags.length > 0 && (
                        <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {tags.map((t, i) => {
                            const s = TAG_STYLES[i % TAG_STYLES.length]!;
                            return (
                              <span
                                key={t}
                                className="dfw-chip"
                                style={{ background: s.bg, borderColor: s.border, color: s.color }}
                              >
                                {t}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {quote && (
                    <aside className="dfw-signature">
                      <Quote className="size-4" style={{ color: "rgba(252,211,77,0.85)", marginBottom: 8 }} />
                      <p>“{quote}”</p>
                      <cite>— {entity.label}</cite>
                    </aside>
                  )}
                </div>
              </section>

              {/* Tabs */}
              <div className="dfw-tabs">
                <div style={{ maxWidth: 1400, margin: "0 auto", display: "flex", gap: 2, overflowX: "auto", padding: "0 1rem" }}>
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={cn("dfw-tab", tab === t.id && "is-active")}
                      onClick={() => setTab(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Body */}
              <div
                className="dfw-body"
                style={
                  tab === "timeline" ||
                  tab === "movies" ||
                  tab === "awards" ||
                  tab === "family" ||
                  tab === "more"
                    ? { gridTemplateColumns: "1fr" }
                    : undefined
                }
              >
                <div style={{ minWidth: 0, display: "grid", gap: 20 }}>
                  {tab === "timeline" && (
                    <div className="dfw-timeline-wrap">
                      <TimelinePanel
                        entity={entity}
                        color="#38bdf8"
                        onNavigate={(path) => {
                          if (path.startsWith("/entity/")) {
                            const rest = path.replace(/^\/entity\//, "");
                            navigate(`/new/entity/${rest}`);
                          } else {
                            navigate(path);
                          }
                        }}
                      />
                    </div>
                  )}

                  {tab === "movies" && (
                    <MoviesPanel
                      personId={id}
                      personLabel={entity.label}
                      personThumb={entity.thumbnail}
                      onOpenWork={openEntity}
                    />
                  )}

                  {tab === "awards" && (
                    <Card
                      title={`Awards & recognition${
                        (awardHighlights?.filmfareWins.length || allAwards.length)
                          ? ` · ${(awardHighlights?.filmfareWins.length || 0) > allAwards.length
                              ? awardHighlights!.filmfareWins.length
                              : Math.max(allAwards.length, awardHighlights?.filmfareWins.length ?? 0)}`
                          : ""
                      }`}
                    >
                      <RichAwardsPanel
                        awards={allAwards}
                        highlights={awardHighlights}
                        loading={awardsLoading}
                      />
                    </Card>
                  )}

                  {tab === "family" && (
                    <>
                      <Card
                        title="Family & relationships"
                        action={
                          <Link to={familyTreePath(id, entity.label)} style={{ fontSize: 12, fontWeight: 500, color: "#7dd3fc", textDecoration: "none" }}>
                            Open full page
                          </Link>
                        }
                        style={{
                          background:
                            "radial-gradient(ellipse 80% 60% at 0% 0%, rgba(244,114,182,0.08), transparent 50%), radial-gradient(ellipse 70% 50% at 100% 0%, rgba(56,189,248,0.07), transparent 45%), #121a2b",
                        }}
                      >
                        <p style={{ margin: "0 0 14px", fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
                          Kinship from Wikidata claims — tap anyone to open their profile.
                        </p>
                        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
                          {(
                            [
                              { key: "parents", title: "Parents", accent: "#60a5fa", items: familyGroups.parents },
                              { key: "spouse", title: "Spouse", accent: "#f472b6", items: familyGroups.spouse },
                              { key: "siblings", title: "Siblings & kin", accent: "#a78bfa", items: familyGroups.siblings },
                              {
                                key: "children",
                                title: "Children",
                                accent: "#34d399",
                                items: valuesOf(entity, "P40", 6).map((v) => ({
                                  id: v.id ?? v.label,
                                  label: v.label,
                                  relation: "Child",
                                  propertyId: "P40",
                                })),
                              },
                            ] as const
                          ).map((col) => (
                            <div
                              key={col.key}
                              style={{
                                borderRadius: 14,
                                border: `1px solid ${col.accent}33`,
                                background: `linear-gradient(160deg, ${col.accent}14, rgba(255,255,255,0.02))`,
                                padding: 12,
                              }}
                            >
                              <p
                                style={{
                                  margin: "0 0 10px",
                                  fontSize: 11,
                                  fontWeight: 700,
                                  letterSpacing: "0.1em",
                                  textTransform: "uppercase",
                                  color: col.accent,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                }}
                              >
                                <span
                                  style={{
                                    width: 6,
                                    height: 6,
                                    borderRadius: 999,
                                    background: col.accent,
                                    boxShadow: `0 0 10px ${col.accent}`,
                                  }}
                                />
                                {col.title}
                                <span style={{ marginLeft: "auto", fontSize: 10, color: "#64748b", letterSpacing: 0, fontWeight: 600 }}>
                                  {col.items.length}
                                </span>
                              </p>
                              <div style={{ display: "grid", gap: 8 }}>
                                {col.items.length === 0 ? (
                                  <p style={{ margin: 0, fontSize: 12, color: "#475569" }}>Not listed</p>
                                ) : (
                                  col.items.slice(0, 5).map((p) => (
                                    <PersonChip
                                      key={`${p.id}-${p.relation}`}
                                      person={p}
                                      onOpen={openEntity}
                                      thumb={entityThumbs?.[p.id]}
                                    />
                                  ))
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </Card>
                      <FamilyTreeEmbed
                        personId={id}
                        personLabel={entity.label}
                        onOpenEntity={openEntity}
                      />
                    </>
                  )}

                  {tab === "more" && (
                    <ClassicMorePanel entity={entity} onOpenEntity={openEntity} />
                  )}

                  {tab === "overview" && (
                    <>
                      <Card title="About">
                        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "#cbd5e1", whiteSpace: "pre-wrap" }}>
                          {about || "No biography available yet."}
                        </p>
                        {stats.length > 0 && (
                          <div style={{ marginTop: 20, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
                            {stats.map((s) => (
                              <div key={s.label} className="dfw-stat">
                                <s.icon className="size-4 mb-2 text-amber-300" />
                                <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#fff" }}>{s.value}</p>
                                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#94a3b8" }}>{s.label}</p>
                              </div>
                            ))}
                          </div>
                        )}
                        {quote && (
                          <blockquote
                            style={{
                              margin: "20px 0 0",
                              borderLeft: "2px solid rgba(251,191,36,0.5)",
                              paddingLeft: 16,
                              fontSize: 14,
                              fontStyle: "italic",
                              color: "#cbd5e1",
                            }}
                          >
                            {quote.length > 200 ? `${quote.slice(0, 197)}…` : quote}
                          </blockquote>
                        )}
                      </Card>

                      <Card title="Quick facts">
                        <dl
                          style={{
                            margin: 0,
                            display: "grid",
                            gap: "12px 24px",
                            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                          }}
                        >
                          {quickFacts.map((f) => (
                            <div key={f.label} style={{ minWidth: 0, borderBottom: "1px solid rgba(255,255,255,0.05)", paddingBottom: 10 }}>
                              <dt style={{ margin: 0, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b" }}>
                                {f.label}
                              </dt>
                              <dd style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 500, color: "#f1f5f9" }}>
                                {f.id ? (
                                  <button
                                    type="button"
                                    onClick={() => openEntity(f.id!, f.value.split(",")[0]!.trim())}
                                    style={{ background: "none", border: 0, padding: 0, color: "#7dd3fc", cursor: "pointer", font: "inherit", textAlign: "left" }}
                                  >
                                    {f.value}
                                  </button>
                                ) : (
                                  f.value
                                )}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </Card>
                    </>
                  )}

                  {(tab === "overview" || tab === "relationships") && (
                    <Card
                      title="Family & relationships"
                      action={
                        <button
                          type="button"
                          onClick={() => setTab("family")}
                          style={{ fontSize: 12, fontWeight: 500, color: "#7dd3fc", background: "none", border: 0, cursor: "pointer" }}
                        >
                          View family tree
                        </button>
                      }
                    >
                      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                        {(
                          [
                            { key: "parents", title: "Parents", items: familyGroups.parents },
                            { key: "spouse", title: "Spouse", items: familyGroups.spouse },
                            { key: "siblings", title: "Siblings & kin", items: familyGroups.siblings },
                          ] as const
                        ).map((col) => (
                          <div
                            key={col.key}
                            style={{
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.06)",
                              background: "rgba(255,255,255,0.02)",
                              padding: 12,
                            }}
                          >
                            <p style={{ margin: "0 0 10px", fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#64748b" }}>
                              {col.title}
                            </p>
                            <div style={{ display: "grid", gap: 8 }}>
                              {col.items.length === 0 ? (
                                <p style={{ margin: 0, fontSize: 12, color: "#475569" }}>Not listed</p>
                              ) : (
                                col.items.slice(0, 3).map((p) => (
                                  <PersonChip key={`${p.id}-${p.relation}`} person={p} onOpen={openEntity} thumb={entityThumbs?.[p.id]} />
                                ))
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  {tab === "overview" && (
                    <Card title="Career highlights">
                      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 10 }}>
                        {careerHighlights.length === 0 ? (
                          <li style={{ fontSize: 13, color: "#64748b" }}>No career milestones found.</li>
                        ) : (
                          careerHighlights.map((h, i) => (
                            <li key={`${h.title}-${i}`} style={{ display: "flex", gap: 12 }}>
                              <span
                                style={{
                                  marginTop: 2,
                                  width: 20,
                                  height: 20,
                                  flexShrink: 0,
                                  borderRadius: 999,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  background: "rgba(251,191,36,0.15)",
                                  color: "#fcd34d",
                                }}
                              >
                                <Check className="size-3" strokeWidth={3} />
                              </span>
                              <div style={{ minWidth: 0 }}>
                                <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "#f1f5f9" }}>{h.title}</p>
                                {h.detail && (
                                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#64748b" }}>{h.detail}</p>
                                )}
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                    </Card>
                  )}

                  {tab === "overview" && (allAwards.length > 0 || (awardHighlights?.filmfareWins.length ?? 0) > 0) && (
                    <Card title="Awards & recognition" className="dfw-awards-mobile" sectionKey="ov-awards">
                      <RichAwardsPanel
                        awards={allAwards.slice(0, 6)}
                        highlights={
                          awardHighlights
                            ? {
                                ...awardHighlights,
                                filmfareWins: awardHighlights.filmfareWins.slice(0, 8),
                                otherRecognition: awardHighlights.otherRecognition.slice(0, 4),
                              }
                            : awardHighlights
                        }
                        loading={awardsLoading}
                      />
                      {(awardHighlights?.filmfareWins.length ?? 0) > 8 && (
                        <button
                          type="button"
                          onClick={() => setTab("awards")}
                          style={{ marginTop: 14, fontSize: 12, fontWeight: 600, color: "#7dd3fc", background: "none", border: 0, cursor: "pointer" }}
                        >
                          View all awards
                        </button>
                      )}
                    </Card>
                  )}

                  {tab === "overview" && (
                    <div
                      style={{
                        position: "relative",
                        overflow: "hidden",
                        borderRadius: 16,
                        border: "1px solid rgba(251,191,36,0.2)",
                        background: "linear-gradient(90deg, #1a1520, #121a2b 50%, #0f1a28)",
                        padding: "20px 24px",
                      }}
                    >
                      {entity.thumbnail && (
                        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "33%", opacity: 0.3 }}>
                          <img src={entity.thumbnail} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
                          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, #121a2b, transparent)" }} />
                        </div>
                      )}
                      <div style={{ position: "relative", maxWidth: 560 }}>
                        <Quote className="size-5" style={{ color: "#fcd34d", marginBottom: 8 }} />
                        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: "#f1f5f9", fontStyle: "italic" }}>
                          {quote || about.slice(0, 180) || "Stories worth remembering."}
                        </p>
                        <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 16, fontSize: 12, color: "#94a3b8" }}>
                          {stats.map((s) => (
                            <span key={s.label}>
                              <span style={{ fontWeight: 600, color: "#fde68a" }}>{s.value}</span> {s.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right rail — overview / relationships only */}
                {(tab === "overview" || tab === "relationships") && (
                <aside style={{ display: "grid", gap: 20, alignContent: "start" }}>
                  <Card
                    title="Life timeline"
                    action={
                      <button type="button" onClick={() => setTab("timeline")} style={{ fontSize: 12, fontWeight: 500, color: "#7dd3fc", background: "none", border: 0, cursor: "pointer" }}>
                        Full timeline
                      </button>
                    }
                  >
                    {timelineItems.length === 0 ? (
                      <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>No dated events yet.</p>
                    ) : (
                      <ol style={{ margin: 0, padding: "0 0 0 16px", listStyle: "none", borderLeft: "1px solid rgba(56,189,248,0.3)", display: "grid", gap: 16 }}>
                        {timelineItems.map((t, i) => (
                          <li key={`${t.sortKey}-${i}`} style={{ position: "relative" }}>
                            <span
                              style={{
                                position: "absolute",
                                left: -21,
                                top: 4,
                                width: 10,
                                height: 10,
                                borderRadius: 999,
                                background: "#38bdf8",
                                boxShadow: "0 0 0 4px #121a2b",
                              }}
                            />
                            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: "#7dd3fc" }}>{t.date}</p>
                            <p style={{ margin: "2px 0 0", fontSize: 13, fontWeight: 500, color: "#f1f5f9" }}>{t.label}</p>
                            {t.value && (
                              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#64748b" }}>{t.value}</p>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </Card>

                  <Card title={`Related people${filteredRelatedPeople.length ? ` (${filteredRelatedPeople.length})` : ""}`}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      {filteredRelatedPeople.length === 0 ? (
                        <p style={{ gridColumn: "1 / -1", margin: 0, fontSize: 13, color: "#64748b" }}>No related people listed.</p>
                      ) : (
                        filteredRelatedPeople.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => openEntity(p.id, p.label)}
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "center",
                              gap: 6,
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.06)",
                              background: "rgba(255,255,255,0.02)",
                              padding: "12px 8px",
                              textAlign: "center",
                              cursor: "pointer",
                              color: "inherit",
                            }}
                          >
                            <Avatar label={p.label} src={entityThumbs?.[p.id]} />
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#f1f5f9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                              {p.label}
                            </span>
                            <span style={{ fontSize: 10, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                              {p.relation}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </Card>

                  <Card
                    title="Notable works"
                    action={
                      <button type="button" onClick={() => setTab("movies")} style={{ fontSize: 12, fontWeight: 500, color: "#7dd3fc", background: "none", border: 0, cursor: "pointer" }}>
                        All movies
                      </button>
                    }
                  >
                    {notableWorks.length === 0 ? (
                      <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>Loading filmography…</p>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        {notableWorks.slice(0, 4).map((w) => (
                          <button
                            key={w.id ?? w.label}
                            type="button"
                            onClick={() => w.id && openEntity(w.id, w.label)}
                            disabled={!w.id}
                            style={{
                              overflow: "hidden",
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.08)",
                              background: "#0c1424",
                              textAlign: "left",
                              cursor: w.id ? "pointer" : "default",
                              color: "inherit",
                              padding: 0,
                            }}
                          >
                            <div
                              style={{
                                aspectRatio: "2/3",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "linear-gradient(135deg,#1e293b,#020617)",
                                overflow: "hidden",
                                position: "relative",
                              }}
                            >
                              {w.id && entityThumbs?.[w.id] ? (
                                <img
                                  src={entityThumbs[w.id]}
                                  alt=""
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                                  onError={(e) => {
                                    e.currentTarget.style.display = "none";
                                  }}
                                />
                              ) : (
                                <Film className="size-7" style={{ color: "#475569" }} />
                              )}
                            </div>
                            <div style={{ padding: 8 }}>
                              <p style={{ margin: 0, fontSize: 11, fontWeight: 600, color: "#e2e8f0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                {w.label}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </Card>

                  <Card
                    title="Awards & recognition"
                    sectionKey="ov-awards"
                    action={
                      (awardHighlights?.filmfareWins.length ?? allAwards.length) > 4 ? (
                        <button
                          type="button"
                          onClick={() => setTab("awards")}
                          style={{ fontSize: 12, fontWeight: 500, color: "#7dd3fc", background: "none", border: 0, cursor: "pointer" }}
                        >
                          View all
                        </button>
                      ) : null
                    }
                    className="dfw-awards-desk"
                  >
                    <RichAwardsPanel
                      awards={allAwards.slice(0, 4)}
                      highlights={
                        awardHighlights
                          ? {
                              ...awardHighlights,
                              filmfareWins: awardHighlights.filmfareWins.slice(0, 6),
                              otherRecognition: awardHighlights.otherRecognition.slice(0, 3),
                            }
                          : awardHighlights
                      }
                      loading={awardsLoading}
                    />
                  </Card>
                </aside>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const iconBtnStyle: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: 999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "transparent",
  color: "#94a3b8",
  cursor: "pointer",
};

const ghostBtnStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.06)",
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 500,
  color: "#e2e8f0",
  cursor: "pointer",
};
