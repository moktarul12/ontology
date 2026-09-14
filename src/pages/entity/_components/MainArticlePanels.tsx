import { useQuery } from "@tanstack/react-query";
import { BookOpen, ChevronDown, ExternalLink, Sparkles } from "lucide-react";
import { useMemo, useState, type MouseEvent } from "react";
import { fetchMainArticleEnrichment, type MainArticleBrief } from "@/lib/ai/enrich.ts";
import { cn } from "@/lib/utils.ts";
import type { EntitySummary, WikiMainArticle } from "@/lib/wikidata/types.ts";

function StatusPills({ isFetching, fallback }: { isFetching: boolean; fallback?: boolean }) {
  if (isFetching) {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
        Polishing…
      </span>
    );
  }
  if (!fallback) {
    return (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
        AI
      </span>
    );
  }
  return null;
}

function MainArticleCard({
  article,
  entity,
  onArticleClick,
}: {
  article: WikiMainArticle;
  entity: EntitySummary;
  onArticleClick?: (e: MouseEvent<HTMLElement>) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const local: MainArticleBrief = useMemo(
    () => ({
      heading: article.parentSection,
      pageTitle: article.title,
      summary: article.lead.slice(0, 700) || `Full Wikipedia page for ${article.title}.`,
      paragraphs: article.sections.slice(0, 4).map((s) => {
        const body = s.content.split(/\n{2,}/)[0]?.trim() ?? "";
        return body ? `${s.title} — ${body.slice(0, 320)}` : s.title;
      }),
      highlights: article.sections.slice(0, 10).map((s) => s.title),
      fallback: true,
    }),
    [article],
  );

  const query = useQuery({
    queryKey: [
      "main-article-enrich",
      entity.id,
      article.title,
      article.revisedAt ?? entity.wikipedia?.revisedAt ?? "norev",
      "v2-full",
    ],
    queryFn: () => fetchMainArticleEnrichment(entity, article),
    placeholderData: local,
    staleTime: 1000 * 60 * 60,
    retry: 0,
  });

  const brief = (query.data ?? local) as MainArticleBrief;
  const hasHtml = Boolean(article.html && article.html.length > 80);

  return (
    <article
      id={`main-${article.parentSectionId}`}
      className="scroll-mt-28 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="border-b border-slate-100 bg-gradient-to-br from-slate-50 via-white to-cyan-50/50 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <BookOpen className="size-3.5 text-cyan-600" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {brief.heading || article.parentSection}
              </p>
              <StatusPills isFetching={query.isFetching} fallback={brief.fallback} />
            </div>
            <h3 className="mt-1.5 font-serif text-xl sm:text-2xl font-semibold text-slate-900">
              {brief.pageTitle || article.title}
            </h3>
            <p className="mt-1 text-[12px] text-slate-500">
              Complete page content · linked from {entity.label}’s {article.parentSection} section
            </p>
          </div>
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-cyan-800 hover:bg-cyan-50"
          >
            <ExternalLink className="size-3" />
            Wikipedia
          </a>
        </div>

        <p className="mt-4 font-serif text-[15px] sm:text-[16px] leading-[1.7] text-slate-800">
          {brief.summary}
        </p>

        {brief.paragraphs && brief.paragraphs.length > 0 && !hasHtml && (
          <div className="mt-3 space-y-2">
            {brief.paragraphs.map((p, i) => (
              <p key={i} className="text-[14px] leading-[1.7] text-slate-600">
                {p}
              </p>
            ))}
          </div>
        )}

        {brief.highlights && brief.highlights.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              <Sparkles className="size-3" />
              Sections
            </p>
            <ul className="flex flex-wrap gap-1.5">
              {brief.highlights.slice(0, 12).map((h) => (
                <li
                  key={h}
                  className="rounded-md border border-slate-200/90 bg-white/90 px-2.5 py-1 text-[12px] text-slate-600"
                >
                  {h}
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      {hasHtml && (
        <div className="border-t border-slate-100">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-[13px] font-medium text-slate-700 hover:bg-slate-50 cursor-pointer sm:px-6"
          >
            <span>{expanded ? "Hide full article" : "Show full article"}</span>
            <ChevronDown
              className={cn(
                "size-4 text-slate-400 transition-transform",
                expanded && "rotate-180",
              )}
            />
          </button>
          {expanded && (
            <div
              className="wiki-article wiki-article-light wiki-main-embed max-w-none border-t border-slate-100 px-5 py-5 sm:px-6 sm:py-6"
              onClick={onArticleClick}
              dangerouslySetInnerHTML={{ __html: article.html! }}
            />
          )}
        </div>
      )}

      {!hasHtml && brief.hint && (
        <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400 sm:px-6">
          {brief.hint}
        </p>
      )}
    </article>
  );
}

/**
 * Split biography HTML on h2 boundaries so we can insert full main-article
 * bodies directly under Discography / Filmography / Awards (not only a hatnote link).
 */
function splitWikiHtmlByH2(html: string): Array<{ headingHtml: string; id?: string; title?: string; bodyHtml: string }> {
  const parts: Array<{ headingHtml: string; id?: string; title?: string; bodyHtml: string }> = [];
  const re = /<h2\b[^>]*>[\s\S]*?<\/h2>/gi;
  const matches = [...html.matchAll(re)];
  if (!matches.length) {
    return [{ headingHtml: "", bodyHtml: html }];
  }

  const firstIdx = matches[0]!.index ?? 0;
  if (firstIdx > 0) {
    parts.push({ headingHtml: "", bodyHtml: html.slice(0, firstIdx) });
  }

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? html.length) : html.length;
    const headingHtml = m[0];
    const bodyHtml = html.slice(start + headingHtml.length, end);
    const id = headingHtml.match(/\bid=["']([^"']+)["']/i)?.[1];
    const title =
      headingHtml.match(/class="[^"]*mw-headline[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ||
      headingHtml.replace(/<[^>]+>/g, " ");
    const cleanTitle = title.replace(/\[\s*edit\s*\]/gi, "").replace(/\s+/g, " ").trim();
    parts.push({
      headingHtml,
      id,
      title: cleanTitle,
      bodyHtml,
    });
  }
  return parts;
}

function matchArticle(
  articles: WikiMainArticle[],
  part: { id?: string; title?: string },
): WikiMainArticle | undefined {
  if (part.id) {
    const byId = articles.find((a) => a.parentSectionId === part.id);
    if (byId) return byId;
  }
  if (part.title) {
    const t = part.title.toLowerCase();
    return articles.find(
      (a) =>
        a.parentSection.toLowerCase() === t ||
        a.parentSection.toLowerCase().includes(t) ||
        t.includes(a.parentSection.toLowerCase()),
    );
  }
  return undefined;
}

/** Strip hatnote-only stubs when we embed the full page underneath. */
function stripRedundantHatnotes(bodyHtml: string, articleTitle: string): string {
  const escaped = articleTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return bodyHtml.replace(
    new RegExp(
      `<div[^>]*class="[^"]*\\bhatnote\\b[^"]*"[^>]*>[\\s\\S]*?(?:${escaped}|Main\\s+article)[\\s\\S]*?<\\/div>`,
      "gi",
    ),
    `<p class="wiki-main-bridge text-[13px] text-slate-500 mb-3">Full page embedded below · also on Wikipedia.</p>`,
  );
}

export function MainArticlePanels({
  entity,
  articles,
}: {
  entity: EntitySummary;
  articles?: WikiMainArticle[];
}) {
  // Used when we can't interleave (no HTML / no matches) — still show full cards
  if (!articles?.length) return null;
  return (
    <div className="mt-8 space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-700/80">
          Expanded from Wikipedia
        </p>
        <h3 className="font-serif text-2xl font-bold text-slate-900 tracking-tight">
          Complete related pages
        </h3>
      </div>
      {articles.map((art) => (
        <MainArticleCard key={`${art.parentSectionId}-${art.title}`} article={art} entity={entity} />
      ))}
    </div>
  );
}

/**
 * Renders the biography HTML with full Discography / Filmography / Awards pages
 * interleaved under their section headings (link + complete content + AI brief).
 */
export function WikiArticleWithMainEmbeds({
  entity,
  html,
  articles,
  onArticleClick,
}: {
  entity: EntitySummary;
  html: string;
  articles?: WikiMainArticle[];
  onArticleClick: (e: MouseEvent<HTMLElement>) => void;
}) {
  const list = articles ?? [];
  const parts = useMemo(() => (html.trim() ? splitWikiHtmlByH2(html) : []), [html]);

  if (!html.trim()) {
    if (!list.length) return null;
    return (
      <div className="space-y-5">
        {list.map((art) => (
          <MainArticleCard
            key={`${art.parentSectionId}-${art.title}`}
            article={art}
            entity={entity}
            onArticleClick={onArticleClick}
          />
        ))}
      </div>
    );
  }

  if (!list.length) {
    return (
      <article
        className="wiki-article wiki-article-light max-w-none"
        onClick={onArticleClick}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  const used = new Set<string>();

  return (
    <div className="space-y-6">
      {parts.map((part, idx) => {
        const matched = matchArticle(list, part);
        if (matched) used.add(`${matched.parentSectionId}::${matched.title}`);
        const body = matched
          ? stripRedundantHatnotes(part.bodyHtml, matched.title)
          : part.bodyHtml;

        return (
          <div key={part.id ?? `part-${idx}`} className="space-y-4">
            {(part.headingHtml || body) && (
              <div
                className="wiki-article wiki-article-light max-w-none"
                onClick={onArticleClick}
                dangerouslySetInnerHTML={{ __html: `${part.headingHtml}${body}` }}
              />
            )}
            {matched && (
              <MainArticleCard
                article={matched}
                entity={entity}
                onArticleClick={onArticleClick}
              />
            )}
          </div>
        );
      })}

      {list
        .filter((a) => !used.has(`${a.parentSectionId}::${a.title}`))
        .map((art) => (
          <MainArticleCard
            key={`extra-${art.parentSectionId}-${art.title}`}
            article={art}
            entity={entity}
            onArticleClick={onArticleClick}
          />
        ))}
    </div>
  );
}
