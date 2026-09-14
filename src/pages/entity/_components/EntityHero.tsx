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

const MEDIA_SKIP = /^(signature|image|logo image|coat of arms image|flag image)$/i;

type VitalValue = { text: string; id?: string };
type VitalGroup = { label: string; values: VitalValue[] };

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
    if (!g.values.some((v) => v.text.toLowerCase() === clean.toLowerCase())) {
      g.values.push({ text: clean, id });
    }
  };

  for (const r of wikiInfobox) {
    if (r.kind === "section" || !r.label || !r.value) continue;
    push(r.label, r.value);
  }
  for (const qf of quickFacts) {
    for (const line of qf.lines) push(qf.label, line.text, line.id);
  }
  if (marketing) {
    for (const kpi of marketing.kpis) push(kpi.label, kpi.value);
    for (const p of marketing.products) push("Products", p.label, p.id);
    if (marketing.website) push("Website", marketing.website);
    if (marketing.stock) push("Exchange / ticker", marketing.stock);
  }

  return order.map((k) => map.get(k)!).filter((g) => g.values.length > 0);
}

/** Short display for URLs / long money strings in the ribbon */
function compactValue(text: string): string {
  if (text.startsWith("http")) {
    return text.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
  return text
    .replace(/\s*United States dollar\b/gi, " USD")
    .replace(/\s*euro\b/gi, " EUR")
    .replace(/\s*pound sterling\b/gi, " GBP")
    .replace(/\s*Indian rupee\b/gi, " INR");
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
 * Light entity masthead + ultra-compact “At a glance” fact ribbon.
 * Every field kept; height stays low via inline label·value chips.
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
  const aliases = entity.aliases.filter(Boolean).slice(0, 8);
  const shortLead = useMemo(() => {
    if (!leadSnippet) return "";
    const parts = leadSnippet.split(/(?<=\.)\s+/).filter(Boolean);
    return parts.slice(0, 2).join(" ");
  }, [leadSnippet]);

  const vitals = useMemo(
    () => collectGroupedVitals(wikiInfobox, quickFacts, marketing),
    [wikiInfobox, quickFacts, marketing],
  );
  const factCount = vitals.reduce((n, g) => n + g.values.length, 0);

  return (
    <section className="relative border-b border-slate-200/90 bg-[#eef3f8]">
      {/* Soft atmosphere — light, not dark */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 60% 80% at 0% 0%, ${cfg.color}14 0%, transparent 55%),
            linear-gradient(180deg, #f7fafc 0%, #eef3f8 100%)
          `,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(15,23,42,0.06) 1px, transparent 0)",
          backgroundSize: "22px 22px",
          maskImage: "linear-gradient(180deg, black, transparent 90%)",
        }}
      />

      <div className="relative mx-auto max-w-[1600px] px-5 pt-5 pb-4 md:pt-6 md:pb-5">
        {/* Identity */}
        <div className="flex gap-4 sm:gap-5 items-start">
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="shrink-0"
          >
            {portraitUrl ? (
              <img
                src={portraitUrl}
                alt={entity.label}
                referrerPolicy="no-referrer"
                className={cn(
                  "border border-slate-200/90 shadow-sm",
                  isOrg
                    ? "size-[4.5rem] sm:size-20 object-contain p-2 bg-white rounded-xl"
                    : "h-[5.25rem] w-[4.25rem] sm:h-24 sm:w-[4.75rem] object-cover object-top bg-slate-100 rounded-xl",
                )}
              />
            ) : (
              <div
                className={cn(
                  "flex size-[4.5rem] sm:size-20 items-center justify-center rounded-xl border border-dashed bg-white",
                  cfg.borderClass,
                )}
              >
                <Icon className={cn("size-7 opacity-40", cfg.textClass)} />
              </div>
            )}
            {signatureUrl && (
              <figure className="mt-1.5 hidden sm:block w-[4.75rem]">
                <div className="rounded-md bg-white border border-slate-200/80 px-1.5 py-1">
                  <img
                    src={signatureUrl}
                    alt={`Signature of ${entity.label}`}
                    referrerPolicy="no-referrer"
                    className="mx-auto max-h-6 w-auto object-contain"
                  />
                </div>
                <figcaption className="mt-0.5 flex items-center justify-center gap-0.5 text-[8px] uppercase tracking-wider text-slate-400">
                  <PenLine className="size-2" /> Sign
                </figcaption>
              </figure>
            )}
          </motion.div>

          <div className="min-w-0 flex-1">
            <nav className="mb-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
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
              <span className="text-slate-700 truncate max-w-[160px]">{entity.label}</span>
              <span className="font-mono text-[10px] text-slate-400">{qid}</span>
            </nav>

            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 }}
            >
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h1 className="font-serif text-[1.65rem] sm:text-[2rem] font-bold tracking-tight text-slate-900 leading-[1.08]">
                  {entity.label}
                </h1>
                <span
                  className={cn(
                    "rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]",
                    cfg.bgClass,
                    cfg.textClass,
                    cfg.borderClass,
                  )}
                >
                  {cfg.label}
                </span>
                {entity.lifespan && (
                  <span className="font-mono text-[12px] text-slate-500">
                    {entity.lifespan}
                  </span>
                )}
              </div>

              {subtitle && (
                <p className="mt-0.5 text-[13.5px] text-slate-600 font-medium">
                  {subtitle}
                </p>
              )}

              {aliases.length > 0 && (
                <p className="mt-0.5 text-[11px] text-slate-400 truncate" title={aliases.join(" · ")}>
                  Also {aliases.join(" · ")}
                </p>
              )}

              {shortLead && (
                <p className="mt-2 text-[13px] sm:text-[13.5px] leading-relaxed text-slate-600 max-w-3xl line-clamp-2">
                  {shortLead}
                </p>
              )}

              {chipTags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {chipTags.slice(0, 8).map((t) => (
                    <button
                      key={`tag-${t.label}`}
                      type="button"
                      onClick={() => t.id && navigate(entityPath(t.id, t.label))}
                      className={cn(
                        "rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600",
                        t.id && "hover:border-teal-400 hover:text-teal-800 cursor-pointer",
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
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:border-teal-400"
                    >
                      <ExternalLink className="size-3" /> Site
                    </a>
                  )}
                </div>
              )}
            </motion.div>
          </div>
        </div>

        {/*
          At a glance — all facts, minimal height:
          each field is one inline chip (Label · values) wrapping in a dense flow.
        */}
        {vitals.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 }}
            className="mt-4 rounded-xl border border-slate-200/90 bg-white/90 shadow-sm shadow-slate-200/40"
          >
            <div className="flex items-center justify-between gap-2 px-3 pt-2 pb-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                At a glance · {factCount}
              </p>
            </div>
            <div className="px-2.5 pb-2.5 flex flex-wrap gap-1">
              {vitals.map((g) => {
                const joined = g.values.map((v) => compactValue(v.text)).join(" · ");
                const title = `${g.label}: ${g.values.map((v) => v.text).join(" · ")}`;
                const primary = g.values[0];
                const isLink = primary?.id?.startsWith("Q");
                const isUrl = primary?.text.startsWith("http");

                const inner = (
                  <>
                    <span className="text-slate-400 font-medium">{g.label}</span>
                    <span className="text-slate-300 mx-1" aria-hidden>
                      ·
                    </span>
                    <span className="text-slate-800 font-medium truncate max-w-[14rem] sm:max-w-[18rem]">
                      {joined}
                    </span>
                  </>
                );

                if (isLink && primary?.id) {
                  return (
                    <button
                      key={g.label}
                      type="button"
                      title={title}
                      onClick={() => navigate(entityPath(primary.id!, primary.text))}
                      className="inline-flex max-w-full items-center rounded-md border border-slate-200/90 bg-slate-50/80 px-2 py-1 text-[11.5px] leading-none hover:border-teal-400 hover:bg-teal-50/50 cursor-pointer"
                    >
                      {inner}
                    </button>
                  );
                }
                if (isUrl && primary) {
                  return (
                    <a
                      key={g.label}
                      href={primary.text}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={title}
                      className="inline-flex max-w-full items-center rounded-md border border-slate-200/90 bg-slate-50/80 px-2 py-1 text-[11.5px] leading-none hover:border-teal-400 hover:bg-teal-50/50"
                    >
                      {inner}
                    </a>
                  );
                }
                return (
                  <span
                    key={g.label}
                    title={title}
                    className="inline-flex max-w-full items-center rounded-md border border-slate-200/90 bg-slate-50/80 px-2 py-1 text-[11.5px] leading-none"
                  >
                    {inner}
                  </span>
                );
              })}
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}
