import { getSectionForProperty, SECTION_TITLES } from "@/lib/wikidata/propertyGroups.ts";
import type { EntitySummary, WikiMainArticle } from "@/lib/wikidata/types.ts";

export type EnrichSection = "overview" | "life" | "family" | "career" | "creative" | "wikiPage";
export type FactsEnrichSection = Exclude<EnrichSection, "overview" | "wikiPage">;

/** Labeled fact row for encyclopedia-style briefs */
export type BriefField = {
  label: string;
  value: string;
  entityId?: string;
};

/**
 * Unified brief: short prose + structured fields.
 * Used for Overview and every facts tab.
 */
export type SectionBrief = {
  section: EnrichSection;
  /** One-line eyebrow, e.g. "Life & Biography" */
  heading: string;
  /** Lead prose (several sentences) */
  summary: string;
  /** Optional deeper paragraphs from AI */
  paragraphs?: string[];
  /** Definition-list rows (Born, Spouse, …) */
  fields: BriefField[];
  fallback?: boolean;
  hint?: string;
};

/** @deprecated — use SectionBrief */
export type OverviewCapsule = SectionBrief & { section: "overview"; capsule?: string; arcs?: string[] };
/** @deprecated — use SectionBrief */
export type FactsBrief = SectionBrief;
/** @deprecated */
export type CreativeBrief = SectionBrief;

export type SectionEnrichment = SectionBrief;

const FACTS_SECTIONS = new Set<FactsEnrichSection>(["life", "family", "career", "creative"]);

const CREATIVE_PIDS = new Set([
  "CR_SONG", "CR_ALBUM", "CR_FILM", "P800", "P175", "P161", "P86", "P166", "P1441",
]);

const HEADINGS: Record<EnrichSection, string> = {
  overview: "Brief",
  life: "Life & Biography",
  family: "Family & Relationships",
  career: "Career & Affiliations",
  creative: "Creative Work",
  wikiPage: "Main article",
};

/** AI / local presentation for a Wikipedia "Main article" page. */
export type MainArticleBrief = {
  heading: string;
  pageTitle: string;
  summary: string;
  paragraphs?: string[];
  highlights?: string[];
  fallback?: boolean;
  hint?: string;
};

