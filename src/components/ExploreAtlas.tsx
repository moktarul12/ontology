import { useNavigate } from "react-router-dom";
import { Network, GitBranch, GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import { entityPath } from "@/lib/entityPath.ts";
import type { EntityType } from "@/lib/wikidata/types.ts";
import type { ComponentType, ReactNode } from "react";

export type ExploreSurface = "entity" | "graph" | "family-tree" | "compare";

type ExploreItem = {
  id: ExploreSurface;
  label: string;
  hint: string;
  icon: ComponentType<{ className?: string }>;
  path: (qid: string, label?: string) => string;
  show: (type: EntityType) => boolean;
  featured?: (type: EntityType) => boolean;
};

const ITEMS: ExploreItem[] = [
  {
    id: "graph",
    label: "Knowledge graph",
    hint: "Relations · expand on click",
    icon: Network,
    path: (qid, label) => `/graph/${qid}`,
    show: () => true,
    featured: () => true,
  },
  {
    id: "family-tree",
    label: "Family tree",
    hint: "Parents · spouses · children",
    icon: GitBranch,
    path: (qid) => `/family-tree/${qid}`,
    show: (type) => type === "person",
    featured: (type) => type === "person",
  },
  {
    id: "compare",
    label: "Compare",
    hint: "Side-by-side matchup",
    icon: GitCompareArrows,
    path: (qid) => `/compare/${qid}`,
    show: () => true,
  },
];

/** Soft copy that shifts with entity category */
function categoryHint(type: EntityType, id: ExploreSurface): string | undefined {
  if (id === "graph") {
    if (type === "person") return "People · works · awards";
    if (type === "organization") return "People · products · places";
    if (type === "work") return "Cast · crew · related works";
    if (type === "place") return "Contained · capital · links";
    return undefined;
  }
  if (id === "compare") {
    if (type === "person") return "Peers in the same craft";
    if (type === "organization") return "Rivals & peers";
    if (type === "work") return "Similar titles";
    return undefined;
  }
  if (id === "family-tree" && type === "person") return "Blood & marriage links";
  return undefined;
}

type Props = {
  qid: string;
  entityType: EntityType;
  entityLabel?: string;
  /** Which surface is current (highlights that tile) */
  active?: ExploreSurface;
  tone?: "dark" | "light";
  className?: string;
  /** Extra slot on the right (e.g. Wikipedia) */
  trailing?: ReactNode;
};

/**
 * Category-aware atlas dock: Knowledge graph · Family tree · Compare.
 * Family tree only for people; hints adapt to entity type.
 */
export function ExploreAtlas({
  qid,
  entityType,
  entityLabel,
  active = "entity",
  tone = "dark",
  className,
  trailing,
}: Props) {
  const navigate = useNavigate();
  const visible = ITEMS.filter((item) => item.show(entityType));
  const isDark = tone === "dark";

  return (
    <div className={cn("w-full", className)}>
      <div
        className={cn(
          "grid gap-2",
          visible.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
        )}
      >
        {visible.map((item) => {
          const Icon = item.icon;
          const selected = active === item.id;
          const featured = item.featured?.(entityType) && !selected;
          const hint = categoryHint(entityType, item.id) ?? item.hint;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === "entity") {
                  navigate(entityPath(qid, entityLabel));
                  return;
                }
                navigate(item.path(qid, entityLabel));
              }}
              className={cn(
                "group relative overflow-hidden rounded-xl px-3.5 py-3 text-left transition-all cursor-pointer",
                isDark
                  ? selected
                    ? "bg-cyan-400 text-slate-950 shadow-[0_12px_28px_-12px_rgba(34,211,238,0.55)]"
                    : featured
                      ? "border border-cyan-300/35 bg-cyan-400/10 text-cyan-50 hover:bg-cyan-400/18"
                      : "border border-white/12 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                  : selected
                    ? "bg-cyan-600 text-white shadow-md shadow-cyan-600/20"
                    : featured
                      ? "border border-cyan-200 bg-cyan-50 text-cyan-950 hover:bg-cyan-100/80"
                      : "border border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:bg-slate-50",
              )}
            >
              {featured && isDark && (
                <span className="pointer-events-none absolute -right-4 -top-6 size-16 rounded-full bg-cyan-300/20 blur-xl" />
              )}
              <div className="relative flex items-start gap-2.5">
                <span
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                    isDark
                      ? selected
                        ? "bg-slate-950/15"
                        : "bg-white/10"
                      : selected
                        ? "bg-white/20"
                        : "bg-slate-100",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold tracking-tight">
                    {item.label}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 block text-[11px] leading-snug",
                      isDark
                        ? selected
                          ? "text-slate-800/75"
                          : "text-slate-400"
                        : selected
                          ? "text-white/80"
                          : "text-slate-500",
                    )}
                  >
                    {hint}
                  </span>
                </span>
              </div>
            </button>
          );
        })}
      </div>
      {trailing && <div className="mt-2 flex justify-center sm:justify-start">{trailing}</div>}
    </div>
  );
}

/** Compact pill strip for sticky headers / toolbars */
export function ExploreAtlasPills({
  qid,
  entityType,
  entityLabel,
  active,
  className,
}: Omit<Props, "tone" | "trailing">) {
  const navigate = useNavigate();
  const visible = ITEMS.filter((item) => item.show(entityType));

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-slate-200/90 bg-white/95 p-1 shadow-sm backdrop-blur",
        className,
      )}
    >
      {visible.map((item) => {
        const Icon = item.icon;
        const selected = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(item.path(qid, entityLabel))}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium cursor-pointer transition-colors",
              selected
                ? "bg-cyan-600 text-white"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
            title={categoryHint(entityType, item.id) ?? item.hint}
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="hidden sm:inline">{item.label.replace("Knowledge ", "")}</span>
          </button>
        );
      })}
    </div>
  );
}
