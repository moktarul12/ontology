import type { ComponentType } from "react";
import {
  Award,
  Building2,
  Calendar,
  Clapperboard,
  DollarSign,
  ExternalLink,
  Globe,
  Languages,
  MapPin,
  Mic2,
  Music,
  Sparkles,
  Store,
  TrendingUp,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { EntityType } from "@/lib/wikidata/types.ts";
import type { GlanceCard, GlanceItem, GlanceMetric, GlanceSnapshot } from "@/lib/ai/glance.ts";

function Glyph({
  name,
  className,
}: {
  name?: string;
  className?: string;
}) {
  const Icon =
    (
      {
        store: Store,
        cart: Users,
        globe: Globe,
        chart: TrendingUp,
        building: Building2,
        mic: Mic2,
        film: Clapperboard,
        music: Music,
        award: Award,
        phone: Sparkles,
        spark: Sparkles,
        cpu: Sparkles,
      } as Record<string, ComponentType<{ className?: string }>>
    )[name ?? ""] ?? Sparkles;
  return <Icon className={className} />;
}

function pillIcon(label: string): ComponentType<{ className?: string }> {
  const l = label.toLowerCase();
  if (/born|founded|active|year|date|published/.test(l)) return Calendar;
  if (/home|hq|head|place|country|town|region|location/.test(l)) return MapPin;
  if (/language/.test(l)) return Languages;
  if (/award|filmfare|honour/.test(l)) return Award;
  if (/employee|people|reach|population/.test(l)) return Users;
  if (/revenue|profit|cap|income/.test(l)) return DollarSign;
  if (/store|location|network/.test(l)) return Store;
  if (/ticker|listed|public/.test(l)) return TrendingUp;
  return Sparkles;
}

function pillAccent(label: string, fallback: string): string {
  const l = label.toLowerCase();
  if (/born|date|died/.test(l)) return "text-rose-300";
  if (/home|hq|head|place|country|town|region/.test(l)) return "text-emerald-300";
  if (/active|year|founded|published/.test(l)) return "text-sky-300";
  if (/award|filmfare|honour/.test(l)) return "text-amber-300";
  if (/language|genre/.test(l)) return "text-violet-300";
  if (/revenue|profit|cap/.test(l)) return "text-teal-300";
  if (/store|employee/.test(l)) return "text-cyan-300";
  return fallback;
}

function ctaClass(type: EntityType): string {
  if (type === "organization") return "bg-teal-400 text-slate-950 hover:bg-teal-300";
  if (type === "place") return "bg-emerald-400 text-slate-950 hover:bg-emerald-300";
  if (type === "event") return "bg-orange-400 text-slate-950 hover:bg-orange-300";
  if (type === "work") return "bg-fuchsia-400 text-slate-950 hover:bg-fuchsia-300";
  if (type === "concept") return "bg-sky-400 text-slate-950 hover:bg-sky-300";
  return "bg-amber-300 text-slate-950 hover:bg-amber-200";
}

function iconChipClass(type: EntityType): string {
  if (type === "organization") return "bg-teal-400 text-slate-950";
  if (type === "place") return "bg-emerald-400 text-slate-950";
  if (type === "event") return "bg-orange-400 text-slate-950";
  if (type === "work") return "bg-fuchsia-400 text-slate-950";
  if (type === "concept") return "bg-sky-400 text-slate-950";
  return "bg-amber-300 text-slate-950";
}

function featureTitle(type: EntityType, crafts?: string, description?: string): string {
  const blob = `${crafts ?? ""} ${description ?? ""}`.toLowerCase();
  if (type === "person") {
    if (/sing|playback/.test(blob) && /india|hindi|bollywood/.test(blob)) {
      return "Legendary Voice of Indian Cinema";
    }
    if (/physic|relativity/.test(blob)) return "The Mind That Reshaped Physics";
    if (/act/.test(blob)) return "A Life on Screen";
    return "A Life in Frames";
  }
  if (type === "organization") {
    if (/retail|store|shop/.test(blob)) return "Retail at Continental Scale";
    return "Built to Operate at Scale";
  }
  if (type === "place") return "The Character of This Place";
  if (type === "event") return "What This Moment Changed";
  if (type === "work") return "Why This Work Endures";
  return "At a Glance";
}

function pillsFor(
  type: EntityType,
  snapshot: GlanceSnapshot,
): Array<{ label: string; value: string; note?: string }> {
  if (type === "organization") {
    const metrics = snapshot.metrics.filter((m) => !/^(founded|ticker)$/i.test(m.label));
    const hq = snapshot.cards.find((c) => /headquarter/i.test(c.label));
    const listed = snapshot.cards.find((c) => /^listed$/i.test(c.label));
    const out: Array<{ label: string; value: string; note?: string }> = metrics.slice(0, 4).map((m) => ({
      label: m.label,
      value: m.value,
      note: m.note,
    }));
    if (hq) out.push({ label: hq.label, value: hq.value, note: hq.note });
    else if (listed) out.push({ label: listed.label, value: listed.value, note: listed.note });
    return out.slice(0, 5);
  }
  return snapshot.cards.slice(0, 5).map((c: GlanceCard) => ({
    label: c.label,
    value: c.value,
    note: c.note,
  }));
}

function stageItems(type: EntityType, snapshot: GlanceSnapshot): GlanceItem[] {
  if (type === "person") {
    const roles = snapshot.bands?.find((b) => b.layout === "roles");
    if (roles?.items.length) return roles.items.slice(0, 4);
  }
  if (type === "organization") {
    const scale = snapshot.bands?.find((b) => b.id === "scale" || b.layout === "rows");
    const digital = snapshot.bands?.find((b) => b.id === "digital" || b.layout === "tiles");
    const fromScale = (scale?.items ?? []).slice(0, 2);
    const fromDigital = (digital?.items ?? []).slice(0, 2);
    const mixed = [...fromScale, ...fromDigital];
    if (mixed.length >= 3) return mixed.slice(0, 4);
    const metrics: GlanceMetric[] = snapshot.metrics.filter((m) => !/^(founded|ticker)$/i.test(m.label));
    return metrics.slice(0, 4).map((m) => ({
      label: m.label,
      value: m.value,
      note: m.note,
      icon: /store|location/.test(m.label) ? "store" : /employee/.test(m.label) ? "cart" : "chart",
    }));
  }
  const themed = snapshot.bands?.find((b) => b.layout === "roles" || b.id === type);
  if (themed?.items.length) return themed.items.slice(0, 4);
  return (snapshot.cards.slice(0, 4) as GlanceItem[]).map((c) => ({
    label: c.label,
    value: c.value,
    note: c.note,
  }));
}

function usesPhotoStage(type: EntityType): boolean {
  return type === "person" || type === "place" || type === "event" || type === "work";
}

export function GlanceBoard({
  snapshot,
  entityType,
  isFetching,
  website,
  images,
  portraitUrl,
  onLearnMore,
  accentClass,
  description,
}: {
  snapshot: GlanceSnapshot;
  entityType: EntityType;
  isFetching: boolean;
  website?: string;
  images: string[];
  portraitUrl?: string;
  onLearnMore?: () => void;
  accentClass: string;
  description?: string;
}) {
  const pills = pillsFor(entityType, snapshot);
  const stage = stageItems(entityType, snapshot);
  const story = snapshot.pulse || snapshot.cards[0]?.value || "";
  const title = snapshot.identity?.featureTitle || featureTitle(entityType, snapshot.identity?.crafts, description);
  const gallery = (() => {
    const skipPlace = /house|home|kunj|building|temple|street|memorial|panoramio|\bmap\b|stamp/i;
    const rest = images.filter((u) => u && u !== portraitUrl);
    if (entityType !== "person") return rest;
    const people = rest.filter((u) => !skipPlace.test(u));
    const places = rest.filter((u) => skipPlace.test(u));
    return ([portraitUrl, ...people, ...places].filter(Boolean) as string[]);
  })();
  const photoStage = usesPhotoStage(entityType);

  return (
    <div className="relative">
      {isFetching && (
        <p className="mb-2 text-[10px] text-white/40">Updating highlights…</p>
      )}

      {pills.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {pills.map((p) => {
            const Icon = pillIcon(p.label);
            const color = pillAccent(p.label, accentClass);
            return (
              <div
                key={`${p.label}-${p.value}`}
                className="flex min-w-[9rem] flex-1 items-start gap-2.5 rounded-2xl bg-[#141c2e] px-3.5 py-3 ring-1 ring-white/12"
              >
                <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/10", color)}>
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-white/55">
                    {p.label}
                  </p>
                  <p className="mt-0.5 text-[13.5px] font-semibold leading-snug text-white whitespace-nowrap">
                    {p.value}
                  </p>
                  {p.note && (
                    <p className="text-[11px] leading-snug text-white/60 line-clamp-2">{p.note}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(16rem,0.78fr)_minmax(0,1.8fr)] md:items-end">
        <article className="px-1 py-1">
          <h2 className="font-serif text-[1.7rem] font-bold leading-[1.15] tracking-tight text-white">
            {title}
          </h2>
          {story && (
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-white/80 line-clamp-5">
              {story}
            </p>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {onLearnMore && (
              <button
                type="button"
                onClick={onLearnMore}
                className={cn(
                  "inline-flex items-center rounded-full px-4 py-1.5 text-[12px] font-semibold cursor-pointer shadow-lg shadow-black/20",
                  ctaClass(entityType),
                )}
              >
                Learn more
              </button>
            )}
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                className={cn("inline-flex items-center gap-1 text-[12px] font-semibold", accentClass)}
              >
                Official site
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        </article>

        <div
          className={cn(
            "grid gap-2.5",
            stage.length >= 4 ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2",
          )}
        >
          {stage.map((item, i) => {
            const photo = photoStage
              ? gallery[i] || gallery[0] || (entityType === "person" ? portraitUrl : undefined)
              : undefined;
            return (
              <div
                key={`${item.label}-${item.value}-${i}`}
                className="group relative overflow-hidden rounded-2xl bg-[#121c30]/80 ring-1 ring-white/10"
              >
                {photo ? (
                  <div className="relative h-[12.25rem] overflow-hidden">
                    <img
                      src={photo}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                      style={{
                        objectPosition: ["48% 10%", "28% 16%", "72% 12%", "50% 26%"][i % 4],
                        filter: entityType === "person" ? "sepia(0.18) contrast(1.08) saturate(0.75)" : undefined,
                      }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/75 to-black/10" />
                    <div className="absolute inset-x-0 bottom-0 px-3 pb-3">
                      <span className={cn("mb-1.5 flex size-7 items-center justify-center rounded-full shadow-md", iconChipClass(entityType))}>
                        <Glyph name={item.icon} className="size-3.5" />
                      </span>
                      <p className={cn("text-[10px] font-semibold uppercase tracking-[0.14em] drop-shadow", accentClass)}>
                        {item.label}
                      </p>
                      <p className="mt-0.5 text-[12px] font-medium leading-snug text-white drop-shadow line-clamp-3">
                        {item.note || item.value}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-[8.5rem] flex-col justify-between px-3.5 py-3.5">
                    <span className={cn("flex size-7 items-center justify-center rounded-full", iconChipClass(entityType))}>
                      <Glyph name={item.icon} className="size-3.5" />
                    </span>
                    <div>
                      <p className={cn("text-[10px] font-semibold uppercase tracking-[0.14em]", accentClass)}>
                        {item.label}
                      </p>
                      <p className="mt-1 text-[15px] font-semibold leading-snug text-white">{item.value}</p>
                      {item.note && (
                        <p className="mt-0.5 text-[12px] text-white/50">{item.note}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
