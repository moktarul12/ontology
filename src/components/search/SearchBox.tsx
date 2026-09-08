import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { searchEntities } from "@/lib/wikidata/api.ts";
import { getEntityTypeConfig } from "@/lib/wikidata/entity-types.ts";
import type { SearchResult } from "@/lib/wikidata/types.ts";
import { motion, AnimatePresence } from "motion/react";
import { Search, Loader2, User, MapPin, Building2, Lightbulb, Calendar, HelpCircle, Film } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { EntityType } from "@/lib/wikidata/types.ts";

const TYPE_ICONS: Record<EntityType, React.ComponentType<{ className?: string }>> = {
  person: User,
  place: MapPin,
  organization: Building2,
  concept: Lightbulb,
  event: Calendar,
  work: Film,
  unknown: HelpCircle,
};

type SearchBoxProps = {
  size?: "lg" | "md";
  placeholder?: string;
  autoFocus?: boolean;
};

export default function SearchBox({ size = "lg", placeholder = "Search any person, place, concept, organization…", autoFocus = false }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [debouncedQuery] = useDebounce(query, 300);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: results, isLoading } = useQuery({
    queryKey: ["search", debouncedQuery],
    queryFn: () => searchEntities(debouncedQuery, 8),
    enabled: debouncedQuery.trim().length >= 2,
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const showDropdown = open && (isLoading || (results && results.length > 0));

  const handleSelect = (result: SearchResult) => {
    setOpen(false);
    setQuery(result.label);
    navigate(`/entity/${result.id}`);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
    if (e.key === "Enter" && results?.[0]) handleSelect(results[0]);
  };

  return (
    <div ref={containerRef} className={cn("relative w-full", size === "lg" ? "max-w-2xl" : "max-w-lg")}>
      {/* Input */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-xl border transition-all duration-200",
          "bg-card/80 backdrop-blur-sm",
          size === "lg" ? "px-5 py-4" : "px-4 py-3",
          focused
            ? "border-primary/60 shadow-[0_0_0_3px_oklch(0.72_0.18_210/0.15)]"
            : "border-border hover:border-border/80"
        )}
      >
        {isLoading && query.length >= 2 ? (
          <Loader2 className={cn("shrink-0 animate-spin text-muted-foreground", size === "lg" ? "size-5" : "size-4")} />
        ) : (
          <Search className={cn("shrink-0 text-muted-foreground", size === "lg" ? "size-5" : "size-4")} />
        )}
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setFocused(true);
            setOpen(true);
          }}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            "flex-1 bg-transparent outline-none placeholder:text-muted-foreground/50",
            size === "lg" ? "text-base" : "text-sm"
          )}
        />
      </div>

      {/* Dropdown */}
      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
            className="absolute top-full left-0 right-0 mt-2 z-50 overflow-hidden rounded-xl border border-border bg-popover shadow-2xl shadow-black/40"
          >
            {isLoading && (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Searching Wikidata…
              </div>
            )}
            {results?.map((result, i) => {
              const cfg = getEntityTypeConfig(result.type);
              const Icon = TYPE_ICONS[result.type];
              return (
                <motion.button
                  key={result.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03, duration: 0.15 }}
                  onMouseDown={() => handleSelect(result)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors cursor-pointer border-b border-border/40 last:border-0"
                >
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg border", cfg.bgClass, cfg.borderClass)}>
                    <Icon className={cn("size-4", cfg.textClass)} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm text-foreground truncate">{result.label}</div>
                    {result.description && (
                      <div className="text-xs text-muted-foreground truncate mt-0.5">{result.description}</div>
                    )}
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium border", cfg.bgClass, cfg.textClass, cfg.borderClass)}>
                    {cfg.label}
                  </span>
                </motion.button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
