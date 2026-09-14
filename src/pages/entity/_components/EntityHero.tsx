import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Building2,
  ChevronRight,
  ExternalLink,
  Factory,
  MapPin,
  Package,
  PenLine,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import {
  buildLocalSectionBrief,
  fetchSectionEnrichment,
} from "@/lib/ai/enrich.ts";
import {
  buildLocalGlance,
  fetchGlanceSnapshot,
  type GlanceCard,
  type GlanceSnapshot,
} from "@/lib/ai/glance.ts";
import type { EntitySummary, EntityType } from "@/lib/wikidata/types.ts";
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
  /** Kept for API stability; glance builds from entity facts */
  wikiInfobox: WikiRow[];
  quickFacts: QuickFact[];
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

const CARD_TONE: Record<
  NonNullable<GlanceCard["tone"]>,
  { bar: string; icon: ComponentType<{ className?: string }> }
> = {
  hq: { bar: "from-teal-500 to-cyan-600", icon: MapPin },
  people: { bar: "from-sky-500 to-blue-600", icon: Users },
  market: { bar: "from-amber-500 to-orange-600", icon: Factory },
  product: { bar: "from-emerald-500 to-teal-600", icon: Package },
  life: { bar: "from-slate-500 to-slate-700", icon: Building2 },
  default: { bar: "from-slate-400 to-slate-600", icon: Building2 },
};

