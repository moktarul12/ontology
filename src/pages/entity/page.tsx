import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchEntitySummary, resolveWikipediaTitleToQid, searchEntities } from "@/lib/wikidata/api.ts";
import { entityPath, parseEntityParam } from "@/lib/entityPath.ts";
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
  Network, ArrowLeft, ChevronRight, ChevronLeft, GitBranch, Sparkles,
  User, MapPin, Building2, Lightbulb, Calendar, HelpCircle,
  BookOpen, Copy, Check, Share2, ExternalLink, GitCompareArrows,
  Image as ImageIcon, Link2, Clock, Film, Languages,
  Briefcase, Heart, Tag, GraduationCap, Landmark, Star, FlaskConical,
  List, Quote, ShieldCheck, Users, Globe2, Factory, Award, Layers,
  TrendingUp, DollarSign, BarChart3,
} from "lucide-react";
import SearchBox from "@/components/search/SearchBox.tsx";
import { SearchNamePeers } from "@/components/search/SearchNamePeers.tsx";
import { cn } from "@/lib/utils.ts";
import type { EntityType, EntityFact, EntitySummary, WikipediaArticle } from "@/lib/wikidata/types.ts";
import { useMemo, useState, useCallback, useEffect, type MouseEvent, type ComponentType } from "react";
import { toast } from "sonner";
import TimelinePanel from "@/pages/entity/_components/TimelinePanel.tsx";
import {
  OverviewCapsuleBlock,
  FactsBriefBlock,
  maybeFactsEnrichSection,
} from "@/pages/entity/_components/SectionEnrichment.tsx";
import { WikiTocNav } from "@/pages/entity/_components/WikiTocNav.tsx";
import { WikiArticleWithMainEmbeds } from "@/pages/entity/_components/MainArticlePanels.tsx";
import { EntityHero } from "@/pages/entity/_components/EntityHero.tsx";

const TYPE_ICONS: Record<EntityType, ComponentType<{ className?: string }>> = {
  person: User,
  place: MapPin,
  organization: Building2,
  concept: Lightbulb,
  event: Calendar,
  work: Film,
  unknown: HelpCircle,
};


type QuickFact = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  lines: Array<{ text: string; id?: string }>;
  tone?: "cyan" | "violet" | "amber" | "emerald" | "rose";
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

function factOf(entity: EntitySummary, pid: string) {
  return entity.facts.find((f) => f.propertyId === pid);
}

function labelsOf(entity: EntitySummary, pid: string, limit = 3) {
  const f = factOf(entity, pid);
  if (!f) return [] as Array<{ label: string; id?: string }>;
  return f.values.slice(0, limit).map((v) => ({ label: v.label, id: v.id }));
}

/** "15 October 1931" → "15 Oct 1931" */
function compactDate(label: string): string {
  return label
    .replace(/\bJanuary\b/g, "Jan").replace(/\bFebruary\b/g, "Feb")
    .replace(/\bMarch\b/g, "Mar").replace(/\bApril\b/g, "Apr")
    .replace(/\bJune\b/g, "Jun").replace(/\bJuly\b/g, "Jul")
    .replace(/\bAugust\b/g, "Aug").replace(/\bSeptember\b/g, "Sep")
    .replace(/\bOctober\b/g, "Oct").replace(/\bNovember\b/g, "Nov")
    .replace(/\bDecember\b/g, "Dec");
}

function linesFromFact(fact: EntityFact | undefined, limit = 2): QuickFact["lines"] {
  if (!fact) return [];
  return fact.values.slice(0, limit).map((v) => ({ text: v.label, id: v.id }));
}

function pushFact(
  items: QuickFact[],
  icon: ComponentType<{ className?: string }>,
  label: string,
  fact: EntityFact | undefined,
  opts?: { limit?: number; tone?: QuickFact["tone"]; transform?: (s: string) => string }
) {
  if (!fact?.values.length) return;
  const limit = opts?.limit ?? 2;
  const lines = fact.values.slice(0, limit).map((v) => ({
    text: opts?.transform ? opts.transform(v.label) : v.label,
    id: v.id,
  }));
  if (!lines.length) return;
  if (items.some((i) => i.label === label)) return;
  items.push({ icon, label, lines, tone: opts?.tone });
}

function mergeLines(...groups: QuickFact["lines"][]): QuickFact["lines"] {
  const out: QuickFact["lines"] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    for (const line of g) {
      const k = line.text.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(line);
    }
  }
  return out;
}

