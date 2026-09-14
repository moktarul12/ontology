import { ChevronDown, List } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils.ts";
import type { WikiTocItem } from "@/lib/wikidata/types.ts";

function flattenIds(items: WikiTocItem[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    out.push(item.id);
    if (item.children?.length) out.push(...flattenIds(item.children));
  }
  return out;
}

function parentsWithChildren(items: WikiTocItem[]): Set<string> {
  const s = new Set<string>();
  for (const item of items) {
    if (item.children?.length) {
      s.add(item.id);
      for (const id of parentsWithChildren(item.children)) s.add(id);
    }
  }
  return s;
}

export function WikiTocNav({
  toc,
  readingMins,
  onNavigateSection,
  className,
}: {
  toc: WikiTocItem[];
  readingMins?: number;
  onNavigateSection?: (id: string) => void;
  className?: string;
}) {
  const allIds = useMemo(() => flattenIds(toc), [toc]);
  const expandable = useMemo(() => parentsWithChildren(toc), [toc]);
  const [activeId, setActiveId] = useState<string | null>(toc[0]?.id ?? null);
  const [open, setOpen] = useState<Set<string>>(() => new Set(expandable));

  useEffect(() => {
    setOpen(new Set(expandable));
  }, [expandable]);

  useEffect(() => {
    if (!allIds.length) return;
    const nodes = allIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!nodes.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const top = visible[0]?.target as HTMLElement | undefined;
        if (top?.id) setActiveId(top.id);
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: [0, 0.1, 0.5] },
    );
    for (const n of nodes) observer.observe(n);
    return () => observer.disconnect();
  }, [allIds]);

  const scrollTo = (item: WikiTocItem) => {
    const mainEl = item.mainArticleTitle
      ? document.getElementById(`main-${item.id}`)
      : null;
    const el = mainEl ?? document.getElementById(item.id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(item.id);
    }
    onNavigateSection?.(item.id);
  };

  const toggle = (id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderItems = (items: WikiTocItem[], depth = 0) => (
    <ul className={cn(depth === 0 ? "p-2 space-y-0.5" : "mt-0.5 ml-2 space-y-0.5 border-l border-slate-100 pl-2")}>
      {items.map((item) => {
        const hasKids = Boolean(item.children?.length);
        const isOpen = open.has(item.id);
        const selected = activeId === item.id;
        return (
          <li key={item.id}>
            <div className="flex items-stretch gap-0.5">
              {hasKids ? (
                <button
                  type="button"
                  aria-label={isOpen ? "Collapse" : "Expand"}
                  onClick={() => toggle(item.id)}
                  className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-50 hover:text-slate-700 cursor-pointer"
                >
                  <ChevronDown
                    className={cn("size-3.5 transition-transform", !isOpen && "-rotate-90")}
                  />
                </button>
              ) : (
                <span className="size-6 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => scrollTo(item)}
                className={cn(
                  "min-w-0 flex-1 rounded-lg px-2 py-1.5 text-left text-[13px] leading-snug cursor-pointer transition-colors",
                  selected
                    ? "bg-slate-900 text-white font-semibold"
                    : depth === 0
                      ? "text-cyan-800 hover:bg-cyan-50/80 font-medium"
                      : "text-cyan-700/90 hover:bg-slate-50",
                )}
              >
                <span className="line-clamp-2">{item.title}</span>
                {item.mainArticleTitle && (
                  <span
                    className={cn(
                      "mt-0.5 block text-[10px] font-normal truncate",
                      selected ? "text-white/70" : "text-slate-400",
                    )}
                  >
                    → {item.mainArticleTitle}
                  </span>
                )}
              </button>
            </div>
            {hasKids && isOpen && renderItems(item.children!, depth + 1)}
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav className={cn("rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/50 overflow-hidden", className)}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
        <List className="size-4 text-cyan-600" />
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Contents</p>
      </div>
      <div className="max-h-[calc(100vh-12rem)] overflow-auto">{renderItems(toc)}</div>
      {readingMins != null && readingMins > 0 && (
        <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          {readingMins} min read
        </div>
      )}
    </nav>
  );
}
