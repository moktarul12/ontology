// Core Wikidata entity types used throughout the app

export type EntityType =
  | "person"
  | "place"
  | "organization"
  | "concept"
  | "event"
  | "work"
  | "unknown";

export type SearchResult = {
  id: string;
  label: string;
  description?: string;
  thumbnail?: string;
  type: EntityType;
};

export type FactValue = {
  label: string;
  id?: string;
  url?: string;
  qualifiers?: Array<{ property: string; propertyId: string; label: string; id?: string }>;
};

export type EntityFact = {
  property: string;
  propertyId: string;
  values: FactValue[];
  datatype?: string;
};

export type EntityImage = {
  propertyId: string;
  property: string;
  url: string;
  thumb: string;
  filename: string;
};

export type EntityLink = {
  label: string;
  url: string;
  kind: "website" | "wikipedia" | "wikidata" | "social" | "identifier" | "other";
};

export type TimelineItem = {
  date: string;
  sortKey: string;
  label: string;
  value?: string;
  entityId?: string;
};

export type TimelineKind = "life" | "career" | "award" | "work" | "tour" | "legacy";

export type TimelineEvent = {
  year: string;
  sortKey: string;
  title: string;
  summary: string;
  kind: TimelineKind;
  eraId: string;
  highlights?: string[];
  entityId?: string;
  /** Longer creative prose for the moment drawer */
  detail?: string;
  whyItMatters?: string;
};

export type TimelineEra = {
  id: string;
  title: string;
  years: string;
  summary: string;
};

export type NarrativeTimeline = {
  tagline?: string;
  legacy?: string;
  eras: TimelineEra[];
  events: TimelineEvent[];
  signatureWorks?: Array<{ year: string; title: string; context?: string }>;
  /** True when built locally without OpenAI */
  fallback?: boolean;
  hint?: string;
};

export type RelatedEntity = {
  id: string;
  label: string;
  relation: string;
  propertyId: string;
  description?: string;
};

export type WikiSection = {
  title: string;
  level: number; // 2 = ==, 3 = ===
  content: string;
};

/** Wikipedia-style table of contents entry (scroll target in overview). */
export type WikiTocItem = {
  id: string;
  title: string;
  level: 2 | 3 | 4;
  children?: WikiTocItem[];
  /** Linked "Main article: …" page title, if present under this section */
  mainArticleTitle?: string;
};

/** Content pulled from a Wikipedia "Main article" page (Discography, Filmography, …). */
export type WikiMainArticle = {
  title: string;
  url: string;
  /** Parent section on the biography page (e.g. "Discography") */
  parentSection: string;
  parentSectionId: string;
  lead: string;
  /** Condensed section digests for AI / display */
  sections: WikiSection[];
  /** Full sanitized article HTML (complete list / awards page body) */
  html?: string;
  revisedAt?: string;
};

export type WikiInfoboxRow = {
  /** Section banner (e.g. "Musical career") when kind === "section" */
  kind?: "row" | "section";
  label: string;
  /** Plain text for display */
  value: string;
  /** Optional HTML (links preserved) for richer rendering */
  valueHtml?: string;
};

export type WikipediaArticle = {
  title: string;
  url: string;
  lead: string;
  sections: WikiSection[];
  /** Full sanitized article HTML for in-app reading (complete page body) */
  html?: string;
  thumbnail?: string;
  gallery?: Array<{ filename: string; url: string; thumb: string }>;
  /** Extra language coverage beyond English */
  otherLanguages?: Array<{ lang: string; langName: string; title: string; extract: string }>;
  /** Wikipedia page last revision (ISO) — used for AI / overview cache busting */
  revisedAt?: string;
  /** Parsed right-rail infobox rows (Born, Died, Occupations, …) */
  infobox?: WikiInfoboxRow[];
  /** Hierarchical TOC for left Contents / scroll navigation */
  toc?: WikiTocItem[];
  /** Fetched "Main article" pages (Discography, Filmography, Awards, …) */
  mainArticles?: WikiMainArticle[];
};

export type EntitySummary = {
  id: string;
  label: string;
  description?: string;
  thumbnail?: string;
  type: EntityType;
  instanceOf: Array<{ id: string; label: string }>;
  wikipediaUrl?: string;
  wikidataUrl: string;
  facts: EntityFact[];
  aliases: string[];
  /** @deprecated prefer wikipedia.lead */
  wikipediaSummary?: string;
  wikipedia?: WikipediaArticle;
  officialUrl?: string;
  images: EntityImage[];
  links: EntityLink[];
  timeline: TimelineItem[];
  related: RelatedEntity[];
  lifespan?: string;
  coordinates?: { lat: number; lon: number; display: string };
};

export type GraphNode = {
  id: string;
  label: string;
  type: EntityType;
  thumbnail?: string;
  description?: string;
  /** External page when the node is not a Wikidata Q-id (e.g. MusicBrainz). */
  externalUrl?: string;
  /** Sex/gender from Wikidata P21 when known (family-tree orientation) */
  gender?: "male" | "female";
  /** Knowledge-graph / family-tree presentation hubs */
  kind?: "entity" | "hub" | "person";
  hubOf?: string;
  hubPropertyId?: string;
  hubRelation?: string;
  /** "+N more" control under a relation hub */
  hubMore?: boolean;
  hubTotal?: number;
  hubShown?: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  vx?: number;
  vy?: number;
};

export type GraphEdge = {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  label: string;
  propertyId: string;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};