function GlanceBoard({
  snapshot,
  isFetching,
  isOrg,
  website,
}: {
  snapshot: GlanceSnapshot;
  isFetching: boolean;
  isOrg: boolean;
  website?: string;
}) {
  return (
    <div
      className={cn(
        "border-t border-slate-100",
        isOrg
          ? "bg-gradient-to-br from-slate-900 via-slate-900 to-teal-950 text-slate-100"
          : "bg-slate-50/80",
      )}
    >
      <div className="px-4 py-4 sm:px-6 sm:py-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Sparkles
            className={cn("size-3.5", isOrg ? "text-teal-300" : "text-teal-600")}
          />
          <span
            className={cn(
              "text-[11px] font-semibold uppercase tracking-[0.16em]",
              isOrg ? "text-teal-200/90" : "text-slate-500",
            )}
          >
            {snapshot.heading}
          </span>
          {isFetching && (
            <span className="text-[10px] text-slate-400">Briefing…</span>
          )}
          {!isFetching && !snapshot.fallback && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium",
                isOrg ? "bg-teal-400/20 text-teal-200" : "bg-teal-600/10 text-teal-800",
              )}
            >
              AI
            </span>
          )}
        </div>

        <p
          className={cn(
            "max-w-3xl text-[15px] sm:text-[16px] leading-[1.65]",
            isOrg ? "text-slate-100" : "text-slate-800",
          )}
        >
          {snapshot.pulse}
        </p>

        {snapshot.metrics.length > 0 && (
          <div
            className={cn(
              "mt-4 grid gap-2",
              snapshot.metrics.length >= 4
                ? "grid-cols-2 sm:grid-cols-4"
                : snapshot.metrics.length === 3
                  ? "grid-cols-3"
                  : "grid-cols-2",
            )}
          >
            {snapshot.metrics.map((m) => (
              <div
                key={m.label}
                className={cn(
                  "rounded-xl px-3 py-3",
                  isOrg
                    ? "bg-white/[0.06] ring-1 ring-white/10"
                    : "bg-white border border-slate-200/90 shadow-sm",
                )}
              >
                <p
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-[0.14em]",
                    isOrg ? "text-teal-300/80" : "text-slate-400",
                  )}
                >
                  {m.label}
                </p>
                <p
                  className={cn(
                    "mt-1 font-serif text-[1.35rem] sm:text-[1.5rem] font-bold tabular-nums leading-none tracking-tight",
                    isOrg ? "text-white" : "text-slate-900",
                  )}
                >
                  {m.value}
                </p>
                {m.note && (
                  <p className={cn("mt-1 text-[11px]", isOrg ? "text-slate-400" : "text-slate-500")}>
                    {m.note}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {snapshot.cards.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {snapshot.cards.map((c) => {
              const tone = CARD_TONE[c.tone ?? "default"];
              const CIcon = tone.icon;
              return (
                <div
                  key={`${c.label}-${c.value}`}
                  className={cn(
                    "relative overflow-hidden rounded-xl px-3.5 py-3",
                    isOrg
                      ? "bg-white/[0.05] ring-1 ring-white/10"
                      : "bg-white border border-slate-200/90",
                  )}
                >
                  <div
                    className={cn(
                      "absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b",
                      tone.bar,
                    )}
                  />
                  <div className="flex items-start gap-2 pl-2">
                    <CIcon
                      className={cn(
                        "mt-0.5 size-3.5 shrink-0",
                        isOrg ? "text-teal-300/80" : "text-slate-400",
                      )}
                    />
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                        {c.label}
                      </p>
                      <p
                        className={cn(
                          "mt-0.5 text-[13.5px] font-medium leading-snug",
                          isOrg ? "text-slate-100" : "text-slate-800",
                        )}
                      >
                        {c.value}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(website || snapshot.footnote) && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors",
                  isOrg
                    ? "bg-teal-400 text-slate-950 hover:bg-teal-300"
                    : "border border-slate-200 bg-white text-slate-700 hover:border-teal-400",
                )}
              >
                <ExternalLink className="size-3.5" />
                Official site
              </a>
            )}
            {snapshot.footnote && (
              <p className={cn("text-[11px]", isOrg ? "text-slate-500" : "text-slate-400")}>
                {snapshot.footnote}
              </p>
            )}
          </div>
        )}

        {snapshot.hint && (
          <p className={cn("mt-2 text-[11px]", isOrg ? "text-slate-500" : "text-slate-400")}>
            {snapshot.hint}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Light editorial hero: portrait + full AI about + AI company/life snapshot.
 */
export function EntityHero({
  entity,
  qid,
  cfg,
  Icon,
  portraitUrl,
  signatureUrl,
  rolesLine,
  leadSnippet,
  breadcrumbMid,
  tags,
  marketing,
}: Props) {
  const navigate = useNavigate();
  const isOrg = entity.type === "organization";
  const subtitle = marketing?.tagline || rolesLine;
  const chipTags = marketing?.industries.length ? marketing.industries : tags;
  const aliases = entity.aliases.filter(Boolean).slice(0, 10);

  const localAbout = useMemo(() => buildLocalSectionBrief("overview", entity), [entity]);
  const { data: aboutBrief, isFetching: aboutFetching } = useQuery({
    queryKey: [
      "section-enrich",
      "overview",
      entity.id,
      entity.wikipedia?.revisedAt ?? "norev",
      "v5",
    ],
    queryFn: () => fetchSectionEnrichment("overview", entity),
    placeholderData: localAbout,
    staleTime: 1000 * 60 * 60,
    retry: 0,
  });
  const about = aboutBrief ?? localAbout;

  const aboutParagraphs = useMemo(() => {
    const paras: string[] = [];
    if (about.summary?.trim()) paras.push(about.summary.trim());
    for (const p of about.paragraphs ?? []) {
      const t = p.trim();
      if (t && !paras.includes(t)) paras.push(t);
    }
    if (paras.join(" ").length < 280 && leadSnippet.trim()) {
      const leadParas = leadSnippet
        .split(/\n{2,}|(?<=\.)\s+(?=[A-Z])/)
        .map((p) => p.trim())
        .filter((p) => p.length > 40);
      for (const p of leadParas) {
        if (!paras.some((x) => x.includes(p.slice(0, 48)))) paras.push(p);
      }
    }
    return paras.slice(0, 5);
  }, [about, leadSnippet]);

  const localGlance = useMemo(() => buildLocalGlance(entity), [entity]);
  const { data: glanceData, isFetching: glanceFetching } = useQuery({
    queryKey: [
      "glance-snapshot",
      entity.id,
      entity.wikipedia?.revisedAt ?? "norev",
      "v1",
    ],
    queryFn: () => fetchGlanceSnapshot(entity),
    placeholderData: localGlance,
    staleTime: 1000 * 60 * 60,
    retry: 0,
  });
  const glance = glanceData ?? localGlance;

  return (
    <section className="border-b border-slate-200/80 bg-[#f4f7fb]">
      <div className="mx-auto max-w-[1600px] px-5 py-6 md:py-8">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-slate-200/90 bg-white shadow-sm shadow-slate-200/50 overflow-hidden"
        >
          <div className="grid lg:grid-cols-[200px_minmax(0,1fr)] gap-0">
            <div className="relative flex flex-col items-center gap-3 border-b lg:border-b-0 lg:border-r border-slate-100 bg-gradient-to-b from-slate-50 to-white px-5 py-6">
              <div
                className="pointer-events-none absolute inset-0 opacity-60"
                style={{
                  background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${cfg.color}18 0%, transparent 70%)`,
                }}
              />
              {portraitUrl ? (
                <img
                  src={portraitUrl}
                  alt={entity.label}
                  referrerPolicy="no-referrer"
                  className={cn(
                    "relative z-10 border border-slate-200 shadow-md",
                    isOrg
                      ? "size-28 object-contain p-3 bg-white rounded-2xl"
                      : "h-40 w-32 sm:h-44 sm:w-36 object-cover object-top rounded-2xl bg-slate-100",
                  )}
                />
              ) : (
                <div
                  className={cn(
                    "relative z-10 flex size-28 items-center justify-center rounded-2xl border border-dashed bg-white",
                    cfg.borderClass,
                  )}
                >
                  <Icon className={cn("size-10 opacity-35", cfg.textClass)} />
                </div>
              )}
              {signatureUrl && (
                <figure className="relative z-10 w-full max-w-[9rem]">
                  <div className="rounded-lg border border-slate-200 bg-[#f8fafc] px-2 py-1.5">
                    <img
                      src={signatureUrl}
                      alt={`Signature of ${entity.label}`}
                      referrerPolicy="no-referrer"
                      className="mx-auto max-h-8 w-auto object-contain"
                    />
                  </div>
                  <figcaption className="mt-1 flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider text-slate-400">
                    <PenLine className="size-2.5" /> Autograph
                  </figcaption>
                </figure>
              )}
              <span
                className={cn(
                  "relative z-10 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                  cfg.bgClass,
                  cfg.textClass,
                  cfg.borderClass,
                )}
              >
                {cfg.label}
              </span>
            </div>

            <div className="px-5 py-5 sm:px-7 sm:py-6 min-w-0">
              <nav className="mb-2 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                <button
                  type="button"
                  onClick={() => navigate("/")}
                  className="hover:text-teal-700 cursor-pointer"
                >
                  {TYPE_BREADCRUMB[entity.type]}
                </button>
                <ChevronRight className="size-3 opacity-40" />
                {breadcrumbMid && (
                  <>
                    <span>{breadcrumbMid}</span>
                    <ChevronRight className="size-3 opacity-40" />
                  </>
                )}
                <span className="text-slate-700 truncate max-w-[200px]">{entity.label}</span>
                <span className="font-mono text-[10px] text-slate-400">{qid}</span>
              </nav>

              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="font-serif text-[1.85rem] sm:text-[2.35rem] font-bold tracking-tight text-slate-900 leading-[1.08]">
                  {entity.label}
                </h1>
                {entity.lifespan && (
                  <span className="font-mono text-[13px] text-slate-500">
                    {entity.lifespan}
                  </span>
                )}
                {marketing?.stock && (
                  <span className="font-mono text-[12px] text-emerald-700">
                    {marketing.stock}
                  </span>
                )}
              </div>

              {subtitle && (
                <p className="mt-1.5 text-[15px] text-slate-600 font-medium">
                  {subtitle}
                </p>
              )}

              {aliases.length > 0 && (
                <p className="mt-1 text-[12px] text-slate-400">
                  Also known as {aliases.join(" · ")}
                </p>
              )}

              <div className="mt-5 rounded-xl border border-teal-100 bg-gradient-to-br from-teal-50/80 via-white to-sky-50/40 px-4 py-4 sm:px-5 sm:py-5">
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <Sparkles className="size-3.5 text-teal-600" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-800/80">
                    About
                  </span>
                  {aboutFetching && (
                    <span className="text-[10px] text-slate-400">Writing…</span>
                  )}
                  {!aboutFetching && !about.fallback && (
                    <span className="rounded-full bg-teal-600/10 px-2 py-0.5 text-[10px] font-medium text-teal-800">
                      AI
                    </span>
                  )}
                </div>
                <div className="space-y-3">
                  {aboutParagraphs.map((p, i) => (
                    <p
                      key={i}
                      className={cn(
                        "leading-[1.75] text-slate-800",
                        i === 0
                          ? "text-[15.5px] sm:text-[16.5px]"
                          : "text-[14.5px] sm:text-[15px] text-slate-700",
                      )}
                    >
                      {p}
                    </p>
                  ))}
                </div>
              </div>

              {chipTags.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {chipTags.map((t) => (
                    <span
                      key={`tag-${t.label}`}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-600"
                    >
                      {t.label}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          <GlanceBoard
            snapshot={glance}
            isFetching={glanceFetching}
            isOrg={isOrg}
            website={marketing?.website}
          />
        </motion.div>
      </div>
    </section>
  );
}
