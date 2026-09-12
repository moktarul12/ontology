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
  Network, GitBranch, ArrowLeft, ChevronRight, ChevronLeft,
  User, MapPin, Building2, Lightbulb, Calendar, HelpCircle,
  BookOpen, Copy, Check, Share2, ExternalLink,
  Image as ImageIcon, Link2, Clock, Sparkles, Film, Languages,
  Briefcase, Heart, Tag, GraduationCap, Landmark, Star, FlaskConical,
  List, Quote, ShieldCheck, Users, Globe2, Factory, Award, Layers,
  TrendingUp, DollarSign, BarChart3, Package,
} from "lucide-react";
import SearchBox from "@/components/search/SearchBox.tsx";
import { cn } from "@/lib/utils.ts";
import type { EntityType, EntityFact, EntitySummary, WikipediaArticle } from "@/lib/wikidata/types.ts";
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

const TYPE_BREADCRUMB: Record<EntityType, string> = {
  person: "People",
  place: "Places",
  organization: "Organizations",
  concept: "Concepts",
  event: "Events",
  work: "Works",
  unknown: "Entities",
};

const GLANCE_IDS: Record<EntityType, string[]> = {
  person: ["P735", "P734", "P569", "P570", "P19", "P20", "P27", "P106", "P69", "P166", "P140", "P39", "P108", "P800", "P1412"],
  place: ["P17", "P131", "P1082", "P36", "P625", "P37", "P6", "P421", "P571", "P138"],
  organization: ["P571", "P112", "P159", "P17", "P452", "P169", "P1128", "P1056", "P749", "P127", "P1454", "P856", "P414", "P2403", "P2139"],
  event: ["P585", "P580", "P582", "P276", "P17", "P710", "P664", "P1542"],
  concept: ["P31", "P279", "P361", "P495", "P527", "P138"],
  work: ["P577", "P50", "P57", "P136", "P495", "P161", "P170", "P86", "P123"],
  unknown: ["P31", "P17", "P571", "P131", "P276"],
};

type QuickFact = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  lines: Array<{ text: string; id?: string }>;
  tone?: "cyan" | "violet" | "amber" | "emerald" | "rose";
};

type QuickMetric = { label: string; value: string };

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
    pushFact(items, FlaskConical, "Field", f("P101"), { tone: "violet", limit: 2 });
    pushFact(items, GraduationCap, "Education", f("P69"), { tone: "cyan", limit: 2 });
    pushFact(items, Award, "Awards", f("P166"), { tone: "amber", limit: 2 });
    pushFact(items, Briefcase, "Employer", f("P108"), { tone: "emerald", limit: 2 });
    pushFact(items, Heart, "Spouse", f("P26"), { tone: "rose", limit: 2 });
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

  // Fill remaining slots from high-signal leftover facts
  if (items.length < 6) {
    const used = new Set(
      ["P569", "P570", "P19", "P20", "P571", "P112", "P159", "P17", "P452", "P169", "P106", "P101", "P800", "P1449", "P39", "P69", "P166", "P108", "P26", "P27", "P31", "P1056", "P749", "P1128", "P131", "P1082", "P36", "P577", "P50", "P57", "P136", "P495", "P161", "P585", "P580", "P276", "P710", "P279"]
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
      if (items.length >= 7) break;
      if (used.has(pid)) continue;
      const fact = f(pid);
      if (!fact) continue;
      pushFact(items, icon, label, fact, { tone, limit: 2 });
    }
    // last resort: any remaining non-identifier facts
    for (const fact of entity.facts) {
      if (items.length >= 7) break;
      if (IMAGE_PROPERTY_IDS.has(fact.propertyId)) continue;
      if (IDENTIFIER_PROPERTY_IDS.has(fact.propertyId)) continue;
      if (items.some((i) => i.label.toLowerCase() === fact.property.toLowerCase())) continue;
      pushFact(items, Tag, fact.property, fact, { tone: "cyan", limit: 2 });
    }
  }

  return items.slice(0, 7);
}

