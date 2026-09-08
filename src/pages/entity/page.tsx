import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchEntitySummary, resolveWikipediaTitleToQid } from "@/lib/wikidata/api.ts";
import { getEntityTypeConfig } from "@/lib/wikidata/entity-types.ts";
import {
  sectionOrderForType,
  SECTION_TITLES,
  IMAGE_PROPERTY_IDS,
  IDENTIFIER_PROPERTY_IDS,
  getSectionForProperty,
  type SectionId,
} from "@/lib/wikidata/propertyGroups.ts";
import { motion, AnimatePresence } from "motion/react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
  Network, GitBranch, ArrowLeft,
  User, MapPin, Building2, Lightbulb, Calendar, HelpCircle,
  BookOpen, Copy, Check,
  Image as ImageIcon, Link2, Clock, Sparkles, Film, Languages,
  Briefcase, Heart, Tag, GraduationCap, Landmark,
} from "lucide-react";
import SearchBox from "@/components/search/SearchBox.tsx";
import { cn } from "@/lib/utils.ts";
import type { EntityType, EntityFact, WikipediaArticle } from "@/lib/wikidata/types.ts";
import { useMemo, useState, useCallback, useEffect, type MouseEvent, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";

const TYPE_ICONS: Record<EntityType, ComponentType<{ className?: string }>> = {
  person: User,
  place: MapPin,
  organization: Building2,
  concept: Lightbulb,
  event: Calendar,
  work: Film,
  unknown: HelpCircle,
};

/** Compact hero highlights only — full facts live in category tabs */
const HERO_HIGHLIGHT_IDS: Record<EntityType, string[]> = {
  person: ["P569", "P570", "P19", "P106", "P27", "P26"],
  place: ["P17", "P131", "P1082", "P36", "P625"],
  organization: ["P571", "P112", "P159", "P17", "P452"],
  event: ["P585", "P580", "P582", "P276", "P17"],
  concept: ["P31", "P279", "P361"],
  work: ["P577", "P50", "P57", "P136", "P495"],
  unknown: ["P31", "P17", "P571"],
};

const SECTION_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  overview: BookOpen,
  identity: Tag,
  life: User,
  family: Heart,
  career: Briefcase,
  organization: Building2,
  place: MapPin,
  creative: Film,
  event: Calendar,
  science: Lightbulb,
  timeline: Clock,
  media: ImageIcon,
  languages: Languages,
  identifiers: Link2,
  related: Sparkles,
  other: GraduationCap,
  education: Landmark,
};

type CategoryTab = {
  id: string;
  title: string;
  count?: number;
  kind: "overview" | "facts" | "timeline" | "media" | "languages" | "identifiers" | "related";
  facts?: EntityFact[];
};

