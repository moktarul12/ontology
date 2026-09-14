import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import {
  ChevronRight,
  ExternalLink,
  PenLine,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { entityPath } from "@/lib/entityPath.ts";
import { ExploreAtlas } from "@/components/ExploreAtlas.tsx";
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

const TYPE_BREADCRUMB: Record<EntityType, string> = {
  person: "People",
  place: "Places",
  organization: "Organizations",
  concept: "Concepts",
  event: "Events",
  work: "Works",
  unknown: "Entities",
};

/** Prefer the richest vital rows for the hero footer — skip chrome. */
const VITAL_SKIP = /^(signature|image|module|website|years active)$/i;

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
};

function pickVitals(wikiInfobox: WikiRow[], quickFacts: QuickFact[]): Array<{ label: string; value: string }> {
  const fromWiki = wikiInfobox
    .filter((r) => r.kind !== "section" && r.label && r.value && !VITAL_SKIP.test(r.label))
    .map((r) => ({ label: r.label, value: r.value.replace(/\s+/g, " ").trim() }))
    .filter((r) => r.value.length > 0 && r.value.length < 220);

  if (fromWiki.length >= 3) return fromWiki.slice(0, 8);

  const fromFacts = quickFacts.map((qf) => ({
    label: qf.label,
    value: qf.lines.map((l) => l.text).join(", "),
  }));
  const seen = new Set(fromWiki.map((v) => v.label.toLowerCase()));
  for (const f of fromFacts) {
    if (seen.has(f.label.toLowerCase())) continue;
    fromWiki.push(f);
    seen.add(f.label.toLowerCase());
  }
  return fromWiki.slice(0, 8);
}

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
  wikiInfobox,
  quickFacts,
}: Props) {
  const navigate = useNavigate();
  const isOrg = entity.type === "organization";
  const subtitle = marketing?.tagline || rolesLine;
  const chipTags = (marketing?.industries.length ? marketing.industries : tags).slice(0, 5);
  const vitals = pickVitals(wikiInfobox, quickFacts);

  return (
    <section className="relative overflow-hidden border-b border-white/10">
      <div className="absolute inset-0 bg-[#08101c]" />
      {portraitUrl && (
        <div className="pointer-events-none absolute inset-0 opacity-[0.2]" aria-hidden>
          <img
            src={portraitUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover object-top scale-110 blur-2xl"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#08101c] via-[#08101c]/88 to-[#08101c]/6" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#08101c] via-transparent to-[#08101c]/75" />
        </div>
      )}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 55% 70% at 12% 35%, ${cfg.color}20 0%, transparent 55%)`,
        }}
      />

      <div className="relative mx-auto max-w-[1600px] px-5 pt-8 md:pt-10 pb-0">
        {/* Identity — one clear composition */}
        <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 items-center sm:items-start">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            className="relative shrink-0"
          >
            {portraitUrl ? (
              <img
                src={portraitUrl}
                alt={entity.label}
                referrerPolicy="no-referrer"
                className={cn(
                  "rounded-xl border border-white/20 shadow-[0_28px_60px_-20px_rgba(0,0,0,0.85)]",
                  isOrg
                    ? "size-28 sm:size-32 object-contain p-3 bg-white"
                    : "h-44 w-36 sm:h-52 sm:w-40 lg:h-56 lg:w-44 object-cover object-top bg-slate-900",
                )}
              />
            ) : (
              <div
                className={cn(
                  "flex h-44 w-36 items-center justify-center rounded-xl border border-dashed sm:h-52 sm:w-40",
                  cfg.borderClass,
                  cfg.bgClass,
                )}
              >
                <Icon className={cn("size-12 opacity-40", cfg.textClass)} />
              </div>
            )}
            {marketing?.stock && (
              <p className="mt-2 text-center font-mono text-[10px] tracking-wide text-emerald-300/90">
                {marketing.stock}
              </p>
            )}
          </motion.div>

          <div className="min-w-0 flex-1 text-center sm:text-left w-full pb-6 md:pb-8">
            <nav className="mb-3 flex flex-wrap items-center justify-center sm:justify-start gap-1.5 text-[11px] text-slate-400">
              <button
                type="button"
                onClick={() => navigate("/")}
                className="hover:text-cyan-300 cursor-pointer"
              >
                {TYPE_BREADCRUMB[entity.type]}
              </button>
              <ChevronRight className="size-3 opacity-50" />
              {breadcrumbMid && (
                <>
                  <span className="text-slate-300">{breadcrumbMid}</span>
                  <ChevronRight className="size-3 opacity-50" />
                </>
              )}
              <span className="text-white/80 truncate max-w-[200px]">{entity.label}</span>
            </nav>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.05 }}
            >
              <div className="flex flex-wrap items-baseline justify-center sm:justify-start gap-x-3 gap-y-1">
                <h1 className="font-serif text-[2.15rem] sm:text-4xl xl:text-[2.85rem] font-bold tracking-tight text-white leading-[1.05] text-balance">
                  {entity.label}
                </h1>
                <span
                  className={cn(
                    "translate-y-[-2px] rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                    cfg.bgClass,
                    cfg.textClass,
                    cfg.borderClass,
                  )}
                >
                  {cfg.label}
                </span>
              </div>

              {subtitle && (
                <p className="mt-2 text-[15px] text-slate-300/95 font-medium tracking-wide">
                  {subtitle}
                </p>
              )}

              {leadSnippet && (
                <p className="mt-4 text-[14px] md:text-[15px] leading-relaxed text-slate-300/88 w-full">
                  {leadSnippet}
                </p>
              )}
            </motion.div>

            {chipTags.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center sm:justify-start gap-1.5">
                {chipTags.map((t) => (
                  <button
                    key={`tag-${t.label}`}
                    type="button"
                    onClick={() => t.id && navigate(entityPath(t.id, t.label))}
                    className={cn(
                      "border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-200",
                      t.id && "hover:border-cyan-400/40 hover:text-cyan-100 cursor-pointer",
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
                    className="inline-flex items-center gap-1 border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/[0.08]"
                  >
                    <ExternalLink className="size-3" /> Site
                  </a>
                )}
              </div>
            )}

            <div className="mt-6 w-full">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 text-center sm:text-left">
                Explore
              </p>
              <ExploreAtlas
                qid={qid}
                entityType={entity.type}
                entityLabel={entity.label}
                active="entity"
                tone="dark"
              />
            </div>

            {isOrg && marketing && marketing.products.length > 0 && (
              <div className="mt-5">
                <p className="mb-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  Products
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center sm:justify-start">
                  {marketing.products.slice(0, 8).map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => p.id && navigate(entityPath(p.id, p.label))}
                      className={cn(
                        "border border-white/12 bg-white/[0.03] px-2.5 py-1 text-[12px] text-slate-200",
                        p.id && "hover:border-cyan-400/40 cursor-pointer",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isOrg && marketing && marketing.kpis.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 pt-4 justify-center sm:justify-start">
                {marketing.kpis.slice(0, 5).map((kpi) => {
                  const KIcon = kpi.icon;
                  return (
                    <div key={kpi.label} className="flex items-baseline gap-2" title={kpi.hint}>
                      <KIcon className="size-3.5 text-slate-500 translate-y-[1px]" />
                      <span className="text-[10px] uppercase tracking-wider text-slate-500">
                        {kpi.label}
                      </span>
                      <span className="text-sm font-semibold text-white">{kpi.value}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Hero footer — signature + vitals as one editorial band */}
        {(signatureUrl || vitals.length > 0) && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.12 }}
            className="relative -mx-5 mt-2 border-t border-white/10"
          >
            <div
              className="absolute inset-0 opacity-90"
              style={{
                background:
                  "linear-gradient(180deg, rgba(8,16,28,0) 0%, rgba(12,22,38,0.95) 18%, #0c1626 100%)",
              }}
            />
            <div className="relative px-5 py-6 md:py-7">
              <div className="flex flex-col lg:flex-row gap-6 lg:gap-10 lg:items-stretch">
                {signatureUrl && (
                  <figure className="shrink-0 lg:w-[240px] flex flex-col justify-end">
                    <div className="relative overflow-hidden rounded-lg bg-[#f3efe6] px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] ring-1 ring-black/10">
                      <div
                        className="pointer-events-none absolute inset-0 opacity-[0.35]"
                        style={{
                          backgroundImage:
                            "radial-gradient(circle at 20% 20%, rgba(0,0,0,0.04) 0.6px, transparent 0.7px)",
                          backgroundSize: "7px 7px",
                        }}
                      />
                      <img
                        src={signatureUrl}
                        alt={`Signature of ${entity.label}`}
                        referrerPolicy="no-referrer"
                        className="relative mx-auto max-h-[4.5rem] w-auto object-contain"
                      />
                    </div>
                    <figcaption className="mt-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      <PenLine className="size-3" />
                      Autograph
                    </figcaption>
                  </figure>
                )}

                {vitals.length > 0 && (
                  <div className="min-w-0 flex-1">
                    <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                      Vitals
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-8 gap-y-4">
                      {vitals.map((v, i) => (
                        <div
                          key={`${v.label}-${i}`}
                          className="relative min-w-0 pl-3 border-l border-cyan-400/35"
                        >
                          <p className="font-serif text-[11px] italic text-cyan-200/70 leading-none mb-1.5">
                            {v.label}
                          </p>
                          <p className="text-[13.5px] leading-snug text-white/92 whitespace-pre-wrap">
                            {v.value}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}