function buildQuickFacts(entity: EntitySummary): QuickFact[] {
  const items: QuickFact[] = [];
  const f = (pid: string) => factOf(entity, pid);

  if (entity.type === "organization") {
    pushFact(items, Calendar, "Founded", f("P571"), { tone: "cyan", transform: compactDate, limit: 1 });
    pushFact(items, Users, "Founders", f("P112"), { tone: "violet", limit: 3 });
    pushFact(items, MapPin, "Headquarters", f("P159"), { tone: "emerald", limit: 2 });
    pushFact(items, Factory, "Industry", f("P452"), { tone: "amber", limit: 3 });
    pushFact(items, Briefcase, "CEO", f("P169"), { tone: "cyan", limit: 2 });
    pushFact(items, Globe2, "Country", f("P17"), { tone: "emerald", limit: 2 });
    pushFact(items, Layers, "Products", f("P1056"), { tone: "violet", limit: 3 });
    pushFact(items, Building2, "Parent", f("P749"), { tone: "amber", limit: 2 });
    pushFact(items, Users, "Employees", f("P1128"), { tone: "cyan", limit: 1 });
    pushFact(items, DollarSign, "Revenue", f("P2139"), { tone: "emerald", limit: 1 });
    pushFact(items, TrendingUp, "Market cap", f("P2226"), { tone: "amber", limit: 1 });
    pushFact(items, BarChart3, "Net profit", f("P2295"), { tone: "violet", limit: 1 });
    pushFact(items, Star, "Exchange", f("P414"), { tone: "rose", limit: 2 });
    pushFact(items, Tag, "Ticker", f("P249"), { tone: "cyan", limit: 1 });
    pushFact(items, Star, "Type", f("P31"), { tone: "rose", limit: 2 });
  } else if (entity.type === "person") {
    const born = f("P569");
    const birthPlace = f("P19");
    if (born || birthPlace) {
      items.push({
        icon: Calendar,
        label: "Born",
        tone: "cyan",
        lines: mergeLines(
          born ? [{ text: compactDate(born.values[0].label) }] : [],
          linesFromFact(birthPlace, 1)
        ),
      });
    }
    const died = f("P570");
    const deathPlace = f("P20");
    if (died || deathPlace) {
      items.push({
        icon: ShieldCheck,
        label: "Died",
        tone: "rose",
        lines: mergeLines(
          died ? [{ text: compactDate(died.values[0].label) }] : [],
          linesFromFact(deathPlace, 1)
        ),
      });
    }
    pushFact(items, Landmark, "Nationality", f("P27"), { tone: "emerald", limit: 2 });
    {
      const known = mergeLines(
        linesFromFact(f("P1449"), 2),
        linesFromFact(f("P800"), 2),
        linesFromFact(f("P39"), 2),
        linesFromFact(f("P106"), 2)
      ).slice(0, 3);
      if (known.length) {
        items.push({
          icon: Star,
          label: f("P1449") || f("P800") || f("P39") ? "Known for" : "Occupation",
          tone: "amber",
          lines: known,
        });
      }
    }
    pushFact(items, FlaskConical, "Field", f("P101"), { tone: "violet", limit: 4 });
    pushFact(items, GraduationCap, "Education", f("P69"), { tone: "cyan", limit: 4 });
    pushFact(items, Award, "Awards", f("P166"), { tone: "amber", limit: 8 });
    pushFact(items, Briefcase, "Employer", f("P108"), { tone: "emerald", limit: 4 });
    pushFact(items, Heart, "Spouse", f("P26"), { tone: "rose", limit: 4 });
  } else if (entity.type === "place") {
    pushFact(items, Globe2, "Country", f("P17"), { tone: "cyan", limit: 2 });
    pushFact(items, MapPin, "Located in", f("P131"), { tone: "emerald", limit: 2 });
    pushFact(items, Users, "Population", f("P1082"), { tone: "amber", limit: 1 });
    pushFact(items, Landmark, "Capital", f("P36"), { tone: "violet", limit: 1 });
    pushFact(items, Calendar, "Inception", f("P571"), { tone: "cyan", transform: compactDate, limit: 1 });
    pushFact(items, Star, "Type", f("P31"), { tone: "rose", limit: 2 });
  } else if (entity.type === "work") {
    pushFact(items, Calendar, "Published", f("P577"), { tone: "cyan", transform: compactDate, limit: 1 });
    pushFact(items, User, "Author", f("P50"), { tone: "violet", limit: 2 });
    pushFact(items, Film, "Director", f("P57"), { tone: "amber", limit: 2 });
    pushFact(items, Star, "Genre", f("P136"), { tone: "rose", limit: 3 });
    pushFact(items, Globe2, "Country", f("P495"), { tone: "emerald", limit: 2 });
    pushFact(items, Users, "Cast", f("P161"), { tone: "cyan", limit: 3 });
  } else if (entity.type === "event") {
    pushFact(items, Calendar, "Date", f("P585") ?? f("P580"), { tone: "cyan", transform: compactDate, limit: 1 });
    pushFact(items, MapPin, "Location", f("P276"), { tone: "emerald", limit: 2 });
    pushFact(items, Globe2, "Country", f("P17"), { tone: "violet", limit: 2 });
    pushFact(items, Users, "Participants", f("P710"), { tone: "amber", limit: 3 });
    pushFact(items, Star, "Type", f("P31"), { tone: "rose", limit: 2 });
  } else {
    pushFact(items, Tag, "Instance of", f("P31"), { tone: "cyan", limit: 2 });
    pushFact(items, Layers, "Subclass of", f("P279"), { tone: "violet", limit: 2 });
    pushFact(items, Globe2, "Country", f("P17") ?? f("P495"), { tone: "emerald", limit: 2 });
    pushFact(items, Calendar, "Inception", f("P571"), { tone: "amber", transform: compactDate, limit: 1 });
  }

  // Curated fillers only — never dump every Wikidata claim into At a glance
  {
    const used = new Set(
      ["P569", "P570", "P19", "P20", "P571", "P112", "P159", "P17", "P452", "P169", "P106", "P101", "P800", "P1449", "P39", "P69", "P166", "P108", "P26", "P27", "P31", "P1056", "P749", "P1128", "P131", "P1082", "P36", "P577", "P50", "P57", "P136", "P495", "P161", "P585", "P580", "P276", "P710", "P279", "P140", "P1412", "P856", "P1454", "P127", "P414", "P937", "P463", "P138", "P740"],
    );
    const fillers: Array<[string, ComponentType<{ className?: string }>, string, QuickFact["tone"]]> = [
      ["P856", Globe2, "Website", "cyan"],
      ["P1454", Building2, "Legal form", "violet"],
      ["P127", Users, "Owned by", "amber"],
      ["P414", Star, "Exchange", "emerald"],
      ["P937", MapPin, "Work location", "cyan"],
      ["P1412", Languages, "Languages", "violet"],
      ["P140", Landmark, "Religion", "rose"],
      ["P463", Users, "Member of", "amber"],
      ["P138", Tag, "Named after", "cyan"],
      ["P740", MapPin, "Location of formation", "emerald"],
    ];
    for (const [pid, icon, label, tone] of fillers) {
      if (used.has(pid)) continue;
      const fact = f(pid);
      if (!fact) continue;
      if (items.some((i) => i.label.toLowerCase() === label.toLowerCase())) continue;
      pushFact(items, icon, label, fact, { tone, limit: 4 });
    }
  }

  return items.slice(0, 14);
}

type HeroKpi = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone: "cyan" | "emerald" | "amber" | "violet" | "rose";
};

type HeroMarketing = {
  kpis: HeroKpi[];
  products: Array<{ label: string; id?: string }>;
  industries: Array<{ label: string; id?: string }>;
  website?: string;
  stock?: string;
  tagline: string;
};