export default function EntityPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [resolvingLink, setResolvingLink] = useState(false);

  const { data: entity, isLoading, error } = useQuery({
    queryKey: ["entity", id, "v6-hero"],
    queryFn: () => fetchEntitySummary(id!),
    enabled: Boolean(id),
    staleTime: 1000 * 60 * 30,
  });

  const cfg = entity ? getEntityTypeConfig(entity.type) : null;
  const Icon = entity ? TYPE_ICONS[entity.type] : null;

  const highlightFacts = useMemo(() => {
    if (!entity) return [] as EntityFact[];
    const ids = HERO_HIGHLIGHT_IDS[entity.type] ?? HERO_HIGHLIGHT_IDS.unknown;
    return ids
      .map((pid) => entity.facts.find((f) => f.propertyId === pid))
      .filter((f): f is EntityFact => Boolean(f))
      .slice(0, 6);
  }, [entity]);

  const leadSnippet = useMemo(() => {
    if (!entity) return "";
    const raw = entity.wikipedia?.lead || entity.wikipediaSummary || entity.description || "";
    const cut = raw.split(/(?<=\.)\s+/).slice(0, 2).join(" ");
    return cut.length > 280 ? `${cut.slice(0, 260).trim()}…` : cut;
  }, [entity]);

  const categories = useMemo((): CategoryTab[] => {
    if (!entity) return [];

    const tabs: CategoryTab[] = [
      { id: "overview", title: "Overview", kind: "overview" },
    ];

    const order = sectionOrderForType(entity.type);
    const buckets = new Map<SectionId, EntityFact[]>();
    for (const sid of order) buckets.set(sid, []);

    for (const fact of entity.facts) {
      if (IMAGE_PROPERTY_IDS.has(fact.propertyId)) continue;
      if (IDENTIFIER_PROPERTY_IDS.has(fact.propertyId)) continue;
      const sid = getSectionForProperty(fact.propertyId);
      if (sid === "identifiers" || sid === "media") continue;
      if (!buckets.has(sid)) buckets.set(sid, []);
      buckets.get(sid)!.push(fact);
    }

    for (const sid of order) {
      if (sid === "media" || sid === "identifiers") continue;
      const facts = buckets.get(sid) ?? [];
      if (!facts.length) continue;
      tabs.push({
        id: sid,
        title: SECTION_TITLES[sid],
        count: facts.length,
        kind: "facts",
        facts,
      });
    }

    if (entity.timeline.length) {
      tabs.push({ id: "timeline", title: "Timeline", count: entity.timeline.length, kind: "timeline" });
    }
    if (entity.images.length) {
      tabs.push({ id: "media", title: "Media", count: entity.images.length, kind: "media" });
    }
    if (entity.wikipedia?.otherLanguages?.length) {
      tabs.push({
        id: "languages",
        title: "Languages",
        count: entity.wikipedia.otherLanguages.length,
        kind: "languages",
      });
    }

    const idFacts = entity.facts.filter(
      (f) => IDENTIFIER_PROPERTY_IDS.has(f.propertyId) || getSectionForProperty(f.propertyId) === "identifiers"
    );
    if (idFacts.length) {
      tabs.push({ id: "identifiers", title: "Identifiers", count: idFacts.length, kind: "identifiers", facts: idFacts });
    }
    if (entity.related.length) {
      tabs.push({ id: "related", title: "Related", count: entity.related.length, kind: "related" });
    }

    return tabs;
  }, [entity]);

  // Keep active tab valid when entity/categories change
  useEffect(() => {
    if (!categories.length) return;
    if (!categories.some((c) => c.id === activeTab)) {
      setActiveTab(categories[0].id);
    }
  }, [categories, activeTab]);

  const active = categories.find((c) => c.id === activeTab) ?? categories[0];

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    toast.success("Link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const onArticleClick = useCallback(async (e: MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor) return;

    const wikiTitle = anchor.getAttribute("data-wiki-title");
    const href = anchor.getAttribute("href") || "";

    if (wikiTitle || href.startsWith("#wiki:")) {
      e.preventDefault();
      const title = wikiTitle || decodeURIComponent(href.replace(/^#wiki:/, ""));
      setResolvingLink(true);
      try {
        const qid = await resolveWikipediaTitleToQid(title);
        if (qid) navigate(`/entity/${qid}`);
        else toast.message(`No Wikidata entity for “${title}”`);
      } finally {
        setResolvingLink(false);
      }
      return;
    }

    if (/wikipedia\.org/i.test(href)) e.preventDefault();
  }, [navigate]);

  const wiki = entity?.wikipedia;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-4 py-2.5 md:px-6">
          <button
            onClick={() => navigate(-1)}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="flex-1">
            <SearchBox size="md" />
          </div>
          <button
            onClick={handleShare}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Copy link"
          >
            {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 md:px-6 pb-24">
        {isLoading && <EntitySkeleton />}

        {error && (
          <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
            <HelpCircle className="size-5 text-destructive" />
            <p className="text-foreground font-medium">Could not load this entity</p>
            <button onClick={() => navigate("/")} className="mt-2 text-primary text-sm hover:underline cursor-pointer">
              Back to search
            </button>
          </div>
        )}

        {entity && cfg && Icon && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            {/* ── Hero: identity + compact highlights ──────────────────── */}
            <section className="relative overflow-hidden rounded-3xl border border-border/60">
              {/* Atmospheric wash */}
              <div
                className="absolute inset-0"
                style={{
                  background: `
                    radial-gradient(ellipse 80% 70% at 0% 50%, ${cfg.color}22 0%, transparent 55%),
                    linear-gradient(120deg, oklch(0.11 0.02 255) 0%, oklch(0.14 0.025 250) 55%, oklch(0.12 0.02 260) 100%)
                  `,
                }}
              />
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.035]"
                style={{
                  backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
                }}
              />

              <div className="relative flex flex-col md:flex-row">
                {/* Portrait — dominant visual plane */}
                <div className="relative md:w-[240px] lg:w-[280px] shrink-0">
                  {entity.thumbnail ? (
                    <img
                      src={entity.thumbnail}
                      alt={entity.label}
                      className="h-56 w-full object-cover object-top md:h-full md:min-h-[320px]"
                    />
                  ) : (
                    <div className={cn("flex h-56 w-full items-center justify-center md:h-full md:min-h-[320px]", cfg.bgClass)}>
                      <Icon className={cn("size-16 opacity-40", cfg.textClass)} />
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/80 via-transparent to-transparent md:bg-gradient-to-r md:from-transparent md:via-transparent md:to-background/40" />
                </div>

                {/* Identity + highlights */}
                <div className="relative flex min-w-0 flex-1 flex-col justify-between gap-5 p-5 md:p-6 lg:p-7">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", cfg.bgClass, cfg.textClass, cfg.borderClass)}>
                        <Icon className="size-3" />
                        {cfg.label}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <CTAButton onClick={() => navigate(`/graph/${id}`)} color={cfg.color} label="Knowledge Graph" icon={<Network className="size-4" />} />
                        {entity.type === "person" && (
                          <CTAButton onClick={() => navigate(`/family-tree/${id}`)} color="oklch(0.68 0.17 145)" label="Family Tree" icon={<GitBranch className="size-4" />} />
                        )}
                      </div>
                    </div>

                    <h1 className="mt-3 font-serif text-3xl font-bold tracking-tight text-foreground text-balance leading-[1.05] md:text-4xl lg:text-[2.6rem]">
                      {entity.label}
                    </h1>

                    <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      {entity.lifespan && (
                        <span className="font-mono text-sm font-semibold text-primary">{entity.lifespan}</span>
                      )}
                      {entity.description && (
                        <span className="text-sm text-muted-foreground">{entity.description}</span>
                      )}
                    </div>

                    {leadSnippet && (
                      <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-foreground/80">
                        {leadSnippet}
                      </p>
                    )}

                    {entity.aliases.length > 0 && (
                      <p className="mt-2 text-xs text-muted-foreground/60">
                        Also known as {entity.aliases.slice(0, 5).join(" · ")}
                        {entity.aliases.length > 5 ? "…" : ""}
                      </p>
                    )}
                  </div>

                  {/* Compact highlight strip — not a card grid */}
                  {highlightFacts.length > 0 && (
                    <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 border-t border-border/50 pt-4 sm:grid-cols-3">
                      {highlightFacts.map((fact) => (
                        <div key={fact.propertyId} className="min-w-0">
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/55">
                            {fact.property}
                          </dt>
                          <dd className="mt-0.5 truncate text-sm font-medium text-foreground/90">
                            {fact.values.slice(0, 2).map((v, j) => (
                              <span key={j}>
                                {j > 0 && <span className="text-muted-foreground/40"> · </span>}
                                {v.id ? (
                                  <button
                                    onClick={() => navigate(`/entity/${v.id}`)}
                                    className="text-primary hover:underline cursor-pointer"
                                  >
                                    {v.label}
                                  </button>
                                ) : (
                                  v.label
                                )}
                              </span>
                            ))}
                            {fact.values.length > 2 && (
                              <span className="text-muted-foreground/50"> +{fact.values.length - 2}</span>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </div>
            </section>

            {resolvingLink && (
              <p className="text-xs text-primary animate-pulse">Opening linked entity…</p>
            )}

            {/* ── Vertical category tabs ───────────────────────────────── */}
            <div className="grid items-start gap-4 lg:grid-cols-[210px_1fr] lg:gap-5">
              {/* Mobile: horizontal pills */}
              <nav className="lg:hidden -mx-1 overflow-x-auto px-1">
                <div className="flex min-w-max gap-1.5 pb-1">
                  {categories.map((cat) => {
                    const TabIcon = SECTION_ICONS[cat.id] ?? Tag;
                    const selected = cat.id === activeTab;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setActiveTab(cat.id)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                          selected
                            ? "border-primary/50 bg-primary/15 text-primary"
                            : "border-border/60 bg-card/40 text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <TabIcon className="size-3.5" />
                        {cat.title}
                        {cat.count != null && <span className="font-mono opacity-70">{cat.count}</span>}
                      </button>
                    );
                  })}
                </div>
              </nav>

              {/* Desktop: vertical rail */}
              <nav className="sticky top-[4.5rem] hidden max-h-[calc(100vh-6rem)] overflow-auto rounded-2xl border border-border/60 bg-card/50 p-1.5 lg:block">
                <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  Categories
                </p>
                <ul className="space-y-0.5">
                  {categories.map((cat) => {
                    const TabIcon = SECTION_ICONS[cat.id] ?? Tag;
                    const selected = cat.id === activeTab;
                    return (
                      <li key={cat.id}>
                        <button
                          onClick={() => setActiveTab(cat.id)}
                          className={cn(
                            "relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors cursor-pointer",
                            selected
                              ? "bg-primary/15 font-semibold text-primary"
                              : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                          )}
                        >
                          {selected && (
                            <span
                              className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full"
                              style={{ background: cfg.color }}
                            />
                          )}
                          <TabIcon className="size-4 shrink-0 opacity-80" />
                          <span className="flex-1 truncate">{cat.title}</span>
                          {cat.count != null && (
                            <span className={cn("font-mono text-[10px]", selected ? "text-primary/80" : "text-muted-foreground/45")}>
                              {cat.count}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              {/* Tab panel */}
              <div className="min-w-0 overflow-hidden rounded-2xl border border-border/60 bg-card/30">
                <div className="flex items-center gap-2 border-b border-border/50 px-5 py-3.5">
                  {(() => {
                    const TabIcon = SECTION_ICONS[active?.id ?? "overview"] ?? BookOpen;
                    return <TabIcon className="size-4 text-primary" />;
                  })()}
                  <h2 className="font-serif text-lg font-semibold text-foreground">{active?.title ?? "Overview"}</h2>
                  {active?.count != null && (
                    <span className="font-mono text-xs text-muted-foreground">{active.count}</span>
                  )}
                </div>

                <div className="p-4 sm:p-6">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={active?.id ?? "empty"}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                    >
                      {active?.kind === "overview" && (
                        <OverviewPanel
                          wiki={wiki}
                          hasArticle={Boolean(wiki?.html || wiki?.lead)}
                          onArticleClick={onArticleClick}
                          entityLabel={entity.label}
                        />
                      )}

                      {active?.kind === "facts" && active.facts && (
                        <FactsPanel facts={active.facts} onNavigate={navigate} />
                      )}

                      {active?.kind === "timeline" && (
                        <ol className="relative ml-2 space-y-4 border-l border-border/60">
                          {entity.timeline.map((item, i) => (
                            <li key={`${item.date}-${item.label}-${i}`} className="relative pl-5">
                              <span className="absolute left-[-5px] top-1.5 size-2.5 rounded-full border-2 border-background" style={{ background: cfg.color }} />
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{item.date}</p>
                              <p className="mt-0.5 text-sm text-foreground/90">
                                <span className="font-medium">{item.label}</span>
                                {item.value && (
                                  <>
                                    {": "}
                                    {item.entityId ? (
                                      <button onClick={() => navigate(`/entity/${item.entityId}`)} className="cursor-pointer text-primary hover:underline">
                                        {item.value}
                                      </button>
                                    ) : item.value}
                                  </>
                                )}
                              </p>
                            </li>
                          ))}
                        </ol>
                      )}

                      {active?.kind === "media" && (
                        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                          {entity.images.map((img) => (
                            <a
                              key={`${img.propertyId}-${img.filename}`}
                              href={img.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="group block overflow-hidden rounded-xl border border-border/50 bg-muted/20"
                            >
                              <img src={img.thumb} alt={img.property} className="aspect-square w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                              <p className="truncate px-2 py-1 text-[10px] text-muted-foreground">{img.property}</p>
                            </a>
                          ))}
                        </div>
                      )}

                      {active?.kind === "languages" && wiki?.otherLanguages && (
                        <div className="space-y-4">
                          {wiki.otherLanguages.map((lang) => (
                            <div key={lang.lang} className="rounded-xl border border-border/50 bg-background/30 p-4">
                              <h3 className="mb-1 font-serif text-base font-semibold text-foreground">
                                {lang.langName}
                                <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">{lang.title}</span>
                              </h3>
                              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/85">{lang.extract}</p>
                            </div>
                          ))}
                        </div>
                      )}

                      {active?.kind === "identifiers" && active.facts && (
                        <FactsPanel facts={active.facts} onNavigate={navigate} />
                      )}

                      {active?.kind === "related" && (
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {entity.related.map((r) => (
                            <li key={`${r.id}-${r.propertyId}`}>
                              <button
                                onClick={() => navigate(`/entity/${r.id}`)}
                                className="w-full cursor-pointer rounded-xl border border-border/50 bg-background/30 px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
                              >
                                <span className="block text-sm font-medium text-foreground">{r.label}</span>
                                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                  {r.relation}{r.description ? ` · ${r.description}` : ""}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>
            </div>

            <p className="text-center text-[11px] text-muted-foreground/50">
              <span className="font-mono">{id}</span>
              {" · "}
              {entity.facts.length} properties
              {wiki ? " · full article in Overview" : ""}
              {entity.images.length ? ` · ${entity.images.length} media` : ""}
            </p>
          </motion.div>
        )}
      </main>
    </div>
  );
}

function OverviewPanel({
  wiki,
  hasArticle,
  onArticleClick,
  entityLabel,
}: {
  wiki?: WikipediaArticle;
  hasArticle: boolean;
  onArticleClick: (e: MouseEvent<HTMLElement>) => void;
  entityLabel: string;
}) {
  if (!hasArticle) {
    return (
      <p className="text-sm text-muted-foreground">
        No encyclopedia article found for {entityLabel}. Browse the category tabs for structured facts, timeline, and media.
      </p>
    );
  }

  if (wiki?.html) {
    return (
      <article
        className="wiki-article max-w-none"
        onClick={onArticleClick}
        dangerouslySetInnerHTML={{ __html: wiki.html }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {wiki?.lead && (
        <div className="space-y-3">
          {wiki.lead.split(/\n{2,}/).filter(Boolean).map((para, i) => (
            <p key={i} className="text-[15px] leading-[1.75] text-foreground/90">{para.trim()}</p>
          ))}
        </div>
      )}
      {wiki?.sections.map((section, i) => (
        <div key={`${section.title}-${i}`} className="pt-2">
          <h3 className={cn("font-serif font-semibold text-foreground mb-2", section.level >= 3 ? "text-base" : "text-lg")}>
            {section.title}
          </h3>
          <div className="space-y-3">
            {section.content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((para, j) => (
              <p key={j} className="text-[14.5px] leading-[1.75] text-foreground/85 whitespace-pre-wrap">{para}</p>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FactsPanel({ facts, onNavigate }: { facts: EntityFact[]; onNavigate: (path: string) => void }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/25 divide-y divide-border/40 overflow-hidden">
      {facts.map((fact) => (
        <div key={fact.propertyId} className="flex items-start gap-4 px-4 py-3.5 hover:bg-muted/15 transition-colors">
          <span className="shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60 w-28 sm:w-36">
            {fact.property}
          </span>
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            <div className="flex flex-wrap gap-1.5">
              {fact.values.map((v, j) =>
                v.id ? (
                  <button
                    key={j}
                    onClick={() => onNavigate(`/entity/${v.id}`)}
                    className="rounded-md border border-primary/25 bg-primary/8 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                  >
                    {v.label}
                  </button>
                ) : v.url ? (
                  <a key={j} href={v.url} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline break-all">
                    {v.label}
                  </a>
                ) : (
                  <span key={j} className="text-sm text-foreground/85 leading-relaxed">{v.label}</span>
                )
              )}
            </div>
            {fact.values.some((v) => v.qualifiers?.length) && (
              <ul className="space-y-0.5">
                {fact.values.flatMap((v, vi) =>
                  (v.qualifiers ?? []).map((q, qi) => (
                    <li key={`${vi}-${qi}`} className="text-[11px] text-muted-foreground">
                      <span className="text-muted-foreground/70">{q.property}: </span>
                      {q.id ? (
                        <button onClick={() => onNavigate(`/entity/${q.id}`)} className="text-primary hover:underline cursor-pointer">
                          {q.label}
                        </button>
                      ) : q.label}
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function CTAButton({ onClick, color, label, icon }: { onClick: () => void; color: string; label: string; icon: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-all cursor-pointer hover:scale-[1.01]"
      style={{ borderColor: `${color}50`, backgroundColor: `${color}12`, color }}
    >
      {icon}{label}
    </button>
  );
}

function EntitySkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-72 rounded-3xl" />
      <div className="grid gap-5 lg:grid-cols-[210px_1fr]">
        <Skeleton className="hidden h-72 rounded-2xl lg:block" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  );
}
