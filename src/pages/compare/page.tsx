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
  Network,
  Search,
  Share2,
  Sparkles,
  X,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { EntitySummary, SearchResult } from "@/lib/wikidata/types.ts";
import SearchBox from "@/components/search/SearchBox.tsx";

function pick(entity: EntitySummary | undefined, pid: string) {
  return entity?.facts.find((f) => f.propertyId === pid)?.values.map((v) => v.label).join(" · ") ?? "—";
}

function pickList(entity: EntitySummary | undefined, pid: string, max = 4) {
  const vals = entity?.facts.find((f) => f.propertyId === pid)?.values.map((v) => v.label) ?? [];
  if (vals.length === 0) return "—";
  const shown = vals.slice(0, max);
  return vals.length > max ? `${shown.join(" · ")} +${vals.length - max}` : shown.join(" · ");
}

function occupationsOf(entity: EntitySummary | undefined): string[] {
  return entity?.facts.find((f) => f.propertyId === "P106")?.values.map((v) => v.label) ?? [];
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
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 flex items-center gap-2 text-slate-500 shadow-sm">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (!entity) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-sm text-slate-500 text-center">
        Choose someone from the suggestions panel →
      </div>
    );
  }

  const isPerson = entity.type === "person";
  const rows = isPerson
    ? [
        { label: "Born", value: pick(entity, "P569") },
        { label: "Birthplace", value: pick(entity, "P19") },
        { label: "Died", value: pick(entity, "P570") },
        { label: "Occupation", value: pickList(entity, "P106", 5) },
        { label: "Field", value: pickList(entity, "P101", 3) },
        { label: "Citizenship", value: pickList(entity, "P27", 3) },
        { label: "Educated at", value: pickList(entity, "P69", 3) },
        { label: "Languages", value: pickList(entity, "P1412", 4) },
        { label: "Spouse", value: pickList(entity, "P26", 3) },
        { label: "Awards", value: pickList(entity, "P166", 4) },
        { label: "Notable work", value: pickList(entity, "P800", 4) },
        { label: "Influenced by", value: pickList(entity, "P737", 3) },
      ]
    : [
        { label: "Type", value: entity.type },
        { label: "Inception", value: pick(entity, "P571") },
        { label: "Country", value: pick(entity, "P17") },
        { label: "Industry", value: pickList(entity, "P452", 3) },
        { label: "Headquarters", value: pick(entity, "P159") },
        { label: "Founders", value: pickList(entity, "P112", 3) },
        { label: "Website", value: pick(entity, "P856") },
      ];

  return (
    <article
      className={cn(
        "rounded-2xl border bg-white overflow-hidden shadow-sm shadow-slate-200/40",
        accent === "left" ? "border-cyan-200" : accent === "right" ? "border-amber-200" : "border-slate-200",
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden border-b p-5",
          accent === "left"
            ? "border-cyan-100 bg-gradient-to-br from-cyan-50 via-white to-sky-50/40"
            : accent === "right"
              ? "border-amber-100 bg-gradient-to-br from-amber-50 via-white to-orange-50/30"
              : "border-slate-100 bg-slate-50/80",
        )}
      >
        <div className="flex items-start gap-4">
          {entity.thumbnail ? (
            <img
              src={entity.thumbnail}
              alt=""
              className="size-20 rounded-2xl object-cover object-top shadow-md ring-1 ring-black/5"
            />
          ) : (
            <div className="size-20 rounded-2xl bg-slate-200" />
          )}
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-[10px] font-semibold uppercase tracking-[0.16em] mb-1",
                accent === "left" ? "text-cyan-700" : "text-amber-800",
              )}
            >
              {accent === "left" ? "Subject" : "Compare with"}
            </p>
            <h2 className="font-serif text-2xl font-semibold text-slate-900 leading-tight text-balance">
              {entity.label}
            </h2>
            <p className="mt-1 text-sm text-slate-500 line-clamp-2">
              {entity.description || entity.id}
            </p>
          </div>
        </div>
      </div>
      <dl className="divide-y divide-slate-100">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[6.5rem_1fr] gap-3 px-5 py-3 text-sm">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 pt-0.5">
              {r.label}
            </dt>
            <dd className="text-slate-800 leading-snug">{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t border-slate-100 px-5 py-3 bg-slate-50/50">
        <Link
          to={entityPath(entity.id, entity.label)}
          className="text-sm font-medium text-cyan-700 hover:underline"
        >
          Open full profile →
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

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/40">
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
              onClick={() =>
                window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener,noreferrer")
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-900 hover:bg-emerald-100 cursor-pointer"
            >
              WhatsApp
            </button>
            <button
              type="button"
              onClick={() =>
                window.open(
                  `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(brief.shareBlurb)}`,
                  "_blank",
                  "noopener,noreferrer",
                )
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[12px] font-medium text-sky-900 hover:bg-sky-100 cursor-pointer"
            >
              Facebook
            </button>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(shareUrl).catch(() => {})}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Share2 className="size-3.5" />
              Copy link
            </button>
          </div>
        </div>

        <p className="mt-4 text-[15px] leading-[1.75] text-slate-800 font-serif">{brief.verdict}</p>

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

function SuggestionRow({
  r,
  selected,
  onPick,
}: {
  r: SearchResult;
  selected?: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer",
        selected ? "bg-amber-50 ring-1 ring-amber-200" : "hover:bg-slate-50",
      )}
    >
      {r.thumbnail ? (
        <img src={r.thumbnail} alt="" className="size-10 rounded-lg object-cover object-top shrink-0" />
      ) : (
        <span className="size-10 rounded-lg bg-slate-100 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-900 truncate">{r.label}</span>
        {r.description && (
          <span className="block text-[11px] text-slate-500 truncate">{r.description}</span>
        )}
      </span>
      {selected && <Check className="size-4 text-amber-600 shrink-0" />}
    </button>
  );
}

export default function ComparePage() {
  const { id: rawId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const parsed = useMemo(() => parseEntityParam(rawId ?? ""), [rawId]);
  const id = parsed.qid;
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);

  const [query, setQuery] = useState("");
  const [debounced] = useDebounce(query, 450);
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

  const crafts = useMemo(() => occupationsOf(left.data), [left.data]);
  const craftSeed = crafts[0] ?? left.data?.type ?? "";

  const peers = useQuery({
    queryKey: ["compare-peers", id, craftSeed],
    queryFn: () => searchEntities(craftSeed, 14),
    enabled: Boolean(craftSeed) && craftSeed.length >= 2,
    staleTime: 1000 * 60 * 30,
  });

  const search = useQuery({
    queryKey: ["search", debounced, "compare"],
    queryFn: ({ signal }) => searchEntities(debounced, 10, signal),
    enabled: debounced.trim().length >= 2 && query.trim() === debounced.trim(),
  });

  const peerList = useMemo(
    () => (peers.data ?? []).filter((r) => r.id !== id),
    [peers.data, id],
  );

  const results = useMemo(
    () => (search.data ?? []).filter((r) => r.id !== id),
    [search.data, id],
  );

  const showSearchHits = query.trim().length >= 2 && (search.isFetching || results.length > 0);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        /* keep list visible in sidebar — no-op */
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    const current = searchParams.get("vs");
    if (otherId) {
      if (current !== otherId) setSearchParams({ vs: otherId }, { replace: true });
    } else if (current) {
      setSearchParams({}, { replace: true });
    }
  }, [otherId, searchParams, setSearchParams]);

  const pickOther = (r: SearchResult) => {
    setOtherId(r.id);
    setQuery(r.label);
  };

  const clearOther = () => {
    setOtherId(null);
    setQuery("");
  };

  const shareUrl =
    typeof window !== "undefined" && id && otherId
      ? `${window.location.origin}/compare/${rawId}?vs=${otherId}`
      : typeof window !== "undefined"
        ? window.location.href
        : "";

  const chromeBtn =
    "flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer";

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-800">
      <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#0b1220]/96 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] items-center gap-2 px-4 py-2 sm:gap-3 md:px-5 md:py-2.5">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex shrink-0 items-center gap-2 cursor-pointer"
          >
            <div className="flex size-8 items-center justify-center rounded-lg bg-cyan-500/20 border border-cyan-400/30">
              <Network className="size-4 text-cyan-300" />
            </div>
            <span className="hidden sm:inline font-serif font-semibold text-white tracking-tight">
              Wikigraph
            </span>
          </button>
          <button
            type="button"
            onClick={() => navigate(id ? entityPath(id, left.data?.label) : -1)}
            className={chromeBtn}
            title="Back"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="hidden sm:flex min-w-0 items-center gap-2 pl-1">
            <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 border border-teal-400/25">
              <GitCompareArrows className="size-3.5 text-teal-300" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500 leading-none mb-0.5">
                Compare
              </p>
              <p className="text-sm font-serif font-semibold text-white truncate max-w-[200px] leading-tight">
                {left.data?.label ?? id}
                {right.data ? ` · ${right.data.label}` : ""}
              </p>
            </div>
          </div>
          <div className="hidden md:block flex-1 min-w-0 max-w-sm">
            <SearchBox size="md" />
          </div>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(shareUrl || window.location.href).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            className={cn(chromeBtn, "ml-auto")}
            title="Copy link"
          >
            {copied ? <Check className="size-4 text-emerald-400" /> : <Share2 className="size-4" />}
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-6 md:px-5 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-6 lg:items-start">
        <main className="space-y-6 min-w-0">
          {left.data && right.data && (
            <AiComparePanel left={left.data} right={right.data} shareUrl={shareUrl} />
          )}

          <div className="grid gap-5 md:grid-cols-2">
            <CompareCard entity={left.data} loading={left.isLoading} accent="left" />
            <CompareCard
              entity={right.data}
              loading={Boolean(otherId) && right.isLoading}
              accent="right"
            />
          </div>

          {!otherId && (
            <p className="text-sm text-slate-500 lg:hidden">
              Use the suggestions panel to pick a peer to compare.
            </p>
          )}
        </main>

        {/* Right: search + same-category suggestions */}
        <aside className="mt-6 lg:mt-0 lg:sticky lg:top-[4.25rem] space-y-4">
          <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/40 overflow-hidden">
            <div className="border-b border-slate-100 bg-gradient-to-r from-slate-50 to-cyan-50/40 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Find a match
              </p>
              <p className="mt-0.5 text-sm font-serif font-semibold text-slate-900">
                Search or pick a peer
              </p>
            </div>

            <div ref={searchWrapRef} className="p-3 border-b border-slate-100">
              <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
                <Search className="size-4 text-slate-400 shrink-0" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && results[0]) pickOther(results[0]);
                  }}
                  placeholder="Search anyone…"
                  className="flex-1 bg-transparent outline-none text-sm min-w-0"
                  autoComplete="off"
                />
                {(otherId || query) && (
                  <button
                    type="button"
                    onClick={clearOther}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-200/80 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
                {search.isFetching && <Loader2 className="size-3.5 animate-spin text-slate-400" />}
              </div>

              {showSearchHits && (
                <ul className="mt-2 max-h-56 overflow-y-auto space-y-0.5">
                  {results.map((r) => (
                    <li key={r.id}>
                      <SuggestionRow
                        r={r}
                        selected={r.id === otherId}
                        onPick={() => pickOther(r)}
                      />
                    </li>
                  ))}
                  {!search.isFetching && results.length === 0 && (
                    <li className="px-2 py-3 text-xs text-slate-500">No matches</li>
                  )}
                </ul>
              )}
            </div>

            <div className="px-3 pt-3 pb-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 px-1 mb-2">
                {crafts.length > 0 ? `Same craft · ${crafts.slice(0, 2).join(", ")}` : "Suggestions"}
              </p>
              {peers.isFetching && peerList.length === 0 ? (
                <div className="flex items-center gap-2 px-2 py-4 text-xs text-slate-500">
                  <Loader2 className="size-3.5 animate-spin" /> Loading peers…
                </div>
              ) : peerList.length === 0 ? (
                <p className="px-2 py-3 text-xs text-slate-500">
                  Search above to find someone to compare.
                </p>
              ) : (
                <ul className="max-h-[min(28rem,55vh)] overflow-y-auto space-y-0.5 pb-2">
                  {peerList.map((r) => (
                    <li key={r.id}>
                      <SuggestionRow
                        r={r}
                        selected={r.id === otherId}
                        onPick={() => pickOther(r)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