function shortMoney(label: string): string {
  // Already compact from API (e.g. "394.33B United States dollar") — trim unit noise
  return label
    .replace(/\s*United States dollar\b/gi, " USD")
    .replace(/\s*euro\b/gi, " EUR")
    .replace(/\s*pound sterling\b/gi, " GBP")
    .replace(/\s*Japanese yen\b/gi, " JPY")
    .replace(/\s*Indian rupee\b/gi, " INR")
    .trim();
}

function buildHeroMarketing(entity: EntitySummary): HeroMarketing {
  const f = (pid: string) => factOf(entity, pid);
  const kpis: HeroKpi[] = [];
  const products = labelsOf(entity, "P1056", 8);
  const industries = labelsOf(entity, "P452", 6);
  const website = entity.links.find((l) => l.kind === "website")?.url
    || f("P856")?.values.find((v) => v.label.startsWith("http"))?.label
    || f("P856")?.values[0]?.url;

  const ticker = f("P249")?.values[0]?.label;
  const exchange = f("P414")?.values[0]?.label;
  const stock = ticker ? (exchange ? `${ticker} · ${exchange}` : ticker) : exchange;

  if (entity.type === "organization") {
    const revenue = f("P2139")?.values[0]?.label;
    if (revenue) kpis.push({ icon: DollarSign, label: "Revenue", value: shortMoney(revenue), tone: "emerald" });
    const mcap = f("P2226")?.values[0]?.label;
    if (mcap) kpis.push({ icon: TrendingUp, label: "Market cap", value: shortMoney(mcap), tone: "cyan" });
    const profit = f("P2295")?.values[0]?.label;
    if (profit) kpis.push({ icon: BarChart3, label: "Net profit", value: shortMoney(profit), tone: "amber" });
    const employees = f("P1128")?.values[0]?.label;
    if (employees) kpis.push({ icon: Users, label: "Employees", value: employees, tone: "violet" });
    const assets = f("P2403")?.values[0]?.label;
    if (assets && kpis.length < 5) kpis.push({ icon: Layers, label: "Assets", value: shortMoney(assets), tone: "rose" });
    const founded = f("P571")?.values[0]?.label;
    if (founded && kpis.length < 5) {
      const y = founded.match(/\b(\d{4})\b/)?.[1] ?? compactDate(founded);
      kpis.push({ icon: Calendar, label: "Founded", value: y, hint: founded, tone: "cyan" });
    }
  } else if (entity.type === "person") {
    if (entity.lifespan) kpis.push({ icon: Calendar, label: "Lifespan", value: entity.lifespan, tone: "cyan" });
    const awards = f("P166")?.values.length;
    if (awards) kpis.push({ icon: Award, label: "Awards", value: String(awards), tone: "amber" });
    const works = f("P800")?.values.length;
    if (works) kpis.push({ icon: Star, label: "Notable works", value: String(works), tone: "violet" });
    const roles = f("P39")?.values.length || f("P106")?.values.length;
    if (roles) kpis.push({ icon: Briefcase, label: "Roles", value: String(roles), tone: "emerald" });
    const langs = f("P1412")?.values.length;
    if (langs) kpis.push({ icon: Languages, label: "Languages", value: String(langs), tone: "rose" });
  } else if (entity.type === "place") {
    const pop = f("P1082")?.values[0]?.label;
    if (pop) kpis.push({ icon: Users, label: "Population", value: pop, tone: "cyan" });
    const area = f("P2046")?.values[0]?.label;
    if (area) kpis.push({ icon: MapPin, label: "Area", value: area, tone: "emerald" });
    const elev = f("P2044")?.values[0]?.label;
    if (elev) kpis.push({ icon: TrendingUp, label: "Elevation", value: elev, tone: "amber" });
  }

  // Always fill remaining KPI slots with portfolio signals
  if (kpis.length < 4) kpis.push({ icon: Layers, label: "Properties", value: String(entity.facts.length), tone: "violet" });
  if (kpis.length < 4 && entity.related.length) {
    kpis.push({ icon: Network, label: "Connections", value: String(entity.related.length), tone: "cyan" });
  }
  if (kpis.length < 4 && entity.images.length) {
    kpis.push({ icon: ImageIcon, label: "Media", value: String(entity.images.length), tone: "rose" });
  }

  const tagline =
    entity.description ||
    industries.slice(0, 2).map((i) => i.label).join(" · ") ||
    entity.instanceOf.slice(0, 2).map((i) => i.label).join(" · ") ||
    "";

  return {
    kpis: kpis.slice(0, 5),
    products,
    industries: industries.length ? industries : entity.instanceOf.slice(0, 4).map((i) => ({ id: i.id, label: i.label })),
    website,
    stock,
    tagline,
  };
}

