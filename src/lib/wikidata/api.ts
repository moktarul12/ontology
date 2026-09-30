/**
 * Wikidata adapter layer.
 * Fetches complete entity dossiers — every populated claim, grouped client-side.
 */

import type {
  SearchResult,
  EntitySummary,
  GraphData,
  EntityType,
  EntityFact,
  EntityImage,
  EntityLink,
  TimelineItem,
  RelatedEntity,
  FactValue,
  WikipediaArticle,
  WikiSection,
  WikiTocItem,
  WikiMainArticle,
} from "./types.ts";
import { IMAGE_PROPERTY_IDS, LINK_PROPERTY_IDS, IDENTIFIER_PROPERTY_IDS } from "./propertyGroups.ts";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php";
const WIKIPEDIA_REST = "https://en.wikipedia.org/api/rest_v1";
const MAX_VALUES_PER_PROP = 80;

// ─── Entity type detection ───────────────────────────────────────────────────

const TYPE_QID_MAP: Record<string, EntityType> = {
  Q5: "person",
  Q215627: "person",
  Q15632617: "person",
  Q95074: "person",
  Q1093829: "person",
  Q82955: "person",
  Q618123: "place",
  Q6256: "place",
  Q515: "place",
  Q3957: "place",
  Q7930989: "place",
  Q532: "place",
  Q486972: "place",
  Q5119: "place",
  Q3624078: "place",
  Q82794: "place",
  Q35657: "place",
  Q15284: "place",
  Q23442: "place",
  Q8502: "place",
  Q4022: "place",
  Q5107: "place",
  Q2221906: "place",
  Q484170: "place", // commune of France
  Q1549591: "place", // big city
  Q1637706: "place", // city with millions of inhabitants
  Q174844: "place", // megacity
  Q208511: "place",
  Q515721: "place",
  Q43229: "organization",
  Q4830453: "organization",
  Q3918: "organization",
  Q7278: "organization",
  Q178790: "organization",
  Q327333: "organization",
  Q783794: "organization",
  Q2659904: "organization",
  Q6881511: "organization",
  Q161726: "organization",
  Q31855: "organization",
  Q22687: "organization",
  Q178706: "organization",
  Q245065: "organization",
  Q17127659: "organization",
  Q891723: "organization", // public company
  Q167037: "organization", // corporation
  Q155271: "organization", // retail company
  Q1656682: "event",
  Q1190554: "event",
  Q198: "event",
  Q2001982: "event",
  Q18608583: "event",
  Q40231: "event",
  Q132241: "event",
  Q386724: "work",
  Q7725634: "work",
  Q11424: "work",
  Q482994: "work",
  Q838948: "work",
  Q47461344: "work",
  Q571: "work",
  Q7889: "work",
  Q7397: "work",
  Q3305213: "work",
  Q25379: "work",
  Q2188189: "work",
  Q151885: "concept",
  Q2996394: "concept",
  Q7187: "concept",
  Q11173: "concept",
  Q12136: "concept",
  Q35120: "concept",
  Q3695082: "concept",
  Q39546: "concept",
};

function detectTypeFromInstanceOf(instanceOfIds: string[]): EntityType {
  for (const qid of instanceOfIds) {
    if (TYPE_QID_MAP[qid]) return TYPE_QID_MAP[qid];
  }
  return "unknown";
}

/** Wikidata “name” items (not people) — demote in search. */
const NAME_ENTITY_QIDS = new Set([
  "Q12308941", // male given name
  "Q11879590", // female given name
  "Q202444", // given name
  "Q3409032", // unisex given name
  "Q3409027", // double given name
  "Q1243157", // hypocorism
  "Q101352", // family name
  "Q82799", // name
]);

function isAnthroponymEntity(p31: string[], description?: string): boolean {
  if (p31.some((id) => NAME_ENTITY_QIDS.has(id))) return true;
  return /\b(male |female |unisex )?(given|first) name\b|\bfamily name\b|\bsurname\b|\blast name\b/i.test(
    description ?? "",
  );
}

/** Lower = higher in search. Prefer people / companies / films; names last. */
function searchResultRank(
  query: string,
  label: string,
  type: EntityType,
  description: string | undefined,
  p31: string[],
): number {
  if (isAnthroponymEntity(p31, description)) return 100;

  const q = query.trim().toLowerCase();
  const l = label.trim().toLowerCase();
  let score =
    type === "person" ? 0
    : type === "organization" ? 2
    : type === "work" ? 3
    : type === "place" ? 12
    : type === "event" ? 14
    : type === "concept" ? 16
    : 20;

  if (l === q) score -= 6;
  else if (l.startsWith(q)) score -= 3;
  else if (l.includes(q)) score -= 1;

  // Description cues for companies / movies when P31 is thin
  const d = (description ?? "").toLowerCase();
  if (/\b(company|corporation|studio|enterprise|business|band|organization)\b/.test(d)) {
    score = Math.min(score, 2);
  }
  if (/\b(film|movie|television series|tv series|album|novel|book)\b/.test(d)) {
    score = Math.min(score, 3);
  }

  return score;
}

// Fallback edge labels for graph view
const GRAPH_PROP_LABELS: Record<string, string> = {
  P18: "Image", P19: "Place of birth", P20: "Place of death", P21: "Sex or gender",
  P22: "Father", P25: "Mother", P26: "Spouse", P27: "Country of citizenship",
  P31: "Instance of", P36: "Capital", P37: "Official language", P39: "Position held",
  P40: "Child", P50: "Author", P57: "Director", P58: "Screenwriter",
  P69: "Educated at", P86: "Composer", P103: "Native language",
  P106: "Occupation", P108: "Employer", P112: "Founded by", P119: "Place of burial",
  P123: "Publisher", P127: "Owned by", P131: "Located in", P136: "Genre",
  P140: "Religion", P150: "Contains", P155: "Follows", P156: "Followed by",
  P159: "Headquarters", P161: "Cast member", P166: "Award received",
  P169: "CEO", P172: "Ethnic group", P17: "Country", P190: "Sister city",
  P170: "Creator", P175: "Performer", P162: "Producer",
  P241: "Military branch", P276: "Location", P279: "Subclass of",
  P30: "Continent", P355: "Subsidiary", P364: "Original language",
  P414: "Stock exchange", P452: "Industry", P463: "Member of",
  P495: "Country of origin", P509: "Cause of death", P527: "Has part",
  P551: "Residence", P571: "Inception", P576: "Dissolved", P577: "Publication date",
  P580: "Start time", P582: "End time", P585: "Point in time",
  P598: "Commander of", P607: "Conflict", P610: "Highest point",
  P625: "Coordinates", P710: "Participant", P740: "Location of formation",
  P749: "Parent organization", P800: "Notable work", P840: "Narrative location",
  P856: "Official website", P937: "Work location", P1038: "Relative",
  P1082: "Population", P1196: "Manner of death", P1344: "Participant in",
  P1412: "Languages spoken", P1454: "Legal form", P361: "Part of",
  P569: "Date of birth", P570: "Date of death", P3373: "Sibling",
};

// ─── Search ─────────────────────────────────────────────────────────────────

export async function searchEntities(
  query: string,
  limit = 10,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  // Pull a wider Wikidata page so we can demote name-items and still fill the list
  const fetchLimit = Math.min(50, Math.max(limit * 3, 20));

  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: query,
    language: "en",
    limit: String(fetchLimit),
    format: "json",
    origin: "*",
    type: "item",
  });

  const res = await fetch(`${WIKIDATA_API}?${params}`, { signal });
  if (!res.ok) throw new Error(`Wikidata search failed: ${res.status}`);
  const data = await res.json() as {
    search: Array<{ id: string; label: string; description?: string }>;
  };

  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const ids = data.search.map((r) => r.id);
  const [meta, thumbs] = await Promise.all([
    ids.length > 0 ? fetchSearchMeta(ids, signal) : Promise.resolve({} as Record<string, SearchEntityMeta>),
    ids.length > 0 ? fetchThumbnails(ids, signal) : Promise.resolve({} as Record<string, string>),
  ]);

  const mapped = data.search.map((r, index) => {
    const m = meta[r.id];
    const type = m?.type ?? guessTypeFromDescription(r.description);
    return {
      id: r.id,
      label: r.label,
      description: r.description,
      thumbnail: thumbs[r.id],
      type,
      _rank: searchResultRank(query, r.label, type, r.description, m?.p31 ?? []),
      _wikidataOrder: index,
    };
  });

  mapped.sort(
    (a, b) =>
      a._rank - b._rank ||
      a._wikidataOrder - b._wikidataOrder ||
      a.label.localeCompare(b.label),
  );

  return mapped.slice(0, limit).map(({ _rank: _r, _wikidataOrder: _o, ...r }) => r);
}

function guessTypeFromDescription(desc = ""): EntityType {
  const d = desc.toLowerCase();
  if (/\b(male |female |unisex )?(given|first) name\b|\bfamily name\b|\bsurname\b/.test(d)) {
    return "unknown";
  }
  if (/politician|actor|scientist|writer|musician|athlete|king|queen|person|human/.test(d)) return "person";
  if (/city|country|town|capital|village|island|river|mountain|commune|municipality|settlement/.test(d)) return "place";
  if (/company|organization|university|corporation|business|party|agency|studio|band/.test(d)) return "organization";
  if (/war|battle|election|festival|revolution/.test(d)) return "event";
  if (/film|movie|novel|album|book|painting|song|software|game|television series/.test(d)) return "work";
  if (/concept|theory|disease|chemical|philosophy/.test(d)) return "concept";
  return "unknown";
}

async function fetchThumbnails(
  ids: string[],
  signal?: AbortSignal,
  width = 120,
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((id) => /^Q\d+$/.test(id)))];
  if (!unique.length) return {};
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < unique.length; i += 50) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const chunk = unique.slice(i, i + 50);
      const params = new URLSearchParams({
        action: "wbgetentities",
        ids: chunk.join("|"),
        props: "claims",
        format: "json",
        origin: "*",
      });
      const res = await fetch(`${WIKIDATA_API}?${params}`, { signal });
      if (!res.ok) continue;
      const data = await res.json() as { entities: Record<string, WikidataEntity> };
      for (const [id, ent] of Object.entries(data.entities)) {
        const claims = ent.claims?.["P18"] as ClaimSnakValue[] | undefined;
        const filename = claims?.[0]?.mainsnak?.datavalue?.value;
        if (typeof filename === "string") out[id] = getCommonsThumbUrl(filename, width);
      }
    }
    return out;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return out;
  }
}

/** Public batch portrait/poster URLs — Commons P18 first, then Wikipedia. */
export async function fetchEntityThumbnails(
  ids: string[],
  opts?: { width?: number; signal?: AbortSignal },
): Promise<Record<string, string>> {
  const out = await fetchThumbnails(ids, opts?.signal, opts?.width ?? 160);
  const missing = ids.filter((id) => /^Q\d+$/.test(id) && !out[id]);
  if (missing.length) {
    const wiki = await fetchWikipediaThumbsForEntities(missing);
    for (const [id, url] of Object.entries(wiki)) {
      if (!out[id]) out[id] = url;
    }
  }
  return out;
}

type SearchEntityMeta = { type: EntityType; p31: string[] };

async function fetchSearchMeta(
  ids: string[],
  signal?: AbortSignal,
): Promise<Record<string, SearchEntityMeta>> {
  const result: Record<string, SearchEntityMeta> = {};
  for (let i = 0; i < ids.length; i += 50) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const chunk = ids.slice(i, i + 50);
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: chunk.join("|"),
      props: "claims",
      format: "json",
      origin: "*",
    });
    const res = await fetch(`${WIKIDATA_API}?${params}`, { signal });
    if (!res.ok) continue;
    const data = await res.json() as { entities: Record<string, { claims?: Record<string, unknown[]> }> };
    for (const [id, entity] of Object.entries(data.entities)) {
      const p31Claims = entity.claims?.["P31"] as Array<{
        mainsnak?: { datavalue?: { value?: { id?: string } } };
      }> | undefined;
      const p31 = (p31Claims ?? [])
        .map((c) => c.mainsnak?.datavalue?.value?.id)
        .filter((x): x is string => Boolean(x));
      result[id] = {
        type: detectTypeFromInstanceOf(p31),
        p31,
      };
    }
  }
  return result;
}

async function fetchEntityTypes(
  ids: string[],
  signal?: AbortSignal,
): Promise<Record<string, EntityType>> {
  const meta = await fetchSearchMeta(ids, signal);
  const result: Record<string, EntityType> = {};
  for (const [id, m] of Object.entries(meta)) result[id] = m.type;
  return result;
}

// ─── Full entity summary (360°) ──────────────────────────────────────────────

export type FetchEntityOptions = {
  /** Full related Wikipedia pages (Discography, …). Default false — load on Overview. */
  includeMainArticles?: boolean;
  /** Other-language extracts. Default false — load when Languages tab opens. */
  includeOtherLanguages?: boolean;
};

export async function fetchEntitySummary(
  id: string,
  opts: FetchEntityOptions = {},
): Promise<EntitySummary> {
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: id,
    languages: "en",
    languagefallback: "1",
    format: "json",
    origin: "*",
    props: "labels|descriptions|claims|sitelinks|aliases",
  });

  const res = await fetch(`${WIKIDATA_API}?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch entity ${id}`);
  const data = await res.json() as { entities: Record<string, WikidataEntity> };
  const entity = data.entities[id];
  if (!entity) throw new Error(`Entity ${id} not found`);

  const label = pickLabel(entity.labels) ?? id;
  const description = pickLabel(entity.descriptions) ?? undefined;
  const aliases = (entity.aliases?.en ?? []).map((a) => a.value);
  const sitelink = entity.sitelinks?.enwiki;
  const wikipediaUrl = sitelink
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(sitelink.title)}`
    : undefined;

  const claims = entity.claims ?? {};
  const propertyIds = Object.keys(claims);

  // Collect every entity / unit QID referenced in claims + qualifiers
  const qidsToResolve = new Set<string>();
  collectReferencedIds(claims, qidsToResolve);

  const [propertyLabels, qidMeta, wikipedia] = await Promise.all([
    resolvePropertyLabels(propertyIds),
    resolveEntityMeta([...qidsToResolve]),
    sitelink
      ? fetchWikipediaArticle(sitelink.title, {
          includeMainArticles: opts.includeMainArticles === true,
          includeOtherLanguages: opts.includeOtherLanguages === true,
        })
      : Promise.resolve(undefined),
  ]);

  // Instance of
  const instanceOf: Array<{ id: string; label: string }> = [];
  for (const claim of (claims["P31"] as ClaimSnakValue[] | undefined) ?? []) {
    const val = claim.mainsnak?.datavalue?.value;
    if (typeof val === "object" && val && "id" in val && typeof val.id === "string") {
      instanceOf.push({ id: val.id, label: qidMeta[val.id]?.label ?? val.id });
    }
  }
  const mappedType = detectTypeFromInstanceOf(instanceOf.map((i) => i.id));
  const type =
    mappedType !== "unknown"
      ? mappedType
      : guessTypeFromDescription(
          `${instanceOf.map((i) => i.label).join(" ")} ${description ?? ""}`,
        );

  // Images from Wikidata (P18 portrait preferred; P109 signatures often SVG)
  const images: EntityImage[] = [];
  for (const pid of IMAGE_PROPERTY_IDS) {
    for (const claim of (claims[pid] as ClaimSnakValue[] | undefined) ?? []) {
      const filename = claim.mainsnak?.datavalue?.value;
      if (typeof filename !== "string") continue;
      const allowSvg = pid === "P109" || pid === "P154" || pid === "P94" || pid === "P41";
      if (!isUsableMediaFilename(filename, { allowSvg })) continue;
      images.push({
        propertyId: pid,
        property: propertyLabels[pid] ?? GRAPH_PROP_LABELS[pid] ?? pid,
        url: getCommonsThumbUrl(filename, 1200),
        thumb: getCommonsThumbUrl(filename, 320),
        filename,
      });
    }
  }

  // Prefer Wikidata P18 (and other image props) for the hero — never let a
  // Wikipedia decorative/SVG gallery file overwrite the portrait.
  const p18 = images.find((i) => i.propertyId === "P18");
  const nonSignatureRaster = images.find(
    (i) =>
      i.propertyId !== "P109" &&
      !/signatur|autograph/i.test(i.filename) &&
      /\.(jpe?g|png|webp)$/i.test(i.filename),
  );
  let thumbnail: string | undefined =
    p18?.url ||
    nonSignatureRaster?.url ||
    images.find((i) => i.propertyId === "P154")?.url ||
    wikipedia?.thumbnail ||
    undefined;

  if (!thumbnail && sitelink) {
    thumbnail = await fetchWikipediaThumbnail(sitelink.title);
  }

  // Merge Wikipedia / Commons gallery into media (more than Wikidata P18 alone)
  if (wikipedia?.gallery?.length) {
    const seen = new Set(images.map((i) => i.filename.toLowerCase()));
    for (const g of wikipedia.gallery) {
      const key = g.filename.toLowerCase();
      if (seen.has(key)) continue;
      if (!isUsableMediaFilename(g.filename)) continue;
      seen.add(key);
      images.push({
        propertyId: "wiki-gallery",
        property: "From Wikipedia",
        url: g.url,
        thumb: g.thumb,
        filename: g.filename,
      });
    }
  }

  // If still no portrait, use first usable gallery photo
  if (!thumbnail) {
    const firstPhoto = images.find((i) => /\.(jpe?g|png|webp)$/i.test(i.filename));
    thumbnail = firstPhoto?.url;
  }

  // Build ALL facts
  const facts: EntityFact[] = [];
  const related: RelatedEntity[] = [];
  const relatedSeen = new Set<string>();
  let coordinates: EntitySummary["coordinates"];

  for (const pid of propertyIds) {
    const claimList = claims[pid] as ClaimSnakValue[] | undefined;
    if (!claimList?.length) continue;

    const values: FactValue[] = [];
    for (const claim of claimList.slice(0, MAX_VALUES_PER_PROP)) {
      const parsed = parseSnak(claim.mainsnak, qidMeta, propertyLabels);
      if (!parsed) continue;

      const qualifiers: FactValue["qualifiers"] = [];
      for (const [qPid, qList] of Object.entries(claim.qualifiers ?? {})) {
        for (const q of qList as ClaimSnakValue[]) {
          const qParsed = parseSnak(q, qidMeta, propertyLabels);
          if (qParsed) {
            qualifiers.push({
              property: propertyLabels[qPid] ?? GRAPH_PROP_LABELS[qPid] ?? qPid,
              propertyId: qPid,
              label: qParsed.label,
              id: qParsed.id,
            });
          }
        }
      }
      if (qualifiers.length) parsed.qualifiers = qualifiers;
      const year = yearFromClaimQualifiers(claim, qualifiers);
      if (year != null) parsed.year = year;
      values.push(parsed);

      if (parsed.id && !relatedSeen.has(parsed.id) && related.length < 48) {
        relatedSeen.add(parsed.id);
        related.push({
          id: parsed.id,
          label: parsed.label,
          relation: propertyLabels[pid] ?? GRAPH_PROP_LABELS[pid] ?? pid,
          propertyId: pid,
          description: qidMeta[parsed.id]?.description,
        });
      }

      if (pid === "P625" && !coordinates) {
        const raw = claim.mainsnak?.datavalue?.value;
        if (typeof raw === "object" && raw && "latitude" in raw && "longitude" in raw) {
          const coord = raw as { latitude: number; longitude: number };
          const lat = Number(coord.latitude);
          const lon = Number(coord.longitude);
          coordinates = {
            lat,
            lon,
            display: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
          };
        }
      }
    }

    if (values.length === 0) continue;
    facts.push({
      property: propertyLabels[pid] ?? GRAPH_PROP_LABELS[pid] ?? pid,
      propertyId: pid,
      values,
      datatype: claimList[0]?.mainsnak?.datatype,
    });
  }

  // Reverse filmography / discography is expensive (many SPARQL calls) and not
  // needed for Overview. Load via fetchCreativeRolesForPerson() when the user
  // opens Creative / related works tabs.

  // Sort facts: known labels first, then by property name
  facts.sort((a, b) => a.property.localeCompare(b.property));

  const links = buildLinks(id, undefined, facts, claims);
  const officialUrl = links.find((l) => l.kind === "website")?.url;
  const timeline = buildTimeline(facts);
  const lifespan = formatLifespan(facts);

  return {
    id,
    label,
    description,
    thumbnail,
    type,
    instanceOf,
    wikidataUrl: `https://www.wikidata.org/wiki/${id}`,
    wikipediaUrl,
    facts,
    aliases,
    wikipediaSummary: wikipedia?.lead,
    wikipedia,
    officialUrl,
    images,
    links,
    timeline,
    related,
    lifespan,
    coordinates,
  };
}

