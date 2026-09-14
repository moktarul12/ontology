import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ChevronRight, ExternalLink, PenLine } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { entityPath } from "@/lib/entityPath.ts";
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

/** Visual-only — already shown as logo / signature */
const MEDIA_SKIP = /^(signature|image|logo image|coat of arms image|flag image)$/i;

type VitalValue = { text: string; id?: string };
type VitalGroup = { label: string; values: VitalValue[] };

/**
 * Merge wiki + Wikidata into groups by label so
 * Website / board member / Type share one compact row — no lost values.
 */
function collectGroupedVitals(
  wikiInfobox: WikiRow[],
  quickFacts: QuickFact[],
  marketing?: Props["marketing"],
): VitalGroup[] {
  const map = new Map<string, VitalGroup>();
  const order: string[] = [];

  const keyOf = (label: string) => label.trim().toLowerCase();

  const push = (label: string, text: string, id?: string) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!label.trim() || !clean) return;
    if (MEDIA_SKIP.test(label)) return;
    const k = keyOf(label);
    let g = map.get(k);
    if (!g) {
      g = { label: label.trim(), values: [] };
      map.set(k, g);
      order.push(k);
    }
    const dup = g.values.some(
      (v) => v.text.toLowerCase() === clean.toLowerCase(),
    );
    if (!dup) g.values.push({ text: clean, id });
  };

  for (const r of wikiInfobox) {
    if (r.kind === "section") continue;
    if (!r.label || !r.value) continue;
    push(r.label, r.value);
  }

  for (const qf of quickFacts) {
    for (const line of qf.lines) {
      push(qf.label, line.text, line.id);
    }
  }

  // Marketing KPIs / products / website fold into the same ribbon (no second stack)
  if (marketing) {
    for (const kpi of marketing.kpis) {
      push(kpi.label, kpi.value);
    }
    for (const p of marketing.products) {
      push("Products", p.label, p.id);
    }
    if (marketing.website) push("Website", marketing.website);
    if (marketing.stock) push("Exchange / ticker", marketing.stock);
  }

  return order.map((k) => map.get(k)!).filter((g) => g.values.length > 0);
}

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

const TYPE_BREADCRUMB: Record<EntityType, string> = {
  person: "People",
  place: "Places",
  organization: "Organizations",
  concept: "Concepts",
  event: "Events",
  work: "Works",
  unknown: "Entities",
};