function yearFrom(text?: string | null): number | null {
  if (!text) return null;
  const m = text.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function fact(entity: EntitySummary, pid: string) {
  return entity.facts.find((x) => x.propertyId === pid);
}

function factLabel(entity: EntitySummary, pid: string): string | undefined {
  return fact(entity, pid)?.values[0]?.label;
}

function factValues(entity: EntitySummary, pid: string, limit = 8) {
  const f = fact(entity, pid);
  if (!f) return [];
  return f.values.slice(0, limit).map((v) => ({
    label: v.label,
    id: v.id?.startsWith("Q") ? v.id : undefined,
    year: yearFrom(v.qualifiers?.find((q) => ["P577", "P580", "P585"].includes(q.propertyId))?.label)
      ?? yearFrom(v.label),
  }));
}

function joinLabels(values: Array<{ label: string }>, limit = 4): string {
  const labels = values.map((v) => v.label).filter(Boolean);
  if (!labels.length) return "";
  const shown = labels.slice(0, limit);
  const extra = labels.length - shown.length;
  return extra > 0 ? `${shown.join(" · ")}${` · +${extra}`}` : shown.join(" · ");
}

function fieldFromPid(
  entity: EntitySummary,
  pid: string,
  label: string,
  limit = 4,
): BriefField | null {
  const values = factValues(entity, pid, limit);
  if (!values.length) return null;
  return {
    label,
    value: joinLabels(values, limit),
    entityId: values.length === 1 ? values[0]!.id : undefined,
  };
}

function pushField(fields: BriefField[], field: BriefField | null) {
  if (field?.value) fields.push(field);
}

function itemsForSection(entity: EntitySummary, section: FactsEnrichSection, limit = 10) {
  const items: Array<{ title: string; note: string; entityId?: string }> = [];
  for (const f of entity.facts) {
    const sid =
      CREATIVE_PIDS.has(f.propertyId) && section === "creative"
        ? "creative"
        : getSectionForProperty(f.propertyId);
    if (sid !== section) continue;
    for (const v of f.values.slice(0, 3)) {
      items.push({
        title: v.label,
        note: f.property,
        entityId: v.id?.startsWith("Q") ? v.id : undefined,
      });
      if (items.length >= limit) return items;
    }
  }
  if (section === "creative" && items.length < limit) {
    for (const f of entity.facts) {
      if (!CREATIVE_PIDS.has(f.propertyId)) continue;
      for (const v of f.values.slice(0, 3)) {
        if (items.some((i) => i.title === v.label)) continue;
        items.push({
          title: v.label,
          note: f.property,
          entityId: v.id?.startsWith("Q") ? v.id : undefined,
        });
        if (items.length >= limit) return items;
      }
    }
  }
  return items;
}

function buildOverviewFields(entity: EntitySummary): BriefField[] {
  const fields: BriefField[] = [];
  pushField(fields, fieldFromPid(entity, "P569", "Born", 1));
  pushField(fields, fieldFromPid(entity, "P19", "Birthplace", 1));
  pushField(fields, fieldFromPid(entity, "P570", "Died", 1));
  pushField(fields, fieldFromPid(entity, "P20", "Death place", 1));
  pushField(fields, fieldFromPid(entity, "P106", "Occupation", 4));
  pushField(fields, fieldFromPid(entity, "P27", "Citizenship", 2));
  return fields;
}

function buildLifeFields(entity: EntitySummary): BriefField[] {
  const fields: BriefField[] = [];
  pushField(fields, fieldFromPid(entity, "P569", "Born", 1));
  pushField(fields, fieldFromPid(entity, "P19", "Birthplace", 1));
  pushField(fields, fieldFromPid(entity, "P570", "Died", 1));
  pushField(fields, fieldFromPid(entity, "P20", "Death place", 1));
  pushField(fields, fieldFromPid(entity, "P1196", "Manner of death", 1));
  pushField(fields, fieldFromPid(entity, "P106", "Occupation", 5));
  pushField(fields, fieldFromPid(entity, "P69", "Educated at", 3));
  pushField(fields, fieldFromPid(entity, "P140", "Religion", 2));
  pushField(fields, fieldFromPid(entity, "P551", "Residence", 3));
  pushField(fields, fieldFromPid(entity, "P27", "Citizenship", 2));
  return fields;
}

function buildFamilyFields(entity: EntitySummary): BriefField[] {
  const fields: BriefField[] = [];
  pushField(fields, fieldFromPid(entity, "P22", "Father", 1));
  pushField(fields, fieldFromPid(entity, "P25", "Mother", 1));
  pushField(fields, fieldFromPid(entity, "P26", "Spouse", 4));
  pushField(fields, fieldFromPid(entity, "P40", "Children", 6));
  pushField(fields, fieldFromPid(entity, "P3373", "Siblings", 4));
  pushField(fields, fieldFromPid(entity, "P1038", "Relative", 4));
  pushField(fields, fieldFromPid(entity, "P451", "Partner", 2));
  return fields;
}

function buildCareerFields(entity: EntitySummary): BriefField[] {
  const fields: BriefField[] = [];
  pushField(fields, fieldFromPid(entity, "P106", "Occupation", 5));
  pushField(fields, fieldFromPid(entity, "P108", "Employer", 4));
  pushField(fields, fieldFromPid(entity, "P39", "Position held", 4));
  pushField(fields, fieldFromPid(entity, "P463", "Member of", 4));
  pushField(fields, fieldFromPid(entity, "P1416", "Affiliation", 3));
  pushField(fields, fieldFromPid(entity, "P136", "Genre", 4));
  pushField(fields, fieldFromPid(entity, "P264", "Record label", 3));
  pushField(fields, fieldFromPid(entity, "P937", "Work location", 3));
  return fields;
}

function buildCreativeFields(entity: EntitySummary): BriefField[] {
  const fields: BriefField[] = [];
  pushField(fields, fieldFromPid(entity, "P800", "Notable work", 5));
  pushField(fields, fieldFromPid(entity, "P136", "Genre", 4));
  pushField(fields, fieldFromPid(entity, "P412", "Voice type", 2));
  pushField(fields, fieldFromPid(entity, "P1303", "Instrument", 4));

  // Reverse / synthetic creative hubs — group by property
  const byProp = new Map<string, Array<{ label: string; id?: string }>>();
  for (const f of entity.facts) {
    if (!CREATIVE_PIDS.has(f.propertyId) || f.propertyId === "P800") continue;
    const bucket = byProp.get(f.property) ?? [];
    for (const v of f.values.slice(0, 4)) {
      bucket.push({ label: v.label, id: v.id?.startsWith("Q") ? v.id : undefined });
    }
    byProp.set(f.property, bucket);
  }
  for (const [prop, vals] of byProp) {
    if (!vals.length) continue;
    fields.push({
      label: prop,
      value: joinLabels(vals, 4),
      entityId: vals.length === 1 ? vals[0]!.id : undefined,
    });
    if (fields.length >= 8) break;
  }
  return fields;
}

function fieldsFor(section: EnrichSection, entity: EntitySummary): BriefField[] {
  switch (section) {
    case "overview":
      return buildOverviewFields(entity);
    case "life":
      return buildLifeFields(entity);
    case "family":
      return buildFamilyFields(entity);
    case "career":
      return buildCareerFields(entity);
    case "creative":
      return buildCreativeFields(entity);
    case "wikiPage":
      return [];
  }
}

function summaryFor(section: EnrichSection, entity: EntitySummary, fields: BriefField[]): string {
  const name = entity.label;
  const desc = entity.description?.replace(/\.$/, "") ?? "";
  const get = (label: string) => fields.find((f) => f.label === label)?.value;

  switch (section) {
    case "overview": {
      const parts: string[] = [];
      if (desc) parts.push(`${name} is ${desc}.`);
      else parts.push(`${name}.`);
      const born = get("Born");
      const place = get("Birthplace");
      const died = get("Died");
      const occ = get("Occupation");
      if (born || place) {
        parts.push(
          [born && `Born ${born}`, place && `in ${place}`].filter(Boolean).join(" ") + ".",
        );
      }
      if (occ) parts.push(`Known professionally as ${occ.replace(/ · /g, ", ")}.`);
      if (died) parts.push(`Died ${died}.`);
      const lead = entity.wikipedia?.lead?.trim();
      if (lead) {
        // First 2–3 sentences from Wikipedia for a richer local overview
        const sentences = lead.split(/(?<=\.)\s+/).filter((s) => s.length > 40).slice(0, 3);
        if (sentences.length) parts.push(...sentences);
      }
      return parts.join(" ").replace(/\s+/g, " ").trim();
    }
    case "life": {
      const parts: string[] = [];
      const born = get("Born");
      const place = get("Birthplace");
      const died = get("Died");
      const deathPlace = get("Death place");
      const occ = get("Occupation");
      const edu = get("Educated at");
      if (born || place) {
        parts.push(
          `${name} was born${born ? ` on ${born}` : ""}${place ? ` in ${place}` : ""}.`,
        );
      } else {
        parts.push(`Biographical facts for ${name} from Wikidata.`);
      }
      if (occ) parts.push(`Occupations include ${occ.replace(/ · /g, ", ")}.`);
      if (edu) parts.push(`Educated at ${edu.replace(/ · /g, ", ")}.`);
      if (died) {
        parts.push(
          `Died ${died}${deathPlace ? ` in ${deathPlace}` : ""}.`,
        );
      }
      return parts.join(" ");
    }
    case "family": {
      const father = get("Father");
      const mother = get("Mother");
      const spouse = get("Spouse");
      const children = get("Children");
      const siblings = get("Siblings");
      const parts: string[] = [];
      if (father || mother) {
        parts.push(
          `${name} was the child of ${[father, mother].filter(Boolean).join(" and ")}.`,
        );
      }
      if (spouse) parts.push(`Married to ${spouse.replace(/ · /g, "; ")}.`);
      if (children) parts.push(`Children include ${children.replace(/ · /g, ", ")}.`);
      if (siblings) parts.push(`Siblings include ${siblings.replace(/ · /g, ", ")}.`);
      if (!parts.length) {
        return `Family links for ${name} are limited on Wikidata.`;
      }
      return parts.join(" ");
    }
    case "career": {
      const occ = get("Occupation");
      const employer = get("Employer");
      const position = get("Position held");
      const member = get("Member of");
      const genre = get("Genre");
      const parts: string[] = [];
      if (occ) {
        parts.push(`${name} worked as ${occ.replace(/ · /g, ", ")}.`);
      } else {
        parts.push(`Career affiliations recorded for ${name}.`);
      }
      if (employer) parts.push(`Employers include ${employer.replace(/ · /g, ", ")}.`);
      if (position) parts.push(`Positions held: ${position.replace(/ · /g, ", ")}.`);
      if (member) parts.push(`Member of ${member.replace(/ · /g, ", ")}.`);
      if (genre) parts.push(`Associated genres: ${genre.replace(/ · /g, ", ")}.`);
      return parts.join(" ");
    }
    case "creative": {
      const works = get("Notable work");
      const genre = get("Genre");
      const extras = fields.filter((f) => !["Notable work", "Genre"].includes(f.label)).slice(0, 2);
      const parts: string[] = [];
      if (works) {
        parts.push(`${name}'s notable works include ${works.replace(/ · /g, ", ")}.`);
      } else if (extras.length) {
        parts.push(
          `${name}'s creative credits include ${extras.map((e) => e.value.split(" · ")[0]).join(", ")}.`,
        );
      } else {
        parts.push(`Creative credits for ${name} are sparse on Wikidata.`);
      }
      if (genre) parts.push(`Genres: ${genre.replace(/ · /g, ", ")}.`);
      return parts.join(" ");
    }
    case "wikiPage":
      return "";
  }
}

export function buildLocalSectionBrief(
  section: EnrichSection,
  entity: EntitySummary,
): SectionBrief {
  const fields = fieldsFor(section, entity);
  return {
    section,
    heading: HEADINGS[section],
    summary: summaryFor(section, entity, fields),
    fields,
    fallback: true,
  };
}

export function buildLocalOverviewCapsule(entity: EntitySummary): SectionBrief {
  return buildLocalSectionBrief("overview", entity);
}

export function buildLocalFactsBrief(
  section: FactsEnrichSection,
  entity: EntitySummary,
): SectionBrief {
  return buildLocalSectionBrief(section, entity);
}

export function buildLocalCreativeBrief(entity: EntitySummary): SectionBrief {
  return buildLocalSectionBrief("creative", entity);
}

export function isFactsEnrichSection(section: string): section is FactsEnrichSection {
  return FACTS_SECTIONS.has(section as FactsEnrichSection);
}

export function buildLocalEnrichment(
  section: EnrichSection,
  entity: EntitySummary,
): SectionBrief {
  return buildLocalSectionBrief(section, entity);
}

function compactDigest(entity: EntitySummary, section: EnrichSection) {
  const local = buildLocalSectionBrief(section, entity);
  return {
    section,
    sectionTitle: section === "overview" || section === "wikiPage"
      ? (section === "overview" ? "Overview" : "Main article")
      : SECTION_TITLES[section] ?? section,
    id: entity.id,
    label: entity.label,
    description: entity.description,
    type: entity.type,
    wikipediaLead: entity.wikipedia?.lead?.slice(0, 600),
    wikiRevisedAt: entity.wikipedia?.revisedAt,
    /** Structured fields the model must keep — polish summary only */
    fields: local.fields,
    local: {
      heading: local.heading,
      summary: local.summary,
      fields: local.fields,
    },
  };
}

function normalizeFields(raw: unknown, fallback: BriefField[]): BriefField[] {
  if (!Array.isArray(raw)) return fallback;
  const parsed = raw.slice(0, 10).map((row) => {
    const o = (row ?? {}) as Record<string, unknown>;
    return {
      label: String(o.label ?? "").trim(),
      value: String(o.value ?? "").trim(),
      entityId: typeof o.entityId === "string" ? o.entityId : undefined,
    };
  }).filter((f) => f.label && f.value);
  return parsed.length ? parsed : fallback;
}

function normalizeBrief(
  section: EnrichSection,
  raw: unknown,
  local: SectionBrief,
): SectionBrief {
  if (!raw || typeof raw !== "object") return local;
  const o = raw as Record<string, unknown>;
  // Accept legacy capsule/intro shapes from older prompts
  const summary =
    o.summary != null
      ? String(o.summary)
      : o.capsule != null
        ? String(o.capsule)
        : o.intro != null
          ? String(o.intro)
          : local.summary;
  const fields = normalizeFields(o.fields, local.fields);
  const paragraphs = Array.isArray(o.paragraphs)
    ? o.paragraphs.map(String).map((p) => p.trim()).filter(Boolean).slice(0, 4)
    : local.paragraphs;
  if (!summary.trim()) return local;
  return {
    section,
    heading: o.heading != null ? String(o.heading) : local.heading,
    summary: summary.trim(),
    paragraphs: paragraphs?.length ? paragraphs : undefined,
    fields,
    fallback: false,
  };
}

/**
 * Local-first section brief; AI polishes the summary while keeping field rows.
 */
export async function fetchSectionEnrichment(
  section: EnrichSection,
  entity: EntitySummary,
): Promise<SectionBrief> {
  const local = buildLocalSectionBrief(section, entity);

  try {
    const res = await fetch("/api/ai/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(compactDigest(entity, section)),
    });

    if (!res.ok) {
      return {
        ...local,
        fallback: true,
        hint: res.status === 503
          ? "Local brief — add GROQ_API_KEY for AI polish."
          : "Local brief (AI polish unavailable).",
      };
    }

    const data: unknown = await res.json();
    return normalizeBrief(section, data, local);
  } catch {
    return {
      ...local,
      fallback: true,
      hint: "Local brief (AI offline).",
    };
  }
}