/** Props shown in graph/family node cards — keep this list short. */
const LITE_FACT_PROPS = [
  "P31", "P106", "P569", "P570", "P19", "P20", "P27", "P39", "P166", "P69", "P108",
];

/**
 * Fast entity card for graph / family chrome + node modal.
 * Skips full Wikipedia HTML parse and resolving every claim QID.
 */
export async function fetchEntityLite(id: string): Promise<EntitySummary> {
  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: id,
    languages: "en",
    languagefallback: "1",
    format: "json",
    origin: "*",
    props: "labels|descriptions|claims|sitelinks",
  });

  const res = await fetch(`${WIKIDATA_API}?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch entity ${id}`);
  const data = await res.json() as { entities: Record<string, WikidataEntity> };
  const entity = data.entities[id];
  if (!entity) throw new Error(`Entity ${id} not found`);

  const label = pickLabel(entity.labels) ?? id;
  const description = pickLabel(entity.descriptions) ?? undefined;
  const claims = entity.claims ?? {};
  const sitelink = entity.sitelinks?.enwiki;
  const wikipediaUrl = sitelink
    ? `https://en.wikipedia.org/wiki/${encodeURIComponent(sitelink.title)}`
    : undefined;

  const p31 = (claims["P31"] as ClaimSnakValue[] | undefined) ?? [];
  const instanceOfIds = p31
    .map((c) => {
      const val = c.mainsnak?.datavalue?.value;
      return typeof val === "object" && val && "id" in val ? (val as { id: string }).id : undefined;
    })
    .filter((x): x is string => Boolean(x));

  const qidsToResolve = new Set<string>(instanceOfIds);
  for (const pid of LITE_FACT_PROPS) {
    const list = claims[pid] as ClaimSnakValue[] | undefined;
    if (!list) continue;
    for (const claim of list.slice(0, 6)) addIdFromSnak(claim.mainsnak, qidsToResolve);
  }

  const [qidMeta, propertyLabels, wikiLead] = await Promise.all([
    resolveEntityMeta([...qidsToResolve]),
    resolvePropertyLabels(LITE_FACT_PROPS.filter((p) => claims[p])),
    sitelink ? fetchWikipediaFullSummary(sitelink.title) : Promise.resolve(undefined),
  ]);

  const mappedType = detectTypeFromInstanceOf(instanceOfIds);
  const type =
    mappedType !== "unknown"
      ? mappedType
      : guessTypeFromDescription(`${description ?? ""}`);

  const instanceOf = instanceOfIds.map((qid) => ({
    id: qid,
    label: qidMeta[qid]?.label ?? qid,
  }));

  let thumbnail: string | undefined;
  for (const pid of ["P18", "P154"] as const) {
    for (const claim of (claims[pid] as ClaimSnakValue[] | undefined) ?? []) {
      const filename = claim.mainsnak?.datavalue?.value;
      if (typeof filename !== "string") continue;
      if (!isUsableMediaFilename(filename, { allowSvg: pid === "P154" })) continue;
      thumbnail = getCommonsThumbUrl(filename, 640);
      break;
    }
    if (thumbnail) break;
  }

  const facts: EntityFact[] = [];
  for (const pid of LITE_FACT_PROPS) {
    const claimList = claims[pid] as ClaimSnakValue[] | undefined;
    if (!claimList?.length) continue;
    const values: FactValue[] = [];
    for (const claim of claimList.slice(0, pid === "P166" ? 16 : 6)) {
      const parsed = parseSnak(claim.mainsnak, qidMeta, propertyLabels);
      if (!parsed) continue;
      const qualifiers: FactValue["qualifiers"] = [];
      for (const [qPid, qList] of Object.entries(claim.qualifiers ?? {})) {
        for (const q of qList as ClaimSnakValue[]) {
          const qParsed = parseSnak(q, qidMeta, propertyLabels);
          if (qParsed) {
            qualifiers.push({
              property: propertyLabels[qPid] ?? GRAPH_PROP_LABELS[qPid] ?? qPid,
              propertyId: qPid,
              label: qParsed.label,
              id: qParsed.id,
            });
          }
        }
      }
      if (qualifiers.length) parsed.qualifiers = qualifiers;
      const year = yearFromClaimQualifiers(claim, qualifiers);
      if (year != null) parsed.year = year;
      values.push(parsed);
    }
    if (!values.length) continue;
    facts.push({
      property: propertyLabels[pid] ?? GRAPH_PROP_LABELS[pid] ?? pid,
      propertyId: pid,
      values,
      datatype: claimList[0]?.mainsnak?.datatype,
    });
  }

  return {
    id,
    label,
    description,
    thumbnail,
    type,
    instanceOf,
    wikidataUrl: `https://www.wikidata.org/wiki/${id}`,
    wikipediaUrl,
    facts,
    aliases: [],
    wikipediaSummary: wikiLead,
    wikipedia: wikiLead && sitelink
      ? {
          title: sitelink.title,
          url: wikipediaUrl!,
          lead: wikiLead,
          sections: [],
        }
      : undefined,
    images: [],
    links: [{ kind: "wikidata", label: "Wikidata", url: `https://www.wikidata.org/wiki/${id}` }],
    timeline: [],
    related: [],
    lifespan: formatLifespan(facts),
  };
}

function collectReferencedIds(claims: Record<string, unknown[]>, out: Set<string>) {
  for (const claimList of Object.values(claims)) {
    for (const raw of claimList) {
      const claim = raw as ClaimSnakValue;
      addIdFromSnak(claim.mainsnak, out);
      // quantity units
      const val = claim.mainsnak?.datavalue?.value;
      if (typeof val === "object" && val && "unit" in val) {
        const unit = (val as { unit?: string }).unit;
        if (unit && unit !== "1") out.add(unit.split("/").pop()!);
      }
      for (const qList of Object.values(claim.qualifiers ?? {})) {
        for (const q of qList as ClaimSnakValue[]) addIdFromSnak(q, out);
      }
    }
  }
}

function yearFromTimeString(time?: string): number | undefined {
  if (!time) return undefined;
  const m = time.match(/([+-]?)(\d{1,7})-/);
  if (!m) return undefined;
  const sign = m[1] === "-" ? -1 : 1;
  const y = Number(m[2]) * sign;
  return Number.isFinite(y) ? y : undefined;
}

function yearFromLabel(label?: string): number | undefined {
  if (!label) return undefined;
  const m = label.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : undefined;
}

/** Prefer P585 (point in time), then start/publication time. */
function yearFromClaimQualifiers(
  claim: ClaimSnakValue,
  parsedQualifiers?: FactValue["qualifiers"],
): number | undefined {
  const TIME_PIDS = ["P585", "P580", "P577"] as const;
  const qs = claim.qualifiers ?? {};
  for (const pid of TIME_PIDS) {
    for (const q of (qs[pid] ?? []) as Array<{
      datavalue?: { type?: string; value?: { time?: string } };
    }>) {
      if (q.datavalue?.type === "time") {
        const y = yearFromTimeString(q.datavalue.value?.time);
        if (y != null) return y;
      }
    }
  }
  for (const pid of TIME_PIDS) {
    const hit = parsedQualifiers?.find((q) => q.propertyId === pid);
    const y = yearFromLabel(hit?.label);
    if (y != null) return y;
  }
  return undefined;
}

function addIdFromSnak(snak: ClaimSnakValue["mainsnak"] | ClaimSnakValue | undefined, out: Set<string>) {
  const mainsnak = snak && "mainsnak" in snak ? snak.mainsnak : snak;
  const val = mainsnak?.datavalue?.value;
  if (typeof val === "object" && val && "id" in val && typeof val.id === "string") {
    out.add(val.id);
  }
}

function parseSnak(
  snak: ClaimSnakValue["mainsnak"] | ClaimSnakValue | undefined,
  qidMeta: Record<string, { label: string; description?: string }>,
  propertyLabels: Record<string, string>,
): FactValue | null {
  const mainsnak = snak && "datavalue" in (snak as object) ? (snak as ClaimSnakValue["mainsnak"]) : (snak as ClaimSnakValue)?.mainsnak ?? (snak as ClaimSnakValue["mainsnak"]);
  if (!mainsnak || mainsnak.snaktype === "novalue" || mainsnak.snaktype === "somevalue") {
    if (mainsnak?.snaktype === "somevalue") return { label: "unknown value" };
    if (mainsnak?.snaktype === "novalue") return { label: "no value" };
    // qualifier snaks are the snak itself
  }

  const actual = (mainsnak?.datavalue ? mainsnak : (snak as ClaimSnakValue["mainsnak"])) as NonNullable<ClaimSnakValue["mainsnak"]> | undefined;
  if (!actual?.datavalue) {
    // maybe snak is already a snak (qualifier)
    const q = snak as { datavalue?: { type?: string; value?: unknown }; snaktype?: string };
    if (!q?.datavalue) return null;
    return parseDataValue(q.datavalue, qidMeta, propertyLabels);
  }
  return parseDataValue(actual.datavalue, qidMeta, propertyLabels);
}

