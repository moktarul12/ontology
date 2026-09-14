import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "@/hooks/use-debounce.ts";
import { fetchEntitySummary, searchEntities } from "@/lib/wikidata/api.ts";
import { entityPath, parseEntityParam } from "@/lib/entityPath.ts";
import {
  buildLocalCompareBrief,
  fetchCompareEnrichment,
  type CompareBrief,
} from "@/lib/ai/compare.ts";
import {
  ArrowLeft,
  GitCompareArrows,
  Loader2,
  Search,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { EntitySummary, SearchResult } from "@/lib/wikidata/types.ts";

function pick(entity: EntitySummary | undefined, pid: string) {
  return entity?.facts.find((f) => f.propertyId === pid)?.values.map((v) => v.label).join(" · ") ?? "—";
}

function CompareCard({
  entity,
  loading,
  accent,
}: {
  entity?: EntitySummary;
  loading?: boolean;
  accent?: "left" | "right";
}) {
  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 flex items-center gap-2 text-slate-500">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!entity) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
        Pick a second entity to compare.
      </div>
    );
  }
  const rows = [
    { label: "Type", value: entity.type },
    { label: "Born", value: pick(entity, "P569") },
    { label: "Birthplace", value: pick(entity, "P19") },
    { label: "Died", value: pick(entity, "P570") },
    { label: "Occupation", value: pick(entity, "P106") },
    { label: "Citizenship", value: pick(entity, "P27") },
    { label: "Spouse", value: pick(entity, "P26") },
    { label: "Notable work", value: pick(entity, "P800") },
  ];
  return (
    <article
      className={cn(
        "rounded-2xl border bg-white overflow-hidden shadow-sm",
        accent === "left" ? "border-cyan-200" : accent === "right" ? "border-amber-200" : "border-slate-200",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-3 border-b p-4",
          accent === "left" ? "border-cyan-100 bg-cyan-50/60" : accent === "right" ? "border-amber-100 bg-amber-50/60" : "border-slate-100 bg-slate-50/80",
        )}
      >
        {entity.thumbnail ? (
          <img src={entity.thumbnail} alt="" className="size-14 rounded-xl object-cover object-top" />
        ) : (
          <div className="size-14 rounded-xl bg-slate-200" />
        )}
        <div className="min-w-0">
          <h2 className="font-serif text-xl font-semibold text-slate-900 truncate">{entity.label}</h2>
          <p className="text-sm text-slate-500 truncate">{entity.description || entity.id}</p>
        </div>
      </div>
      <dl className="divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[7.5rem_1fr] gap-3 px-4 py-3 text-sm">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 pt-0.5">{r.label}</dt>
            <dd className="text-slate-800">{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-slate-100 p-3">
        <Link to={entityPath(entity.id, entity.label)} className="text-sm font-medium text-cyan-700 hover:underline">
          Open profile →
        </Link>
      </div>
    </article>
  );
}