/**
 * Compact entity masthead — identity + dense fact ribbon.
 * All fields stay visible; explore modes live in the page header.
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
  wikiInfobox,
  quickFacts,
}: Props) {
  const navigate = useNavigate();
  const isOrg = entity.type === "organization";
  const subtitle = marketing?.tagline || rolesLine;
  const chipTags = marketing?.industries.length ? marketing.industries : tags;
  const aliases = entity.aliases.filter(Boolean).slice(0, 12);

  const vitals = useMemo(
    () => collectGroupedVitals(wikiInfobox, quickFacts, marketing),
    [wikiInfobox, quickFacts, marketing],
  );

  return (
    <section className="relative overflow-hidden border-b border-white/10">
      <div className="absolute inset-0 bg-[#07111f]" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 55% 80% at 100% 0%, ${cfg.color}28 0%, transparent 50%),
            linear-gradient(120deg, #07111f 0%, #0a1628 100%)
          `,
        }}
      />
      {portraitUrl && (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 w-1/2 max-w-xl opacity-20"
          aria-hidden
        >
          <img
            src={portraitUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#07111f] via-[#07111f]/85 to-transparent" />
        </div>
      )}

      <div className="relative mx-auto max-w-[1600px] px-5 py-5 md:py-6">
        {/* Identity strip — short vertical footprint */}
        <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 sm:items-start">
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative shrink-0 self-center sm:self-start"
          >
            {portraitUrl ? (
              <img
                src={portraitUrl}
                alt={entity.label}
                referrerPolicy="no-referrer"
                className={cn(
                  "border border-white/20 shadow-lg",
                  isOrg
                    ? "size-20 sm:size-24 object-contain p-2.5 bg-white rounded-xl"
                    : "h-28 w-24 sm:h-32 sm:w-28 object-cover object-top bg-slate-900 rounded-xl",
                )}
              />
            ) : (
              <div
                className={cn(
                  "flex size-20 sm:size-24 items-center justify-center rounded-xl border border-dashed",
                  cfg.borderClass,
                  cfg.bgClass,
                )}
              >
                <Icon className={cn("size-8 opacity-40", cfg.textClass)} />
              </div>
            )}
            {signatureUrl && (
              <figure className="mt-2 hidden sm:block w-24 sm:w-28">
                <div className="rounded-md bg-[#eef2f6] px-2 py-1.5">
                  <img
                    src={signatureUrl}
                    alt={`Signature of ${entity.label}`}
                    referrerPolicy="no-referrer"
                    className="mx-auto max-h-8 w-auto object-contain"
                  />
                </div>
                <figcaption className="mt-1 flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider text-slate-500">
                  <PenLine className="size-2.5" /> Sign
                </figcaption>
              </figure>
            )}
          </motion.div>

          <div className="min-w-0 flex-1 text-center sm:text-left">
            <nav className="mb-1.5 flex flex-wrap items-center justify-center sm:justify-start gap-1 text-[11px] text-slate-400">
              <button
                type="button"
                onClick={() => navigate("/")}
                className="hover:text-teal-300 cursor-pointer"
              >
                {TYPE_BREADCRUMB[entity.type]}
              </button>
              <ChevronRight className="size-3 opacity-40" />
              {breadcrumbMid && (
                <>
                  <span className="text-slate-300">{breadcrumbMid}</span>
                  <ChevronRight className="size-3 opacity-40" />
                </>
              )}
              <span className="text-white/75 truncate max-w-[180px]">{entity.label}</span>
              <span className="font-mono text-[10px] text-slate-500">{qid}</span>
            </nav>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
            >
              <div className="flex flex-wrap items-baseline justify-center sm:justify-start gap-x-3 gap-y-1">
                <h1 className="font-serif text-[1.85rem] sm:text-[2.35rem] font-bold tracking-tight text-white leading-[1.05]">
                  {entity.label}
                </h1>
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                    cfg.bgClass,
                    cfg.textClass,
                    cfg.borderClass,
                  )}
                >
                  {cfg.label}
                </span>
                {entity.lifespan && (
                  <span className="font-mono text-[12px] text-teal-200/80">
                    {entity.lifespan}
                  </span>
                )}
              </div>

              {subtitle && (
                <p className="mt-1 text-[14px] text-slate-300 font-medium">
                  {subtitle}
                </p>
              )}

              {aliases.length > 0 && (
                <p className="mt-1 text-[11px] text-slate-500">
                  Also {aliases.join(" · ")}
                </p>
              )}

              {leadSnippet && (
                <p className="mt-2.5 text-[13.5px] sm:text-[14px] leading-relaxed text-slate-300/90 max-w-4xl">
                  {leadSnippet}
                </p>
              )}

              {chipTags.length > 0 && (
                <div className="mt-2.5 flex flex-wrap justify-center sm:justify-start gap-1">
                  {chipTags.map((t) => (
                    <button
                      key={`tag-${t.label}`}
                      type="button"
                      onClick={() => t.id && navigate(entityPath(t.id, t.label))}
                      className={cn(
                        "rounded-full border border-white/12 bg-white/[0.03] px-2 py-0.5 text-[11px] text-slate-200",
                        t.id && "hover:border-teal-300/40 cursor-pointer",
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
                      className="inline-flex items-center gap-1 rounded-full border border-white/12 px-2 py-0.5 text-[11px] text-slate-200 hover:bg-white/[0.06]"
                    >
                      <ExternalLink className="size-3" /> Site
                    </a>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        </div>

        {/* Dense fact ribbon — every field, grouped, low height */}
        {vitals.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.06 }}
            className="mt-5 rounded-xl border border-white/10 bg-white/[0.03] backdrop-blur-sm"
          >
            <div className="flex items-center justify-between gap-2 border-b border-white/8 px-3.5 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-400/85">
                At a glance · {vitals.reduce((n, g) => n + g.values.length, 0)} facts
              </p>
            </div>
            <dl className="grid grid-cols-1 xs:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-px bg-white/[0.04]">
              {vitals.map((g) => (
                <div
                  key={g.label}
                  className="bg-[#0a1626]/90 px-3.5 py-2.5 min-w-0"
                >
                  <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-500 truncate">
                    {g.label}
                  </dt>
                  <dd className="mt-0.5 text-[13px] leading-snug text-white/92">
                    {g.values.map((v, i) => (
                      <span key={`${v.text}-${i}`}>
                        {i > 0 && (
                          <span className="text-slate-600 mx-1" aria-hidden>
                            ·
                          </span>
                        )}
                        {v.id ? (
                          <button
                            type="button"
                            onClick={() => navigate(entityPath(v.id!, v.text))}
                            className="hover:text-teal-200 cursor-pointer text-left"
                          >
                            {v.text}
                          </button>
                        ) : v.text.startsWith("http") ? (
                          <a
                            href={v.text}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-teal-200 break-all"
                          >
                            {v.text.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          <span className="whitespace-pre-wrap">{v.text}</span>
                        )}
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </motion.div>
        )}
      </div>
    </section>
  );
}