function parseDataValue(
  dv: { type?: string; value?: unknown },
  qidMeta: Record<string, { label: string; description?: string }>,
  _propertyLabels: Record<string, string>,
): FactValue | null {
  if (!dv) return null;
  const type = dv.type;
  const val = dv.value;

  if (type === "wikibase-entityid" && typeof val === "object" && val && "id" in val) {
    const id = (val as { id: string }).id;
    return { label: qidMeta[id]?.label ?? id, id };
  }
  if (type === "time" && typeof val === "object" && val && "time" in val) {
    return { label: formatWikidataTime((val as { time: string; precision?: number }).time, (val as { precision?: number }).precision) };
  }
  if (type === "string" && typeof val === "string") {
    if (/^https?:\/\//.test(val)) return { label: val, url: val };
    return { label: val };
  }
  if (type === "monolingualtext" && typeof val === "object" && val && "text" in val) {
    const mt = val as { text: string; language?: string };
    return { label: mt.language ? `${mt.text} (${mt.language})` : mt.text };
  }
  if (type === "quantity" && typeof val === "object" && val && "amount" in val) {
    const q = val as { amount: string; unit?: string };
    const amount = q.amount.replace(/^\+/, "");
    let unitLabel = "";
    if (q.unit && q.unit !== "1") {
      const unitId = q.unit.split("/").pop()!;
      unitLabel = qidMeta[unitId]?.label ? ` ${qidMeta[unitId].label}` : "";
    }
    return { label: `${formatNumber(amount)}${unitLabel}` };
  }
  if (type === "globecoordinate" && typeof val === "object" && val && "latitude" in val) {
    const c = val as { latitude: number; longitude: number };
    return {
      label: `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}`,
      url: `https://www.openstreetmap.org/?mlat=${c.latitude}&mlon=${c.longitude}#map=10/${c.latitude}/${c.longitude}`,
    };
  }
  if (typeof val === "string") return { label: val };
  return null;
}

function buildLinks(
  id: string,
  wikipediaUrl: string | undefined,
  facts: EntityFact[],
  claims: Record<string, unknown[]>,
): EntityLink[] {
  const links: EntityLink[] = [
    { label: "Wikidata", url: `https://www.wikidata.org/wiki/${id}`, kind: "wikidata" },
  ];
  if (wikipediaUrl) links.push({ label: "Wikipedia", url: wikipediaUrl, kind: "wikipedia" });

  const add = (label: string, url: string, kind: EntityLink["kind"]) => {
    if (!links.some((l) => l.url === url)) links.push({ label, url, kind });
  };

  for (const fact of facts) {
    if (fact.propertyId === "P856") {
      for (const v of fact.values) if (v.label.startsWith("http")) add("Official website", v.label, "website");
    }
    if (fact.propertyId === "P2002") {
      for (const v of fact.values) add(`X / Twitter (@${v.label})`, `https://x.com/${v.label}`, "social");
    }
    if (fact.propertyId === "P2013") {
      for (const v of fact.values) add("Facebook", `https://www.facebook.com/${v.label}`, "social");
    }
    if (fact.propertyId === "P2003") {
      for (const v of fact.values) add(`Instagram (@${v.label})`, `https://www.instagram.com/${v.label}`, "social");
    }
    if (fact.propertyId === "P2397") {
      for (const v of fact.values) add("YouTube", `https://www.youtube.com/channel/${v.label}`, "social");
    }
    if (fact.propertyId === "P2037") {
      for (const v of fact.values) add(`GitHub (@${v.label})`, `https://github.com/${v.label}`, "social");
    }
    if (IDENTIFIER_PROPERTY_IDS.has(fact.propertyId) || LINK_PROPERTY_IDS.has(fact.propertyId)) {
      for (const v of fact.values) {
        if (v.url) add(`${fact.property}: ${v.label}`, v.url, "identifier");
        else if (fact.propertyId === "P214") add(`VIAF ${v.label}`, `https://viaf.org/viaf/${v.label}`, "identifier");
        else if (fact.propertyId === "P345") add(`IMDb ${v.label}`, `https://www.imdb.com/${v.label.startsWith("tt") || v.label.startsWith("nm") ? "" : "name/"}${v.label}`, "identifier");
        else if (fact.propertyId === "P213") add(`ISNI ${v.label}`, `https://isni.org/isni/${v.label.replace(/\s/g, "")}`, "identifier");
        else if (fact.propertyId === "P496") add(`ORCID ${v.label}`, `https://orcid.org/${v.label}`, "identifier");
        else if (fact.propertyId === "P244") add(`LoC ${v.label}`, `https://id.loc.gov/authorities/names/${v.label}`, "identifier");
        else if (fact.propertyId === "P227") add(`GND ${v.label}`, `https://d-nb.info/gnd/${v.label}`, "identifier");
        else if (fact.propertyId === "P6782") add(`ROR ${v.label}`, `https://ror.org/${v.label}`, "identifier");
        else if (fact.propertyId === "P1566") add(`GeoNames ${v.label}`, `https://www.geonames.org/${v.label}`, "identifier");
      }
    }
  }

  // Also catch raw P856 if facts somehow skipped
  const p856 = claims["P856"] as ClaimSnakValue[] | undefined;
  const rawUrl = p856?.[0]?.mainsnak?.datavalue?.value;
  if (typeof rawUrl === "string") add("Official website", rawUrl, "website");

  return links;
}

function buildTimeline(facts: EntityFact[]): TimelineItem[] {
  const dateProps = new Set([
    "P569", "P570", "P571", "P576", "P577", "P580", "P582", "P585", "P1619", "P2031", "P2032",
  ]);
  const eventProps = new Set(["P166", "P39", "P793", "P607", "P1411", "P1344"]);
  const creativeProps = new Set(["CR_SONG", "CR_ALBUM", "CR_FILM", "P800", "P175", "P161"]);
  const items: TimelineItem[] = [];

  for (const fact of facts) {
    if (dateProps.has(fact.propertyId)) {
      for (const v of fact.values) {
        items.push({
          date: v.label,
          sortKey: v.label,
          label: fact.property,
          value: undefined,
        });
      }
    }
    if (eventProps.has(fact.propertyId)) {
      for (const v of fact.values) {
        const timeQ = v.qualifiers?.find((q) =>
          ["P580", "P582", "P585", "P577"].includes(q.propertyId),
        );
        items.push({
          date: timeQ?.label ?? "Date unknown",
          sortKey: timeQ?.label ?? "9999",
          label: fact.property,
          value: v.label,
          entityId: v.id,
        });
      }
    }
  }

  // Career markers from reverse discography / filmography when years are sparse
  for (const fact of facts) {
    if (!creativeProps.has(fact.propertyId)) continue;
    for (const v of fact.values.slice(0, 8)) {
      const yearQ = v.qualifiers?.find((q) =>
        ["P577", "P580", "P585"].includes(q.propertyId),
      );
      items.push({
        date: yearQ?.label ?? "Career",
        sortKey: yearQ?.label ?? "8888",
        label: fact.property,
        value: v.label,
        entityId: v.id,
      });
    }
  }

  items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const seen = new Set<string>();
  return items.filter((it) => {
    const key = `${it.date}|${it.label}|${it.value ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatLifespan(facts: EntityFact[]): string | undefined {
  const birth = facts.find((f) => f.propertyId === "P569")?.values[0]?.label;
  const death = facts.find((f) => f.propertyId === "P570")?.values[0]?.label;
  if (!birth && !death) return undefined;
  const by = birth ? extractYearFromLabel(birth) : "?";
  const dy = death ? extractYearFromLabel(death) : null;
  return dy ? `${by} – ${dy}` : `b. ${by}`;
}

function extractYearFromLabel(label: string): string {
  // Prefer a 4-digit year (avoid matching day "4" in "4 August 1929")
  const yearMatch = label.match(/\b(\d{4})\b/);
  if (yearMatch) {
    const bce = /\b(BCE|BC)\b/i.test(label);
    return bce ? `${yearMatch[1]} BCE` : yearMatch[1];
  }
  const m = label.match(/(\d{1,4})\s*(BCE|BC)?/i);
  if (!m) return label;
  return m[2] ? `${m[1]} BCE` : m[1];
}

// ─── Graph data ──────────────────────────────────────────────────────────────

const GRAPH_PROPS = [
  "P17", "P131", "P361", "P527", "P22", "P25", "P26", "P40", "P3373", "P1038",
  "P19", "P20", "P27", "P106", "P108", "P69", "P112", "P463", "P1344",
  "P159", "P169", "P140", "P136", "P495", "P57", "P58", "P161", "P86",
  "P50", "P170", "P175", "P162", "P800", "P127", "P749", "P355", "P166", "P39", "P452",
];

/**
 * Roles found on works pointing back to a person (filmography / discography).
 * `pattern` is a SPARQL fragment that binds `?work`; use PERSON_ID for the focus Q-id.
 * Typed Song / Album / Film hubs cover singers (e.g. Kumar Sanu) better than a flat Performer list.
 */
export type CreativeRoleQuery = {
  pid: string;
  label: string;
  limit: number;
  pattern?: string;
};

export const CREATIVE_ROLE_QUERIES: CreativeRoleQuery[] = [
  { pid: "P161", label: "Actor", limit: 15 },
  { pid: "P57", label: "Director", limit: 15 },
  { pid: "P162", label: "Producer", limit: 15 },
  { pid: "P86", label: "Composer", limit: 20 },
  { pid: "P58", label: "Screenwriter", limit: 10 },
  {
    pid: "CR_SONG",
    label: "Song",
    limit: 40,
    // Direct P31 only — P279* is slow and often times out on WDQS
    pattern: `?work wdt:P175 wd:PERSON_ID .
      MINUS { ?work wdt:P31 wd:Q482994 }
      MINUS { ?work wdt:P31 wd:Q11424 }`,
  },
  {
    pid: "CR_ALBUM",
    label: "Album",
    limit: 40,
    pattern: `?work wdt:P175 wd:PERSON_ID .
      ?work wdt:P31 wd:Q482994 .`,
  },
  {
    pid: "CR_FILM",
    label: "Film",
    limit: 30,
    pattern: `{
        ?work wdt:P175 wd:PERSON_ID .
        ?work wdt:P31 wd:Q11424 .
      } UNION {
        ?song wdt:P175 wd:PERSON_ID .
        ?song (wdt:P361|wdt:P1433|wdt:P179) ?work .
        ?work wdt:P31 wd:Q11424 .
      }`,
  },
];

export function isCreativeRoleProperty(propertyId: string): boolean {
  return CREATIVE_ROLE_QUERIES.some((r) => r.pid === propertyId);
}

export function creativeRoleLabel(propertyId: string): string | undefined {
  return CREATIVE_ROLE_QUERIES.find((r) => r.pid === propertyId)?.label;
}

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const MUSICBRAINZ_API = "https://musicbrainz.org/ws/2";
const MB_USER_AGENT = "OntaraKnowledgeExplorer/1.0 (educational; contact@ontara.local)";
/** Hard cap so one cold WDQS query cannot stall the whole graph. */
const SPARQL_TIMEOUT_MS = 8_000;

function rolePattern(role: CreativeRoleQuery, personId: string): string {
  if (role.pattern) return role.pattern.replaceAll("PERSON_ID", personId);
  return `?work wdt:${role.pid} wd:${personId} .`;
}

async function runSparql(
  sparql: string,
  timeoutMs = SPARQL_TIMEOUT_MS,
): Promise<Array<Record<string, { value?: string }>>> {
  const url = `${SPARQL_ENDPOINT}?${new URLSearchParams({ format: "json", query: sparql })}`;
  const headers = {
    Accept: "application/sparql-results+json",
    "User-Agent": MB_USER_AGENT,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      if (res.status === 429 || res.status === 503) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return [];
      const data = await res.json() as {
        results?: { bindings?: Array<Record<string, { value?: string }>> };
      };
      return data.results?.bindings ?? [];
    } catch {
      if (attempt === 0) await new Promise((r) => setTimeout(r, 200));
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

/** Occupation QIDs (P106) → which reverse-work SPARQL roles are worth running. */
const OCC_ACTOR = new Set([
  "Q33999", "Q10800557", "Q2259451", "Q2405480", "Q10798782", "Q4610556",
  "Q211236", "Q713200", "Q11481802",
]);
const OCC_DIRECTOR = new Set(["Q2526255", "Q3455803", "Q222344"]);
const OCC_PRODUCER = new Set(["Q3282637", "Q10535780", "Q47541952"]);
const OCC_WRITER = new Set(["Q28389", "Q18844224", "Q5762300"]);
const OCC_COMPOSER = new Set(["Q36834", "Q21680731", "Q55960555"]);
const OCC_SINGER = new Set([
  "Q177220", "Q488205", "Q55960555", "Q753110", "Q855091", "Q2865819",
]);

export function occupationIdsFromClaims(
  claims?: Record<string, ClaimSnakValue[] | undefined> | Record<string, unknown[] | undefined>,
): string[] {
  const list = claims?.["P106"] as ClaimSnakValue[] | undefined;
  if (!list?.length) return [];
  const out: string[] = [];
  for (const claim of list) {
    const val = claim.mainsnak?.datavalue?.value;
    if (typeof val === "object" && val && "id" in val && typeof val.id === "string") {
      out.push(val.id);
    }
  }
  return out;
}

/** Pick SPARQL role queries from occupations — skip song/album for non-singers. */
export function creativeRolesForOccupations(occupationIds: string[]): CreativeRoleQuery[] {
  const byPid = (pid: string) => CREATIVE_ROLE_QUERIES.find((r) => r.pid === pid)!;
  const occ = new Set(occupationIds);
  const hit = (set: Set<string>) => occupationIds.some((id) => set.has(id));

  const selected: CreativeRoleQuery[] = [];
  if (hit(OCC_ACTOR) || occ.size === 0) selected.push(byPid("P161"));
  if (hit(OCC_DIRECTOR)) selected.push(byPid("P57"));
  if (hit(OCC_PRODUCER)) selected.push(byPid("P162"));
  if (hit(OCC_WRITER)) selected.push(byPid("P58"));
  if (hit(OCC_COMPOSER)) selected.push(byPid("P86"));
  if (hit(OCC_SINGER)) {
    selected.push(byPid("CR_SONG"), byPid("CR_ALBUM"), byPid("CR_FILM"));
  } else if (hit(OCC_ACTOR) && !selected.some((r) => r.pid === "CR_FILM")) {
    // Actors: cast list is enough; skip heavy performer→film UNION unless singer
  }

  // Unknown occupations: cheap defaults only (never cold-start Song/Album)
  if (!selected.length) {
    return [byPid("P161"), byPid("P57"), byPid("P162")].map((r) => ({
      ...r,
      limit: Math.min(r.limit, 12),
    }));
  }

  return selected.map((r) => ({ ...r, limit: Math.min(r.limit, 20) }));
}

export type CreativeRoleHit = {
  qid: string;
  pid: string;
  label: string;
  workLabel: string;
  type: EntityType;
  externalUrl?: string;
};

/**
 * Reverse-lookup works where `personId` appears as cast / director / producer / singer / etc.
 * Wikidata stores those claims on the work, so outbound expand alone misses filmography.
 * Call this lazily (Creative tab / deferred graph merge) — not on first paint.
 */
export async function fetchCreativeRoles(
  personId: string,
  opts?: {
    propertyId?: string;
    existingIds?: Set<string>;
    limitPerRole?: number;
    /** P106 QIDs — filters which SPARQL roles run */
    occupationIds?: string[];
  },
): Promise<CreativeRoleHit[]> {
  const roles = opts?.propertyId
    ? CREATIVE_ROLE_QUERIES.filter((r) => r.pid === opts.propertyId)
    : creativeRolesForOccupations(opts?.occupationIds ?? []);
  if (!roles.length) return [];

  const existing = opts?.existingIds ?? new Set<string>();

  // All selected roles in parallel (occupation filter keeps this small: usually 1–3)
  const waveHits = await Promise.all(
    roles.map(async (r) => {
      const limit = opts?.limitPerRole ?? r.limit;
      const sparql = `
          SELECT ?work ?workLabel WHERE {
            {
              SELECT ?work WHERE {
                ${rolePattern(r, personId)}
              } LIMIT ${limit}
            }
            SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
          }
        `;
      const rows = await runSparql(sparql);
      return rows.map((row) => ({
        qid: row.work?.value?.split("/").pop(),
        workLabel: row.workLabel?.value,
        pid: r.pid,
        label: r.label,
      }));
    }),
  );

  const out: CreativeRoleHit[] = [];
  const seen = new Set<string>();
  for (const row of waveHits.flat()) {
    const qid = row.qid;
    if (!qid || existing.has(qid)) continue;
    const key = `${row.pid}:${qid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      qid,
      pid: row.pid,
      label: row.label,
      workLabel: row.workLabel ?? qid,
      type: "work",
    });
  }
  return out;
}

/**
 * Lazy filmography / discography for Creative tab / deferred graph enrich.
 * Kept out of Overview + initial graph paint to cut SPARQL fan-out.
 */
export async function fetchCreativeRolesForPerson(
  personId: string,
  claims?: Record<string, unknown[] | undefined>,
): Promise<CreativeRoleHit[]> {
  let resolvedClaims = claims;
  if (!resolvedClaims) {
    const ents = await fetchWikidataEntitiesBatch([personId]);
    resolvedClaims = ents[personId]?.claims as Record<string, unknown[] | undefined> | undefined;
  }
  const occupationIds = occupationIdsFromClaims(resolvedClaims);
  const roles = await fetchCreativeRoles(personId, { occupationIds });
  const mbid = resolvedClaims
    ? musicBrainzArtistIdFromClaims(resolvedClaims as Record<string, ClaimSnakValue[] | undefined>)
    : undefined;
  // Only hit MusicBrainz when the person is a singer / has MB id
  const wantMb =
    Boolean(mbid) &&
    (occupationIds.length === 0 ||
      occupationIds.some((id) => OCC_SINGER.has(id) || OCC_COMPOSER.has(id)));
  const mbAlbums = wantMb && mbid
    ? await fetchMusicBrainzAlbums(mbid, {
        existingIds: new Set(roles.map((r) => r.qid)),
        limit: 24,
      })
    : [];
  return [...roles, ...mbAlbums];
}

/** Film / work credit with year + character when Wikidata has them. */
export type FilmographyEntry = {
  qid: string;
  title: string;
  year?: number;
  character?: string;
  role: string;
  thumbnail?: string;
};

/** How a person connects to a specific film / work. */
export type PersonWorkLink = {
  role: string;
  pid: string;
  character?: string;
};

/**
 * Resolve cast / crew / performer / notable-work links between a person and one film.
 * Used by the Movies detail pane (“how this movie relates to …”).
 */
export async function fetchHowPersonRelatesToWork(
  personId: string,
  workId: string,
): Promise<PersonWorkLink[]> {
  if (!/^Q\d+$/.test(personId) || !/^Q\d+$/.test(workId)) return [];
  const sparql = `
    SELECT ?role ?pid ?characterLabel WHERE {
      {
        BIND("Cast" AS ?role) BIND("P161" AS ?pid)
        wd:${workId} p:P161 ?stmt .
        ?stmt ps:P161 wd:${personId} .
        OPTIONAL { ?stmt pq:P453 ?character . }
      } UNION {
        BIND("Director" AS ?role) BIND("P57" AS ?pid)
        wd:${workId} wdt:P57 wd:${personId} .
      } UNION {
        BIND("Producer" AS ?role) BIND("P162" AS ?pid)
        wd:${workId} wdt:P162 wd:${personId} .
      } UNION {
        BIND("Composer" AS ?role) BIND("P86" AS ?pid)
        wd:${workId} wdt:P86 wd:${personId} .
      } UNION {
        BIND("Screenwriter" AS ?role) BIND("P58" AS ?pid)
        wd:${workId} wdt:P58 wd:${personId} .
      } UNION {
        BIND("Notable work" AS ?role) BIND("P800" AS ?pid)
        wd:${personId} wdt:P800 wd:${workId} .
      } UNION {
        BIND("Playback / performer" AS ?role) BIND("P175" AS ?pid)
        ?song wdt:P175 wd:${personId} .
        { ?song wdt:P1441 wd:${workId} } UNION { ?song wdt:P361 wd:${workId} }
          UNION { ?song wdt:P179 wd:${workId} }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 24
  `;
  const rows = await runSparql(sparql);
  const seen = new Set<string>();
  const out: PersonWorkLink[] = [];
  for (const row of rows) {
    const role = row.role?.value?.trim();
    const pid = row.pid?.value?.trim();
    if (!role || !pid) continue;
    const character = row.characterLabel?.value?.trim();
    const key = `${pid}:${character ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role, pid, character: character || undefined });
  }
  return out;
}

function commonsFilePathToThumb(url?: string, width = 320): string | undefined {
  if (!url) return undefined;
  try {
    const decoded = decodeURIComponent(url);
    // Direct upload CDN — usable as-is
    if (/upload\.wikimedia\.org/.test(url)) return url;

    const markers = ["/wiki/Special:FilePath/", "/wiki/File:", "/wiki/file:"];
    let filename: string | undefined;
    for (const marker of markers) {
      const idx = decoded.indexOf(marker);
      if (idx >= 0) {
        filename = decoded.slice(idx + marker.length).split(/[?#]/)[0]?.replace(/_/g, " ");
        break;
      }
    }
    // SPARQL sometimes returns a bare Commons filename
    if (!filename && /^[^/]+\.(jpe?g|png|gif|webp)$/i.test(decoded.trim())) {
      filename = decoded.trim().replace(/_/g, " ");
    }
    if (!filename) return undefined;
    return getCommonsThumbUrl(filename, width);
  } catch {
    return undefined;
  }
}

/**
 * Actor filmography with publication year (P577) and character (P453 on cast claim).
 * Used by the /new/entity Movies tab — richer than reverse-role labels alone.
 */
export async function fetchPersonFilmography(
  personId: string,
  limit = 80,
): Promise<FilmographyEntry[]> {
  const sparql = `
    SELECT ?work ?workLabel ?year ?characterLabel ?image WHERE {
      {
        ?work wdt:P161 wd:${personId} .
      } UNION {
        wd:${personId} wdt:P800 ?work .
        ?work wdt:P31/wdt:P279* wd:Q11424 .
      }
      OPTIONAL {
        ?work wdt:P577 ?date .
        BIND(YEAR(?date) AS ?year)
      }
      OPTIONAL {
        ?work p:P161 ?stmt .
        ?stmt ps:P161 wd:${personId} .
        OPTIONAL { ?stmt pq:P453 ?character . }
      }
      OPTIONAL { ?work wdt:P18 ?image . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY DESC(?year)
    LIMIT ${Math.min(Math.max(limit, 10), 120)}
  `;
  const rows = await runSparql(sparql);
  const seen = new Set<string>();
  const out: FilmographyEntry[] = [];
  for (const row of rows) {
    const qid = row.work?.value?.split("/").pop();
    if (!qid || seen.has(qid)) continue;
    seen.add(qid);
    const yearRaw = row.year?.value;
    const year = yearRaw ? Number(yearRaw) : undefined;
    out.push({
      qid,
      title: row.workLabel?.value ?? qid,
      year: year && Number.isFinite(year) ? year : undefined,
      character: row.characterLabel?.value,
      role: "Cast",
      thumbnail: commonsFilePathToThumb(row.image?.value, 360),
    });
  }
  // Commons P18 batch for gaps
  const needCommons = out.filter((f) => !f.thumbnail).map((f) => f.qid);
  if (needCommons.length) {
    const thumbs = await fetchThumbnails(needCommons, undefined, 360);
    for (const f of out) {
      if (!f.thumbnail && thumbs[f.qid]) f.thumbnail = thumbs[f.qid];
    }
  }
  // Wikipedia posters (fair-use) — most Bollywood films have no Commons P18
  const needWiki = out.filter((f) => !f.thumbnail).map((f) => f.qid);
  if (needWiki.length) {
    const wiki = await fetchWikipediaThumbsForEntities(needWiki);
    for (const f of out) {
      if (!f.thumbnail && wiki[f.qid]) f.thumbnail = wiki[f.qid];
    }
  }
  // Last resort: REST by Wikidata label for a few stubborn titles
  const still = out.filter((f) => !f.thumbnail).slice(0, 16);
  if (still.length) {
    await Promise.all(
      still.map(async (f) => {
        const rest = await fetchWikipediaRestThumb(f.title);
        if (rest) f.thumbnail = rest;
      }),
    );
  }
  return out;
}

/** Song credit for a performer (playback singer etc.). */
export type SongEntry = {
  qid: string;
  title: string;
  year?: number;
  film?: string;
  filmQid?: string;
  youtubeId?: string;
  archiveId?: string;
  /** Direct playable URL (mp3 / ogg) when known. */
  audioUrl?: string;
};

/**
 * Songs performed by a person (Wikidata P175), with film/year.
 * Playable mp3 URLs are resolved on click via /api/audio (Archive.org).
 */
export async function fetchPersonSongs(
  personId: string,
  opts?: { personLabel?: string; limit?: number },
): Promise<SongEntry[]> {
  if (!/^Q\d+$/.test(personId)) return [];
  const limit = Math.min(Math.max(opts?.limit ?? 40, 8), 80);
  const sparql = `
    SELECT ?song ?songLabel ?year ?film ?filmLabel ?yt ?ia WHERE {
      ?song wdt:P175 wd:${personId} .
      MINUS { ?song wdt:P31 wd:Q482994 }
      MINUS { ?song wdt:P31 wd:Q11424 }
      OPTIONAL {
        ?song wdt:P577 ?date .
        BIND(YEAR(?date) AS ?year)
      }
      OPTIONAL {
        ?song wdt:P1441|wdt:P361|wdt:P179 ?film .
        ?film wdt:P31/wdt:P279* wd:Q11424 .
      }
      OPTIONAL { ?song wdt:P1651 ?yt . }
      OPTIONAL { ?song wdt:P724 ?ia . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    ORDER BY DESC(?year)
    LIMIT ${limit}
  `;
  const rows = await runSparql(sparql, 12_000);
  const seen = new Set<string>();
  const songs: SongEntry[] = [];
  for (const row of rows) {
    const qid = row.song?.value?.split("/").pop();
    if (!qid || seen.has(qid)) continue;
    seen.add(qid);
    const yearRaw = row.year?.value;
    const year = yearRaw ? Number(yearRaw) : undefined;
    songs.push({
      qid,
      title: row.songLabel?.value ?? qid,
      year: year && Number.isFinite(year) ? year : undefined,
      film: row.filmLabel?.value,
      filmQid: row.film?.value?.split("/").pop(),
      youtubeId: row.yt?.value?.trim() || undefined,
      archiveId: row.ia?.value?.trim() || undefined,
    });
  }

  // Audio URLs are resolved on demand via /api/audio (browser cannot
  // call archive.org reliably due to 403/CORS). Keep Wikidata credits only.
  return songs;
}

/**
 * Lazy YouTube video id for a song query (Piped / Invidious public search).
 * Kept for callers that still want video; song player prefers Archive mp3.
 */
export async function resolveSongYoutubeId(query: string): Promise<string | undefined> {
  const q = query.trim();
  if (!q) return undefined;
  const endpoints = [
    `https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(q)}&filter=videos`,
    `https://invidious.fdn.fr/api/v1/search?q=${encodeURIComponent(q)}&type=video`,
  ];
  for (const url of endpoints) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json() as
        | { items?: Array<{ url?: string; id?: string; type?: string }> }
        | Array<{ videoId?: string; type?: string }>;
      if (Array.isArray(data)) {
        const hit = data.find((x) => x.videoId && (x.type === "video" || !x.type));
        if (hit?.videoId) return hit.videoId;
      } else {
        for (const item of data.items ?? []) {
          if (item.type && item.type !== "stream" && item.type !== "video") continue;
          const fromUrl = item.url?.match(/(?:v=|\/watch\/|youtu\.be\/)([\w-]{11})/)?.[1];
          const id = item.id?.replace(/^\/watch\?v=/, "") || fromUrl;
          if (id && /^[\w-]{11}$/.test(id)) return id;
        }
      }
    } catch {
      /* try next */
    }
  }
  return undefined;
}

/** On-demand playable mp3/audio via server (Archive.org, then YouTube audio). */
export async function resolveSongAudioUrl(opts: {
  title: string;
  artist?: string;
  archiveId?: string;
  film?: string;
  youtubeId?: string;
}): Promise<{ audioUrl: string; archiveId?: string; track?: string; source?: string } | undefined> {
  const title = opts.title.trim();
  if (!title) return undefined;
  try {
    const res = await fetch("/api/audio/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        artist: opts.artist?.trim() || undefined,
        film: opts.film?.trim() || undefined,
        archiveId: opts.archiveId?.trim() || undefined,
        youtubeId: opts.youtubeId?.trim() || undefined,
      }),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as {
      audioUrl?: string;
      archiveId?: string;
      track?: string;
      source?: string;
    };
    if (!data.audioUrl) return undefined;
    return {
      audioUrl: data.audioUrl,
      archiveId: data.archiveId,
      track: data.track,
      source: data.source,
    };
  } catch {
    return undefined;
  }
}

/**
 * Highlight films for compare cards — prefer notable works with Wikipedia posters.
 */
export async function fetchCompareHighlightFilms(
  personId: string,
  limit = 4,
): Promise<FilmographyEntry[]> {
  const sparql = `
    SELECT ?work ?workLabel ?year ?image ?notable WHERE {
      {
        wd:${personId} wdt:P800 ?work .
        BIND(2 AS ?notable)
      } UNION {
        ?work wdt:P161 wd:${personId} .
        BIND(0 AS ?notable)
      }
      OPTIONAL {
        ?work wdt:P577 ?date .
        BIND(YEAR(?date) AS ?year)
      }
      OPTIONAL { ?work wdt:P18 ?image . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 100
  `;
  const rows = await runSparql(sparql);
  const seen = new Set<string>();
  type Row = FilmographyEntry & { notable: number; hasImage: boolean };
  const scored: Row[] = [];
  for (const row of rows) {
    const qid = row.work?.value?.split("/").pop();
    if (!qid || seen.has(qid)) continue;
    seen.add(qid);
    const yearRaw = row.year?.value;
    const year = yearRaw ? Number(yearRaw) : undefined;
    const thumb = commonsFilePathToThumb(row.image?.value, 360);
    scored.push({
      qid,
      title: row.workLabel?.value ?? qid,
      year: year && Number.isFinite(year) ? year : undefined,
      role: Number(row.notable?.value) >= 2 ? "Notable" : "Cast",
      thumbnail: thumb,
      notable: Number(row.notable?.value) || 0,
      hasImage: Boolean(thumb),
    });
  }

  // Rank before enriching so we fetch posters for the best candidates
  scored.sort((a, b) => {
    const score = (f: Row) =>
      f.notable * 25 +
      (f.hasImage ? 20 : 0) +
      (f.year && f.year >= 1990 && f.year <= 2015 ? 18 : 0) +
      (f.year && f.year >= 1980 && f.year < 1990 ? 10 : 0) +
      (f.year && f.year >= 2016 && f.year <= 2022 ? 6 : 0);
    return score(b) - score(a);
  });

  const top = scored.slice(0, Math.max(limit * 6, 24));
  const topIds = top.map((f) => f.qid);

  // Commons P18 batch
  const needCommons = top.filter((f) => !f.thumbnail).map((f) => f.qid);
  if (needCommons.length) {
    const thumbs = await fetchThumbnails(needCommons, undefined, 360);
    for (const f of top) {
      if (!f.thumbnail && thumbs[f.qid]) {
        f.thumbnail = thumbs[f.qid];
        f.hasImage = true;
      }
    }
  }

  // Wikipedia pageimages — best source for film posters; prefer over Commons when present
  const wikiThumbs = await fetchWikipediaThumbsForEntities(topIds);
  for (const f of top) {
    const wiki = wikiThumbs[f.qid];
    if (wiki) {
      f.thumbnail = wiki;
      f.hasImage = true;
    }
  }

  // REST summary fallback for any still missing among first picks
  const still = top.filter((f) => !f.thumbnail).slice(0, 8);
  if (still.length) {
    await Promise.all(
      still.map(async (f) => {
        const rest = await fetchWikipediaRestThumb(f.title);
        if (rest) {
          f.thumbnail = rest;
          f.hasImage = true;
        }
      }),
    );
  }

  // Prefer items with posters (re-rank after enrich)
  top.sort((a, b) => {
    const score = (f: Row) =>
      (f.hasImage ? 100 : 0) +
      f.notable * 25 +
      (f.year && f.year >= 1990 && f.year <= 2015 ? 18 : 0) +
      (f.year && f.year >= 1980 && f.year < 1990 ? 10 : 0) +
      (f.year && f.year >= 2016 && f.year <= 2022 ? 6 : 0);
    return score(b) - score(a);
  });
  const withPoster = top.filter((f) => f.thumbnail);
  const pool = withPoster.length >= limit ? withPoster : [...withPoster, ...top.filter((f) => !f.thumbnail)];
  return pool.slice(0, limit).map((f) => ({
    qid: f.qid,
    title: f.title,
    year: f.year,
    role: f.role,
    thumbnail: f.thumbnail,
  }));
}

/** Dynamic career signals for compare (playback span, collabs, top music directors). */
export type CompareCareerStats = {
  personId: string;
  recordedWorks?: number;
  firstSinging?: { year: number; title: string };
  lastSinging?: { year: number; title: string };
  careerSpanYears?: number;
  topMusicDirectors?: Array<{ id: string; label: string; count: number }>;
  /** Duets / shared credits with Lata Mangeshkar (Q156347) on Wikidata */
  lataCollaborations?: number;
  filmCredits?: number;
  residence?: string[];
  assets?: string[];
  netWorth?: string[];
  workLocation?: string[];
};

const LATA_MANGESHKAR_QID = "Q156347";
const CAREER_SPARQL_TIMEOUT_MS = 14_000;

function sparqlLiteralList(
  rows: Array<Record<string, { value?: string }>>,
  key: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const v = row[key]?.value?.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * SPARQL career depth for a person — first/last credited works, top composers,
 * Lata collabs, screen credits, and asset/residence claims when present.
 */
export async function fetchCompareCareerStats(
  personId: string,
): Promise<CompareCareerStats> {
  if (!/^Q\d+$/i.test(personId)) return { personId };

  const empty: CompareCareerStats = { personId };
  const timeout = CAREER_SPARQL_TIMEOUT_MS;

  const spanQ = `
    SELECT ?works ?firstYear ?lastYear ?films ?lataN WHERE {
      {
        SELECT (COUNT(DISTINCT ?work) AS ?works)
               (MIN(?year) AS ?firstYear) (MAX(?year) AS ?lastYear)
        WHERE {
          ?work wdt:P175 wd:${personId} .
          OPTIONAL { ?work wdt:P577 ?d . BIND(YEAR(?d) AS ?year) }
        }
      }
      {
        SELECT (COUNT(DISTINCT ?film) AS ?films) WHERE {
          ?film wdt:P161 wd:${personId} .
        }
      }
      {
        SELECT (COUNT(DISTINCT ?duet) AS ?lataN) WHERE {
          ?duet wdt:P175 wd:${personId}, wd:${LATA_MANGESHKAR_QID} .
        }
      }
    }
  `;

  const endsQ = `
    SELECT ?which ?year ?workLabel WHERE {
      {
        SELECT ("first" AS ?which) ?year ?work ?workLabel WHERE {
          ?work wdt:P175 wd:${personId} ; wdt:P577 ?d .
          BIND(YEAR(?d) AS ?year)
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        ORDER BY ASC(?year)
        LIMIT 1
      }
      UNION
      {
        SELECT ("last" AS ?which) ?year ?work ?workLabel WHERE {
          ?work wdt:P175 wd:${personId} ; wdt:P577 ?d .
          BIND(YEAR(?d) AS ?year)
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        }
        ORDER BY DESC(?year)
        LIMIT 1
      }
    }
  `;

  const composersQ = `
    SELECT ?c ?cLabel (COUNT(DISTINCT ?work) AS ?n) WHERE {
      ?work wdt:P175 wd:${personId} .
      ?work wdt:P86 ?c .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    GROUP BY ?c ?cLabel
    ORDER BY DESC(?n)
    LIMIT 3
  `;

  const personalQ = `
    SELECT ?resLabel ?assetLabel ?worth ?locLabel WHERE {
      OPTIONAL { wd:${personId} wdt:P551 ?res . }
      OPTIONAL { wd:${personId} wdt:P1830 ?asset . }
      OPTIONAL { wd:${personId} wdt:P2218 ?worth . }
      OPTIONAL { wd:${personId} wdt:P937 ?loc . }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 20
  `;

  const [spanRows, endsRows, composerRows, personalRows] = await Promise.all([
    runSparql(spanQ, timeout),
    runSparql(endsQ, timeout),
    runSparql(composersQ, timeout),
    runSparql(personalQ, timeout),
  ]);

  const span = spanRows[0];
  const works = span?.works?.value ? Number(span.works.value) : undefined;
  const firstYear = span?.firstYear?.value ? Number(span.firstYear.value) : undefined;
  const lastYear = span?.lastYear?.value ? Number(span.lastYear.value) : undefined;
  const films = span?.films?.value ? Number(span.films.value) : undefined;
  const lataN = span?.lataN?.value ? Number(span.lataN.value) : undefined;

  const firstRow = endsRows.find((r) => r.which?.value === "first") ?? endsRows[0];
  const lastRow = endsRows.find((r) => r.which?.value === "last") ?? endsRows[1];
  const fy = firstRow?.year?.value ? Number(firstRow.year.value) : firstYear;
  const ly = lastRow?.year?.value ? Number(lastRow.year.value) : lastYear;

  const topMusicDirectors = composerRows
    .map((row) => {
      const id = row.c?.value?.split("/").pop();
      const label = row.cLabel?.value;
      const count = row.n?.value ? Number(row.n.value) : 0;
      if (!id || !label || !count) return null;
      return { id, label, count };
    })
    .filter((x): x is { id: string; label: string; count: number } => Boolean(x));

  const residence = sparqlLiteralList(personalRows, "resLabel");
  const assets = sparqlLiteralList(personalRows, "assetLabel");
  const workLocation = sparqlLiteralList(personalRows, "locLabel");
  const netWorth = personalRows
    .map((r) => r.worth?.value)
    .filter((v): v is string => Boolean(v))
    .filter((v, i, a) => a.indexOf(v) === i);

  const out: CompareCareerStats = { ...empty };
  if (works != null && Number.isFinite(works) && works > 0) out.recordedWorks = works;
  if (fy != null && Number.isFinite(fy)) {
    out.firstSinging = {
      year: fy,
      title: firstRow?.workLabel?.value?.trim() || `First credited work (${fy})`,
    };
  }
  if (ly != null && Number.isFinite(ly)) {
    out.lastSinging = {
      year: ly,
      title: lastRow?.workLabel?.value?.trim() || `Last credited work (${ly})`,
    };
  }
  if (
    out.firstSinging &&
    out.lastSinging &&
    out.lastSinging.year >= out.firstSinging.year
  ) {
    out.careerSpanYears = out.lastSinging.year - out.firstSinging.year + 1;
  }
  if (topMusicDirectors.length) out.topMusicDirectors = topMusicDirectors;
  if (lataN != null && Number.isFinite(lataN)) out.lataCollaborations = lataN;
  if (films != null && Number.isFinite(films) && films > 0) out.filmCredits = films;
  if (residence.length) out.residence = residence;
  if (assets.length) out.assets = assets;
  if (netWorth.length) out.netWorth = netWorth;
  if (workLocation.length) out.workLocation = workLocation;
  return out;
}

export type FilmfareWin = {
  year: number;
  /** Film title (actors) or film for a winning song (singers). */
  film: string;
  /** Song title when this is a playback win. */
  song?: string;
  /** e.g. Best Actress, Best Male Playback Singer */
  category?: string;
};

export type FilmHighlight = {
  year?: number;
  film: string;
  song?: string;
  note?: string;
  thumbnail?: string;
};

export type CompareAwardHighlights = {
  personId: string;
  label: string;
  /** Filmfare wins parsed from Wikipedia awards lists. */
  filmfareWins: FilmfareWin[];
  /** Dominant category label for the Filmfare block header. */
  filmfareCategory?: string;
  /** Other recognition bullets (BFJA, state awards, legacy). */
  otherRecognition: string[];
  /** Poster-ready film cards derived from award wins (+ Wikidata cast fallback). */
  filmHighlights: FilmHighlight[];
  source?: string;
};

function stripWikiTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#91;.*?&#93;/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSongTitle(raw: string): string {
  return raw.replace(/^["“']+|["”']+$/g, "").trim();
}

async function wikiParseSections(
  title: string,
): Promise<Array<{ index: string; line: string }>> {
  try {
    const params = new URLSearchParams({
      action: "parse",
      page: title,
      prop: "sections",
      format: "json",
      origin: "*",
      redirects: "1",
    });
    const res = await fetch(`${WIKIPEDIA_API}?${params}`);
    if (!res.ok) return [];
    const data = await res.json() as {
      error?: unknown;
      parse?: { sections?: Array<{ index: string; line: string }> };
    };
    if (data.error) return [];
    return data.parse?.sections ?? [];
  } catch {
    return [];
  }
}

async function wikiParseSectionHtml(
  title: string,
  section: string,
): Promise<string> {
  try {
    const params = new URLSearchParams({
      action: "parse",
      page: title,
      prop: "text",
      section,
      disableeditsection: "1",
      format: "json",
      origin: "*",
      redirects: "1",
    });
    const res = await fetch(`${WIKIPEDIA_API}?${params}`);
    if (!res.ok) return "";
    const data = await res.json() as {
      error?: unknown;
      parse?: { text?: { "*": string } };
    };
    if (data.error) return "";
    return data.parse?.text?.["*"] ?? "";
  } catch {
    return "";
  }
}

function parseWikiTableRows(tableHtml: string): string[][] {
  const rowHtmls = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const raw: Array<Array<{ text: string; rowspan: number }>> = [];

  for (const row of rowHtmls) {
    const cells = row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) ?? [];
    const parsed: Array<{ text: string; rowspan: number }> = [];
    for (const cell of cells) {
      const rs = cell.match(/rowspan\s*=\s*["']?(\d+)/i);
      parsed.push({
        text: stripWikiTags(cell),
        rowspan: rs ? Number(rs[1]) : 1,
      });
    }
    if (parsed.some((c) => c.text.length > 0)) raw.push(parsed);
  }

  // Expand rowspans into a dense grid
  const grid: string[][] = [];
  const carry: Array<{ text: string; left: number } | null> = [];

  for (const row of raw) {
    const out: string[] = [];
    let ci = 0;
    let col = 0;
    while (ci < row.length || carry.some((c) => c && c.left > 0)) {
      if (carry[col] && carry[col]!.left > 0) {
        out.push(carry[col]!.text);
        carry[col]!.left -= 1;
        if (carry[col]!.left <= 0) carry[col] = null;
        col++;
        continue;
      }
      if (ci >= row.length) break;
      const cell = row[ci]!;
      out.push(cell.text);
      if (cell.rowspan > 1) {
        carry[col] = { text: cell.text, left: cell.rowspan - 1 };
      }
      ci++;
      col++;
    }
    grid.push(out);
  }
  return grid;
}

/** Extract Filmfare wins — singer, actor, and unified Award/Year tables. */
function parseFilmfareWinsFromHtml(html: string): FilmfareWin[] {
  if (!html) return [];
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const wins: FilmfareWin[] = [];

  for (const table of tables) {
    const rows = parseWikiTableRows(table);
    if (rows.length < 2) continue;

    const headerIdx = rows.findIndex(
      (r) =>
        r.some((c) => /^year$/i.test(c.trim())) &&
        r.some((c) => /film|song|nominated work|^work$/i.test(c)),
    );
    if (headerIdx < 0) continue;
    const header = rows[headerIdx]!.map((h) => h.toLowerCase());
    const yearIdx = header.findIndex((h) => /year/.test(h));
    const songIdx = header.findIndex((h) => /song/.test(h));
    const filmIdx = header.findIndex(
      (h) => /^film$|film\b|nominated work|^work$/.test(h) && !/filmfare/.test(h),
    );
    const categoryIdx = header.findIndex((h) => /category/.test(h));
    const awardIdx = header.findIndex((h) => /^award$/.test(h.trim()));
    const resultIdx = header.findIndex((h) => /result/.test(h));
    if (yearIdx < 0) continue;

    const isUnifiedAwardTable = awardIdx >= 0;
    let currentCategory = "";
    let carriedYear: number | undefined;
    let carriedAward = "";
    let added = 0;

    for (const row of rows.slice(headerIdx + 1)) {
      if (
        !isUnifiedAwardTable &&
        (row.length === 1 ||
          (row.length <= 2 && !/\b(19|20)\d{2}\b/.test(row.join(" "))))
      ) {
        const banner = row.find((c) =>
          /best |award|critics|villain|playback|supporting/i.test(c),
        );
        if (banner && !/^(won|nominated)$/i.test(banner)) {
          currentCategory = banner.replace(/\[\d+\]/g, "").trim();
          continue;
        }
      }

      const cells = row.map((c) => c.trim()).filter(Boolean);

      if (isUnifiedAwardTable) {
        const awardCell =
          (awardIdx < row.length ? row[awardIdx] : undefined)?.trim() || carriedAward;
        if (awardCell) carriedAward = awardCell;
        if (!/filmfare/i.test(carriedAward)) continue;

        const yearCell = yearIdx < row.length ? row[yearIdx] ?? "" : "";
        const ym = yearCell.match(/\b(19\d{2}|20\d{2})\b/);
        let year = ym ? Number(ym[1]) : carriedYear;
        if (ym) carriedYear = year;
        if (year == null) continue;

        const resCell = resultIdx >= 0 && resultIdx < row.length ? row[resultIdx] ?? "" : "";
        if (resCell && !/won/i.test(resCell)) continue;
        if (!resCell && !cells.some((c) => /^won$/i.test(c))) continue;

        const work =
          filmIdx >= 0 && filmIdx < row.length
            ? (row[filmIdx] ?? "").trim()
            : "";
        const category =
          (categoryIdx >= 0 && categoryIdx < row.length
            ? row[categoryIdx]
            : undefined)?.trim() || undefined;
        if (!work || /^nominated work$/i.test(work)) continue;

        wins.push({ year, film: work, category });
        added++;
        continue;
      }

      let year: number | undefined;
      let result = "";
      for (const c of cells) {
        const ym = c.match(/^(19\d{2}|20\d{2})$/);
        if (ym) {
          year = Number(ym[1]);
          continue;
        }
        if (/^(won|nominated)$/i.test(c)) {
          result = c;
        }
      }
      if (year != null) carriedYear = year;
      else year = carriedYear;
      if (year == null) continue;
      if (resultIdx >= 0 || cells.some((c) => /^(won|nominated)$/i.test(c))) {
        if (!/won/i.test(result)) continue;
      }

      let song = "";
      let film = "";
      let category = currentCategory;
      if (songIdx >= 0 && filmIdx >= 0 && row.length > Math.max(songIdx, filmIdx)) {
        song = cleanSongTitle(row[songIdx] ?? "");
        film = (row[filmIdx] ?? "").trim();
      } else {
        const skip = new Set(
          cells.filter(
            (c) =>
              /^(19\d{2}|20\d{2})$/.test(c) ||
              /^(won|nominated)$/i.test(c) ||
              /^\[\d+\]$/.test(c),
          ),
        );
        const rest = cells.filter((c) => !skip.has(c));
        if (!rest.length) continue;
        if (rest.length === 1) film = rest[0]!;
        else {
          const catHit = rest.find((c) =>
            /best |critics|villain|playback|supporting/i.test(c),
          );
          if (catHit) {
            category = catHit;
            film = rest.find((c) => c !== catHit) ?? "";
          } else film = rest[rest.length - 1]!;
        }
      }
      if (!film || /^film$/i.test(film) || /^(won|nominated)$/i.test(film)) continue;
      if (/^best |critics|villain|playback/i.test(film) && !song) {
        category = film;
        continue;
      }
      wins.push({
        year,
        film,
        song: song || undefined,
        category: category || undefined,
      });
      added++;
    }

    if (resultIdx < 0 && songIdx >= 0 && added > 0 && !isUnifiedAwardTable) break;
  }

  const seen = new Set<string>();
  return wins.filter((w) => {
    const k = `${w.year}|${w.song ?? ""}|${w.film}|${w.category ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function dominantFilmfareCategory(wins: FilmfareWin[]): string | undefined {
  if (!wins.length) return undefined;
  const counts = new Map<string, number>();
  for (const w of wins) {
    const c = w.category?.trim();
    if (!c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  if (counts.size) {
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  }
  if (wins.some((w) => w.song)) return "Best Male Playback Singer";
  return "Filmfare Awards";
}

function parseOtherRecognitionFromHtml(html: string, sectionTitle: string): string[] {
  if (!html) return [];
  const out: string[] = [];
  const lis = html.match(/<li[\s\S]*?<\/li>/gi) ?? [];
  for (const li of lis) {
    const t = stripWikiTags(li);
    if (!isCleanRecognitionLine(t)) continue;
    out.push(t);
  }
  if (!out.length) {
    const text = stripWikiTags(html);
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 28 && s.length < 220);
    for (const s of sentences.slice(0, 4)) {
      if (/award|honou|institut|recogn/i.test(s) && isCleanRecognitionLine(s)) {
        out.push(s.replace(/\s+/g, " ").trim());
      }
    }
  }
  return out.slice(0, 8).map((t) =>
    /bfja|bengal film/i.test(sectionTitle) && !/bfja|bengal/i.test(t)
      ? `BFJA — ${t}`
      : t,
  );
}

function isCleanRecognitionLine(t: string): boolean {
  if (!t || t.length < 12 || t.length > 160) return false;
  if (/^[\^†*#]|^\./.test(t)) return false;
  if (/^https?:|^Retrieved|^Archived|^ISBN|^Jump to|^cite |bfjaawards\.com|wikipedia\.org/i.test(t)) {
    return false;
  }
  if (/cite\.citation|mw-parser-output|tooltip-dotted/i.test(t)) return false;
  if (/archived from the original/i.test(t)) return false;
  // Table chrome / header leftovers from awards-list pages
  if (/^(year|category|film|result|ref\.?s?)\b/i.test(t)) return false;
  if (/\bYear\s+Category\s+Film\s+Result\b/i.test(t)) return false;
  if (/^\s*Ref\.?\s*$/i.test(t)) return false;
  return true;
}

async function resolveAwardsListPage(personLabel: string): Promise<string | undefined> {
  const candidates = [
    `List of awards and nominations received by ${personLabel}`,
    `${personLabel} awards and nominations`,
  ];
  for (const title of candidates) {
    const sections = await wikiParseSections(title);
    if (sections.some((s) => /filmfare|award|honou/i.test(s.line))) return title;
  }
  // Search fallback
  try {
    const params = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: `List of awards and nominations received by ${personLabel}`,
      srlimit: "5",
      format: "json",
      origin: "*",
    });
    const res = await fetch(`${WIKIPEDIA_API}?${params}`);
    if (!res.ok) return undefined;
    const data = await res.json() as {
      query?: { search?: Array<{ title: string }> };
    };
    const hit = (data.query?.search ?? []).find((s) =>
      /list of awards/i.test(s.title) &&
      new RegExp(personLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(s.title),
    );
    return hit?.title;
  } catch {
    return undefined;
  }
}

/**
 * Rich awards + film highlights for compare — Wikipedia awards-list pages
 * (Filmfare year/song/film or year/film) when Wikidata P166 is sparse.
 */
export async function fetchCompareAwardHighlights(
  personId: string,
  personLabel: string,
  opts?: { castFilms?: FilmographyEntry[] },
): Promise<CompareAwardHighlights> {
  const empty: CompareAwardHighlights = {
    personId,
    label: personLabel,
    filmfareWins: [],
    otherRecognition: [],
    filmHighlights: [],
  };
  if (!personLabel?.trim()) return empty;

  const page = await resolveAwardsListPage(personLabel.trim());
  let filmfareWins: FilmfareWin[] = [];
  const otherRecognition: string[] = [];
  let source: string | undefined;

  if (page) {
    source = page;
    const sections = await wikiParseSections(page);
    const filmfareSec = sections.find((s) => /filmfare/i.test(s.line));
    if (filmfareSec) {
      const html = await wikiParseSectionHtml(page, filmfareSec.index);
      filmfareWins = parseFilmfareWinsFromHtml(html);
    } else {
      // Kajol-style: Filmfare rows inside a unified awards table on the page
      for (const sec of sections) {
        if (/reference|external|see also|note|early|personal/i.test(sec.line)) continue;
        if (!/award|nomination|honou/i.test(sec.line)) continue;
        const html = await wikiParseSectionHtml(page, sec.index);
        filmfareWins = parseFilmfareWinsFromHtml(html);
        if (filmfareWins.length) break;
      }
      if (!filmfareWins.length) {
        // Last resort: full page parse
        try {
          const params = new URLSearchParams({
            action: "parse",
            page,
            prop: "text",
            disableeditsection: "1",
            format: "json",
            origin: "*",
            redirects: "1",
          });
          const res = await fetch(`${WIKIPEDIA_API}?${params}`);
          if (res.ok) {
            const data = await res.json() as {
              parse?: { text?: { "*": string } };
            };
            const full = data.parse?.text?.["*"] ?? "";
            if (full) filmfareWins = parseFilmfareWinsFromHtml(full);
          }
        } catch {
          /* ignore */
        }
      }
    }
    for (const sec of sections) {
      if (!/honou|bfja|bengal film|national film|state|legacy/i.test(sec.line)) continue;
      if (/reference|external|see also|note/i.test(sec.line)) continue;
      const html = await wikiParseSectionHtml(page, sec.index);
      otherRecognition.push(...parseOtherRecognitionFromHtml(html, sec.line));
    }
  }

  const filmfareCategory = dominantFilmfareCategory(filmfareWins);

  // Unique film cards from Filmfare wins
  const filmHighlights: FilmHighlight[] = [];
  const seenFilms = new Set<string>();
  for (const w of filmfareWins) {
    const key = w.film.toLowerCase();
    if (seenFilms.has(key)) continue;
    seenFilms.add(key);
    filmHighlights.push({
      year: w.year,
      film: w.film,
      song: w.song,
      note: w.category ? `Filmfare · ${w.category}` : "Filmfare Winner",
    });
  }

  // Always merge cast/notable highlights for actors (Kajol etc.)
  if (opts?.castFilms?.length) {
    for (const f of opts.castFilms) {
      const key = f.title.toLowerCase();
      if (seenFilms.has(key)) continue;
      seenFilms.add(key);
      filmHighlights.push({
        year: f.year,
        film: f.title,
        note: f.role === "Notable" ? "Notable work" : "Screen credit",
        thumbnail: f.thumbnail,
      });
      if (filmHighlights.length >= 8) break;
    }
  }

  const needThumbs = filmHighlights.filter((f) => !f.thumbnail).slice(0, 10);
  await Promise.all(
    needThumbs.map(async (f) => {
      const thumb = await fetchWikipediaRestThumb(f.film);
      if (thumb) f.thumbnail = thumb;
    }),
  );

  return {
    personId,
    label: personLabel,
    filmfareWins,
    filmfareCategory,
    otherRecognition: [...new Set(otherRecognition)].filter(isCleanRecognitionLine).slice(0, 8),
    filmHighlights: filmHighlights.slice(0, 8),
    source,
  };
}

async function fetchWikipediaRestThumb(title: string): Promise<string | undefined> {
  if (!title?.trim()) return undefined;
  try {
    const res = await fetch(
      `${WIKIPEDIA_REST}/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    );
    if (!res.ok) return undefined;
    const data = await res.json() as {
      thumbnail?: { source?: string };
      originalimage?: { source?: string };
    };
    return data.originalimage?.source || data.thumbnail?.source;
  } catch {
    return undefined;
  }
}

export type ComparePeerBundle = {
  peers: SearchResult[];
  /** Human label for the rail, e.g. "Indian film actors" */
  categoryLabel: string;
  kind: "actor" | "singer" | "musician" | "company" | "place" | "work" | "person" | "generic";
};

type SubjectPeerMeta = {
  type: EntityType;
  occupationIds: string[];
  citizenshipIds: string[];
  industryIds: string[];
  instanceIds: string[];
  countryIds: string[];
  genreIds: string[];
  description?: string;
  label?: string;
};

async function loadSubjectPeerMeta(entityId: string): Promise<SubjectPeerMeta> {
  const empty: SubjectPeerMeta = {
    type: "unknown",
    occupationIds: [],
    citizenshipIds: [],
    industryIds: [],
    instanceIds: [],
    countryIds: [],
    genreIds: [],
  };
  try {
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: entityId,
      props: "claims|descriptions|labels",
      languages: "en",
      format: "json",
      origin: "*",
    });
    const res = await fetch(`${WIKIDATA_API}?${params}`);
    if (!res.ok) return empty;
    const data = await res.json() as {
      entities?: Record<
        string,
        {
          claims?: Record<string, ClaimSnakValue[] | undefined>;
          descriptions?: { en?: { value?: string } };
          labels?: { en?: { value?: string } };
        }
      >;
    };
    const ent = data.entities?.[entityId];
    if (!ent) return empty;
    const claims = ent.claims ?? {};
    const idsOf = (pid: string) => {
      const out: string[] = [];
      for (const c of claims[pid] ?? []) {
        const v = c.mainsnak?.datavalue?.value;
        if (typeof v === "object" && v && "id" in v && typeof (v as { id: string }).id === "string") {
          out.push((v as { id: string }).id);
        }
      }
      return out;
    };
    const instanceIds = idsOf("P31");
    const type = guessTypeFromP31(instanceIds) ?? guessTypeFromDescription(ent.descriptions?.en?.value);
    return {
      type,
      occupationIds: idsOf("P106"),
      citizenshipIds: idsOf("P27"),
      industryIds: idsOf("P452"),
      instanceIds,
      countryIds: idsOf("P17"),
      genreIds: idsOf("P136"),
      description: ent.descriptions?.en?.value,
      label: ent.labels?.en?.value,
    };
  } catch {
    return empty;
  }
}

function guessTypeFromP31(p31: string[]): EntityType | undefined {
  for (const id of p31) {
    if (TYPE_QID_MAP[id]) return TYPE_QID_MAP[id];
  }
  // Common org / company classes
  if (p31.some((id) => ["Q4830453", "Q783794", "Q6881511", "Q891723", "Q43229"].includes(id))) {
    return "organization";
  }
  return undefined;
}

function detectCompareKind(meta: SubjectPeerMeta): ComparePeerBundle["kind"] {
  const occ = new Set(meta.occupationIds);
  const hit = (set: Set<string>) => meta.occupationIds.some((id) => set.has(id));
  if (meta.type === "organization") return "company";
  if (meta.type === "place") return "place";
  if (meta.type === "work") return "work";
  if (hit(OCC_SINGER)) return "singer";
  if (hit(OCC_COMPOSER) || occ.has("Q855091") || occ.has("Q639669")) return "musician";
  if (hit(OCC_ACTOR)) return "actor";
  if (meta.type === "person") return "person";
  return "generic";
}

function categoryLabelFor(kind: ComparePeerBundle["kind"], meta: SubjectPeerMeta): string {
  const citHint = /india|indian|bollywood|hindi/i.test(meta.description ?? "")
    ? "Indian "
    : "";
  switch (kind) {
    case "actor":
      return `${citHint}film actors & actresses`.replace(/^./, (c) => c.toUpperCase());
    case "singer":
      return `${citHint}singers & playback artists`.replace(/^./, (c) => c.toUpperCase());
    case "musician":
      return `${citHint}musicians & composers`.replace(/^./, (c) => c.toUpperCase());
    case "company":
      return "Similar companies & organizations";
    case "place":
      return "Related places";
    case "work":
      return "Similar works";
    case "person":
      return "People in the same field";
    default:
      return "Same category";
  }
}

function primaryOccupationIds(meta: SubjectPeerMeta, kind: ComparePeerBundle["kind"]): string[] {
  const occ = meta.occupationIds;
  if (kind === "actor") {
    const preferred = occ.filter((id) => OCC_ACTOR.has(id));
    return preferred.length ? preferred.slice(0, 4) : ["Q33999", "Q10800557", "Q211236"];
  }
  if (kind === "singer") {
    const preferred = occ.filter((id) => OCC_SINGER.has(id));
    return preferred.length ? preferred.slice(0, 4) : ["Q177220", "Q488205", "Q855091"];
  }
  if (kind === "musician") {
    const preferred = occ.filter((id) => OCC_COMPOSER.has(id) || OCC_SINGER.has(id));
    return preferred.length ? preferred.slice(0, 4) : ["Q36834", "Q639669"];
  }
  return occ.slice(0, 4);
}

function searchQueriesForKind(kind: ComparePeerBundle["kind"], meta: SubjectPeerMeta): string[] {
  const desc = (meta.description ?? "").toLowerCase();
  const queries: string[] = [];
  if (kind === "actor") {
    if (/india|bollywood|hindi|bengali|tamil|telugu/.test(desc)) {
      queries.push(
        "Kajol",
        "Aishwarya Rai",
        "Preity Zinta",
        "Madhuri Dixit",
        "Kareena Kapoor",
        "Deepika Padukone",
        "Priyanka Chopra",
        "Vidya Balan",
        "Bollywood actress",
      );
    } else if (/bangladesh|bengali|dhallywood|bangladeshi/.test(desc)) {
      queries.push("Bangladeshi actress", "Bengali film actor", "Shabnur", "Purnima");
    } else if (/hollywood|hollywoodwood|american film/.test(desc)) {
      queries.push("Hollywood actress", "American film actress", "film actor");
    } else {
      queries.push("film actress", "film actor", meta.description?.split(",")[0] ?? "actor");
    }
  } else if (kind === "singer") {
    if (/india|bollywood|playback|hindi|bengali/.test(desc)) {
      queries.push(
        "Indian playback singer",
        "Alka Yagnik",
        "Kavita Krishnamurthy",
        "Sunidhi Chauhan",
        "Shreya Ghoshal",
        "Lata Mangeshkar",
      );
    } else {
      queries.push("singer", "playback singer");
    }
  } else if (kind === "musician") {
    queries.push(meta.description?.split(",")[0] ?? "composer", "music composer");
  } else if (kind === "company") {
    const industryHint = meta.description?.split(/[,(]/)[0]?.trim();
    if (industryHint) queries.push(industryHint);
    queries.push("company", "multinational corporation");
  } else if (kind === "place") {
    queries.push(meta.description?.split(/[,(]/)[0]?.trim() ?? "city");
  } else if (kind === "work") {
    queries.push(meta.description?.split(/[,(]/)[0]?.trim() ?? "film");
  } else {
    const seed = meta.description?.split(/[,(]/)[0]?.trim();
    if (seed) queries.push(seed);
  }
  return [...new Set(queries.filter((q) => q && q.length >= 3))].slice(0, 8);
}

async function sparqlPersonPeers(
  subjectId: string,
  occupationIds: string[],
  citizenshipIds: string[],
  limit: number,
): Promise<SearchResult[]> {
  if (!occupationIds.length) return [];
  const occValues = occupationIds.map((id) => `wd:${id}`).join(" ");
  const citFilter =
    citizenshipIds.length > 0
      ? `
      OPTIONAL {
        ?person wdt:P27 ?cit .
        VALUES ?wantCit { ${citizenshipIds.map((id) => `wd:${id}`).join(" ")} }
        BIND(IF(?cit = ?wantCit, 1, 0) AS ?sameCit)
      }`
      : "BIND(0 AS ?sameCit)";

  const sparql = `
    SELECT DISTINCT ?person ?personLabel ?personDescription ?image ?sameCit ?hasAward WHERE {
      VALUES ?occ { ${occValues} }
      ?person wdt:P106 ?occ ;
              wdt:P31 wd:Q5 ;
              wdt:P18 ?image .
      ?article schema:about ?person ;
               schema:isPartOf <https://en.wikipedia.org/> .
      FILTER(?person != wd:${subjectId})
      ${citFilter}
      OPTIONAL { ?person wdt:P166 ?aw . BIND(1 AS ?hasAward) }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT ${Math.min(Math.max(limit * 3, 30), 80)}
  `;
  const rows = await runSparql(sparql);
  const scored: Array<SearchResult & { score: number }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const id = row.person?.value?.split("/").pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const sameCit = row.sameCit?.value === "1" ? 1 : 0;
    const hasAward = row.hasAward?.value === "1" ? 1 : 0;
    const desc = row.personDescription?.value ?? "";
    // Prefer notable-sounding descriptions (actress/actor/singer…)
    const notableDesc = /actress|actor|singer|composer|director|musician/i.test(desc) ? 1 : 0;
    scored.push({
      id,
      label: row.personLabel?.value ?? id,
      description: desc || undefined,
      thumbnail: commonsFilePathToThumb(row.image?.value, 120),
      type: "person",
      score: sameCit * 50 + hasAward * 20 + notableDesc * 15 + (row.image?.value ? 10 : 0),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ score: _s, ...r }) => r);
}

async function sparqlOrgPeers(subjectId: string, meta: SubjectPeerMeta, limit: number): Promise<SearchResult[]> {
  const industry = meta.industryIds.slice(0, 3);
  const instances = meta.instanceIds.slice(0, 4);
  const country = meta.countryIds.slice(0, 2);
  if (!industry.length && !instances.length) return [];

  const matchBlock = industry.length
    ? `VALUES ?ind { ${industry.map((id) => `wd:${id}`).join(" ")} }
       ?org wdt:P452 ?ind .`
    : `VALUES ?cls { ${instances.map((id) => `wd:${id}`).join(" ")} }
       ?org wdt:P31 ?cls .`;

  const countryBlock = country.length
    ? `OPTIONAL {
         ?org wdt:P17 ?co .
         VALUES ?wantCo { ${country.map((id) => `wd:${id}`).join(" ")} }
         BIND(IF(?co = ?wantCo, 1, 0) AS ?sameCountry)
       }`
    : "BIND(0 AS ?sameCountry)";

  const sparql = `
    SELECT DISTINCT ?org ?orgLabel ?orgDescription ?image ?sameCountry WHERE {
      ${matchBlock}
      OPTIONAL { ?org wdt:P154|wdt:P18 ?image . }
      ?article schema:about ?org ; schema:isPartOf <https://en.wikipedia.org/> .
      FILTER(?org != wd:${subjectId})
      ${countryBlock}
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT ${Math.min(limit * 3, 60)}
  `;
  try {
    const rows = await runSparql(sparql);
    const scored: Array<SearchResult & { score: number }> = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const id = row.org?.value?.split("/").pop();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      scored.push({
        id,
        label: row.orgLabel?.value ?? id,
        description: row.orgDescription?.value,
        thumbnail: commonsFilePathToThumb(row.image?.value, 120),
        type: "organization",
        score: (row.sameCountry?.value === "1" ? 40 : 0) + (row.image?.value ? 10 : 0),
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ score: _s, ...r }) => r);
  } catch {
    return [];
  }
}

/**
 * Category-aware compare suggestions:
 * actors → film peers (Kajol for Rani), singers → singers, companies → companies, etc.
 */
export async function fetchComparePeers(
  entityId: string,
  limit = 22,
): Promise<ComparePeerBundle> {
  const meta = await loadSubjectPeerMeta(entityId);
  const kind = detectCompareKind(meta);
  const categoryLabel = categoryLabelFor(kind, meta);

  let peers: SearchResult[] = [];
  try {
    if (kind === "company") {
      peers = await sparqlOrgPeers(entityId, meta, limit);
    } else if (kind === "actor" || kind === "singer" || kind === "musician") {
      const occIds = primaryOccupationIds(meta, kind);
      peers = await sparqlPersonPeers(
        entityId,
        occIds,
        meta.citizenshipIds,
        limit,
      );
    } else if (kind === "person") {
      peers = await sparqlPersonPeers(
        entityId,
        meta.occupationIds.slice(0, 5),
        meta.citizenshipIds,
        limit,
      );
    }
  } catch {
    peers = [];
  }

  // Search hits first — famous names (Kajol, etc.) beat obscure SPARQL peers
  {
    const queries = searchQueriesForKind(kind, meta);
    const seen = new Set<string>([entityId]);
    const fromSearch: SearchResult[] = [];
    const searchHits = await Promise.all(
      queries.map((q) => searchEntities(q, 12).catch(() => [] as SearchResult[])),
    );
    for (const hits of searchHits) {
      for (const h of hits) {
        if (seen.has(h.id)) continue;
        if (kind === "company" && h.type !== "organization" && h.type !== "unknown") continue;
        if (
          (kind === "actor" || kind === "singer" || kind === "musician" || kind === "person") &&
          h.type !== "person" &&
          h.type !== "unknown"
        ) {
          continue;
        }
        seen.add(h.id);
        fromSearch.push(h);
      }
    }
    const fromSparql: SearchResult[] = [];
    for (const p of peers) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      fromSparql.push(p);
    }
    peers = [...fromSearch, ...fromSparql];
  }

  // Backfill thumbs
  const needThumbs = peers.filter((p) => !p.thumbnail).map((p) => p.id);
  if (needThumbs.length) {
    const thumbs = await fetchThumbnails(needThumbs.slice(0, 50), undefined, 120);
    for (const p of peers) {
      if (!p.thumbnail && thumbs[p.id]) p.thumbnail = thumbs[p.id];
    }
  }

  return {
    peers: peers.slice(0, limit),
    categoryLabel,
    kind,
  };
}

/** @deprecated use fetchComparePeers */
export async function fetchSameCategoryPeers(
  personId: string,
  limit = 20,
): Promise<SearchResult[]> {
  const bundle = await fetchComparePeers(personId, limit);
  return bundle.peers;
}

/** Batch Wikipedia thumbs for Wikidata entities (enwiki sitelinks → pageimages / REST). */
async function fetchWikipediaThumbsForEntities(
  ids: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const unique = [...new Set(ids.filter((id) => /^Q\d+$/.test(id)))];
  if (!unique.length) return out;

  const clean = (src?: string) => {
    if (!src) return undefined;
    try {
      const u = new URL(src);
      u.searchParams.delete("utm_source");
      u.searchParams.delete("utm_campaign");
      u.searchParams.delete("utm_content");
      return u.toString();
    } catch {
      return src;
    }
  };

  try {
    for (let i = 0; i < unique.length; i += 40) {
      const chunk = unique.slice(i, i + 40);
      const params = new URLSearchParams({
        action: "wbgetentities",
        ids: chunk.join("|"),
        props: "sitelinks",
        sitefilter: "enwiki",
        format: "json",
        origin: "*",
      });
      const res = await fetch(`${WIKIDATA_API}?${params}`);
      if (!res.ok) continue;
      const data = await res.json() as {
        entities?: Record<string, { sitelinks?: { enwiki?: { title?: string } } }>;
      };
      const titleToQid = new Map<string, string>();
      const qidToTitle = new Map<string, string>();
      const titles: string[] = [];
      for (const [qid, ent] of Object.entries(data.entities ?? {})) {
        const title = ent.sitelinks?.enwiki?.title;
        if (!title) continue;
        titles.push(title);
        qidToTitle.set(qid, title);
        titleToQid.set(title.replace(/ /g, "_"), qid);
        titleToQid.set(title, qid);
      }
      if (!titles.length) continue;

      // pageimages — often empty for fair-use film posters
      for (let j = 0; j < titles.length; j += 20) {
        const titleChunk = titles.slice(j, j + 20);
        const wp = new URLSearchParams({
          action: "query",
          format: "json",
          origin: "*",
          prop: "pageimages",
          piprop: "thumbnail",
          pithumbsize: "360",
          titles: titleChunk.join("|"),
        });
        const wr = await fetch(`${WIKIPEDIA_API}?${wp}`);
        if (!wr.ok) continue;
        const wdata = await wr.json() as {
          query?: {
            pages?: Record<
              string,
              { title?: string; thumbnail?: { source?: string } }
            >;
          };
        };
        for (const page of Object.values(wdata.query?.pages ?? {})) {
          const src = clean(page.thumbnail?.source);
          const title = page.title;
          if (!src || !title) continue;
          const qid = titleToQid.get(title) ?? titleToQid.get(title.replace(/ /g, "_"));
          if (qid) out[qid] = src;
        }
      }

      // REST summary — reliable for Bollywood / fair-use posters; use sitelink titles
      const missing = [...qidToTitle.entries()].filter(([qid]) => !out[qid]);
      for (let k = 0; k < missing.length; k += 12) {
        const batch = missing.slice(k, k + 12);
        await Promise.all(
          batch.map(async ([qid, title]) => {
            const src = clean(await fetchWikipediaRestThumb(title));
            if (src) out[qid] = src;
          }),
        );
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

function roleLabelForProp(pid: string): string | undefined {
  return creativeRoleLabel(pid);
}

/** Resolve MusicBrainz release-group MBIDs → Wikidata QIDs via P436. */
async function resolveReleaseGroupsToWikidata(
  mbids: string[],
): Promise<Record<string, { qid: string; label: string }>> {
  if (!mbids.length) return {};
  // Chunk to keep VALUES clauses modest
  const out: Record<string, { qid: string; label: string }> = {};
  for (let i = 0; i < mbids.length; i += 40) {
    const chunk = mbids.slice(i, i + 40);
    const values = chunk.map((m) => `"${m}"`).join(" ");
    const sparql = `
      SELECT ?mbid ?work ?workLabel WHERE {
        VALUES ?mbid { ${values} }
        ?work wdt:P436 ?mbid .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }
    `;
    const rows = await runSparql(sparql);
    for (const row of rows) {
      const mbid = row.mbid?.value;
      const qid = row.work?.value?.split("/").pop();
      if (!mbid || !qid) continue;
      out[mbid] = { qid, label: row.workLabel?.value ?? qid };
    }
  }
  return out;
}

/**
 * Albums / singles from MusicBrainz when the person has P434.
 * Fills gaps Wikidata often has for playback singers (Kumar Sanu, etc.).
 */
export async function fetchMusicBrainzAlbums(
  musicBrainzArtistId: string,
  opts?: { existingIds?: Set<string>; limit?: number; offset?: number },
): Promise<CreativeRoleHit[]> {
  const limit = opts?.limit ?? 40;
  const offset = opts?.offset ?? 0;
  const existing = opts?.existingIds ?? new Set<string>();
  try {
    const url =
      `${MUSICBRAINZ_API}/release-group?artist=${encodeURIComponent(musicBrainzArtistId)}` +
      `&limit=${Math.min(limit, 100)}&offset=${offset}&fmt=json`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": MB_USER_AGENT },
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      "release-groups"?: Array<{
        id: string;
        title: string;
        "primary-type"?: string | null;
      }>;
    };
    const groups = (data["release-groups"] ?? []).filter((g) => {
      const t = (g["primary-type"] ?? "").toLowerCase();
      return !t || t === "album" || t === "ep" || t === "single";
    });
    if (!groups.length) return [];

    const resolved = await resolveReleaseGroupsToWikidata(groups.map((g) => g.id));
    const out: CreativeRoleHit[] = [];
    const seen = new Set<string>();

    for (const g of groups) {
      const wd = resolved[g.id];
      const id = wd?.qid ?? `mb:rg:${g.id}`;
      if (existing.has(id) || seen.has(id)) continue;
      seen.add(id);
      out.push({
        qid: id,
        pid: "CR_ALBUM",
        label: "Album",
        workLabel: wd?.label ?? g.title,
        type: "work",
        externalUrl: `https://musicbrainz.org/release-group/${g.id}`,
      });
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

function musicBrainzArtistIdFromClaims(
  claims: Record<string, ClaimSnakValue[] | undefined> | undefined,
): string | undefined {
  const list = claims?.["P434"];
  const val = list?.[0]?.mainsnak?.datavalue?.value;
  return typeof val === "string" ? val : undefined;
}

/** Fetch more works for one creative role (hub expand). */
export async function fetchCreativeRoleExpansion(
  personId: string,
  propertyId: string,
  existingIds: Set<string>,
): Promise<GraphData> {
  const roles = await fetchCreativeRoles(personId, {
    propertyId,
    existingIds,
    limitPerRole: 30,
  });

  let extra: CreativeRoleHit[] = [];
  if (propertyId === "CR_ALBUM") {
    try {
      const params = new URLSearchParams({
        action: "wbgetentities",
        ids: personId,
        languages: "en",
        format: "json",
        origin: "*",
        props: "claims",
      });
      const res = await fetch(`${WIKIDATA_API}?${params}`);
      if (res.ok) {
        const data = await res.json() as { entities?: Record<string, WikidataEntity> };
        const mbid = musicBrainzArtistIdFromClaims(
          data.entities?.[personId]?.claims as Record<string, ClaimSnakValue[] | undefined>,
        );
        if (mbid) {
          const have = new Set([...existingIds, ...roles.map((r) => r.qid)]);
          extra = await fetchMusicBrainzAlbums(mbid, {
            existingIds: have,
            limit: 30,
            offset: Math.max(0, existingIds.size),
          });
        }
      }
    } catch {
      /* ignore MB failures */
    }
  }

  const all = [...roles, ...extra];
  const nodes: import("./types.ts").GraphNode[] = [];
  const edges: import("./types.ts").GraphEdge[] = [];
  for (const r of all) {
    nodes.push({
      id: r.qid,
      label: r.workLabel,
      type: r.type,
      kind: "entity",
      externalUrl: r.externalUrl,
      description: r.externalUrl ? "MusicBrainz release group" : undefined,
    });
    edges.push({
      id: `${personId}-${r.pid}-${r.qid}`,
      source: personId,
      target: r.qid,
      label: r.label,
      propertyId: r.pid,
    });
  }
  return { nodes, edges };
}

export type FetchGraphOptions = {
  /**
   * Reverse filmography SPARQL + MusicBrainz. Default false — load in a
   * deferred query so claim-based graph paints in ~1 Wikidata RTT.
   */
  includeCreativeRoles?: boolean;
};

export async function fetchGraphData(
  rootId: string,
  depth = 1,
  existingIds: Set<string> = new Set(),
  opts: FetchGraphOptions = {},
): Promise<GraphData> {
  const visited = new Set([...existingIds, rootId]);
  const nodes = new Map<string, import("./types.ts").GraphNode>();
  const edges: import("./types.ts").GraphEdge[] = [];
  const includeCreative = opts.includeCreativeRoles === true;

  // Level-by-level BFS (batched wbgetentities). Creative SPARQL is opt-in.
  let frontier = [rootId];
  for (let remaining = depth; frontier.length > 0 && remaining >= 0; remaining--) {
    const qids = frontier.filter((id) => /^Q\d+$/i.test(id));
    const entities = qids.length ? await fetchWikidataEntitiesBatch(qids) : {};
    const nextFrontier: string[] = [];

    for (const id of frontier) {
      if (!/^Q\d+$/i.test(id)) continue;
      const entity = entities[id];
      if (!entity) continue;

      const label = pickLabel(entity.labels) ?? id;
      const desc = pickLabel(entity.descriptions) ?? undefined;
      const type = typeFromEntityClaims(entity);
      if (!nodes.has(id)) {
        nodes.set(id, { id, label, description: desc, type, kind: "entity" });
      } else {
        const n = nodes.get(id)!;
        n.label = label;
        if (desc) n.description = desc;
        if (type !== "unknown") n.type = type;
      }

      if (remaining === 0) continue;

      const neighbors: GraphNeighbor[] = graphClaimNeighbors(entity);

      if (includeCreative && id === rootId && type === "person") {
        const already = new Set([...visited, ...nodes.keys()]);
        const occupationIds = occupationIdsFromClaims(
          entity.claims as Record<string, ClaimSnakValue[] | undefined>,
        );
        const roles = await fetchCreativeRoles(id, { existingIds: already, occupationIds });
        const mbid = musicBrainzArtistIdFromClaims(
          entity.claims as Record<string, ClaimSnakValue[] | undefined>,
        );
        const wantMb =
          Boolean(mbid) &&
          (occupationIds.length === 0 ||
            occupationIds.some((oid) => OCC_SINGER.has(oid) || OCC_COMPOSER.has(oid)));
        const mbAlbums =
          wantMb && mbid
            ? await fetchMusicBrainzAlbums(mbid, {
                existingIds: new Set([...already, ...roles.map((r) => r.qid)]),
                limit: 24,
              })
            : [];
        for (const r of [...roles, ...mbAlbums]) {
          neighbors.push({ qid: r.qid, pid: r.pid, edgeLabel: r.label });
          if (!nodes.has(r.qid)) {
            nodes.set(r.qid, {
              id: r.qid,
              label: r.workLabel,
              type: r.type,
              kind: "entity",
              externalUrl: r.externalUrl,
              description: r.externalUrl ? "MusicBrainz release group" : undefined,
            });
          }
        }
      }

      // Resolve award + film labels in one batch (no extra BFS hop)
      const awardMetaIds = [
        ...new Set(
          neighbors
            .filter((n) => n.pid === "P166" && n.forWorkQid)
            .flatMap((n) => [n.qid, n.forWorkQid!]),
        ),
      ];
      const awardLabels = awardMetaIds.length ? await resolveLabels(awardMetaIds) : {};

      for (const { qid, pid, edgeLabel, forWorkQid } of neighbors) {
        if (pid === "P166" && forWorkQid) {
          const leafId = `awd:${qid}:${forWorkQid}`;
          const edgeId = `${id}-P166-${leafId}`;
          const awardName = awardLabels[qid] ?? qid;
          const workName = awardLabels[forWorkQid] ?? forWorkQid;
          nodes.set(leafId, {
            id: leafId,
            label: awardName,
            description: `for ${workName}`,
            type: "concept",
            kind: "entity",
          });
          if (!edges.some((e) => e.id === edgeId)) {
            edges.push({
              id: edgeId,
              source: id,
              target: leafId,
              label: edgeLabel ?? GRAPH_PROP_LABELS.P166 ?? "Award received",
              propertyId: "P166",
            });
          }
          continue;
        }

        if (!nodes.has(qid)) {
          nodes.set(qid, {
            id: qid,
            label: qid,
            type: "unknown",
            kind: "entity",
          });
        }
        const edgeId = `${id}-${pid}-${qid}`;
        if (!edges.some((e) => e.id === edgeId)) {
          edges.push({
            id: edgeId,
            source: id,
            target: qid,
            label: edgeLabel ?? roleLabelForProp(pid) ?? GRAPH_PROP_LABELS[pid] ?? pid,
            propertyId: pid,
          });
        }
        if (/^Q\d+$/i.test(qid) && !visited.has(qid)) {
          visited.add(qid);
          nextFrontier.push(qid);
        }
      }
    }

    frontier = nextFrontier;
  }

  return { nodes: [...nodes.values()], edges };
}

/** Turn creative-role hits into graph nodes/edges under `personId`. */
export function creativeHitsToGraphData(
  personId: string,
  hits: CreativeRoleHit[],
): GraphData {
  const nodes: import("./types.ts").GraphNode[] = [];
  const edges: import("./types.ts").GraphEdge[] = [];
  for (const r of hits) {
    nodes.push({
      id: r.qid,
      label: r.workLabel,
      type: r.type,
      kind: "entity",
      externalUrl: r.externalUrl,
      description: r.externalUrl ? "MusicBrainz release group" : undefined,
    });
    edges.push({
      id: `${personId}-${r.pid}-${r.qid}`,
      source: personId,
      target: r.qid,
      label: r.label,
      propertyId: r.pid,
    });
  }
  return { nodes, edges };
}

function typeFromEntityClaims(entity: WikidataEntity): import("./types.ts").EntityType {
  const p31 = (entity.claims?.["P31"] as ClaimSnakValue[] | undefined) ?? [];
  const instanceOfIds = p31
    .map((c) => {
      const val = c.mainsnak?.datavalue?.value;
      return typeof val === "object" && val && "id" in val ? (val as { id: string }).id : undefined;
    })
    .filter((x): x is string => Boolean(x));
  return detectTypeFromInstanceOf(instanceOfIds);
}

type GraphNeighbor = {
  qid: string;
  pid: string;
  edgeLabel?: string;
  /** Award “for work” (P1686) — builds a compound award leaf. */
  forWorkQid?: string;
};

function graphClaimNeighbors(entity: WikidataEntity): GraphNeighbor[] {
  const neighbors: GraphNeighbor[] = [];
  for (const pid of GRAPH_PROPS) {
    const claimList = entity.claims?.[pid] as ClaimSnakValue[] | undefined;
    if (!claimList) continue;
    const cap = pid === "P800" ? 12 : pid === "P166" ? 16 : 5;
    for (const claim of claimList.slice(0, cap)) {
      const val = claim.mainsnak?.datavalue?.value;
      if (typeof val !== "object" || !val || !("id" in val) || typeof val.id !== "string") {
        continue;
      }
      const qid = val.id;
      if (pid === "P166") {
        const workSnaks = (claim.qualifiers?.["P1686"] ?? []) as Array<{
          datavalue?: { value?: unknown };
          mainsnak?: { datavalue?: { value?: unknown } };
        }>;
        const raw = workSnaks[0]?.datavalue?.value ?? workSnaks[0]?.mainsnak?.datavalue?.value;
        const forWorkQid =
          typeof raw === "object" && raw && "id" in raw && typeof (raw as { id: string }).id === "string"
            ? (raw as { id: string }).id
            : undefined;
        neighbors.push({ qid, pid, forWorkQid });
        continue;
      }
      neighbors.push({ qid, pid });
    }
  }
  return neighbors;
}

// ─── Family tree ─────────────────────────────────────────────────────────────

const FAMILY_PROPS: Record<string, string> = {
  P22: "father",
  P25: "mother",
  P26: "spouse",
  P40: "child",
  P3373: "sibling",
};

export async function fetchFamilyData(
  rootId: string,
  depth = 2,
  existingIds: Set<string> = new Set()
): Promise<GraphData> {
  const visited = new Set([...existingIds, rootId]);
  const nodes = new Map<string, import("./types.ts").GraphNode>();
  const edges: import("./types.ts").GraphEdge[] = [];
  /** Claims seen while expanding — used to link co-parents at hop 1. */
  const claimsCache = new Map<string, Record<string, ClaimSnakValue[] | undefined>>();

  // Level-by-level BFS: one batched wbgetentities round-trip per hop (not sequential DFS).
  let frontier = [rootId];
  for (let remaining = depth; frontier.length > 0 && remaining >= 0; remaining--) {
    const entities = await fetchWikidataEntitiesBatch(frontier);
    const nextFrontier: string[] = [];

    for (const id of frontier) {
      const entity = entities[id];
      if (!entity) continue;

      claimsCache.set(id, (entity.claims ?? {}) as Record<string, ClaimSnakValue[] | undefined>);
      upsertFamilyNode(nodes, id, entity);

      if (remaining === 0) continue;

      for (const { qid, pid } of familyNeighbors(entity)) {
        if (!nodes.has(qid)) {
          nodes.set(qid, { id: qid, label: qid, type: "person" });
        }
        const edgeId = `${id}-${pid}-${qid}`;
        if (!edges.some((e) => e.id === edgeId)) {
          edges.push({
            id: edgeId,
            source: id,
            target: qid,
            label: FAMILY_PROPS[pid] ?? pid,
            propertyId: pid,
          });
        }
        if (!visited.has(qid)) {
          visited.add(qid);
          nextFrontier.push(qid);
        }
      }
    }

    frontier = nextFrontier;
  }

  // Leaf nodes (depth 0) were not expanded for neighbors; still wire family
  // claims between people already on the graph (e.g. spouse → shared child).
  linkFamilyClaimsAmongKnown(claimsCache, nodes, edges);
  const normalized = normalizeChildEdgesToParent(edges, nodes);
  return { nodes: [...nodes.values()], edges: dedupeFamilyEdges(normalized) };
}

/** Batch wbgetentities (labels|descriptions|claims) — chunks of 50 in parallel. */
async function fetchWikidataEntitiesBatch(
  ids: string[],
): Promise<Record<string, WikidataEntity>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const out: Record<string, WikidataEntity> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 50) chunks.push(unique.slice(i, i + 50));

  await Promise.all(
    chunks.map(async (chunk) => {
      const params = new URLSearchParams({
        action: "wbgetentities",
        ids: chunk.join("|"),
        languages: "en",
        languagefallback: "1",
        format: "json",
        origin: "*",
        props: "labels|descriptions|claims",
      });
      const res = await fetch(`${WIKIDATA_API}?${params}`);
      if (!res.ok) return;
      const data = await res.json() as { entities: Record<string, WikidataEntity> };
      Object.assign(out, data.entities);
    }),
  );
  return out;
}

function familyNeighbors(entity: WikidataEntity): { qid: string; pid: string }[] {
  const neighbors: { qid: string; pid: string }[] = [];
  for (const pid of Object.keys(FAMILY_PROPS)) {
    const claimList = entity.claims?.[pid] as ClaimSnakValue[] | undefined;
    if (!claimList) continue;
    for (const claim of claimList.slice(0, 8)) {
      const val = claim.mainsnak?.datavalue?.value;
      if (typeof val === "object" && val && "id" in val && typeof val.id === "string") {
        neighbors.push({ qid: val.id, pid });
      }
    }
  }
  return neighbors;
}

function upsertFamilyNode(
  nodes: Map<string, import("./types.ts").GraphNode>,
  id: string,
  entity: WikidataEntity,
): void {
  const label = pickLabel(entity.labels) ?? id;
  const desc = pickLabel(entity.descriptions) ?? undefined;
  const birthClaim = entity.claims?.["P569"] as ClaimSnakValue[] | undefined;
  const deathClaim = entity.claims?.["P570"] as ClaimSnakValue[] | undefined;
  const birth = birthClaim?.[0]?.mainsnak?.datavalue?.value;
  const death = deathClaim?.[0]?.mainsnak?.datavalue?.value;
  const birthYear = typeof birth === "object" && birth && "time" in birth
    ? extractYear(birth.time as string) : undefined;
  const deathYear = typeof death === "object" && death && "time" in death
    ? extractYear(death.time as string) : undefined;
  const lifespan = birthYear ? `${birthYear}–${deathYear ?? ""}` : undefined;
  const gender = sexFromClaims(entity.claims);

  if (!nodes.has(id)) {
    nodes.set(id, {
      id,
      label: lifespan ? `${label}\n${lifespan}` : label,
      description: desc,
      type: "person",
      gender,
    });
  } else {
    const existing = nodes.get(id)!;
    existing.label = lifespan ? `${label}\n${lifespan}` : label;
    if (desc) existing.description = desc;
    if (gender) existing.gender = gender;
  }
}

/**
 * Add missing family edges when both endpoints are already in `nodes`
 * (Amit→mother→Ruma, Leena→child→Sumit, etc. at hop 1).
 */
function linkFamilyClaimsAmongKnown(
  claimsCache: Map<string, Record<string, ClaimSnakValue[] | undefined>>,
  nodes: Map<string, import("./types.ts").GraphNode>,
  edges: import("./types.ts").GraphEdge[],
): void {
  for (const [id, claims] of claimsCache) {
    if (!claims) continue;
    for (const pid of Object.keys(FAMILY_PROPS)) {
      const claimList = claims[pid];
      if (!claimList) continue;
      for (const claim of claimList.slice(0, 12)) {
        const val = claim.mainsnak?.datavalue?.value;
        if (typeof val !== "object" || !val || !("id" in val)) continue;
        const qid = (val as { id: string }).id;
        if (!nodes.has(qid)) continue;
        const edgeId = `${id}-${pid}-${qid}`;
        if (edges.some((e) => e.id === edgeId)) continue;
        edges.push({
          id: edgeId,
          source: id,
          target: qid,
          label: FAMILY_PROPS[pid] ?? pid,
          propertyId: pid,
        });
      }
    }
  }
}

/**
 * A → child → B  becomes  B → father/mother → A
 * so arrows read from the child's perspective toward the parent.
 */
function normalizeChildEdgesToParent(
  edges: import("./types.ts").GraphEdge[],
  nodes: Map<string, import("./types.ts").GraphNode>,
): import("./types.ts").GraphEdge[] {
  const idOf = (v: string | import("./types.ts").GraphNode) =>
    typeof v === "object" ? v.id : v;

  return edges.map((e) => {
    if (e.label.toLowerCase() !== "child" && e.propertyId !== "P40") return e;

    const parentId = idOf(e.source);
    const childId = idOf(e.target);
    const parentGender = nodes.get(parentId)?.gender;
    const label =
      parentGender === "female" ? "mother"
      : parentGender === "male" ? "father"
      : "parent";
    const propertyId =
      label === "mother" ? "P25"
      : label === "father" ? "P22"
      : "P40";

    return {
      ...e,
      id: `${childId}-${propertyId}-${parentId}`,
      source: childId,
      target: parentId,
      label,
      propertyId,
    };
  });
}

/**
 * When depth > 1, expanded relatives often mirror claims back
 * (spouse↔spouse, sibling↔sibling, father + child). Keep one edge per bond.
 */
export function dedupeFamilyEdges(edges: import("./types.ts").GraphEdge[]): import("./types.ts").GraphEdge[] {
  const priority: Record<string, number> = {
    father: 50,
    mother: 50,
    parent: 45,
    spouse: 40,
    sibling: 40,
    child: 30,
  };

  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const idOf = (v: string | import("./types.ts").GraphNode) =>
    typeof v === "object" ? v.id : v;

  const groups = new Map<string, import("./types.ts").GraphEdge[]>();
  for (const e of edges) {
    const key = pairKey(idOf(e.source), idOf(e.target));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const out: import("./types.ts").GraphEdge[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }

    // Prefer father/mother/parent over reciprocal "child" for the same pair
    const hasParent = group.some((e) => /^(father|mother|parent)$/i.test(e.label));
    const candidates = hasParent
      ? group.filter((e) => !/^child$/i.test(e.label))
      : group;

    const sorted = [...candidates].sort(
      (a, b) => (priority[b.label.toLowerCase()] ?? 0) - (priority[a.label.toLowerCase()] ?? 0)
    );

    const kept: import("./types.ts").GraphEdge[] = [];
    const seenSymmetric = new Set<string>();

    for (const e of sorted) {
      const lbl = e.label.toLowerCase();
      // Symmetric bonds: one edge only
      if (lbl === "spouse" || lbl === "sibling") {
        if (seenSymmetric.has(lbl)) continue;
        seenSymmetric.add(lbl);
        kept.push(e);
        continue;
      }
      // Parent/child bond: one directed edge only
      if (lbl === "father" || lbl === "mother" || lbl === "parent" || lbl === "child") {
        if (kept.some((k) => /^(father|mother|parent|child)$/i.test(k.label))) continue;
        kept.push(e);
        continue;
      }
      if (!kept.some((k) => k.id === e.id || k.label.toLowerCase() === lbl)) kept.push(e);
    }

    out.push(...(kept.length ? kept : [sorted[0]]));
  }
  return out;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sexFromClaims(claims?: Record<string, unknown[]>): "male" | "female" | undefined {
  const list = claims?.["P21"] as ClaimSnakValue[] | undefined;
  const val = list?.[0]?.mainsnak?.datavalue?.value;
  if (typeof val !== "object" || !val || !("id" in val)) return undefined;
  const qid = (val as { id: string }).id;
  // Q6581097 male, Q6581072 female (Wikidata)
  if (qid === "Q6581097") return "male";
  if (qid === "Q6581072") return "female";
  return undefined;
}

function pickLabel(labels?: Record<string, { value: string }>): string | null {
  if (!labels) return null;
  return labels.en?.value || Object.values(labels)[0]?.value || null;
}

async function resolveLabels(ids: string[]): Promise<Record<string, string>> {
  const meta = await resolveEntityMeta(ids);
  const out: Record<string, string> = {};
  for (const [id, m] of Object.entries(meta)) out[id] = m.label;
  return out;
}

async function resolveEntityMeta(ids: string[]): Promise<Record<string, { label: string; description?: string }>> {
  if (ids.length === 0) return {};
  const results: Record<string, { label: string; description?: string }> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

  await Promise.all(
    chunks.map(async (chunk) => {
      const params = new URLSearchParams({
        action: "wbgetentities",
        ids: chunk.join("|"),
        props: "labels|descriptions",
        languages: "en",
        languagefallback: "1",
        format: "json",
        origin: "*",
      });
      const res = await fetch(`${WIKIDATA_API}?${params}`);
      if (!res.ok) return;
      const data = await res.json() as {
        entities: Record<string, {
          labels?: Record<string, { value: string }>;
          descriptions?: Record<string, { value: string }>;
        }>;
      };
      for (const [qid, ent] of Object.entries(data.entities)) {
        results[qid] = {
          label: pickLabel(ent.labels) ?? qid,
          description: pickLabel(ent.descriptions) ?? undefined,
        };
      }
    }),
  );
  return results;
}

async function resolvePropertyLabels(pids: string[]): Promise<Record<string, string>> {
  if (!pids.length) return {};
  const results: Record<string, string> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < pids.length; i += 50) chunks.push(pids.slice(i, i + 50));

  await Promise.all(
    chunks.map(async (chunk) => {
      const params = new URLSearchParams({
        action: "wbgetentities",
        ids: chunk.join("|"),
        props: "labels",
        languages: "en",
        languagefallback: "1",
        format: "json",
        origin: "*",
      });
      const res = await fetch(`${WIKIDATA_API}?${params}`);
      if (!res.ok) return;
      const data = await res.json() as {
        entities: Record<string, { labels?: Record<string, { value: string }> }>;
      };
      for (const [pid, ent] of Object.entries(data.entities)) {
        results[pid] = pickLabel(ent.labels) ?? pid;
      }
    }),
  );
  return results;
}

async function fetchWikipediaThumbnail(title: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${WIKIPEDIA_REST}/page/summary/${encodeURIComponent(title)}`);
    if (!res.ok) return undefined;
    const data = await res.json() as { thumbnail?: { source: string }; originalimage?: { source: string } };
    return data.originalimage?.source || data.thumbnail?.source;
  } catch {
    return undefined;
  }
}

/** Complete in-app Wikipedia dossier: full HTML + text sections + gallery (+ optional extras) */
async function fetchWikipediaArticle(
  title: string,
  opts: { includeMainArticles?: boolean; includeOtherLanguages?: boolean } = {},
): Promise<WikipediaArticle | undefined> {
  try {
    const [parsed, textArticle, otherLanguages, revisedAt] = await Promise.all([
      fetchWikipediaParsedHtml(title),
      fetchWikipediaPlainExtract(title),
      opts.includeOtherLanguages
        ? fetchOtherLanguageExtracts(title)
        : Promise.resolve([] as Awaited<ReturnType<typeof fetchOtherLanguageExtracts>>),
      fetchWikipediaRevisedAt(title),
    ]);

    if (!parsed && !textArticle) {
      const short = await fetchWikipediaFullSummary(title);
      if (!short) return undefined;
      return {
        title,
        url: wikiUrl(title),
        lead: short,
        sections: [],
        otherLanguages: otherLanguages.length ? otherLanguages : undefined,
        revisedAt,
      };
    }

    const lead = textArticle?.lead || stripHtmlToText(parsed?.html ?? "").slice(0, 1200);
    const sections = textArticle?.sections ?? [];

    // Prefer Wikipedia pageimages / REST over first parse-gallery file (often an icon SVG)
    const portrait =
      textArticle?.thumbnail ||
      pickPortraitFromGallery(parsed?.gallery) ||
      parsed?.thumbnail;

    let html = parsed?.html;
    let toc: WikiTocItem[] | undefined;
    let mainArticleHints: Array<{ parentSection: string; parentSectionId: string; title: string }> = [];

    if (html) {
      const enhanced = enhanceWikiHtmlWithAnchors(html);
      html = enhanced.html;
      toc = enhanced.toc.length ? enhanced.toc : undefined;
      mainArticleHints = enhanced.mainArticles;
    } else if (sections.length) {
      toc = tocFromPlainSections(sections);
    }

    // Prefer hatnotes under Discography / Filmography / Awards (+ any main-article links found)
    const prioritized = prioritizeMainArticleHints(mainArticleHints, sections);
    const mainArticles =
      opts.includeMainArticles && prioritized.length
        ? await fetchMainArticles(prioritized)
        : undefined;

    // Attach mainArticleTitle onto matching TOC nodes
    if (toc && mainArticles?.length) {
      for (const art of mainArticles) {
        annotateTocMainArticle(toc, art.parentSectionId, art.title);
      }
    }

    return {
      title: parsed?.title || textArticle?.title || title,
      url: wikiUrl(title),
      lead,
      sections, // keep ALL sections including references
      html,
      thumbnail: portrait,
      gallery: parsed?.gallery ?? [],
      otherLanguages: otherLanguages.length ? otherLanguages : undefined,
      revisedAt,
      infobox: parsed?.infobox,
      toc,
      mainArticleHints: prioritized.length ? prioritized : undefined,
      mainArticles,
    };
  } catch {
    return undefined;
  }
}

/** Deferred: other-language Wikipedia extracts for the Languages tab. */
export async function fetchEntityOtherLanguages(enTitle: string) {
  return fetchOtherLanguageExtracts(enTitle);
}

/** Deferred: full "Main article" pages for Overview embeds. */
export async function fetchEntityMainArticles(
  hints: Array<{ parentSection: string; parentSectionId: string; title: string }>,
) {
  if (!hints.length) return [];
  return fetchMainArticles(hints);
}

/** Cheap MediaWiki revision timestamp for cache invalidation. */
export async function fetchWikipediaRevisedAt(title: string): Promise<string | undefined> {
  try {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      prop: "revisions",
      rvprop: "timestamp",
      rvlimit: "1",
      titles: title,
      redirects: "1",
    });
    const res = await fetch(`${WIKIPEDIA_API}?${params}`);
    if (!res.ok) return undefined;
    const data = await res.json() as {
      query?: { pages?: Record<string, { revisions?: Array<{ timestamp?: string }> }> };
    };
    const page = Object.values(data.query?.pages ?? {})[0];
    return page?.revisions?.[0]?.timestamp;
  } catch {
    return undefined;
  }
}

function wikiUrl(title: string) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

async function fetchWikipediaParsedHtml(title: string): Promise<{
  title: string;
  html: string;
  thumbnail?: string;
  gallery: Array<{ filename: string; url: string; thumb: string }>;
  infobox?: Array<{ label: string; value: string; valueHtml?: string }>;
} | undefined> {
  const params = new URLSearchParams({
    action: "parse",
    page: title,
    prop: "text|images|displaytitle",
    disableeditsection: "1",
    disabletoc: "1",
    format: "json",
    origin: "*",
    redirects: "1",
  });
  const res = await fetch(`${WIKIPEDIA_API}?${params}`);
  if (!res.ok) return undefined;
  const data = await res.json() as {
    error?: unknown;
    parse?: {
      title?: string;
      text?: { "*": string };
      images?: string[];
    };
  };
  if (data.error || !data.parse?.text?.["*"]) return undefined;

  const rawHtml = data.parse.text["*"];
  const infobox = extractWikipediaInfobox(rawHtml);
  const html = sanitizeWikiHtml(rawHtml);
  const imageNames = (data.parse.images ?? []).filter((name) => isUsableMediaFilename(name));

  const gallery = imageNames.slice(0, 24).map((filename) => ({
    filename,
    url: getCommonsThumbUrl(filename, 1200),
    thumb: getCommonsThumbUrl(filename, 360),
  }));

  return {
    title: data.parse.title ?? title,
    html,
    thumbnail: pickPortraitFromGallery(gallery),
    gallery,
    infobox: infobox.length ? infobox : undefined,
  };
}

/** Parse Wikipedia right-rail infobox into labeled rows (Born, Died, Occupations, …). */
function extractWikipediaInfobox(
  html: string,
): Array<{ kind?: "row" | "section"; label: string; value: string; valueHtml?: string }> {
  const start = html.search(/<table[^>]*class="[^"]*\binfobox\b/i);
  if (start < 0) return [];
  // Balance nested <table> (musical career / module templates nest inside)
  let depth = 0;
  let end = -1;
  const tagRe = /<\/?table\b[^>]*>/gi;
  tagRe.lastIndex = start;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(html)) !== null) {
    if (tag[0].startsWith("</")) {
      depth -= 1;
      if (depth === 0) {
        end = tag.index + tag[0].length;
        break;
      }
    } else {
      depth += 1;
    }
  }
  if (end < 0) return [];
  const table = html.slice(start, end);
  const rows: Array<{ kind?: "row" | "section"; label: string; value: string; valueHtml?: string }> = [];

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(table)) !== null) {
    const rowHtml = m[1];

    // Section banners: "Musical career", etc.
    const section =
      rowHtml.match(
        /<(?:th|td)[^>]*(?:infobox-header|infobox-full-data)[^>]*>([\s\S]*?)<\/(?:th|td)>/i,
      ) ??
      rowHtml.match(/<th[^>]*colspan\s*=\s*["']?2["']?[^>]*>([\s\S]*?)<\/th>/i);
    const th = rowHtml.match(/<th[^>]*scope=["']row["'][^>]*>([\s\S]*?)<\/th>/i)
      ?? rowHtml.match(/<th[^>]*class="[^"]*infobox-label[^"]*"[^>]*>([\s\S]*?)<\/th>/i)
      ?? rowHtml.match(/<th[^>]*>([\s\S]*?)<\/th>/i);
    const td = rowHtml.match(/<td[^>]*class="[^"]*infobox-data[^"]*"[^>]*>([\s\S]*?)<\/td>/i)
      ?? rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/i);

    if (section && !td) {
      const label = decodeHtmlEntities(stripHtmlToText(section[1]))
        .replace(/\[\d+\]/g, "")
        .trim();
      if (
        label &&
        label.length < 60 &&
        !/^(musical artist|signature|module|hide)$/i.test(label)
      ) {
        rows.push({ kind: "section", label, value: "" });
      }
      continue;
    }

    // Full-data row that is only a bold section title (no label th)
    if (!th && td && /infobox-full-data/i.test(rowHtml)) {
      const label = decodeHtmlEntities(stripHtmlToText(td[1]))
        .replace(/\[\d+\]/g, "")
        .trim();
      if (
        label &&
        label.length < 60 &&
        !/^(musical artist|signature|module|hide)$/i.test(label)
      ) {
        rows.push({ kind: "section", label, value: "" });
      }
      continue;
    }

    if (!th || !td) continue;
    const label = decodeHtmlEntities(stripHtmlToText(th[1]))
      .replace(/\[\d+\]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/:$/, "");
    let valueHtml = td[1]
      .replace(/<link[^>]*>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, "")
      .replace(/<div[^>]*class="[^"]*marriage-display-inline[^"]*"[^>]*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "")
      .trim();
    // Absolute wiki links for in-app display
    valueHtml = valueHtml
      .replace(/href="\/wiki\//gi, 'href="https://en.wikipedia.org/wiki/')
      .replace(/href="\/w\//gi, 'href="https://en.wikipedia.org/w/');
    const value = decodeHtmlEntities(
      valueHtml
        .replace(/<[^>]+>/g, " ")
        .replace(/[^\S\n]+/g, " ")
        .replace(/ *\n */g, "\n")
        .replace(/\n{2,}/g, "\n")
        .trim(),
    )
      .replace(/\[\d+\]/g, "")
      .replace(/\u200b/g, "")
      .trim();
    if (!label || !value || label.length > 60 || value.length < 1) continue;
    if (/^(image|signature|module)$/i.test(label)) continue;
    if (/^https?:\/\//i.test(value) && value.length < 8) continue;
    rows.push({ kind: "row", label, value, valueHtml });
    if (rows.length >= 28) break;
  }
  return rows;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/g, " ")
    .replace(/&#x0*a0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#91;/g, "[")
    .replace(/&#93;/g, "]")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    });
}

async function fetchWikipediaPlainExtract(title: string): Promise<{
  title: string;
  lead: string;
  sections: WikiSection[];
  thumbnail?: string;
} | undefined> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    prop: "extracts|pageimages|info",
    titles: title,
    explaintext: "1",
    exsectionformat: "wiki",
    pithumbsize: "800",
    inprop: "url",
    redirects: "1",
  });
  const res = await fetch(`${WIKIPEDIA_API}?${params}`);
  if (!res.ok) return undefined;
  const data = await res.json() as {
    query?: {
      pages?: Record<string, {
        title?: string;
        extract?: string;
        thumbnail?: { source: string };
        missing?: boolean;
      }>;
    };
  };
  const page = Object.values(data.query?.pages ?? {})[0];
  if (!page || page.missing || !page.extract) return undefined;
  const { lead, sections } = parseWikiExtract(page.extract, { keepAll: true });
  return {
    title: page.title ?? title,
    lead,
    sections,
    thumbnail: page.thumbnail?.source,
  };
}

const LANG_NAMES: Record<string, string> = {
  hi: "Hindi", bn: "Bengali", ur: "Urdu", ta: "Tamil", te: "Telugu",
  mr: "Marathi", gu: "Gujarati", pa: "Punjabi", ml: "Malayalam", kn: "Kannada",
  fr: "French", de: "German", es: "Spanish", ru: "Russian", ja: "Japanese",
  ar: "Arabic", zh: "Chinese", pt: "Portuguese", it: "Italian",
};

/** Extra language Wikipedia extracts — more coverage than English alone */
async function fetchOtherLanguageExtracts(enTitle: string): Promise<Array<{
  lang: string;
  langName: string;
  title: string;
  extract: string;
}>> {
  try {
    // Resolve sitelinks for this EN page via Wikidata
    const langlinksParams = new URLSearchParams({
      action: "query",
      format: "json",
      origin: "*",
      prop: "langlinks",
      titles: enTitle,
      lllimit: "50",
      redirects: "1",
    });
    const llRes = await fetch(`${WIKIPEDIA_API}?${langlinksParams}`);
    if (!llRes.ok) return [];
    const llData = await llRes.json() as {
      query?: { pages?: Record<string, { langlinks?: Array<{ lang: string; "*": string }> }> };
    };
    const page = Object.values(llData.query?.pages ?? {})[0];
    const links = page?.langlinks ?? [];

    // Prefer culturally relevant + major languages
    const preferred = ["hi", "bn", "ur", "fr", "de", "es", "ru", "ja", "ar", "zh"];
    const chosen = preferred
      .map((lang) => links.find((l) => l.lang === lang))
      .filter((l): l is { lang: string; "*": string } => Boolean(l))
      .slice(0, 4);

    const results = await Promise.all(
      chosen.map(async (ll) => {
        try {
          const summaryRes = await fetch(
            `https://${ll.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(ll["*"])}`
          );
          if (!summaryRes.ok) return null;
          const summary = await summaryRes.json() as { extract?: string; title?: string };
          if (!summary.extract || summary.extract.length < 80) return null;
          return {
            lang: ll.lang,
            langName: LANG_NAMES[ll.lang] ?? ll.lang,
            title: summary.title ?? ll["*"],
            extract: summary.extract,
          };
        } catch {
          return null;
        }
      })
    );
    return results.filter((r): r is NonNullable<typeof r> => Boolean(r));
  } catch {
    return [];
  }
}

function sanitizeWikiHtml(html: string): string {
  let out = html;
  // Drop scripts/styles/noscript
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style[\s\S]*?<\/style>/gi, "");
  out = out.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  // Remove Wikipedia infobox — we render our own hero/sidebar (avoids duplicate photo)
  out = out.replace(/<table[^>]*class="[^"]*\binfobox\b[^"]*"[\s\S]*?<\/table>/gi, "");
  out = out.replace(/<aside[^>]*class="[^"]*\binfobox\b[^"]*"[\s\S]*?<\/aside>/gi, "");
  out = out.replace(/<div[^>]*class="[^"]*\binfobox\b[^"]*"[\s\S]*?<\/div>/gi, "");
  // Remove edit / nav noise
  out = out.replace(/<span[^>]*class="[^"]*mw-editsection[^"]*"[\s\S]*?<\/span>/gi, "");
  out = out.replace(/<div[^>]*class="[^"]*navbox[\s\S]*?<\/div>/gi, "");
  out = out.replace(/<table[^>]*class="[^"]*navbox[\s\S]*?<\/table>/gi, "");
  out = out.replace(/<div[^>]*class="[^"]*sistersitebox[\s\S]*?<\/div>/gi, "");
  out = out.replace(/<div[^>]*class="[^"]*shortdescription[\s\S]*?<\/div>/gi, "");
  // Make wiki internal links in-app resolvable
  out = out.replace(
    /href="\/wiki\/([^"#:]+)(?:#[^"]*)?"/gi,
    (_m, page: string) => `href="#wiki:${decodeURIComponent(page.replace(/_/g, " "))}" data-wiki-title="${decodeURIComponent(page.replace(/_/g, " "))}"`
  );
  // Neutralize remaining external wiki / action links that would leave the app
  out = out.replace(/href="\/\/([^"]+)"/gi, 'href="https://$1"');
  // Media: ensure protocol
  out = out.replace(/src="\/\//g, 'src="https://');
  out = out.replace(/srcset="\/\//g, 'srcset="https://');
  return out;
}

function wikiSectionSlug(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['']/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return `wiki-sec-${base || "section"}`;
}

const MAIN_ARTICLE_SECTION_RE =
  /^(discography|filmography|awards|works|bibliography|publications|songs|albums)$/i;

/**
 * Ensure headings have stable scroll ids and extract TOC + Main article hatnotes.
 */
function enhanceWikiHtmlWithAnchors(html: string): {
  html: string;
  toc: WikiTocItem[];
  mainArticles: Array<{ parentSection: string; parentSectionId: string; title: string }>;
} {
  const flat: Array<{ id: string; title: string; level: 2 | 3 | 4 }> = [];
  const mainArticles: Array<{ parentSection: string; parentSectionId: string; title: string }> = [];
  let currentSection = { title: "Lead", id: "wiki-sec-lead" };
  const usedIds = new Set<string>();

  const uniqueId = (raw: string) => {
    let id = raw;
    let n = 2;
    while (usedIds.has(id)) {
      id = `${raw}-${n++}`;
    }
    usedIds.add(id);
    return id;
  };

  // Rewrite h2–h4 (and mw-headline spans) with data-wiki-sec anchors
  let out = html.replace(
    /<(h[2-4])([^>]*)>([\s\S]*?)<\/\1>/gi,
    (full, tag: string, attrs: string, inner: string) => {
      const level = Number(tag[1]) as 2 | 3 | 4;
      const headline =
        inner.match(/class="[^"]*mw-headline[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] ??
        inner;
      const title = stripHtmlToText(headline)
        .replace(/\[\s*edit\s*\]/gi, "")
        .trim();
      if (!title || title.length > 120) return full;

      const existingId =
        attrs.match(/\bid=["']([^"']+)["']/i)?.[1] ||
        inner.match(/class="[^"]*mw-headline[^"]*"[^>]*\bid=["']([^"']+)["']/i)?.[1];
      const id = uniqueId(
        existingId?.startsWith("wiki-sec-")
          ? existingId
          : wikiSectionSlug(existingId?.replace(/_/g, " ") || title),
      );

      flat.push({ id, title, level });
      currentSection = { title, id };

      let nextAttrs = attrs;
      if (/\bid=/i.test(nextAttrs)) {
        nextAttrs = nextAttrs.replace(/\bid=["'][^"']*["']/i, `id="${id}"`);
      } else {
        nextAttrs += ` id="${id}"`;
      }
      nextAttrs += ` data-wiki-sec="${id}"`;
      return `<${tag}${nextAttrs}>${inner}</${tag}>`;
    },
  );

  // Walk hatnotes in document order relative to headings via sequential scan
  const pieceRe =
    /<(h[2-4])\b[^>]*\bid=["']([^"']+)["'][^>]*>[\s\S]*?<\/\1>|<div[^>]*class="[^"]*\bhatnote\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let current = { title: "Lead", id: "wiki-sec-lead" };
  let pm: RegExpExecArray | null;
  while ((pm = pieceRe.exec(out)) !== null) {
    if (pm[1] && pm[2]) {
      const found = flat.find((f) => f.id === pm![2]);
      if (found) current = { title: found.title, id: found.id };
      continue;
    }
    const hatHtml = pm[3] ?? "";
    const text = stripHtmlToText(hatHtml);
    if (!/main\s+articles?:/i.test(text) && !/see\s+also:/i.test(text) && !/^for\s+/i.test(text)) {
      // Still accept classic "Main article:" only
      if (!/main\s+article/i.test(text)) continue;
    }
    if (!/main\s+article/i.test(text)) continue;

    const titles: string[] = [];
    const linkRe = /data-wiki-title="([^"]+)"|href="#wiki:([^"]+)"/gi;
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(hatHtml)) !== null) {
      const t = (lm[1] || lm[2] || "").trim();
      if (t) titles.push(t);
    }
    // Fallback: plain /wiki/ before sanitize rewrite (shouldn't happen post-sanitize)
    if (!titles.length) {
      const raw = hatHtml.match(/\/wiki\/([^"#<\s]+)/);
      if (raw?.[1]) titles.push(decodeURIComponent(raw[1].replace(/_/g, " ")));
    }
    for (const t of titles.slice(0, 2)) {
      if (mainArticles.some((a) => a.title === t && a.parentSectionId === current.id)) continue;
      mainArticles.push({
        parentSection: current.title,
        parentSectionId: current.id,
        title: t,
      });
    }
  }

  // Also scan plain sections for "Main article:" lines if no hatnotes found
  return {
    html: out,
    toc: nestTocItems(flat),
    mainArticles,
  };
}

function nestTocItems(
  flat: Array<{ id: string; title: string; level: 2 | 3 | 4 }>,
): WikiTocItem[] {
  const roots: WikiTocItem[] = [];
  let lastL2: WikiTocItem | null = null;
  let lastL3: WikiTocItem | null = null;

  for (const item of flat) {
    const node: WikiTocItem = { id: item.id, title: item.title, level: item.level };
    if (item.level === 2) {
      roots.push(node);
      lastL2 = node;
      lastL3 = null;
    } else if (item.level === 3 && lastL2) {
      lastL2.children = lastL2.children ?? [];
      lastL2.children.push(node);
      lastL3 = node;
    } else if (item.level === 4 && lastL3) {
      lastL3.children = lastL3.children ?? [];
      lastL3.children.push(node);
    } else if (item.level === 4 && lastL2) {
      lastL2.children = lastL2.children ?? [];
      lastL2.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function tocFromPlainSections(sections: WikiSection[]): WikiTocItem[] {
  const flat = sections
    .filter((s) => s.level >= 2 && s.level <= 4)
    .map((s) => ({
      id: wikiSectionSlug(s.title),
      title: s.title,
      level: Math.min(4, Math.max(2, s.level)) as 2 | 3 | 4,
    }));
  return nestTocItems(flat);
}

function annotateTocMainArticle(toc: WikiTocItem[], sectionId: string, title: string) {
  for (const item of toc) {
    if (item.id === sectionId) {
      item.mainArticleTitle = title;
      return;
    }
    if (item.children) annotateTocMainArticle(item.children, sectionId, title);
  }
}

function prioritizeMainArticleHints(
  hints: Array<{ parentSection: string; parentSectionId: string; title: string }>,
  sections: WikiSection[],
): Array<{ parentSection: string; parentSectionId: string; title: string }> {
  const fromHints = [...hints];

  // Fallback: plain-text sections that look like lists with "Main article:" in content
  if (!fromHints.length) {
    for (const s of sections) {
      if (!MAIN_ARTICLE_SECTION_RE.test(s.title) && !/discography|filmography|awards/i.test(s.title)) {
        continue;
      }
      const m = s.content.match(/Main article:\s*(.+)/i);
      if (!m) continue;
      const title = m[1].split("\n")[0]?.replace(/\[\[|\]\]/g, "").trim();
      if (!title) continue;
      fromHints.push({
        parentSection: s.title,
        parentSectionId: wikiSectionSlug(s.title),
        title,
      });
    }
  }

  const preferred = fromHints.filter((h) =>
    MAIN_ARTICLE_SECTION_RE.test(h.parentSection) ||
    /discography|filmography|award|song|works/i.test(h.parentSection) ||
    /discography|filmography|award|song|list of/i.test(h.title),
  );
  const pool = preferred.length ? preferred : fromHints;
  const seen = new Set<string>();
  const out: typeof pool = [];
  for (const h of pool) {
    const key = h.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= 5) break;
  }
  return out;
}

async function fetchMainArticles(
  hints: Array<{ parentSection: string; parentSectionId: string; title: string }>,
): Promise<WikiMainArticle[]> {
  const results = await Promise.all(
    hints.map(async (h) => {
      try {
        const [text, parsed, revisedAt] = await Promise.all([
          fetchWikipediaPlainExtract(h.title),
          fetchWikipediaParsedHtml(h.title),
          fetchWikipediaRevisedAt(h.title),
        ]);
        const lead =
          (text?.lead || "").slice(0, 2000) ||
          stripHtmlToText(parsed?.html ?? "").slice(0, 1200);
        if (!lead && !text?.sections?.length && !parsed?.html) return null;
        // Keep a usable digest — skip pure References
        const sections = (text?.sections ?? [])
          .filter((s) => !/^(references|notes|external links|see also|further reading|sources)$/i.test(s.title))
          .slice(0, 16)
          .map((s) => ({
            ...s,
            content: s.content.slice(0, 1800),
          }));
        const html = parsed?.html
          ? trimMainArticleHtml(parsed.html)
          : undefined;
        return {
          title: parsed?.title || text?.title || h.title,
          url: wikiUrl(h.title),
          parentSection: h.parentSection,
          parentSectionId: h.parentSectionId,
          lead,
          sections,
          html,
          revisedAt,
        } satisfies WikiMainArticle;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is NonNullable<typeof r> => r != null);
}

/** Drop trailing reference chrome from list / awards pages; keep the body. */
function trimMainArticleHtml(html: string): string {
  let out = html;
  // Cut from common end-matter headings onward
  out = out.replace(
    /<h[2-4]\b[^>]*>[\s\S]*?\b(References|Notes|External links|See also|Further reading|Sources|Bibliography|Navigation)\b[\s\S]*$/i,
    "",
  );
  // Soft size guard — keep the page usable in the entity view
  if (out.length > 350_000) out = out.slice(0, 350_000);
  return out.trim();
}

function stripHtmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseWikiExtract(extract: string, opts: { keepAll?: boolean } = {}): { lead: string; sections: WikiSection[] } {
  const lines = extract.replace(/\r\n/g, "\n").split("\n");
  const sections: WikiSection[] = [];
  const leadParts: string[] = [];
  let current: WikiSection | null = null;
  const headingRe = /^(={2,6})\s*(.+?)\s*\1\s*$/;

  for (const line of lines) {
    const m = line.match(headingRe);
    if (m) {
      if (current) sections.push(current);
      current = { title: m[2].trim(), level: m[1].length, content: "" };
      continue;
    }
    if (!current) leadParts.push(line);
    else current.content += (current.content ? "\n" : "") + line;
  }
  if (current) sections.push(current);

  const skip = /^(navigation|authority control)$/i;
  const cleaned = sections
    .map((s) => ({ ...s, content: s.content.trim() }))
    .filter((s) => s.content.length > 0 && (opts.keepAll || !skip.test(s.title)));

  return {
    lead: leadParts.join("\n").trim(),
    sections: cleaned,
  };
}

async function fetchWikipediaFullSummary(title: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${WIKIPEDIA_REST}/page/summary/${encodeURIComponent(title)}`);
    if (!res.ok) return undefined;
    const data = await res.json() as { extract?: string };
    return data.extract;
  } catch {
    return undefined;
  }
}

/** Resolve an English Wikipedia title to a Wikidata QID for in-app navigation */
export async function resolveWikipediaTitleToQid(title: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      action: "wbgetentities",
      sites: "enwiki",
      titles: title.replace(/_/g, " "),
      props: "info",
      format: "json",
      origin: "*",
      normalize: "1",
    });
    const res = await fetch(`${WIKIDATA_API}?${params}`);
    if (!res.ok) return null;
    const data = await res.json() as { entities?: Record<string, { id?: string; missing?: string }> };
    const entity = Object.values(data.entities ?? {})[0];
    if (!entity || entity.missing || !entity.id) return null;
    return entity.id;
  } catch {
    return null;
  }
}

function getCommonsThumbUrl(filename: string, width: number): string {
  // thumb.php is more reliable as a direct <img> src than Special:FilePath redirects
  // (which often fail with referrer / redirect quirks in the browser).
  const file = filename.replace(/ /g, "_");
  return `https://commons.wikimedia.org/w/thumb.php?f=${encodeURIComponent(file)}&width=${width}`;
}

/** Skip icons, audio, and decorative wiki chrome — keep real photos/illustrations */
function isUsableMediaFilename(
  filename: string,
  opts?: { allowSvg?: boolean },
): boolean {
  // Autographs / logos are commonly SVG on Commons (e.g. P109 signatures)
  const allowSvg =
    opts?.allowSvg === true || /signatur|autograph/i.test(filename);
  const extOk = allowSvg
    ? /\.(jpe?g|png|gif|webp|svg)$/i.test(filename)
    : /\.(jpe?g|png|gif|webp)$/i.test(filename);
  if (!extOk) return false;
  return !/semi-protection|ambox|edit|icon|logo_of_wikimedia|question_book|padlock|symbol_|commons-logo|wiki_letter|red_pencil|increase2|decrease2|sound-icon|speaker_icon|nuvola|crystal_clear|ogg|opus/i.test(
    filename
  );
}

function pickPortraitFromGallery(
  gallery?: Array<{ filename: string; url: string; thumb: string }>
): string | undefined {
  if (!gallery?.length) return undefined;
  const photo = gallery.find((g) => /\.(jpe?g|png|webp)$/i.test(g.filename));
  return photo?.url ?? gallery[0]?.url;
}

function formatWikidataTime(time: string, precision?: number): string {
  const match = time.match(/([+-]?)(\d+)-(\d{2})-(\d{2})/);
  if (!match) return time;
  const sign = match[1] === "-" ? -1 : 1;
  const year = Number(match[2]) * sign;
  const month = Number(match[3]);
  const day = Number(match[4]);
  const era = year < 0 ? " BCE" : "";
  const absYear = Math.abs(year);
  const p = precision ?? 11;
  if (p <= 9) return `${absYear}${era}`;
  if (p === 10 || month === 0) {
    if (month === 0) return `${absYear}${era}`;
    const monthName = new Date(2000, month - 1).toLocaleString("en", { month: "short" });
    return `${monthName} ${absYear}${era}`;
  }
  if (day === 0) {
    const monthName = new Date(2000, month - 1).toLocaleString("en", { month: "short" });
    return `${monthName} ${absYear}${era}`;
  }
  try {
    const date = new Date(Date.UTC(Math.abs(year), month - 1, day));
    const formatted = date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    return year < 0 ? formatted.replace(String(Math.abs(year)), `${absYear} BCE`) : formatted;
  } catch {
    return `${day} ${month}/${absYear}${era}`;
  }
}

function formatNumber(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(abs >= 1e13 ? 0 : 2)}T`;
  if (abs >= 1e9) return `${(n / 1e9).toFixed(abs >= 1e10 ? 0 : 2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(abs >= 1e4 ? 0 : 1)}K`;
  return n.toLocaleString("en-US");
}

function extractYear(time: string): string | undefined {
  const match = time.match(/([+-]?)(\d{1,4})/);
  if (!match) return undefined;
  return match[1] === "-" ? `${match[2]} BCE` : match[2];
}

type ClaimSnakValue = {
  mainsnak?: {
    snaktype?: string;
    datatype?: string;
    datavalue?: {
      type?: string;
      value?: unknown;
    };
  };
  snaktype?: string;
  datatype?: string;
  datavalue?: {
    type?: string;
    value?: unknown;
  };
  qualifiers?: Record<string, unknown[]>;
};

type WikidataEntity = {
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  aliases?: Record<string, Array<{ value: string }>>;
  claims?: Record<string, unknown[]>;
  sitelinks?: Record<string, { title: string }>;
};