function buildLocalMainArticleBrief(
  entity: EntitySummary,
  article: WikiMainArticle,
): MainArticleBrief {
  const highlights = article.sections.slice(0, 10).map((s) => s.title);
  const paragraphs = article.sections.slice(0, 4).map((s) => {
    const body = s.content.split(/\n{2,}/).map((p) => p.trim()).find((p) => p.length > 40) ?? "";
    return body
      ? `${s.title}. ${body.slice(0, 360)}${body.length > 360 ? "…" : ""}`
      : s.title;
  });
  return {
    heading: article.parentSection,
    pageTitle: article.title,
    summary:
      article.lead.slice(0, 700) ||
      `${article.title} expands the ${article.parentSection} section for ${entity.label}.`,
    paragraphs,
    highlights,
    fallback: true,
  };
}

function normalizeMainArticleBrief(raw: unknown, local: MainArticleBrief): MainArticleBrief {
  if (!raw || typeof raw !== "object") return local;
  const o = raw as Record<string, unknown>;
  const summary = o.summary != null ? String(o.summary).trim() : local.summary;
  const paragraphs = Array.isArray(o.paragraphs)
    ? o.paragraphs.map(String).map((p) => p.trim()).filter(Boolean).slice(0, 5)
    : local.paragraphs;
  const highlights = Array.isArray(o.highlights)
    ? o.highlights.map(String).map((h) => h.trim()).filter(Boolean).slice(0, 12)
    : local.highlights;
  if (!summary) return local;
  return {
    heading: o.heading != null ? String(o.heading) : local.heading,
    pageTitle: o.pageTitle != null ? String(o.pageTitle) : local.pageTitle,
    summary,
    paragraphs: paragraphs?.length ? paragraphs : undefined,
    highlights: highlights?.length ? highlights : undefined,
    fallback: false,
  };
}