export default function EntityPage() {
  const { id: rawParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("timeline");
  const [resolvingLink, setResolvingLink] = useState(false);

  const parsed = useMemo(() => parseEntityParam(rawParam ?? ""), [rawParam]);

  const { data: slugQid, isLoading: resolvingSlug } = useQuery({
    queryKey: ["entity-slug", parsed.slug],
    queryFn: async () => {
      const q = (parsed.slug ?? "").replace(/-/g, " ").trim();
      if (!q) return null;
      const hits = await searchEntities(q, 8);
      return hits[0]?.id ?? null;
    },
    enabled: !parsed.qid && Boolean(parsed.slug),
    staleTime: 1000 * 60 * 60,
  });

  const qid = parsed.qid ?? slugQid ?? undefined;

  const { data: entity, isLoading, error } = useQuery({
    queryKey: ["entity", qid, "v15-hero-main-full"],
    queryFn: () => fetchEntitySummary(qid!),
    enabled: Boolean(qid),
    staleTime: 1000 * 60 * 30,
  });

  // Prefer /entity/albert-einstein-Q9458 over bare /entity/Q9458
  useEffect(() => {
    if (!entity || !qid || !rawParam) return;
    const canonical = entityPath(qid, entity.label);
    const current = `/entity/${rawParam}`;
    if (current !== canonical) {
      navigate(canonical, { replace: true });
    }
  }, [entity, qid, rawParam, navigate]);

  const pageLoading = isLoading || (!parsed.qid && resolvingSlug);

  const cfg = entity ? getEntityTypeConfig(entity.type) : null;
  const Icon = entity ? TYPE_ICONS[entity.type] : null;

  const occupations = useMemo(() => {
    if (!entity) return [] as string[];
    return labelsOf(entity, "P106", 4).map((v) => v.label);
  }, [entity]);

  const rolesLine = useMemo(() => {
    if (!entity) return "";
    if (occupations.length) return occupations.slice(0, 3).join(" · ");
    if (entity.type === "organization") {
      const industry = labelsOf(entity, "P452", 2).map((v) => v.label);
      if (industry.length) return industry.join(" · ");
    }
    return entity.instanceOf.slice(0, 3).map((i) => i.label).join(" · ");
  }, [entity, occupations]);

  const leadSnippet = useMemo(() => {
    if (!entity) return "";
    // Full Wikipedia lead for hero about fallback (AI may replace with richer prose)
    return (entity.wikipedia?.lead || entity.wikipediaSummary || entity.description || "").trim();
  }, [entity]);

  const tags = useMemo(() => {
    if (!entity) return [] as Array<{ id?: string; label: string }>;
    const buckets =
      entity.type === "organization"
        ? [
            ...labelsOf(entity, "P452", 3),
            ...labelsOf(entity, "P17", 1),
            ...labelsOf(entity, "P1056", 2),
            ...entity.instanceOf.slice(0, 3).map((i) => ({ id: i.id, label: i.label })),
            ...labelsOf(entity, "P1454", 1),
          ]
        : entity.type === "person"
          ? [
              ...labelsOf(entity, "P101", 2),
              ...labelsOf(entity, "P106", 3),
              ...labelsOf(entity, "P27", 1),
              ...entity.instanceOf.slice(0, 3).map((i) => ({ id: i.id, label: i.label })),
              ...labelsOf(entity, "P1412", 1),
            ]
          : [
              ...entity.instanceOf.slice(0, 4).map((i) => ({ id: i.id, label: i.label })),
              ...labelsOf(entity, "P17", 1),
              ...labelsOf(entity, "P136", 2),
            ];
    const seen = new Set<string>();
    return buckets
      .filter((t) => {
        const k = t.label.toLowerCase();
        if (seen.has(k) || k.length > 40) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 16);
  }, [entity]);

  const quickFacts = useMemo(() => (entity ? buildQuickFacts(entity) : []), [entity]);
  const wikiInfobox = useMemo(() => entity?.wikipedia?.infobox ?? [], [entity]);
  const marketing = useMemo(() => (entity ? buildHeroMarketing(entity) : null), [entity]);

  const categories = useMemo((): CategoryTab[] => {
    if (!entity) return [];

    // Default order: Timeline → Overview → fact sections → media…
    const tabs: CategoryTab[] = [
      {
        id: "timeline",
        title: "AI Timeline",
        count: entity.timeline.length || undefined,
        kind: "timeline",
      },
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
      tabs.push({ id: sid, title: SECTION_TITLES[sid], count: facts.length, kind: "facts", facts });
    }

    if (entity.images.length) {
      tabs.push({ id: "media", title: "Related Images", count: entity.images.length, kind: "media" });
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

  useEffect(() => {
    setActiveTab("timeline");
  }, [qid]);

  useEffect(() => {
    if (!categories.length) return;
    if (!categories.some((c) => c.id === activeTab)) {
      const prefer = categories.find((c) => c.id === "timeline") ?? categories[0];
      setActiveTab(prefer.id);
    }
  }, [categories, activeTab]);

  const activeIdx = Math.max(0, categories.findIndex((c) => c.id === activeTab));
  const active = categories[activeIdx] ?? categories[0];

  const readingMins = useMemo(() => {
    if (!entity) return 1;
    const words =
      (entity.wikipedia?.lead?.split(/\s+/).length ?? 0) +
      (entity.wikipedia?.html ? Math.round(entity.wikipedia.html.replace(/<[^>]+>/g, " ").split(/\s+/).length * 0.4) : 0) +
      entity.facts.length * 4;
    return Math.max(1, Math.round(words / 200));
  }, [entity]);

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
        if (qid) navigate(entityPath(qid));
        else toast.message(`No Wikidata entity for “${title}”`);
      } finally {
        setResolvingLink(false);
      }
      return;
    }

    if (/wikipedia\.org/i.test(href)) e.preventDefault();
  }, [navigate]);

  const goTab = (dir: -1 | 1) => {
    const next = activeIdx + dir;
    if (next < 0 || next >= categories.length) return;
    setActiveTab(categories[next].id);
  };

  const wiki = entity?.wikipedia;
  const breadcrumbMid = entity?.instanceOf[0]?.label || occupations[0] || cfg?.label;
  const signatureUrl =
    entity?.images.find((i) => i.propertyId === "P109")?.url ||
    entity?.images.find((i) => /signatur|autograph/i.test(i.filename))?.url;
  const portraitUrl =
    (entity?.type === "organization"
      ? entity.images.find((i) => i.propertyId === "P154")?.url ||
        entity.images.find((i) => i.propertyId === "P18")?.url
      : undefined) ||
    entity?.thumbnail ||
    entity?.images.find((i) => i.propertyId === "P18")?.url ||
    entity?.images.find(
      (i) =>
        i.propertyId !== "P109" &&
        !/signatur|autograph/i.test(i.filename) &&
        /\.(jpe?g|png|webp)$/i.test(i.filename),
    )?.url;

  return (
    <div className="min-h-screen bg-[#f4f7fb]">
      {/* Top nav — dark chrome over light page */}
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#0b1220]/96 backdrop-blur-md">
        {/* Row 1: brand + actions (search lives on row 2 on mobile) */}
        <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-4 py-2 sm:gap-3 md:px-5 md:py-2.5">
          <button
            onClick={() => navigate("/")}
            className="flex shrink-0 items-center gap-2 cursor-pointer"
          >
            <div className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/20 border border-cyan-400/30">
              <Network className="size-4 text-cyan-300" />
            </div>
            <span className="hidden sm:inline font-serif font-semibold text-white tracking-tight">Wikigraph</span>
          </button>
          <button
            onClick={() => navigate(-1)}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="hidden md:flex flex-1 min-w-0 items-center gap-1.5">
            <div className="flex-1 min-w-0">
              <SearchBox size="md" />
            </div>
            {qid && entity && (
              <SearchNamePeers name={entity.label} currentId={qid} />
            )}
          </div>
          {qid && entity && (
            <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
              <button
                type="button"
                onClick={() => {
                  setActiveTab("timeline");
                  requestAnimationFrame(() =>
                    document.getElementById("entity-main")?.scrollIntoView({ behavior: "smooth", block: "start" }),
                  );
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-[12px] font-medium cursor-pointer transition-colors",
                  activeTab === "timeline"
                    ? "bg-teal-400 text-slate-950"
                    : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white",
                )}
                title="AI Timeline"
              >
                <Sparkles className="size-3.5 shrink-0" />
                <span className="hidden md:inline">Timeline</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab("overview");
                  requestAnimationFrame(() =>
                    document.getElementById("entity-main")?.scrollIntoView({ behavior: "smooth", block: "start" }),
                  );
                }}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-[12px] font-medium cursor-pointer transition-colors",
                  activeTab === "overview"
                    ? "bg-teal-400 text-slate-950"
                    : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white",
                )}
                title="Overview"
              >
                <BookOpen className="size-3.5 shrink-0" />
                <span className="hidden md:inline">Overview</span>
              </button>
              <button
                type="button"
                onClick={() => navigate(`/graph/${qid}`)}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-[12px] font-medium text-slate-300 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer"
                title="Knowledge graph"
              >
                <Network className="size-3.5 text-teal-300 shrink-0" />
                <span className="hidden lg:inline">Graph</span>
              </button>
              {entity.type === "person" && (
                <button
                  type="button"
                  onClick={() => navigate(`/family-tree/${qid}`)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-[12px] font-medium text-slate-300 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer"
                  title="Family tree"
                >
                  <GitBranch className="size-3.5 text-teal-300 shrink-0" />
                  <span className="hidden lg:inline">Family</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => navigate(`/compare/${qid}`)}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-[12px] font-medium text-slate-300 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer"
                title="Compare"
              >
                <GitCompareArrows className="size-3.5 text-teal-300 shrink-0" />
                <span className="hidden lg:inline">Compare</span>
              </button>
            </div>
          )}
          <button
            onClick={handleShare}
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer",
              !(qid && entity) && "ml-auto",
            )}
            title="Copy link"
          >
            {copied ? <Check className="size-4 text-emerald-400" /> : <Share2 className="size-4" />}
          </button>
        </div>
        {/* Row 2 (mobile only): full-width search */}
        <div className="md:hidden border-t border-white/10 px-4 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <SearchBox size="md" />
            </div>
            {qid && entity && (
              <SearchNamePeers name={entity.label} currentId={qid} />
            )}
          </div>
        </div>
      </header>

      {pageLoading && (
        <div className="mx-auto max-w-[1600px] px-5 py-8 space-y-6">
          <Skeleton className="h-48 w-full rounded-2xl bg-slate-200/80" />
          <div className="grid lg:grid-cols-[200px_1fr] gap-5">
            <Skeleton className="h-72 hidden lg:block rounded-xl bg-slate-200/80" />
            <Skeleton className="h-96 rounded-xl bg-slate-200/80" />
          </div>
        </div>
      )}

      {!pageLoading && !qid && (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <HelpCircle className="size-5 text-red-500" />
          <p className="text-slate-900 font-medium">Could not find this entity</p>
          <button onClick={() => navigate("/")} className="mt-2 text-teal-700 text-sm hover:underline cursor-pointer">
            Back to search
          </button>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <HelpCircle className="size-5 text-red-500" />
          <p className="text-slate-900 font-medium">Could not load this entity</p>
          <button onClick={() => navigate("/")} className="mt-2 text-teal-700 text-sm hover:underline cursor-pointer">
            Back to search
          </button>
        </div>
      )}

      {entity && cfg && Icon && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <EntityHero
            entity={entity}
            qid={qid!}
            cfg={cfg}
            Icon={Icon}
            portraitUrl={portraitUrl}
            signatureUrl={signatureUrl}
            rolesLine={rolesLine}
            leadSnippet={leadSnippet}
            breadcrumbMid={breadcrumbMid}
            tags={tags}
            marketing={marketing}
            wikiInfobox={wikiInfobox}
            quickFacts={quickFacts}
          />

          {/* Primary surfaces — directly under hero */}
          <nav
            aria-label="Explore this entity"
            className="sticky top-[6.75rem] z-20 border-b border-slate-200/80 bg-[#f4f7fb]/95 backdrop-blur-md md:top-[3.25rem]"
          >
            <div className="mx-auto max-w-[1600px] px-4 py-2.5 sm:px-5">
              <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1">
                {(
                  [
                    {
                      id: "timeline" as const,
                      label: "Timeline",
                      hint: "Year-by-year",
                      icon: Sparkles,
                      action: () => setActiveTab("timeline"),
                      selected: activeTab === "timeline",
                    },
                    {
                      id: "overview" as const,
                      label: "Overview",
                      hint: "Full biography",
                      icon: BookOpen,
                      action: () => setActiveTab("overview"),
                      selected: activeTab === "overview",
                    },
                    {
                      id: "graph" as const,
                      label: "Knowledge graph",
                      hint: "Relations map",
                      icon: Network,
                      action: () => navigate(`/graph/${qid}`),
                      selected: false,
                    },
                    ...(entity.type === "person"
                      ? [
                          {
                            id: "family-tree" as const,
                            label: "Family tree",
                            hint: "Kinship links",
                            icon: GitBranch,
                            action: () => navigate(`/family-tree/${qid}`),
                            selected: false,
                          },
                        ]
                      : []),
                    {
                      id: "compare" as const,
                      label: "Compare",
                      hint: "Side-by-side",
                      icon: GitCompareArrows,
                      action: () => navigate(`/compare/${qid}`),
                      selected: false,
                    },
                  ] as const
                ).map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={item.action}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-left cursor-pointer transition-all",
                        item.selected
                          ? "border-teal-600 bg-teal-600 text-white shadow-sm shadow-teal-600/20"
                          : "border-slate-200 bg-white text-slate-700 hover:border-teal-300 hover:bg-teal-50/60",
                      )}
                    >
                      <ItemIcon
                        className={cn(
                          "size-4 shrink-0",
                          item.selected ? "text-white" : "text-teal-600",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold leading-tight">
                          {item.label}
                        </span>
                        <span
                          className={cn(
                            "hidden sm:block text-[11px] leading-tight",
                            item.selected ? "text-teal-100" : "text-slate-500",
                          )}
                        >
                          {item.hint}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>

          {/* ═══════════════ BODY (light) ═══════════════ */}
          <section
            id="entity-main"
            className="entity-body bg-[#f4f7fb] text-slate-800 min-h-[70vh] scroll-mt-28"
          >
            <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-5 md:px-6 md:py-8 pb-24">
              {resolvingLink && (
                <p className="mb-3 text-xs text-cyan-700 animate-pulse">Opening linked entity…</p>
              )}

              {/* Mobile TOC / section pills */}
              <nav className="lg:hidden mb-4 -mx-1 overflow-x-auto px-1">
                <div className="flex min-w-max gap-1.5 pb-1">
                  {activeTab === "overview" && wiki?.toc && wiki.toc.length > 0
                    ? wiki.toc.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            const main = item.mainArticleTitle
                              ? document.getElementById(`main-${item.id}`)
                              : null;
                            (main ?? document.getElementById(item.id))?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-cyan-800 shadow-sm cursor-pointer"
                        >
                          {item.title}
                        </button>
                      ))
                    : categories.map((cat) => {
                        const selected = cat.id === activeTab;
                        const CatIcon = SECTION_ICONS[cat.id] ?? BookOpen;
                        return (
                          <button
                            key={cat.id}
                            onClick={() => setActiveTab(cat.id)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium cursor-pointer transition-all",
                              selected
                                ? "border-transparent bg-gradient-to-r from-cyan-500 to-sky-500 text-white shadow-md shadow-cyan-500/25"
                                : "border-slate-200 bg-white text-slate-600 hover:text-slate-900"
                            )}
                          >
                            <CatIcon className={cn("size-3.5", selected ? "opacity-95" : "opacity-70")} />
                            {cat.title}
                          </button>
                        );
                      })}
                </div>
              </nav>

              {/* TOC + content — Timeline is full width (no left Contents) */}
              <div
                className={cn(
                  "grid gap-5 items-start",
                  activeTab === "timeline"
                    ? "grid-cols-1"
                    : "lg:grid-cols-[220px_minmax(0,1fr)]",
                )}
              >
                {activeTab !== "timeline" && (
                <div className="hidden lg:block sticky top-[4.5rem] space-y-3">
                  {activeTab === "overview" && wiki?.toc && wiki.toc.length > 0 ? (
                    <WikiTocNav toc={wiki.toc} readingMins={readingMins} />
                  ) : (
                    <nav className="rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/50 overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
                        <List className="size-4 text-cyan-600" />
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Contents</p>
                      </div>
                      <ul className="p-2 space-y-0.5 max-h-[calc(100vh-12rem)] overflow-auto">
                        {categories.map((cat) => {
                          const selected = cat.id === activeTab;
                          const CatIcon = SECTION_ICONS[cat.id] ?? BookOpen;
                          return (
                            <li key={cat.id}>
                              <button
                                onClick={() => setActiveTab(cat.id)}
                                className={cn(
                                  "relative flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 pl-3.5 text-left text-sm cursor-pointer transition-all",
                                  selected
                                    ? "bg-gradient-to-r from-cyan-50 via-sky-50 to-white text-cyan-950 font-semibold shadow-sm ring-1 ring-cyan-200/90"
                                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                                )}
                              >
                                {selected && (
                                  <span className="absolute inset-y-1.5 left-1 w-1 rounded-full bg-gradient-to-b from-cyan-400 to-sky-600" />
                                )}
                                <span
                                  className={cn(
                                    "flex size-7 shrink-0 items-center justify-center rounded-lg",
                                    selected
                                      ? "bg-cyan-500 text-white"
                                      : "bg-slate-100 text-slate-500",
                                  )}
                                >
                                  <CatIcon className="size-3.5" />
                                </span>
                                <span className="flex-1 truncate">{cat.title}</span>
                                {selected && (
                                  <span className="size-1.5 shrink-0 rounded-full bg-cyan-500" />
                                )}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="border-t border-slate-100 px-4 py-3 flex items-center gap-2 text-xs text-slate-500">
                        <Clock className="size-3.5" />
                        {readingMins} min read
                      </div>
                    </nav>
                  )}
                  {activeTab === "overview" && wiki?.toc && wiki.toc.length > 0 && (
                    <div className="rounded-2xl border border-slate-200/80 bg-white/90 px-3 py-2.5 text-[11px] text-slate-500">
                      <button
                        type="button"
                        className="font-medium text-cyan-800 hover:underline cursor-pointer"
                        onClick={() => setActiveTab("timeline")}
                      >
                        More sections →
                      </button>
                      <span className="mx-1.5 text-slate-300">·</span>
                      Facts, timeline, media
                    </div>
                  )}
                </div>
                )}

                <div className="min-w-0 w-full rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/40">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 sm:px-8 py-3.5 bg-gradient-to-r from-slate-50 to-cyan-50/40 rounded-t-2xl">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        onClick={() => goTab(-1)}
                        disabled={activeIdx <= 0}
                        className="flex size-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-40 cursor-pointer hover:text-slate-800"
                      >
                        <ChevronLeft className="size-4" />
                      </button>
                      <button
                        onClick={() => goTab(1)}
                        disabled={activeIdx >= categories.length - 1}
                        className="flex size-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 disabled:opacity-40 cursor-pointer hover:text-slate-800"
                      >
                        <ChevronRight className="size-4" />
                      </button>
                      <span className="text-sm text-slate-500 font-medium truncate">
                        {activeIdx + 1} / {categories.length}
                      </span>
                    </div>
                    <div className="hidden sm:block h-1.5 flex-1 max-w-[200px] rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-cyan-500 transition-all"
                        style={{ width: `${((activeIdx + 1) / Math.max(categories.length, 1)) * 100}%` }}
                      />
                    </div>
                  </div>

                  <div className="px-5 sm:px-8 lg:px-10 py-7 sm:py-9">
                    <div className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 pb-6">
                      <div className="flex items-center gap-3.5 min-w-0">
                        {(() => {
                          const TabIcon = SECTION_ICONS[active?.id ?? "overview"] ?? BookOpen;
                          return (
                            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-50 to-slate-50 text-cyan-700 border border-cyan-100 shadow-sm">
                              <TabIcon className="size-6" />
                            </div>
                          );
                        })()}
                        <div className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700/80 mb-1">
                            {entity.label}
                          </p>
                          <h2 className="font-serif text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
                            {active?.title ?? "Overview"}
                          </h2>
                        </div>
                      </div>
                      {active?.count != null && active.count > 0 && (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-mono text-slate-600">
                          {active.count} items
                        </span>
                      )}
                    </div>

                    <AnimatePresence mode="wait">
                      <motion.div
                        key={active?.id ?? "empty"}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.2 }}
                        className="w-full"
                      >
                        {active?.kind === "overview" && (
                          <OverviewPanel
                            entity={entity}
                            wiki={wiki}
                            hasArticle={Boolean(wiki?.html || wiki?.lead)}
                            onArticleClick={onArticleClick}
                            entityLabel={entity.label}
                            thumbnail={portraitUrl}
                          />
                        )}

                        {active?.kind === "facts" && active.facts && (() => {
                          const enrichSection = maybeFactsEnrichSection(active.id);
                          return (
                            <div className="space-y-8">
                              {enrichSection && (
                                <FactsBriefBlock
                                  section={enrichSection}
                                  entity={entity}
                                  onNavigate={navigate}
                                />
                              )}
                              <KeyHighlights facts={active.facts.slice(0, 6)} onNavigate={navigate} />
                              <FactsPanel facts={active.facts} onNavigate={navigate} light />
                            </div>
                          );
                        })()}

                        {active?.kind === "timeline" && (
                          <TimelinePanel
                            entity={entity}
                            color={cfg.color}
                            onNavigate={navigate}
                            portraitUrl={portraitUrl}
                          />
                        )}

                        {active?.kind === "media" && (
                          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                            {entity.images.map((img, i) => (
                              <a
                                key={`${img.propertyId}-${img.filename}`}
                                href={img.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={cn(
                                  "group relative block overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm",
                                  i === 0 && "md:col-span-2 md:row-span-2"
                                )}
                              >
                                <img
                                  src={img.thumb}
                                  alt={img.property}
                                  className={cn(
                                    "w-full object-cover transition-transform duration-500 group-hover:scale-105",
                                    i === 0 ? "aspect-[4/3] md:aspect-square md:h-full" : "aspect-square"
                                  )}
                                  loading="lazy"
                                />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-900/70 to-transparent px-3 py-2.5">
                                  <p className="truncate text-sm font-medium text-white">{img.property}</p>
                                </div>
                              </a>
                            ))}
                          </div>
                        )}

                        {active?.kind === "languages" && wiki?.otherLanguages && (
                          <div className="grid md:grid-cols-2 gap-5">
                            {wiki.otherLanguages.map((lang) => (
                              <div
                                key={lang.lang}
                                className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-6 shadow-sm"
                              >
                                <div className="mb-3 flex items-center gap-2">
                                  <Languages className="size-4 text-cyan-600" />
                                  <h3 className="font-serif text-xl font-semibold text-slate-900">
                                    {lang.langName}
                                  </h3>
                                </div>
                                <p className="mb-3 text-sm font-medium text-slate-500">{lang.title}</p>
                                <p className="whitespace-pre-wrap text-[15px] leading-[1.75] text-slate-700">
                                  {lang.extract}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        {active?.kind === "identifiers" && active.facts && (
                          <FactsPanel facts={active.facts} onNavigate={navigate} light />
                        )}

                        {active?.kind === "related" && (
                          <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                            {entity.related.map((r) => (
                              <li key={`${r.id}-${r.propertyId}`}>
                                <button
                                  onClick={() => navigate(entityPath(r.id, r.label))}
                                  className="group flex h-full w-full flex-col rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-cyan-50/30 p-5 text-left shadow-sm transition-all hover:border-cyan-300 hover:shadow-md cursor-pointer"
                                >
                                  <span className="mb-2 inline-flex w-fit rounded-full bg-cyan-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-700">
                                    {r.relation}
                                  </span>
                                  <span className="font-serif text-lg font-semibold text-slate-900 group-hover:text-cyan-800">
                                    {r.label}
                                  </span>
                                  {r.description && (
                                    <span className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-500">
                                      {r.description}
                                    </span>
                                  )}
                                  <span className="mt-auto pt-4 text-sm font-medium text-cyan-600 opacity-0 transition-opacity group-hover:opacity-100">
                                    Open →
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
            </div>
          </section>
        </motion.div>
      )}
    </div>
  );
}

function OverviewPanel({
  entity,
  wiki,
  hasArticle,
  onArticleClick,
  entityLabel,
  thumbnail,
}: {
  entity: EntitySummary;
  wiki?: WikipediaArticle;
  hasArticle: boolean;
  onArticleClick: (e: MouseEvent<HTMLElement>) => void;
  entityLabel: string;
  thumbnail?: string;
}) {
  const quote = wiki?.lead?.split(/(?<=\.)\s+/).find((s) => s.length > 40 && s.length < 180);

  return (
    <div className="space-y-5">
      <OverviewCapsuleBlock entity={entity} />

      {!hasArticle ? (
        <p className="text-sm text-slate-500">
          No encyclopedia article found for {entityLabel}. Browse the table of contents for structured facts, timeline, and media.
        </p>
      ) : (
        <>
          {quote && (
            <blockquote className="relative rounded-2xl border border-cyan-200/70 bg-cyan-50/70 px-5 py-4 pl-14">
              <Quote className="absolute left-4 top-4 size-6 text-cyan-500/70" />
              <p className="text-[15px] leading-relaxed text-slate-700 italic">{quote.trim()}</p>
              <footer className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                {thumbnail && <img src={thumbnail} alt="" className="size-6 rounded-full object-cover object-top" />}
                — {entityLabel}
              </footer>
            </blockquote>
          )}

          {wiki?.html ? (
            <WikiArticleWithMainEmbeds
              entity={entity}
              html={wiki.html}
              articles={wiki.mainArticles}
              onArticleClick={onArticleClick}
            />
          ) : (
            <div className="space-y-4">
              {wiki?.lead && (
                <div className="space-y-3">
                  {wiki.lead.split(/\n{2,}/).filter(Boolean).map((para, i) => (
                    <p key={i} className="text-[15px] leading-[1.75] text-slate-700">{para.trim()}</p>
                  ))}
                </div>
              )}
              {wiki?.sections.map((section, i) => (
                <div
                  key={`${section.title}-${i}`}
                  id={`wiki-sec-${section.title.replace(/[^a-zA-Z0-9]+/g, "_")}`}
                  className="scroll-mt-28 pt-2"
                >
                  <h3 className={cn("font-serif font-semibold text-slate-900 mb-2", section.level >= 3 ? "text-base" : "text-lg")}>
                    {section.title}
                  </h3>
                  <div className="space-y-3">
                    {section.content.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((para, j) => (
                      <p key={j} className="text-[14.5px] leading-[1.75] text-slate-700 whitespace-pre-wrap">{para}</p>
                    ))}
                  </div>
                </div>
              ))}
              {wiki?.mainArticles && wiki.mainArticles.length > 0 && (
                <WikiArticleWithMainEmbeds
                  entity={entity}
                  html=""
                  articles={wiki.mainArticles}
                  onArticleClick={onArticleClick}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KeyHighlights({ facts, onNavigate }: { facts: EntityFact[]; onNavigate: (path: string) => void }) {
  if (!facts.length) return null;
  return (
    <div>
      <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Spotlight</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {facts.map((f, i) => (
          <div
            key={f.propertyId}
            className={cn(
              "rounded-2xl border p-5 shadow-sm",
              i === 0
                ? "sm:col-span-2 xl:col-span-1 border-cyan-200 bg-gradient-to-br from-cyan-50 to-white"
                : "border-slate-200 bg-gradient-to-br from-white to-slate-50"
            )}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-cyan-700/80 mb-2">
              {f.property}
            </p>
            <div className="flex flex-wrap gap-2">
              {f.values.slice(0, 4).map((v, j) =>
                v.id ? (
                  <button
                    key={j}
                    onClick={() => onNavigate(entityPath(v.id!, v.label))}
                    className="rounded-lg border border-cyan-200/80 bg-white px-3 py-1.5 text-[15px] font-medium text-cyan-900 hover:bg-cyan-50 cursor-pointer"
                  >
                    {v.label}
                  </button>
                ) : (
                  <span key={j} className="text-[15px] font-medium text-slate-800 leading-relaxed">
                    {v.label}
                  </span>
                )
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


function FactsPanel({
  facts,
  onNavigate,
  light = false,
}: {
  facts: EntityFact[];
  onNavigate: (path: string) => void;
  light?: boolean;
}) {
  return (
    <div>
      <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">All details</p>
      <div className="grid gap-4 md:grid-cols-2">
        {facts.map((fact) => (
          <article
            key={fact.propertyId}
            className={cn(
              "rounded-2xl border p-5 transition-shadow hover:shadow-md",
              light
                ? "border-slate-200 bg-white"
                : "border-border/50 bg-background/25"
            )}
          >
            <h3
              className={cn(
                "mb-3 text-sm font-semibold uppercase tracking-[0.12em]",
                light ? "text-slate-500" : "text-muted-foreground"
              )}
            >
              {fact.property}
            </h3>
            <div className="flex flex-wrap gap-2.5">
              {fact.values.map((v, j) =>
                v.id ? (
                  <button
                    key={j}
                    onClick={() => onNavigate(entityPath(v.id!, v.label))}
                    className={cn(
                      "rounded-xl border px-3.5 py-2 text-[15px] font-medium transition-colors cursor-pointer",
                      light
                        ? "border-cyan-200 bg-cyan-50 text-cyan-900 hover:bg-cyan-100"
                        : "border-primary/25 bg-primary/8 text-primary hover:bg-primary/20"
                    )}
                  >
                    {v.label}
                  </button>
                ) : v.url ? (
                  <a
                    key={j}
                    href={v.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "text-[15px] break-all hover:underline",
                      light ? "text-cyan-700" : "text-primary"
                    )}
                  >
                    {v.label}
                  </a>
                ) : (
                  <span
                    key={j}
                    className={cn(
                      "text-[15px] leading-relaxed",
                      light ? "text-slate-800" : "text-foreground/85"
                    )}
                  >
                    {v.label}
                  </span>
                )
              )}
            </div>
            {fact.values.some((v) => v.qualifiers?.length) && (
              <ul className="mt-3 space-y-1 border-t border-slate-100 pt-3">
                {fact.values.flatMap((v, vi) =>
                  (v.qualifiers ?? []).map((q, qi) => (
                    <li
                      key={`${vi}-${qi}`}
                      className={cn("text-sm", light ? "text-slate-500" : "text-muted-foreground")}
                    >
                      <span className="opacity-70">{q.property}: </span>
                      {q.id ? (
                        <button
                          onClick={() => onNavigate(entityPath(q.id!, q.label))}
                          className={cn(
                            "hover:underline cursor-pointer",
                            light ? "text-cyan-700" : "text-primary"
                          )}
                        >
                          {q.label}
                        </button>
                      ) : (
                        q.label
                      )}
                    </li>
                  ))
                )}
              </ul>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
