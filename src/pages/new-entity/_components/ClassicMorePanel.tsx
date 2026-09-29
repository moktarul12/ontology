import { useMemo, useState, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  BookOpen,
  ChevronRight,
  ExternalLink,
  Image as ImageIcon,
  Languages,
  Link2,
  Sparkles,
} from "lucide-react";
import { OverviewCapsuleBlock } from "@/pages/entity/_components/SectionEnrichment.tsx";
import { WikiArticleWithMainEmbeds } from "@/pages/entity/_components/MainArticlePanels.tsx";
import { WikiTocNav } from "@/pages/entity/_components/WikiTocNav.tsx";
import { AiReadAloud } from "@/pages/entity/_components/AiReadAloud.tsx";
import {
  fetchEntityMainArticles,
  fetchEntityOtherLanguages,
} from "@/lib/wikidata/api.ts";
import {
  getSectionForProperty,
  sectionOrderForType,
  SECTION_TITLES,
  type SectionId,
} from "@/lib/wikidata/propertyGroups.ts";
import { entityPath } from "@/lib/entityPath.ts";
import type { EntityFact, EntitySummary } from "@/lib/wikidata/types.ts";
import { cn } from "@/lib/utils.ts";

type Props = {
  entity: EntitySummary;
  onOpenEntity: (id: string, label: string) => void;
};

type MorePane = "article" | "facts" | "media" | "languages" | "links";

const PANES: Array<{ id: MorePane; label: string; icon: typeof BookOpen }> = [
  { id: "article", label: "Article", icon: BookOpen },
  { id: "facts", label: "Structured facts", icon: Sparkles },
  { id: "media", label: "Gallery", icon: ImageIcon },
  { id: "languages", label: "Languages", icon: Languages },
  { id: "links", label: "Sources", icon: Link2 },
];

function groupFacts(entity: EntitySummary): Array<{ id: SectionId; title: string; facts: EntityFact[] }> {
  const buckets = new Map<SectionId, EntityFact[]>();
  for (const f of entity.facts) {
    const sid = getSectionForProperty(f.propertyId);
    if (!buckets.has(sid)) buckets.set(sid, []);
    buckets.get(sid)!.push(f);
  }
  const order = sectionOrderForType(entity.type);
  return order
    .filter((id) => (buckets.get(id)?.length ?? 0) > 0)
    .map((id) => ({
      id,
      title: SECTION_TITLES[id] ?? id,
      facts: buckets.get(id)!,
    }));
}