function buildQuickMetrics(entity: EntitySummary): QuickMetric[] {
  const metrics: QuickMetric[] = [];
  const yearFrom = (pid: string) => {
    const raw = factOf(entity, pid)?.values[0]?.label ?? "";
    const m = raw.match(/\b(\d{4})\b/);
    return m?.[1];
  };

  if (entity.type === "organization") {
    const y = yearFrom("P571");
    if (y) metrics.push({ label: "Since", value: y });
    const emp = factOf(entity, "P1128")?.values[0]?.label;
    if (emp) metrics.push({ label: "Staff", value: emp.replace(/\s+/g, " ").slice(0, 12) });
    const industry = factOf(entity, "P452")?.values.length;
    if (industry) metrics.push({ label: "Industries", value: String(industry) });
  } else if (entity.type === "person") {
    if (entity.lifespan) metrics.push({ label: "Lifespan", value: entity.lifespan.replace(/\s/g, "") });
    const awards = factOf(entity, "P166")?.values.length;
    if (awards) metrics.push({ label: "Awards", value: String(awards) });
    const works = factOf(entity, "P800")?.values.length;
    if (works) metrics.push({ label: "Works", value: String(works) });
  } else if (entity.type === "place") {
    const pop = factOf(entity, "P1082")?.values[0]?.label;
    if (pop) metrics.push({ label: "Pop.", value: pop.split(" ")[0] });
    const y = yearFrom("P571");
    if (y) metrics.push({ label: "Since", value: y });
  }

  if (metrics.length < 3) metrics.push({ label: "Facts", value: String(entity.facts.length) });
  if (metrics.length < 3 && entity.related.length) metrics.push({ label: "Links", value: String(entity.related.length) });
  if (metrics.length < 3 && entity.images.length) metrics.push({ label: "Media", value: String(entity.images.length) });
  return metrics.slice(0, 3);
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
  const [activeTab, setActiveTab] = useState("overview");
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
    queryKey: ["entity", qid, "v10-biz-hero"],
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
    const raw = entity.wikipedia?.lead || entity.wikipediaSummary || entity.description || "";
    const cut = raw.split(/(?<=\.)\s+/).slice(0, 3).join(" ");
    return cut.length > 360 ? `${cut.slice(0, 340).trim()}…` : cut;
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
      .slice(0, 8);
  }, [entity]);

  const quickFacts = useMemo(() => (entity ? buildQuickFacts(entity) : []), [entity]);
  const quickMetrics = useMemo(() => (entity ? buildQuickMetrics(entity) : []), [entity]);
  const marketing = useMemo(() => (entity ? buildHeroMarketing(entity) : null), [entity]);

  const glanceFacts = useMemo(() => {
    if (!entity) return [] as EntityFact[];
    const ids = GLANCE_IDS[entity.type] ?? GLANCE_IDS.unknown;
    const picked = ids
      .map((pid) => entity.facts.find((f) => f.propertyId === pid))
      .filter((f): f is EntityFact => Boolean(f));
    if (picked.length >= 6) return picked.slice(0, 12);
    const extra = entity.facts.filter(
      (f) =>
        !IMAGE_PROPERTY_IDS.has(f.propertyId) &&
        !IDENTIFIER_PROPERTY_IDS.has(f.propertyId) &&
        !picked.some((p) => p.propertyId === f.propertyId)
    );
    return [...picked, ...extra].slice(0, 12);
  }, [entity]);

  const categories = useMemo((): CategoryTab[] => {
    if (!entity) return [];

    const tabs: CategoryTab[] = [{ id: "overview", title: "Overview", kind: "overview" }];

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

    if (entity.timeline.length) {
      tabs.push({ id: "timeline", title: "Timeline", count: entity.timeline.length, kind: "timeline" });
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
    if (!categories.length) return;
    if (!categories.some((c) => c.id === activeTab)) setActiveTab(categories[0].id);
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
  const portraitUrl =
    (entity?.type === "organization"
      ? entity.images.find((i) => i.propertyId === "P154")?.url ||
        entity.images.find((i) => i.propertyId === "P18")?.url
      : undefined) ||
    entity?.thumbnail ||
    entity?.images.find((i) => i.propertyId === "P18")?.url ||
    entity?.images.find((i) => /\.(jpe?g|png|webp|svg)$/i.test(i.filename))?.url;

  return (
    <div className="min-h-screen bg-[#0b1220]">
      {/* Top nav */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0b1220]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] items-center gap-3 px-5 py-2.5">
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
          <div className="flex-1 min-w-0">
            <SearchBox size="md" />
          </div>
          <button
            onClick={handleShare}
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Copy link"
          >
            {copied ? <Check className="size-4 text-emerald-400" /> : <Share2 className="size-4" />}
          </button>
        </div>
      </header>

      {pageLoading && (
        <div className="mx-auto max-w-[1600px] px-5 py-8 space-y-6">
          <Skeleton className="h-64 w-full rounded-2xl bg-white/10" />
          <div className="grid lg:grid-cols-[200px_1fr_260px] gap-5">
            <Skeleton className="h-72 hidden lg:block rounded-xl bg-white/10" />
            <Skeleton className="h-96 rounded-xl bg-white/10" />
            <Skeleton className="h-72 hidden lg:block rounded-xl bg-white/10" />
          </div>
        </div>
      )}

      {!pageLoading && !qid && (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <HelpCircle className="size-5 text-red-400" />
          <p className="text-white font-medium">Could not find this entity</p>
          <button onClick={() => navigate("/")} className="mt-2 text-cyan-300 text-sm hover:underline cursor-pointer">
            Back to search
          </button>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
          <HelpCircle className="size-5 text-red-400" />
          <p className="text-white font-medium">Could not load this entity</p>
          <button onClick={() => navigate("/")} className="mt-2 text-cyan-300 text-sm hover:underline cursor-pointer">
            Back to search
          </button>
        </div>
      )}

      {entity && cfg && Icon && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          {/* ═══════════════ HERO — brand / marketing / business ═══════════════ */}
          <section className="relative overflow-hidden border-b border-white/10">
            <div
              className="absolute inset-0"
              style={{
                background: `
                  radial-gradient(ellipse 50% 80% at 0% 0%, ${cfg.color}28 0%, transparent 50%),
                  radial-gradient(ellipse 45% 60% at 100% 100%, #22d3ee18 0%, transparent 45%),
                  linear-gradient(165deg, #0a1628 0%, #0f1c33 42%, #0c1526 100%)
                `,
              }}
            />
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage: "linear-gradient(rgba(148,163,184,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.35) 1px, transparent 1px)",
                backgroundSize: "48px 48px",
              }}
            />

            <div className="relative mx-auto max-w-[1600px] px-5 py-7 md:py-10 space-y-5 md:space-y-6">
              <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-center lg:items-start">
                <div className="relative shrink-0">
                  {portraitUrl ? (
                    <img
                      src={portraitUrl}
                      alt={entity.label}
                      referrerPolicy="no-referrer"
                      className={cn(
                        "rounded-2xl border border-white/15 shadow-[0_24px_50px_-18px_rgba(0,0,0,0.7)] bg-slate-800 object-cover",
                        entity.type === "organization"
                          ? "size-28 sm:size-32 object-contain p-3 bg-white/95"
                          : "size-36 sm:size-40 lg:size-44 object-top"
                      )}
                    />
                  ) : (
                    <div className={cn("size-32 sm:size-36 rounded-2xl border border-dashed flex items-center justify-center", cfg.borderClass, cfg.bgClass)}>
                      <Icon className={cn("size-12 opacity-40", cfg.textClass)} />
                    </div>
                  )}
                  {marketing?.stock && (
                    <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-mono font-semibold text-emerald-200 backdrop-blur-sm">
                      {marketing.stock}
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1 text-center lg:text-left">
                  <nav className="mb-2 flex flex-wrap items-center justify-center lg:justify-start gap-1.5 text-[11px] text-slate-400">
                    <button onClick={() => navigate("/")} className="hover:text-cyan-300 cursor-pointer">
                      {TYPE_BREADCRUMB[entity.type]}
                    </button>
                    <ChevronRight className="size-3 opacity-50" />
                    {breadcrumbMid && (
                      <>
                        <span className="text-slate-300">{breadcrumbMid}</span>
                        <ChevronRight className="size-3 opacity-50" />
                      </>
                    )}
                    <span className="text-white/85 font-medium truncate max-w-[220px]">{entity.label}</span>
                  </nav>

                  <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2.5">
                    <h1 className="font-serif text-[2rem] sm:text-4xl xl:text-[2.7rem] font-bold tracking-tight text-white leading-[1.05] text-balance">
                      {entity.label}
                    </h1>
                    <span className={cn("rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider", cfg.bgClass, cfg.textClass, cfg.borderClass)}>
                      {cfg.label}
                    </span>
                  </div>

                  {(marketing?.tagline || rolesLine) && (
                    <p className="mt-2 text-sm md:text-[15px] text-cyan-200/85 font-medium">
                      {marketing?.tagline || rolesLine}
                    </p>
                  )}

                  {leadSnippet && (
                    <p className="mt-3 text-[14px] md:text-[15px] leading-relaxed text-slate-300/90 max-w-3xl mx-auto lg:mx-0">
                      {leadSnippet}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap justify-center lg:justify-start gap-2">
                    {(marketing?.industries.length ? marketing.industries : tags).slice(0, 6).map((t) => (
                      <button
                        key={`ind-${t.label}`}
                        onClick={() => t.id && navigate(entityPath(t.id, t.label))}
                        className={cn(
                          "rounded-full border border-cyan-300/35 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-100",
                          t.id && "hover:bg-cyan-400/20 cursor-pointer"
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                    {marketing?.website && (
                      <a
                        href={marketing.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs font-medium text-white/90 hover:bg-white/10"
                      >
                        <ExternalLink className="size-3" /> Official site
                      </a>
                    )}
                  </div>

                  {marketing && marketing.products.length > 0 && (
                    <div className="mt-3.5">
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 flex items-center justify-center lg:justify-start gap-1.5">
                        <Package className="size-3" /> Product & offering line
                      </p>
                      <div className="flex flex-wrap justify-center lg:justify-start gap-1.5">
                        {marketing.products.map((p) => (
                          <button
                            key={p.label}
                            onClick={() => p.id && navigate(entityPath(p.id, p.label))}
                            className={cn(
                              "rounded-lg border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[12px] text-slate-200",
                              p.id && "hover:border-cyan-400/40 hover:text-cyan-100 cursor-pointer"
                            )}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {marketing && marketing.kpis.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
                  {marketing.kpis.map((kpi) => {
                    const KIcon = kpi.icon;
                    const tone =
                      kpi.tone === "emerald" ? "from-emerald-500/20 to-emerald-500/5 border-emerald-400/25 text-emerald-200"
                      : kpi.tone === "amber" ? "from-amber-500/20 to-amber-500/5 border-amber-400/25 text-amber-200"
                      : kpi.tone === "violet" ? "from-violet-500/20 to-violet-500/5 border-violet-400/25 text-violet-200"
                      : kpi.tone === "rose" ? "from-rose-500/20 to-rose-500/5 border-rose-400/25 text-rose-200"
                      : "from-cyan-500/20 to-cyan-500/5 border-cyan-400/25 text-cyan-200";
                    return (
                      <div
                        key={kpi.label}
                        className={cn("rounded-2xl border bg-gradient-to-br px-3.5 py-3 backdrop-blur-sm", tone)}
                        title={kpi.hint}
                      >
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-80">
                          <KIcon className="size-3.5" />
                          {kpi.label}
                        </div>
                        <p className="mt-1.5 text-lg sm:text-xl font-bold text-white leading-tight truncate">
                          {kpi.value}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px] items-start">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
                  <div className="flex items-center justify-between gap-2 border-b border-white/8 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="size-4 text-cyan-300" />
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
                        {entity.type === "organization" ? "Business intelligence" : "Profile intelligence"}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">{entity.facts.length} signals</span>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-px bg-white/5">
                    {quickFacts.slice(0, 6).map((qf) => {
                      const QIcon = qf.icon;
                      return (
                        <div key={qf.label} className="bg-[#0d1524] px-4 py-3.5 flex gap-3 min-h-[4.5rem]">
                          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">
                            <QIcon className="size-4" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{qf.label}</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {qf.lines.slice(0, 3).map((line, i) =>
                                line.id ? (
                                  <button
                                    key={`${line.text}-${i}`}
                                    onClick={() => navigate(entityPath(line.id!, line.text))}
                                    className="text-[13px] text-white/90 hover:text-cyan-300 hover:underline cursor-pointer text-left"
                                  >
                                    {line.text}{i < Math.min(qf.lines.length, 3) - 1 ? "," : ""}
                                  </button>
                                ) : (
                                  <span key={`${line.text}-${i}`} className="text-[13px] text-white/90">
                                    {line.text}{i < Math.min(qf.lines.length, 3) - 1 ? "," : ""}
                                  </span>
                                )
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <aside className="space-y-3">
                  <div className="rounded-2xl border border-white/12 bg-gradient-to-b from-[#152238] to-[#0e1626] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 mb-3">Explore</p>
                    <div className="grid grid-cols-1 gap-2.5">
                      <ExploreBtn
                        onClick={() => navigate(`/graph/${qid}`)}
                        icon={<Network className="size-4 shrink-0" />}
                        label="Knowledge Graph"
                        primary
                      />
                      {entity.type === "person" ? (
                        <ExploreBtn
                          onClick={() => navigate(`/family-tree/${qid}`)}
                          icon={<GitBranch className="size-4 shrink-0" />}
                          label="Family Tree"
                        />
                      ) : (
                        <ExploreBtn
                          onClick={() => setActiveTab(categories.find((c) => c.id === "organization" || c.kind === "related")?.id ?? "overview")}
                          icon={<Building2 className="size-4 shrink-0" />}
                          label="Org details"
                        />
                      )}
                    </div>
                    {quickMetrics.length > 0 && (
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        {quickMetrics.map((m) => (
                          <div key={m.label} className="rounded-xl border border-white/10 bg-white/[0.04] px-2 py-2 text-center">
                            <p className="text-sm font-bold text-white truncate">{m.value}</p>
                            <p className="text-[9px] uppercase tracking-wider text-slate-500 mt-0.5">{m.label}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            </div>
          </section>

          {/* ═══════════════ BODY (light) ═══════════════ */}
          <section className="entity-body bg-[#f4f7fb] text-slate-800 min-h-[70vh]">
            <div className="mx-auto max-w-[1600px] px-5 py-6 md:py-8 pb-24">
              {resolvingLink && (
                <p className="mb-3 text-xs text-cyan-700 animate-pulse">Opening linked entity…</p>
              )}

              {/* Mobile TOC pills */}
              <nav className="lg:hidden mb-4 -mx-1 overflow-x-auto px-1">
                <div className="flex min-w-max gap-1.5 pb-1">
                  {categories.map((cat, i) => {
                    const selected = cat.id === activeTab;
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setActiveTab(cat.id)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors",
                          selected
                            ? "border-cyan-500/50 bg-cyan-50 text-cyan-800"
                            : "border-slate-200 bg-white text-slate-600 hover:text-slate-900"
                        )}
                      >
                        <span className="font-mono text-[10px] opacity-60">{i + 1}</span>
                        {cat.title}
                      </button>
                    );
                  })}
                </div>
              </nav>

              <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)_240px] xl:grid-cols-[190px_minmax(0,1fr)_260px] items-start">
                {/* Left TOC */}
                <nav className="hidden lg:block sticky top-[4.25rem]">
                  <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/50 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
                      <List className="size-4 text-cyan-600" />
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Table of Contents</p>
                    </div>
                    <ul className="p-2 space-y-0.5 max-h-[calc(100vh-10rem)] overflow-auto">
                      {categories.map((cat, i) => {
                        const selected = cat.id === activeTab;
                        return (
                          <li key={cat.id}>
                            <button
                              onClick={() => setActiveTab(cat.id)}
                              className={cn(
                                "relative flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm cursor-pointer transition-colors",
                                selected
                                  ? "bg-cyan-50 text-cyan-900 font-semibold"
                                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                              )}
                            >
                              {selected && (
                                <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-cyan-500" />
                              )}
                              <span className={cn("font-mono text-[10px] w-4 shrink-0", selected ? "text-cyan-600" : "text-slate-400")}>
                                {i + 1}.
                              </span>
                              <span className="flex-1 truncate">{cat.title}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="border-t border-slate-100 px-4 py-3 flex items-center gap-2 text-xs text-slate-500">
                      <Clock className="size-3.5" />
                      Reading time: {readingMins} min
                    </div>
                  </div>
                </nav>

                {/* Center content */}
                <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/40 overflow-hidden">
                  <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 sm:px-5 py-3 bg-slate-50/80">
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
                      <span className="text-xs text-slate-500 font-medium truncate">
                        Section {activeIdx + 1} of {categories.length}
                      </span>
                    </div>
                    <div className="hidden sm:block h-1.5 flex-1 max-w-[140px] rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-cyan-500 transition-all"
                        style={{ width: `${((activeIdx + 1) / Math.max(categories.length, 1)) * 100}%` }}
                      />
                    </div>
                  </div>

                  <div className="px-4 sm:px-6 py-5 sm:py-6">
                    <div className="flex items-center gap-2.5 mb-4">
                      {(() => {
                        const TabIcon = SECTION_ICONS[active?.id ?? "overview"] ?? BookOpen;
                        return (
                          <div className="flex size-9 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700 border border-cyan-100">
                            <TabIcon className="size-4" />
                          </div>
                        );
                      })()}
                      <h2 className="font-serif text-xl md:text-2xl font-bold text-slate-900 tracking-tight">
                        {active?.title ?? "Overview"}
                      </h2>
                    </div>

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
                            thumbnail={portraitUrl}
                          />
                        )}

                        {active?.kind === "facts" && active.facts && (
                          <div className="space-y-4">
                            <KeyHighlights facts={active.facts.slice(0, 5)} onNavigate={navigate} />
                            <FactsPanel facts={active.facts} onNavigate={navigate} light />
                          </div>
                        )}

                        {active?.kind === "timeline" && (
                          <TimelinePanel items={entity.timeline} color={cfg.color} onNavigate={navigate} />
                        )}

                        {active?.kind === "media" && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {entity.images.map((img) => (
                              <a
                                key={`${img.propertyId}-${img.filename}`}
                                href={img.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group block overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
                              >
                                <img src={img.thumb} alt={img.property} className="aspect-square w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                                <p className="truncate px-2 py-1.5 text-[11px] text-slate-500">{img.property}</p>
                              </a>
                            ))}
                          </div>
                        )}

                        {active?.kind === "languages" && wiki?.otherLanguages && (
                          <div className="space-y-3">
                            {wiki.otherLanguages.map((lang) => (
                              <div key={lang.lang} className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                                <h3 className="font-serif text-base font-semibold text-slate-900 mb-1">
                                  {lang.langName}
                                  <span className="ml-2 font-sans text-xs font-normal text-slate-500">{lang.title}</span>
                                </h3>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{lang.extract}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {active?.kind === "identifiers" && active.facts && (
                          <FactsPanel facts={active.facts} onNavigate={navigate} light />
                        )}

                        {active?.kind === "related" && (
                          <ul className="grid sm:grid-cols-2 gap-2">
                            {entity.related.map((r) => (
                              <li key={`${r.id}-${r.propertyId}`}>
                                <button
                                  onClick={() => navigate(entityPath(r.id, r.label))}
                                  className="w-full text-left rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 hover:border-cyan-300 hover:bg-cyan-50/50 transition-colors cursor-pointer"
                                >
                                  <span className="block text-sm font-medium text-slate-900">{r.label}</span>
                                  <span className="block text-[11px] text-slate-500 mt-0.5">
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

                {/* Right sidebar */}
                <aside className="hidden lg:flex flex-col gap-4 sticky top-[4.25rem] max-h-[calc(100vh-5rem)] overflow-auto pb-4">
                  <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/50 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">At a glance</p>
                    </div>
                    <dl className="divide-y divide-slate-100">
                      <div className="flex gap-3 px-4 py-2.5">
                        <User className="size-4 text-cyan-600 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <dt className="text-[10px] uppercase tracking-wide text-slate-400">Full name</dt>
                          <dd className="text-sm font-medium text-slate-800">{entity.label}</dd>
                        </div>
                      </div>
                      {glanceFacts.map((fact) => {
                        const FIcon =
                          fact.propertyId === "P569" || fact.propertyId === "P570" ? Calendar
                          : fact.propertyId === "P19" || fact.propertyId === "P20" || fact.propertyId === "P159" ? MapPin
                          : fact.propertyId === "P106" || fact.propertyId === "P39" ? Briefcase
                          : fact.propertyId === "P166" ? Star
                          : fact.propertyId === "P27" ? Landmark
                          : Tag;
                        return (
                          <div key={fact.propertyId} className="flex gap-3 px-4 py-2.5">
                            <FIcon className="size-4 text-cyan-600 shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <dt className="text-[10px] uppercase tracking-wide text-slate-400">{fact.property}</dt>
                              <dd className="text-sm font-medium text-slate-800 leading-snug">
                                {fact.values.slice(0, 3).map((v, j) => (
                                  <span key={j}>
                                    {j > 0 && ", "}
                                    {v.id ? (
                                      <button onClick={() => navigate(entityPath(v.id!, v.label))} className="text-cyan-700 hover:underline cursor-pointer">
                                        {v.label}
                                      </button>
                                    ) : v.label}
                                  </span>
                                ))}
                                {fact.values.length > 3 && <span className="text-slate-400"> +{fact.values.length - 3}</span>}
                              </dd>
                            </div>
                          </div>
                        );
                      })}
                    </dl>
                  </div>

                  {entity.related.length > 0 && (
                    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-slate-100">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Related topics</p>
                      </div>
                      <ul className="p-2">
                        {entity.related.slice(0, 6).map((r) => (
                          <li key={`${r.id}-${r.propertyId}`}>
                            <button
                              onClick={() => navigate(entityPath(r.id, r.label))}
                              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-cyan-50 hover:text-cyan-900 cursor-pointer transition-colors"
                            >
                              <span className="flex-1 truncate font-medium">{r.label}</span>
                              <ChevronRight className="size-4 text-slate-300 shrink-0" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {entity.related.length > 3 && (
                    <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/50 overflow-hidden">
                      <div className="px-4 py-3 border-b border-slate-100">
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Explore more</p>
                      </div>
                      <ul className="p-2 space-y-1">
                        {entity.related.slice(0, 4).map((r) => (
                          <li key={`pop-${r.id}`}>
                            <button
                              onClick={() => navigate(entityPath(r.id, r.label))}
                              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-slate-50 cursor-pointer"
                            >
                              <div className="size-9 rounded-lg bg-gradient-to-br from-cyan-100 to-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                                <Sparkles className="size-3.5 text-cyan-700" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-slate-800 truncate">{r.label}</p>
                                <p className="text-[11px] text-slate-500 truncate">{r.relation}</p>
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <p className="text-center text-[10px] text-slate-400 font-mono px-2">
                    {qid} · {entity.facts.length} properties
                  </p>
                </aside>
              </div>
            </div>
          </section>
        </motion.div>
      )}
    </div>
  );
}

function ExploreBtn({
  onClick,
  icon,
  label,
  primary = false,
}: {
  onClick: () => void;
  icon: ReactNode;
  label: string;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all cursor-pointer",
        primary
          ? "bg-cyan-400 text-slate-950 hover:bg-cyan-300 shadow-lg shadow-cyan-500/25"
          : "border border-white/25 bg-transparent text-white/90 hover:bg-white/10"
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function OverviewPanel({
  wiki,
  hasArticle,
  onArticleClick,
  entityLabel,
  thumbnail,
}: {
  wiki?: WikipediaArticle;
  hasArticle: boolean;
  onArticleClick: (e: MouseEvent<HTMLElement>) => void;
  entityLabel: string;
  thumbnail?: string;
}) {
  if (!hasArticle) {
    return (
      <p className="text-sm text-slate-500">
        No encyclopedia article found for {entityLabel}. Browse the table of contents for structured facts, timeline, and media.
      </p>
    );
  }

  const quote = wiki?.lead?.split(/(?<=\.)\s+/).find((s) => s.length > 40 && s.length < 180);

  return (
    <div className="space-y-5">
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
        <article
          className="wiki-article wiki-article-light max-w-none"
          onClick={onArticleClick}
          dangerouslySetInnerHTML={{ __html: wiki.html }}
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
            <div key={`${section.title}-${i}`} className="pt-2">
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
        </div>
      )}
    </div>
  );
}

function KeyHighlights({ facts, onNavigate }: { facts: EntityFact[]; onNavigate: (path: string) => void }) {
  if (!facts.length) return null;
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3.5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Key highlights</p>
      <ul className="space-y-1.5">
        {facts.map((f) => (
          <li key={f.propertyId} className="flex gap-2 text-sm text-slate-700">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-cyan-500" />
            <span>
              <span className="font-medium text-slate-900">{f.property}: </span>
              {f.values.slice(0, 3).map((v, j) => (
                <span key={j}>
                  {j > 0 && ", "}
                  {v.id ? (
                    <button onClick={() => onNavigate(entityPath(v.id!, v.label))} className="text-cyan-700 hover:underline cursor-pointer">
                      {v.label}
                    </button>
                  ) : v.label}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TimelinePanel({
  items,
  color,
  onNavigate,
}: {
  items: EntitySummary["timeline"];
  color: string;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Horizontal strip for first milestones */}
      <div className="overflow-x-auto -mx-1 px-1">
        <div className="relative flex min-w-max gap-8 pb-2 pt-1">
          <div className="absolute left-0 right-0 top-[11px] h-0.5 bg-slate-200" />
          {items.slice(0, 8).map((item, i) => (
            <div key={`h-${item.date}-${i}`} className="relative z-[1] w-28 text-center">
              <span className="mx-auto mb-2 flex size-3 rounded-full border-2 border-white shadow" style={{ background: color }} />
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{item.date}</p>
              <p className="mt-0.5 text-xs font-medium text-slate-800 line-clamp-2">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      <ol className="relative ml-2 space-y-4 border-l border-slate-200">
        {items.map((item, i) => (
          <li key={`${item.date}-${item.label}-${i}`} className="relative pl-5">
            <span className="absolute left-[-5px] top-1.5 size-2.5 rounded-full border-2 border-white" style={{ background: color }} />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{item.date}</p>
            <p className="mt-0.5 text-sm text-slate-800">
              <span className="font-medium">{item.label}</span>
              {item.value && (
                <>
                  {": "}
                  {item.entityId ? (
                    <button onClick={() => onNavigate(entityPath(item.entityId!, item.value))} className="cursor-pointer text-cyan-700 hover:underline">
                      {item.value}
                    </button>
                  ) : item.value}
                </>
              )}
            </p>
          </li>
        ))}
      </ol>
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
    <div
      className={cn(
        "rounded-xl border overflow-hidden divide-y",
        light ? "border-slate-200 bg-white divide-slate-100" : "border-border/50 bg-background/25 divide-border/40"
      )}
    >
      {facts.map((fact) => (
        <div
          key={fact.propertyId}
          className={cn("flex items-start gap-4 px-4 py-3.5 transition-colors", light ? "hover:bg-slate-50" : "hover:bg-muted/15")}
        >
          <span className={cn("shrink-0 pt-0.5 text-[10px] font-semibold uppercase tracking-wide w-28 sm:w-36", light ? "text-slate-400" : "text-muted-foreground/60")}>
            {fact.property}
          </span>
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            <div className="flex flex-wrap gap-1.5">
              {fact.values.map((v, j) =>
                v.id ? (
                  <button
                    key={j}
                    onClick={() => onNavigate(entityPath(v.id!, v.label))}
                    className={cn(
                      "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer",
                      light
                        ? "border-cyan-200 bg-cyan-50 text-cyan-800 hover:bg-cyan-100"
                        : "border-primary/25 bg-primary/8 text-primary hover:bg-primary/20"
                    )}
                  >
                    {v.label}
                  </button>
                ) : v.url ? (
                  <a key={j} href={v.url} target="_blank" rel="noopener noreferrer" className={cn("text-sm break-all hover:underline", light ? "text-cyan-700" : "text-primary")}>
                    {v.label}
                  </a>
                ) : (
                  <span key={j} className={cn("text-sm leading-relaxed", light ? "text-slate-700" : "text-foreground/85")}>{v.label}</span>
                )
              )}
            </div>
            {fact.values.some((v) => v.qualifiers?.length) && (
              <ul className="space-y-0.5">
                {fact.values.flatMap((v, vi) =>
                  (v.qualifiers ?? []).map((q, qi) => (
                    <li key={`${vi}-${qi}`} className={cn("text-[11px]", light ? "text-slate-500" : "text-muted-foreground")}>
                      <span className="opacity-70">{q.property}: </span>
                      {q.id ? (
                        <button onClick={() => onNavigate(entityPath(q.id!, q.label))} className={cn("hover:underline cursor-pointer", light ? "text-cyan-700" : "text-primary")}>
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
