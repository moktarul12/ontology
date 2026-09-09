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
  /** Sex/gender from Wikidata P21 when known (family-tree orientation) */
  gender?: "male" | "female";
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