function AiComparePanel({
  left,
  right,
  shareUrl,
}: {
  left: EntitySummary;
  right: EntitySummary;
  shareUrl: string;
}) {
  const local = useMemo(() => buildLocalCompareBrief(left, right), [left, right]);
  const query = useQuery({
    queryKey: [
      "compare-ai",
      left.id,
      right.id,
      left.wikipedia?.revisedAt ?? "",
      right.wikipedia?.revisedAt ?? "",
      "v1",
    ],
    queryFn: () => fetchCompareEnrichment(left, right),
    placeholderData: local,
    staleTime: 1000 * 60 * 60,
    retry: 0,
  });
  const brief = (query.data ?? local) as CompareBrief;

  const shareText = `${brief.shareBlurb}\n\n${shareUrl}`;

  const openWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener,noreferrer");
  };
  const openFacebook = () => {
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(brief.shareBlurb)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-cyan-50/40 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="size-4 text-cyan-600" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                AI matchup
              </p>
              {query.isFetching ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  Polishing…
                </span>
              ) : !brief.fallback ? (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                  AI
                </span>
              ) : null}
            </div>
            <h2 className="mt-2 font-serif text-2xl sm:text-3xl font-semibold text-slate-900 text-balance">
              {brief.headline}
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openWhatsApp}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-900 hover:bg-emerald-100 cursor-pointer"
            >
              WhatsApp
            </button>
            <button
              type="button"
              onClick={openFacebook}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[12px] font-medium text-sky-900 hover:bg-sky-100 cursor-pointer"
            >
              Facebook
            </button>
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
              title="Copy link"
            >
              <Share2 className="size-3.5" />
              Copy link
            </button>
          </div>
        </div>

        <p className="mt-4 text-[15px] leading-[1.75] text-slate-800 font-serif">
          {brief.verdict}
        </p>

        {brief.overlap.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {brief.overlap.map((o) => (
              <span
                key={o}
                className="rounded-md border border-slate-200 bg-white/90 px-2.5 py-1 text-[12px] text-slate-600"
              >
                {o}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 border-b border-slate-100 p-5 sm:grid-cols-2 sm:px-6">
        <div className="rounded-xl border border-cyan-100 bg-cyan-50/40 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-700/80">
            {left.label}
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-slate-800">{brief.leftAngle}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800/80">
            {right.label}
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-slate-800">{brief.rightAngle}</p>
        </div>
      </div>

      {brief.contrasts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] uppercase tracking-wider text-slate-500">
                <th className="px-5 py-3 font-semibold sm:px-6">Lens</th>
                <th className="px-4 py-3 font-semibold text-cyan-800">{left.label}</th>
                <th className="px-4 py-3 font-semibold text-amber-900">{right.label}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {brief.contrasts.map((c) => (
                <tr key={c.label} className="align-top">
                  <td className="px-5 py-3 sm:px-6">
                    <p className="font-medium text-slate-700">{c.label}</p>
                    {c.note && <p className="mt-1 text-[12px] text-slate-500">{c.note}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-800">{c.left || "—"}</td>
                  <td className="px-4 py-3 text-slate-800">{c.right || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {brief.hint && (
        <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400 sm:px-6">
          {brief.hint}
        </p>
      )}
    </section>
  );
}

export default function ComparePage() {
  const { id: rawId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = useMemo(() => parseEntityParam(rawId ?? ""), [rawId]);
  const id = parsed.qid;
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [debounced] = useDebounce(query, 300);
  const [open, setOpen] = useState(false);
  const [otherId, setOtherId] = useState<string | null>(() => {
    const vs = searchParams.get("vs");
    return vs && /^Q\d+$/i.test(vs) ? vs.toUpperCase() : null;
  });
  const searchWrapRef = useRef<HTMLDivElement>(null);

  const left = useQuery({
    queryKey: ["entity", id, "compare-left"],
    queryFn: () => fetchEntitySummary(id!),
    enabled: Boolean(id),
  });

  const right = useQuery({
    queryKey: ["entity", otherId, "compare-right"],
    queryFn: () => fetchEntitySummary(otherId!),
    enabled: Boolean(otherId),
  });

  const search = useQuery({
    queryKey: ["search", debounced, "compare"],
    queryFn: () => searchEntities(debounced, 8),
    enabled: debounced.trim().length >= 2,
  });

  const results = useMemo(
    () => (search.data ?? []).filter((r) => r.id !== id && r.id !== otherId),
    [search.data, id, otherId],
  );

  const showSuggestions =
    open && query.trim().length >= 2 && (search.isFetching || results.length > 0);

  // Outside click closes suggestions
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Keep ?vs= in the URL for shareable links
  useEffect(() => {
    const current = searchParams.get("vs");
    if (otherId) {
      if (current !== otherId) {
        setSearchParams({ vs: otherId }, { replace: true });
      }
    } else if (current) {
      setSearchParams({}, { replace: true });
    }
  }, [otherId, searchParams, setSearchParams]);

  const pickOther = (r: SearchResult) => {
    setOtherId(r.id);
    setQuery(r.label);
    setOpen(false);
  };

  const clearOther = () => {
    setOtherId(null);
    setQuery("");
    setOpen(false);
  };

  const shareUrl =
    typeof window !== "undefined" && id && otherId
      ? `${window.location.origin}/compare/${rawId}?vs=${otherId}`
      : typeof window !== "undefined"
        ? window.location.href
        : "";

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-5 py-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 cursor-pointer"
          >
            <ArrowLeft className="size-4" /> Back
          </button>
          <GitCompareArrows className="size-5 text-cyan-600" />
          <h1 className="font-serif text-xl font-semibold">Compare</h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8 space-y-6">
        <div ref={searchWrapRef} className="relative max-w-xl">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <Search className="size-4 text-slate-400" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onFocus={() => {
                if (query.trim().length >= 2) setOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && results[0]) pickOther(results[0]);
              }}
              placeholder="Search someone to compare with…"
              className="flex-1 bg-transparent outline-none text-sm"
              autoComplete="off"
            />
            {otherId && (
              <button
                type="button"
                onClick={clearOther}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                title="Clear"
              >
                <X className="size-4" />
              </button>
            )}
            {search.isFetching && open && <Loader2 className="size-4 animate-spin text-slate-400" />}
          </div>

          {showSuggestions && (
            <ul className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              {search.isFetching && results.length === 0 && (
                <li className="px-3 py-3 text-sm text-slate-500 flex items-center gap-2">
                  <Loader2 className="size-3.5 animate-spin" /> Searching…
                </li>
              )}
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pickOther(r)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50 cursor-pointer"
                  >
                    {r.thumbnail ? (
                      <img src={r.thumbnail} alt="" className="size-8 rounded-lg object-cover object-top" />
                    ) : (
                      <span className="size-8 rounded-lg bg-slate-100" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{r.label}</span>
                      {r.description && (
                        <span className="block text-xs text-slate-500 truncate">{r.description}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
              {!search.isFetching && results.length === 0 && (
                <li className="px-3 py-3 text-sm text-slate-500">No matches</li>
              )}
            </ul>
          )}
        </div>

        {left.data && right.data && (
          <AiComparePanel left={left.data} right={right.data} shareUrl={shareUrl} />
        )}

        <div className="grid gap-5 md:grid-cols-2">
          <CompareCard entity={left.data} loading={left.isLoading} accent="left" />
          <CompareCard entity={right.data} loading={Boolean(otherId) && right.isLoading} accent="right" />
        </div>

        {!otherId && (
          <p className="text-sm text-slate-500">
            Tip: start from an entity page → Compare, then search a peer (e.g. another singer or actor).
          </p>
        )}
      </main>
    </div>
  );
}
