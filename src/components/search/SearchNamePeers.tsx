import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "motion/react";
import {
  Building2,
  Calendar,
  Film,
  HelpCircle,
  Lightbulb,
  List,
  Loader2,
  MapPin,
  User,
} from "lucide-react";
import { searchEntities } from "@/lib/wikidata/api.ts";
import { entityPath } from "@/lib/entityPath.ts";
import { getEntityTypeConfig } from "@/lib/wikidata/entity-types.ts";
import { cn } from "@/lib/utils.ts";
import type { EntityType, SearchResult } from "@/lib/wikidata/types.ts";

const TYPE_ICONS: Record<EntityType, React.ComponentType<{ className?: string }>> = {
  person: User,
  place: MapPin,
  organization: Building2,
  concept: Lightbulb,
  event: Calendar,
  work: Film,
  unknown: HelpCircle,
};

/**
 * Header control: open a list of other Wikidata hits for the same search name (with images).
 */
export function SearchNamePeers({
  name,
  currentId,
  className,
}: {
  name: string;
  currentId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const q = name.trim();

  const { data: results, isFetching, isError } = useQuery({
    queryKey: ["name-peers", q],
    queryFn: () => searchEntities(q, 12),
    enabled: open && q.length >= 2,
    staleTime: 1000 * 60 * 10,
  });

  const peers = (results ?? []).filter((r) => r.id !== currentId);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (r: SearchResult) => {
    setOpen(false);
    navigate(entityPath(r.id, r.label));
  };

  if (q.length < 2) return null;

  return (
    <div ref={ref} className={cn("relative shrink-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={`Other results for “${q}”`}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "flex size-9 items-center justify-center rounded-lg border transition-colors cursor-pointer",
          open
            ? "border-teal-400/50 bg-teal-400 text-slate-950"
            : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white",
        )}
      >
        {isFetching && open ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <List className="size-4" />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            role="listbox"
            className="absolute right-0 top-[calc(100%+0.4rem)] z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/15"
          >
            <div className="border-b border-slate-100 px-3.5 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Same search
              </p>
              <p className="mt-0.5 text-[13px] font-medium text-slate-800 truncate">
                “{q}”
              </p>
            </div>

            <div className="max-h-[min(22rem,60vh)] overflow-y-auto">
              {isFetching && peers.length === 0 && (
                <p className="px-4 py-6 text-center text-[13px] text-slate-500">
                  Looking up matches…
                </p>
              )}
              {isError && (
                <p className="px-4 py-6 text-center text-[13px] text-red-600">
                  Could not load matches.
                </p>
              )}
              {!isFetching && !isError && peers.length === 0 && (
                <p className="px-4 py-6 text-center text-[13px] text-slate-500">
                  No other entities with this name.
                </p>
              )}
              {peers.map((r) => {
                const cfg = getEntityTypeConfig(r.type);
                const Icon = TYPE_ICONS[r.type];
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="option"
                    onClick={() => pick(r)}
                    className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
                  >
                    <span
                      className={cn(
                        "relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border",
                        r.thumbnail
                          ? "border-slate-200 bg-slate-100"
                          : cn(cfg.bgClass, cfg.borderClass),
                      )}
                    >
                      {r.thumbnail ? (
                        <img
                          src={r.thumbnail}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 size-full object-cover object-top"
                          onError={(e) => e.currentTarget.remove()}
                        />
                      ) : (
                        <Icon className={cn("size-4", cfg.textClass)} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-slate-900 truncate">
                        {r.label}
                      </span>
                      {r.description && (
                        <span className="mt-0.5 block text-[11px] text-slate-500 line-clamp-2">
                          {r.description}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
                        cfg.bgClass,
                        cfg.textClass,
                        cfg.borderClass,
                      )}
                    >
                      {cfg.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