/** AI-polished presentation of a Wikipedia main-article page (Discography, etc.). */
export async function fetchMainArticleEnrichment(
  entity: EntitySummary,
  article: WikiMainArticle,
): Promise<MainArticleBrief> {
  const local = buildLocalMainArticleBrief(entity, article);
  const digest = {
    section: "wikiPage",
    sectionTitle: article.parentSection,
    id: entity.id,
    label: entity.label,
    description: entity.description,
    type: entity.type,
    pageTitle: article.title,
    parentSection: article.parentSection,
    wikipediaLead: article.lead.slice(0, 900),
    wikiRevisedAt: article.revisedAt ?? entity.wikipedia?.revisedAt,
    sectionDigest: article.sections.slice(0, 10).map((s) => ({
      title: s.title,
      excerpt: s.content.slice(0, 400),
    })),
    local: {
      heading: local.heading,
      pageTitle: local.pageTitle,
      summary: local.summary,
      paragraphs: local.paragraphs,
      highlights: local.highlights,
    },
  };

  try {
    const res = await fetch("/api/ai/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(digest),
    });
    if (!res.ok) {
      return {
        ...local,
        hint: res.status === 503
          ? "Local digest — add an AI key for polish."
          : "Local digest (AI polish unavailable).",
      };
    }
    const data: unknown = await res.json();
    return normalizeMainArticleBrief(data, local);
  } catch {
    return { ...local, hint: "Local digest (AI offline)." };
  }
}