export default function ClassicMorePanel({ entity, onOpenEntity }: Props) {
  const [pane, setPane] = useState<MorePane>("article");
  const wiki = entity.wikipedia;
  const wikiTitle = wiki?.title;
  const wikiRev = wiki?.revisedAt ?? "norev";
  const mainHints = wiki?.mainArticleHints ?? [];

  const { data: mainArticles } = useQuery({
    queryKey: ["wiki-main-articles", entity.id, wikiTitle, wikiRev, "more-v1"],
    queryFn: () => fetchEntityMainArticles(mainHints),
    enabled: Boolean(wikiTitle && mainHints.length),
    staleTime: 1000 * 60 * 60,
  });

  const { data: otherLanguages, isFetching: langsFetching } = useQuery({
    queryKey: ["wiki-other-langs", entity.id, wikiTitle, wikiRev, "more-v1"],
    queryFn: () => fetchEntityOtherLanguages(wikiTitle!),
    enabled: Boolean(wikiTitle) && pane === "languages",
    staleTime: 1000 * 60 * 60,
  });

  const enrichedWiki = useMemo(() => {
    if (!wiki) return undefined;
    return {
      ...wiki,
      mainArticles: mainArticles ?? wiki.mainArticles,
      otherLanguages: otherLanguages ?? wiki.otherLanguages,
    };
  }, [wiki, mainArticles, otherLanguages]);

  const factGroups = useMemo(() => groupFacts(entity), [entity]);
  const classicHref = entityPath(entity.id, entity.label);

  const tocItems = useMemo(() => {
    if (enrichedWiki?.toc?.length) return enrichedWiki.toc;
    const fromSections = (enrichedWiki?.sections ?? [])
      .filter((s) => s.title?.trim())
      .map((s, i) => ({
        id: `more-sec-${i}-${s.title.toLowerCase().replace(/\W+/g, "-").slice(0, 40)}`,
        title: s.title,
        level: 2 as const,
      }));
    if (fromSections.length) return fromSections;
    // Fallback reading guide from fact groups so Contents is always present
    return factGroups.slice(0, 8).map((g) => ({
      id: `more-fact-${g.id}`,
      title: g.title,
      level: 2 as const,
    }));
  }, [enrichedWiki?.toc, enrichedWiki?.sections, factGroups]);

  const onArticleClick = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") || "";
    // Internal wiki links stay in classic page; external open new tab
    if (href.startsWith("/wiki/") || href.includes("wikipedia.org/wiki/")) {
      e.preventDefault();
      window.open(href.startsWith("http") ? href : `https://en.wikipedia.org${href}`, "_blank");
    }
  };

  const lead =
    enrichedWiki?.lead ||
    entity.wikipediaSummary ||
    entity.description ||
    "";

  return (
    <div className="dfw-classic">
      {/* Dossier header */}
      <header className="dfw-classic-hero">
        <div className="dfw-classic-hero-copy">
          <p className="dfw-classic-kicker">
            <BookOpen className="size-3.5" />
            Classic encyclopedia
          </p>
          <h2>Deep dive · {entity.label}</h2>
          <p>
            Full Wikipedia reading room + Wikidata claims — dark dossier with a sticky
            contents rail.
          </p>
        </div>
        <div className="dfw-classic-hero-actions">
          {lead && (
            <AiReadAloud
              entity={entity}
              text={lead.slice(0, 1800)}
            />
          )}
          <Link to={classicHref} className="dfw-classic-open">
            Open classic page
            <ExternalLink className="size-3.5" />
          </Link>
        </div>
      </header>

      {/* Pane switcher */}
      <nav className="dfw-classic-panes" aria-label="Classic sections">
        {PANES.map((p) => {
          const Icon = p.icon;
          const active = pane === p.id;
          return (
            <button
              key={p.id}
              type="button"
              className={cn("dfw-classic-pane", active && "is-active")}
              onClick={() => setPane(p.id)}
            >
              <Icon className="size-3.5" />
              {p.label}
            </button>
          );
        })}
      </nav>

      <div className="dfw-classic-stage">
        {pane === "article" && (
          <div className="dfw-classic-paper entity-body">
            <div className="dfw-classic-paper-grid">
              <aside className="dfw-classic-toc">
                {tocItems.length > 0 ? (
                  <WikiTocNav toc={tocItems} variant="dark" />
                ) : (
                  <div style={{ padding: "12px 8px" }}>
                    <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#64748b" }}>
                      Contents
                    </p>
                    <p style={{ margin: "8px 0 0", fontSize: 12, color: "#94a3b8", lineHeight: 1.45 }}>
                      Sections appear when the article loads.
                    </p>
                  </div>
                )}
              </aside>
              <div className="dfw-classic-article wiki-article">
                <OverviewCapsuleBlock entity={entity} />
                {enrichedWiki?.html ? (
                  <WikiArticleWithMainEmbeds
                    entity={entity}
                    html={enrichedWiki.html}
                    articles={enrichedWiki.mainArticles}
                    onArticleClick={onArticleClick}
                  />
                ) : enrichedWiki?.lead ? (
                  <div className="space-y-4">
                    {enrichedWiki.lead.split(/\n{2,}/).filter(Boolean).map((para, i) => (
                      <p key={i} className="text-[15px] leading-[1.75] text-slate-300">
                        {para.trim()}
                      </p>
                    ))}
                    {enrichedWiki.sections?.map((section, i) => (
                      <section
                        key={`${section.title}-${i}`}
                        id={`more-sec-${i}-${section.title.toLowerCase().replace(/\W+/g, "-").slice(0, 40)}`}
                        className="pt-2"
                      >
                        <h3 className="mb-2 font-serif text-lg font-semibold text-slate-100">
                          {section.title}
                        </h3>
                        {section.content
                          .split(/\n{2,}/)
                          .map((p) => p.trim())
                          .filter(Boolean)
                          .map((para, j) => (
                            <p key={j} className="mb-3 text-[14.5px] leading-[1.75] text-slate-300 whitespace-pre-wrap">
                              {para}
                            </p>
                          ))}
                      </section>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    No encyclopedia article found. Explore structured facts or the gallery instead.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {pane === "facts" && (
          <div className="dfw-classic-facts">
            {factGroups.length === 0 ? (
              <p style={{ color: "#94a3b8", fontSize: 13 }}>No structured claims grouped yet.</p>
            ) : (
              factGroups.map((g) => (
                <details key={g.id} className="dfw-classic-fact-group" open={g.id === "life" || g.id === "career" || g.id === "identity"}>
                  <summary>
                    <span>{g.title}</span>
                    <span className="dfw-classic-count">{g.facts.length}</span>
                    <ChevronRight className="size-4 dfw-classic-chevron" />
                  </summary>
                  <ul>
                    {g.facts.map((f) => (
                      <li key={f.propertyId}>
                        <span className="dfw-classic-prop">{f.property}</span>
                        <span className="dfw-classic-vals">
                          {f.values.slice(0, 8).map((v, i) => (
                            <span key={`${v.label}-${i}`}>
                              {i > 0 ? " · " : ""}
                              {v.id ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenEntity(v.id!, v.label)}
                                  className="dfw-classic-link"
                                >
                                  {v.label}
                                </button>
                              ) : (
                                v.label
                              )}
                            </span>
                          ))}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              ))
            )}
          </div>
        )}

        {pane === "media" && (
          <div className="dfw-classic-media">
            {entity.images.length === 0 ? (
              <p style={{ color: "#94a3b8", fontSize: 13 }}>No Commons images attached.</p>
            ) : (
              entity.images.map((img, i) => (
                <a
                  key={`${img.propertyId}-${img.filename}`}
                  href={img.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn("dfw-classic-media-item", i === 0 && "is-hero")}
                >
                  <img src={img.thumb || img.url} alt={img.property} loading="lazy" />
                  <span>{img.property}</span>
                </a>
              ))
            )}
          </div>
        )}

        {pane === "languages" && (
          <div className="dfw-classic-langs">
            {langsFetching && !(otherLanguages?.length || enrichedWiki?.otherLanguages?.length) ? (
              <p style={{ color: "#94a3b8", fontSize: 13 }}>Loading language extracts…</p>
            ) : !(otherLanguages ?? enrichedWiki?.otherLanguages)?.length ? (
              <p style={{ color: "#94a3b8", fontSize: 13 }}>No other-language extracts available.</p>
            ) : (
              (otherLanguages ?? enrichedWiki?.otherLanguages ?? []).map((lang) => (
                <article key={lang.lang} className="dfw-classic-lang-card">
                  <header>
                    <Languages className="size-4" />
                    <h3>{lang.langName}</h3>
                    <span>{lang.title}</span>
                  </header>
                  <p>{lang.extract}</p>
                </article>
              ))
            )}
          </div>
        )}

        {pane === "links" && (
          <div className="dfw-classic-links">
            {entity.links.length === 0 && !entity.wikidataUrl && !entity.wikipediaUrl ? (
              <p style={{ color: "#94a3b8", fontSize: 13 }}>No external links listed.</p>
            ) : (
              <>
                {entity.wikipediaUrl && (
                  <a href={entity.wikipediaUrl} target="_blank" rel="noopener noreferrer" className="dfw-classic-link-row">
                    <BookOpen className="size-4" />
                    <span>Wikipedia</span>
                    <ExternalLink className="size-3.5 ml-auto opacity-60" />
                  </a>
                )}
                <a href={entity.wikidataUrl} target="_blank" rel="noopener noreferrer" className="dfw-classic-link-row">
                  <Sparkles className="size-4" />
                  <span>Wikidata · {entity.id}</span>
                  <ExternalLink className="size-3.5 ml-auto opacity-60" />
                </a>
                {entity.links.map((l) => (
                  <a
                    key={l.url}
                    href={l.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="dfw-classic-link-row"
                  >
                    <Link2 className="size-4" />
                    <span>{l.label}</span>
                    <em>{l.kind}</em>
                    <ExternalLink className="size-3.5 ml-auto opacity-60" />
                  </a>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
