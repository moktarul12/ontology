import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import {
  buildLocalSectionBrief,
  fetchSectionEnrichment,
} from "@/lib/ai/enrich.ts";
import {
  buildLocalGlance,
  cinematicType,
  fetchGlanceSnapshot,
} from "@/lib/ai/glance.ts";
import { GlanceBoard } from "@/pages/entity/_components/GlanceBoard.tsx";
import { AiReadAloud } from "@/pages/entity/_components/AiReadAloud.tsx";
import type { EntitySummary, EntityType } from "@/lib/wikidata/types.ts";
import { isGenericTypeLabel } from "@/lib/wikidata/entity-types.ts";
import type { ComponentType } from "react";

type TypeCfg = {
  label: string;
  color: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
};

type QuickFact = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  lines: Array<{ text: string; id?: string }>;
};

type WikiRow = {
  kind?: "section" | "row";
  label: string;
  value: string;
};

type Tag = { id?: string; label: string };

export type HeroExploreItem = {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  action: () => void;
  selected?: boolean;
  /** Rich thumbnail card (graph / family) so the destination is obvious */
  preview?: {
    visual: "graph" | "family";
    image?: string;
    subtitle?: string;
  };
};

type Props = {
  entity: EntitySummary;
  qid: string;
  cfg: TypeCfg;
  Icon: ComponentType<{ className?: string }>;
  portraitUrl?: string;
  signatureUrl?: string;
  rolesLine: string;
  leadSnippet: string;
  breadcrumbMid?: string;
  tags: Tag[];
  marketing?: {
    tagline?: string;
    stock?: string | null;
    website?: string;
    industries: Tag[];
    products: Tag[];
    kpis: Array<{
      icon: ComponentType<{ className?: string }>;
      label: string;
      value: string;
      hint?: string;
      tone?: string;
    }>;
  } | null;
  wikiInfobox: WikiRow[];
  quickFacts: QuickFact[];
  galleryUrls?: string[];
  explore?: HeroExploreItem[];
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

type HeroTheme = {
  bg: string;
  accent: string;
  fade: string;
  portraitWidth: string;
  portraitFilter: string;
  portraitPosition: string;
};

const THEME: Record<EntityType, HeroTheme> = {
  person: {
    bg: "#0b1220",
    accent: "text-amber-300",
    fade: "linear-gradient(90deg, transparent 40%, #0b1220 100%)",
    portraitWidth: "w-full",
    portraitFilter: "sepia(0.18) contrast(1.08) saturate(0.78) brightness(0.88)",
    portraitPosition: "16% 8%",
  },
  organization: {
    bg: "#07131f",
    accent: "text-teal-300",
    fade: "linear-gradient(90deg, transparent 30%, #07131f 100%)",
    portraitWidth: "w-full",
    portraitFilter: "none",
    portraitPosition: "center",
  },
  place: {
    bg: "#07140f",
    accent: "text-emerald-300",
    fade: "linear-gradient(90deg, transparent 35%, #07140f 100%)",
    portraitWidth: "w-full",
    portraitFilter: "saturate(0.8) contrast(1.06) brightness(0.72)",
    portraitPosition: "center 40%",
  },
  event: {
    bg: "#140c0a",
    accent: "text-orange-300",
    fade: "linear-gradient(90deg, transparent 35%, #140c0a 100%)",
    portraitWidth: "w-full",
    portraitFilter: "contrast(1.08) saturate(0.75) brightness(0.7)",
    portraitPosition: "center 30%",
  },
  work: {
    bg: "#140a12",
    accent: "text-fuchsia-300",
    fade: "linear-gradient(90deg, transparent 30%, #140a12 100%)",
    portraitWidth: "w-full",
    portraitFilter: "contrast(1.06) saturate(0.85) brightness(0.78)",
    portraitPosition: "center top",
  },
  concept: {
    bg: "#0a1020",
    accent: "text-sky-300",
    fade: "linear-gradient(90deg, transparent 30%, #0a1020 100%)",
    portraitWidth: "w-full",
    portraitFilter: "saturate(0.65) brightness(0.72)",
    portraitPosition: "center",
  },
  unknown: {
    bg: "#0b1220",
    accent: "text-amber-300",
    fade: "linear-gradient(90deg, transparent 35%, #0b1220 100%)",
    portraitWidth: "w-full",
    portraitFilter: "none",
    portraitPosition: "center top",
  },
};

function splitDisplayName(label: string, type: EntityType): { lead: string; gold: string } {
  if (type !== "person") return { lead: label, gold: "" };
  const parts = label.trim().split(/\s+/);
  if (parts.length < 2) return { lead: label, gold: "" };
  return { lead: parts.slice(0, -1).join(" "), gold: parts[parts.length - 1]! };
}

function compactHeroDate(label: string): string {
  return label
    .replace(/\bJanuary\b/g, "Jan").replace(/\bFebruary\b/g, "Feb")
    .replace(/\bMarch\b/g, "Mar").replace(/\bApril\b/g, "Apr")
    .replace(/\bJune\b/g, "Jun").replace(/\bJuly\b/g, "Jul")
    .replace(/\bAugust\b/g, "Aug").replace(/\bSeptember\b/g, "Sep")
    .replace(/\bOctober\b/g, "Oct").replace(/\bNovember\b/g, "Nov")
    .replace(/\bDecember\b/g, "Dec")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlacePhoto(url: string): boolean {
  return /house|home|kunj|building|temple|street|memorial|panoramio|logo|flag|signature|\bmap\b|stamp/i.test(
    url,
  );
}

function pickAtmosphere(
  type: EntityType,
  portraitUrl: string | undefined,
  galleryUrls: string[],
): string | undefined {
  const alts = galleryUrls.filter((u) => u && u !== portraitUrl);
  if (type === "person") {
    const people = alts.filter((u) => !isPlacePhoto(u));
    const scene = people.find((u) => /and_|film|movie|with_|scene|still/i.test(u));
    return scene || people[0] || portraitUrl;
  }
  return alts[0] || portraitUrl;
}

function pullQuote(entity: EntitySummary): { latin?: string; native?: string } {
  const lead = entity.wikipedia?.lead ?? "";
  const quoted = lead.match(/[“"']([^”"']{18,86})[”"']/);
  if (quoted?.[1] && !/born|died|january|august|the most popular/i.test(quoted[1])) {
    return { latin: quoted[1] };
  }
  const motto = entity.facts.find((f) => f.propertyId === "P1451" || f.propertyId === "P163")
    ?.values[0]?.label;
  if (motto && motto.length >= 8 && motto.length <= 90) return { latin: motto };
  const song = entity.facts
    .find((f) => f.propertyId === "CR_SONG" || f.propertyId === "P800")
    ?.values.find((v) => /safar|zindagi|yeh |pyar|dil |love |life /i.test(v.label));
  if (song?.label) return { latin: song.label };
  const native = lead.match(/[\u0900-\u097F][^。.\n]{10,70}/);
  return { native: native?.[0] };
}

/**
 * Full-bleed cinematic hero — same chassis for every entity type.
 */
export function EntityHero({
  entity,
  cfg,
  Icon,
  portraitUrl,
  signatureUrl,
  rolesLine,
  leadSnippet,
  breadcrumbMid,
  tags,
  marketing,
  galleryUrls = [],
  explore = [],
}: Props) {
  const navigate = useNavigate();
  const type = cinematicType(entity);
  const theme = THEME[type];
  const accent = theme.accent;
  const { lead, gold } = splitDisplayName(entity.label, type);
  const subtitle = marketing?.tagline || rolesLine;
  const chipTags = (marketing?.industries.length ? marketing.industries : tags).filter(
    (t) => !isGenericTypeLabel(t.label),
  );

  const localAbout = useMemo(() => buildLocalSectionBrief("overview", entity), [entity]);
  const [aiReady, setAiReady] = useState(false);
  useEffect(() => {
    // Local copy first — defer AI POSTs so Timeline / Wikidata win the network.
    const t = window.setTimeout(() => setAiReady(true), 1200);
    return () => window.clearTimeout(t);
  }, [entity.id]);

  const { data: aboutBrief } = useQuery({
    queryKey: [
      "section-enrich",
      "overview",
      entity.id,
      entity.wikipedia?.revisedAt ?? "norev",
      "v5",
    ],
    queryFn: () => fetchSectionEnrichment("overview", entity),
    placeholderData: localAbout,
    enabled: aiReady,
    staleTime: 1000 * 60 * 60,
    retry: 0,
  });
  const about = aboutBrief ?? localAbout;

  const aboutParagraphs = useMemo(() => {
    const paras: string[] = [];
    const isStub = (t: string) => {
      if (/\(born\b/i.test(t) && /\d{4}/.test(t)) return true;
      const named = new RegExp(
        `^${entity.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+is\\b`,
        "i",
      ).test(t);
      if (!named) return false;
      return /\(\d{4}/.test(t) || t.length < 160;
    };
    if (about.summary?.trim() && !isStub(about.summary.trim())) {
      paras.push(about.summary.trim());
    }
    for (const p of about.paragraphs ?? []) {
      const t = p.trim();
      if (t && !isStub(t) && !paras.includes(t)) paras.push(t);
    }
    if (paras.join(" ").length < 180 && leadSnippet.trim()) {
      const leadParas = leadSnippet
        .split(/\n{2,}|(?<=\.)\s+(?=[A-Z])/)
        .map((p) => p.trim())
        .filter((p) => p.length > 70 && !isStub(p));
      for (const p of leadParas) {
        if (!paras.some((x) => x.includes(p.slice(0, 48)))) paras.push(p);
      }
    }
    return paras.slice(0, 2);
  }, [about, leadSnippet, entity.label]);

  const localGlance = useMemo(() => buildLocalGlance(entity), [entity]);
  const { data: glanceData, isFetching: glanceFetching } = useQuery({
    queryKey: [
      "glance-snapshot",
      entity.id,
      entity.wikipedia?.revisedAt ?? "norev",
      "v8",
    ],
    queryFn: () => fetchGlanceSnapshot(entity),
    placeholderData: localGlance,
    enabled: aiReady,
    staleTime: 1000 * 60 * 60,
    retry: 0,
  });
  const glance = useMemo(() => {
    const g = glanceData ?? localGlance;
    const cards = g.cards.map((c) => {
      const local = localGlance.cards.find(
        (x) => x.label.toLowerCase() === c.label.toLowerCase(),
      );
      return local ? { ...c, value: local.value || c.value, note: local.note ?? c.note } : c;
    });
    for (const c of localGlance.cards) {
      if (!cards.some((x) => x.label.toLowerCase() === c.label.toLowerCase())) cards.push(c);
    }
    const metrics = [...g.metrics];
    for (const m of localGlance.metrics) {
      if (!metrics.some((x) => x.label.toLowerCase() === m.label.toLowerCase())) metrics.push(m);
    }
    const bands = [...(g.bands ?? [])];
    for (const b of localGlance.bands ?? []) {
      const existing = bands.find((x) => x.id === b.id);
      if (!existing) {
        bands.push(b);
        continue;
      }
      existing.items = existing.items.map((item, i) => {
        const loc =
          b.items.find((x) => x.label.toLowerCase() === item.label.toLowerCase()) ||
          b.items[i];
        const note =
          item.note && item.note.length >= (loc?.note?.length ?? 0)
            ? item.note
            : loc?.note ?? item.note;
        return { ...item, note, icon: item.icon || loc?.icon };
      });
      for (const loc of b.items) {
        if (!existing.items.some((x) => x.label.toLowerCase() === loc.label.toLowerCase())) {
          existing.items.push(loc);
        }
      }
    }
    const identity = {
      ...localGlance.identity,
      ...g.identity,
      name: g.identity?.name || localGlance.identity?.name || entity.label,
      quote: g.identity?.quote || localGlance.identity?.quote,
      quoteNative: g.identity?.quoteNative || localGlance.identity?.quoteNative,
      featureTitle: g.identity?.featureTitle || localGlance.identity?.featureTitle,
      bio: g.identity?.bio || localGlance.identity?.bio,
      crafts: g.identity?.crafts || localGlance.identity?.crafts,
    };
    return {
      ...g,
      heading: g.heading || localGlance.heading,
      pulse: (g.pulse && g.pulse.length >= (localGlance.pulse?.length ?? 0) ? g.pulse : localGlance.pulse) || g.pulse,
      cards: cards.slice(0, 10),
      metrics: metrics.slice(0, 8),
      bands,
      identity,
    };
  }, [glanceData, localGlance]);

  const crafts =
    glance.identity?.crafts ||
    chipTags.map((t) => t.label).slice(0, 6).join(" · ") ||
    subtitle;
  const quote = {
    latin: glance.identity?.quote || pullQuote(entity).latin,
    native: glance.identity?.quoteNative || pullQuote(entity).native,
  };
  const bioParas = (() => {
    const raw = (glance.identity?.bio ?? "").trim();
    if (!raw) return aboutParagraphs;
    const chunks = raw.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (chunks.length >= 2) return chunks.slice(0, 2);
    const sentences = raw.split(/(?<=\.)\s+/).filter(Boolean);
    if (sentences.length >= 3) {
      return [sentences.slice(0, 2).join(" "), sentences.slice(2).join(" ")];
    }
    return [raw];
  })();
  const displayParas = bioParas.slice(0, 2);
  const atmosphereUrl = pickAtmosphere(type, portraitUrl, galleryUrls);
  const years = glance.identity?.years || entity.lifespan?.replace(/[–-]/g, " — ");
  const showPortraitContain = type === "organization";
  const showAtmosphere =
    Boolean(atmosphereUrl) &&
    (type === "person" || type === "place" || type === "event" || type === "work");
  const bgRgb = (() => {
    const h = theme.bg.replace("#", "");
    return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`;
  })();
  const bornCard = glance.cards.find((c) => /^born$/i.test(c.label));
  const diedRaw = entity.facts.find((f) => f.propertyId === "P570")?.values[0]?.label;
  const heroIntro = [
    entity.description
      ? `${entity.label} is ${entity.description.replace(/\.$/, "")}${
          entity.lifespan && !/\(\d{4}/.test(entity.description)
            ? ` (${entity.lifespan.replace(/[–-]/g, "–")})`
            : ""
        }.`
      : "",
    bornCard
      ? `Born ${bornCard.value}${bornCard.note ? ` in ${bornCard.note.split(",")[0]}` : ""}.`
      : "",
    crafts
      ? `Known professionally as ${crafts.replace(/ · /g, ", ").toLowerCase()}.`
      : "",
    diedRaw ? `Died ${compactHeroDate(diedRaw)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const heroRest =
    displayParas.find(
      (p) =>
        !/\(born\b/i.test(p) &&
        !new RegExp(`^${entity.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+is\\b`, "i").test(p),
    ) ||
    displayParas[0] ||
    "";
  const heroParas = [heroIntro, heroRest].filter(
    (p, i, arr) => p && !arr.slice(0, i).some((x) => x.slice(0, 40) === p.slice(0, 40)),
  );


  return (
    <section className="text-white" style={{ background: theme.bg }}>
      <div className="relative min-h-[22rem] overflow-hidden md:min-h-[26rem]">
        {portraitUrl && (
          <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[min(38%,34rem)] overflow-hidden md:block">
            <img
              src={portraitUrl}
              alt=""
              referrerPolicy="no-referrer"
              className={cn(
                "absolute inset-0 size-full object-cover",
                showPortraitContain && "object-contain bg-white/5 p-10",
              )}
              style={{
                objectPosition: theme.portraitPosition,
                filter: theme.portraitFilter === "none" ? undefined : theme.portraitFilter,
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(90deg, transparent 18%, rgb(${bgRgb} / 0.38) 48%, rgb(${bgRgb} / 0.92) 78%, rgb(${bgRgb}) 100%)`,
              }}
            />
          </div>
        )}

        {showAtmosphere && (
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[min(42%,38rem)] overflow-hidden md:block">
            <img
              src={atmosphereUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="absolute inset-0 size-full scale-110 object-cover"
              style={{
                objectPosition: type === "person" ? "70% 18%" : "center 30%",
                filter: "blur(2.5px) saturate(0.72) contrast(1.03) brightness(0.62)",
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(90deg, rgb(${bgRgb}) 0%, rgb(${bgRgb} / 0.78) 16%, rgb(${bgRgb} / 0.52) 42%, rgb(${bgRgb} / 0.4) 100%)`,
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background: `linear-gradient(180deg, rgb(${bgRgb} / 0.18) 0%, transparent 32%, transparent 62%, rgb(${bgRgb} / 0.7) 100%)`,
              }}
            />
          </div>
        )}

        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24"
          style={{ background: `linear-gradient(180deg, transparent, rgb(${bgRgb}))` }}
        />

        <div className="relative z-10 mx-auto flex min-h-[22rem] max-w-[1600px] flex-col px-4 pt-5 pb-5 sm:px-5 md:min-h-[24.5rem] md:px-7 md:pt-6 md:pb-6">
          <nav className="mb-4 flex flex-wrap items-center gap-1 text-[11px] text-white/55 md:mb-5">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="cursor-pointer hover:text-white"
            >
              {TYPE_BREADCRUMB[type]}
            </button>
            <ChevronRight className="size-3 opacity-40" />
            {breadcrumbMid && (
              <>
                <span>{breadcrumbMid}</span>
                <ChevronRight className="size-3 opacity-40" />
              </>
            )}
            <span className="max-w-[220px] truncate text-white/80">{entity.label}</span>
          </nav>

          <div className="grid flex-1 items-start gap-5 md:grid-cols-[minmax(9rem,32%)_minmax(22rem,1.25fr)_minmax(16rem,26%)] md:gap-8">
            <div className="md:hidden">
              {portraitUrl && (
                <img
                  src={portraitUrl}
                  alt={entity.label}
                  referrerPolicy="no-referrer"
                  className="mb-3 h-44 w-36 rounded-2xl object-cover object-top shadow-2xl"
                />
              )}
            </div>
            <div className="hidden md:block" aria-hidden />

            <div className="relative z-10 min-w-0 overflow-hidden pt-1 md:pt-3">
              <motion.h1
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="font-serif text-[clamp(2.35rem,3.6vw,3.25rem)] font-bold leading-[1.04] tracking-tight text-white md:whitespace-nowrap"
              >
                <span>{lead}</span>
                {gold && (
                  <>
                    {" "}
                    <span className={accent}>{gold}</span>
                  </>
                )}
              </motion.h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                {years && (
                  <p className="font-mono text-[13px] tracking-wide text-white/70">{years}</p>
                )}
                {marketing?.stock && (
                  <p className={cn("font-mono text-[12px]", accent)}>{marketing.stock}</p>
                )}
              </div>
              {crafts && (
                <p className="mt-2 text-[13.5px] text-white/72 line-clamp-1">{crafts}</p>
              )}
              {(quote.latin || quote.native) && (
                <blockquote className="mt-5 max-w-lg">
                  {quote.latin && (
                    <p className="font-serif text-[1.18rem] italic leading-snug text-white">
                      “{quote.latin}”
                    </p>
                  )}
                  {quote.native && (
                    <p className="mt-1.5 text-[13px] text-white/60">{quote.native}</p>
                  )}
                </blockquote>
              )}
              <AiReadAloud
                entity={entity}
                text={[
                  entity.label,
                  years,
                  crafts,
                  quote.latin,
                  ...heroParas,
                ]
                  .filter(Boolean)
                  .join(". ")}
              />
            </div>

            <div className="relative z-20 min-w-0 pt-1 md:pt-3">
              <div
                className="space-y-3 text-[13.5px] leading-relaxed text-white/92"
                style={{ textShadow: "0 1px 12px rgb(0 0 0 / 0.85), 0 0 2px rgb(0 0 0 / 0.7)" }}
              >
                {heroParas.map((p, i) => (
                  <p key={i} className={i === 0 ? "line-clamp-5" : "line-clamp-4"}>
                    {p}
                  </p>
                ))}
              </div>
              {signatureUrl && (
                <img
                  src={signatureUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="mt-5 max-h-12 w-auto opacity-95 brightness-0 invert drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
                />
              )}
              {!signatureUrl && !heroParas.length && (
                <div className="flex items-center gap-2 text-white/50">
                  <Icon className="size-5" />
                  <span className="text-[12px] uppercase tracking-wider">{cfg.label}</span>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      <div className="relative mx-auto max-w-[1600px] px-4 pb-5 pt-5 sm:px-5 md:px-7 md:pb-6 md:pt-6">
        <GlanceBoard
          snapshot={glance}
          entityType={type}
          isFetching={glanceFetching}
          website={marketing?.website}
          images={galleryUrls}
          portraitUrl={portraitUrl}
          onLearnMore={() => explore.find((e) => e.id === "overview")?.action()}
          accentClass={accent}
          description={`${entity.description ?? ""} ${entity.wikipedia?.lead ?? ""}`}
        />
      </div>

      {explore.length > 0 && (
        <div
          className="relative z-20 border-y border-white/10"
          style={{
            background: `linear-gradient(180deg, rgb(${bgRgb} / 0.92), rgb(${bgRgb} / 0.98))`,
            boxShadow:
              "0 -12px 28px rgb(0 0 0 / 0.38), 0 12px 28px rgb(0 0 0 / 0.32), inset 0 1px 0 rgb(255 255 255 / 0.08), inset 0 -1px 0 rgb(0 0 0 / 0.35)",
          }}
        >
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-stretch gap-2 px-4 py-2.5 sm:px-5 md:gap-3 md:px-7">
            {explore.map((item) => {
              const ItemIcon = item.icon;
              if (item.preview) {
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={item.action}
                    className="group relative flex min-w-[10.5rem] max-w-[14rem] flex-1 cursor-pointer overflow-hidden rounded-xl border border-white/12 bg-white/[0.05] text-left transition-colors hover:border-teal-400/35 hover:bg-white/[0.08] sm:min-w-[12rem]"
                  >
                    <div className="relative h-[4.25rem] w-[4.25rem] shrink-0 overflow-hidden bg-slate-800/80 sm:h-[4.75rem] sm:w-[4.75rem]">
                      {item.preview.image ? (
                        <img
                          src={item.preview.image}
                          alt=""
                          className="h-full w-full object-cover object-top opacity-90 transition-transform duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <ItemIcon className="size-6 text-teal-300/80" />
                        </div>
                      )}
                      <div
                        className="pointer-events-none absolute inset-0 opacity-70"
                        style={{
                          background:
                            item.preview.visual === "family"
                              ? "radial-gradient(circle at 30% 40%, transparent 28%, rgb(15 118 110 / 0.45) 29%, transparent 32%), radial-gradient(circle at 70% 55%, transparent 22%, rgb(45 212 191 / 0.35) 23%, transparent 26%)"
                              : "linear-gradient(135deg, transparent 40%, rgb(45 212 191 / 0.25)), repeating-linear-gradient(90deg, transparent, transparent 6px, rgb(255 255 255 / 0.06) 6px, rgb(255 255 255 / 0.06) 7px)",
                        }}
                        aria-hidden
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-white">
                        <ItemIcon className="size-3.5 shrink-0 text-teal-300" />
                        {item.label}
                      </span>
                      {item.preview.subtitle && (
                        <span className="text-[11px] leading-snug text-slate-400">
                          {item.preview.subtitle}
                        </span>
                      )}
                      <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-teal-400/90 opacity-0 transition-opacity group-hover:opacity-100">
                        Open →
                      </span>
                    </div>
                  </button>
                );
              }
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.action}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 self-center rounded-full px-4 py-2 text-[13px] font-semibold cursor-pointer transition-colors",
                    item.selected
                      ? "bg-white text-slate-900 shadow-md shadow-black/20"
                      : "bg-white/[0.06] text-white/85 hover:bg-white/10",
                  )}
                >
                  <ItemIcon className="size-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
