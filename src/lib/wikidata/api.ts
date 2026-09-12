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

export async function searchEntities(query: string, limit = 10): Promise<SearchResult[]> {
  if (!query.trim()) return [];

  const params = new URLSearchParams({
    action: "wbsearchentities",
    search: query,
    language: "en",
    limit: String(limit),
    format: "json",
    origin: "*",
    type: "item",
  });

  const res = await fetch(`${WIKIDATA_API}?${params}`);
  if (!res.ok) throw new Error(`Wikidata search failed: ${res.status}`);
  const data = await res.json() as {
    search: Array<{ id: string; label: string; description?: string }>;
  };

  const ids = data.search.map((r) => r.id);
  const [typeMap, thumbs] = await Promise.all([
    ids.length > 0 ? fetchEntityTypes(ids) : Promise.resolve({} as Record<string, EntityType>),
    ids.length > 0 ? fetchThumbnails(ids) : Promise.resolve({} as Record<string, string>),
  ]);

  return data.search.map((r) => ({
    id: r.id,
    label: r.label,
    description: r.description,
    thumbnail: thumbs[r.id],
    type: typeMap[r.id] ?? guessTypeFromDescription(r.description),
  }));
}

function guessTypeFromDescription(desc = ""): EntityType {
  const d = desc.toLowerCase();
  if (/politician|actor|scientist|writer|musician|athlete|king|queen|person|human/.test(d)) return "person";
  if (/city|country|town|capital|village|island|river|mountain/.test(d)) return "place";
  if (/company|organization|university|corporation|business|party|agency/.test(d)) return "organization";
  if (/war|battle|election|festival|revolution/.test(d)) return "event";
  if (/film|novel|album|book|painting|song|software|game/.test(d)) return "work";
  if (/concept|theory|disease|chemical|philosophy/.test(d)) return "concept";
  return "unknown";
}

async function fetchThumbnails(ids: string[]): Promise<Record<string, string>> {
  try {
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: ids.slice(0, 50).join("|"),
      props: "claims",
      format: "json",
      origin: "*",
    });
    const res = await fetch(`${WIKIDATA_API}?${params}`);
    if (!res.ok) return {};
    const data = await res.json() as { entities: Record<string, WikidataEntity> };
    const out: Record<string, string> = {};
    for (const [id, ent] of Object.entries(data.entities)) {
      const claims = ent.claims?.["P18"] as ClaimSnakValue[] | undefined;
      const filename = claims?.[0]?.mainsnak?.datavalue?.value;
      if (typeof filename === "string") out[id] = getCommonsThumbUrl(filename, 120);
    }
    return out;
  } catch {
    return {};
  }
}

async function fetchEntityTypes(ids: string[]): Promise<Record<string, EntityType>> {
  const result: Record<string, EntityType> = {};
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const params = new URLSearchParams({
      action: "wbgetentities",
      ids: chunk.join("|"),
      props: "claims",
      format: "json",
      origin: "*",
    });
    const res = await fetch(`${WIKIDATA_API}?${params}`);
    if (!res.ok) continue;
    const data = await res.json() as { entities: Record<string, { claims?: Record<string, unknown[]> }> };
    for (const [id, entity] of Object.entries(data.entities)) {
      const p31Claims = entity.claims?.["P31"] as Array<{
        mainsnak?: { datavalue?: { value?: { id?: string } } };
      }> | undefined;
      const instanceOfIds = (p31Claims ?? [])
        .map((c) => c.mainsnak?.datavalue?.value?.id)
        .filter((x): x is string => Boolean(x));
      result[id] = detectTypeFromInstanceOf(instanceOfIds);
    }
  }
  return result;
}

// ─── Full entity summary (360°) ──────────────────────────────────────────────

export async function fetchEntitySummary(id: string): Promise<EntitySummary> {
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
    sitelink ? fetchWikipediaArticle(sitelink.title) : Promise.resolve(undefined),
  ]);

  // Instance of
  const instanceOf: Array<{ id: string; label: string }> = [];
  for (const claim of (claims["P31"] as ClaimSnakValue[] | undefined) ?? []) {
    const val = claim.mainsnak?.datavalue?.value;
    if (typeof val === "object" && val && "id" in val && typeof val.id === "string") {
      instanceOf.push({ id: val.id, label: qidMeta[val.id]?.label ?? val.id });
    }
  }
  const type = detectTypeFromInstanceOf(instanceOf.map((i) => i.id));

  // Images from Wikidata (P18 portrait preferred)
  const images: EntityImage[] = [];
  for (const pid of IMAGE_PROPERTY_IDS) {
    for (const claim of (claims[pid] as ClaimSnakValue[] | undefined) ?? []) {
      const filename = claim.mainsnak?.datavalue?.value;
      if (typeof filename !== "string") continue;
      if (!isUsableMediaFilename(filename)) continue;
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
  let thumbnail: string | undefined =
    p18?.url ||
    images[0]?.url ||
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
  const dateProps = new Set(["P569", "P570", "P571", "P576", "P577", "P580", "P582", "P585", "P1619"]);
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
    if (["P166", "P39", "P793", "P607"].includes(fact.propertyId)) {
      for (const v of fact.values) {
        const timeQ = v.qualifiers?.find((q) => ["P580", "P582", "P585"].includes(q.propertyId));
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
  "P31", "P17", "P131", "P279", "P361", "P527", "P22", "P25", "P26", "P40",
  "P19", "P20", "P27", "P106", "P108", "P69", "P112", "P463", "P1344",
  "P159", "P169", "P140", "P136", "P495", "P57", "P58", "P161", "P86",
  "P50", "P170", "P127", "P749", "P355", "P166", "P39", "P452",
];

export async function fetchGraphData(
  rootId: string,
  depth = 1,
  existingIds: Set<string> = new Set()
): Promise<GraphData> {
  const visited = new Set([...existingIds, rootId]);
  const nodes = new Map<string, import("./types.ts").GraphNode>();
  const edges: import("./types.ts").GraphEdge[] = [];
  await expandNode(rootId, depth, visited, nodes, edges);
  return { nodes: [...nodes.values()], edges };
}

async function expandNode(
  id: string,
  depth: number,
  visited: Set<string>,
  nodes: Map<string, import("./types.ts").GraphNode>,
  edges: import("./types.ts").GraphEdge[],
): Promise<void> {
  if (depth < 0) return;

  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: id,
    languages: "en",
    languagefallback: "1",
    format: "json",
    origin: "*",
    props: "labels|descriptions|claims",
  });

  const res = await fetch(`${WIKIDATA_API}?${params}`);
  if (!res.ok) return;
  const data = await res.json() as { entities: Record<string, WikidataEntity> };
  const entity = data.entities[id];
  if (!entity) return;

  const label = pickLabel(entity.labels) ?? id;
  const desc = pickLabel(entity.descriptions) ?? undefined;

  const neighbors: { qid: string; pid: string }[] = [];
  for (const pid of GRAPH_PROPS) {
    const claimList = entity.claims?.[pid] as ClaimSnakValue[] | undefined;
    if (!claimList) continue;
    for (const claim of claimList.slice(0, 5)) {
      const val = claim.mainsnak?.datavalue?.value;
      if (typeof val === "object" && val && "id" in val && typeof val.id === "string") {
        neighbors.push({ qid: val.id, pid });
      }
    }
  }

  const p31 = (entity.claims?.["P31"] as ClaimSnakValue[] | undefined) ?? [];
  const instanceOfIds = p31
    .map((c) => {
      const val = c.mainsnak?.datavalue?.value;
      return typeof val === "object" && val && "id" in val ? val.id : undefined;
    })
    .filter((x): x is string => Boolean(x));
  const type = detectTypeFromInstanceOf(instanceOfIds);

  if (!nodes.has(id)) nodes.set(id, { id, label, description: desc, type });
  if (depth === 0 || neighbors.length === 0) return;

  const newQids = neighbors.map((n) => n.qid).filter((q) => !visited.has(q));
  const batchLabels = newQids.length > 0 ? await resolveLabels(newQids) : {};
  const batchTypes = newQids.length > 0 ? await fetchEntityTypes(newQids) : {};

  for (const { qid, pid } of neighbors) {
    if (!nodes.has(qid)) {
      nodes.set(qid, {
        id: qid,
        label: batchLabels[qid] ?? qid,
        type: batchTypes[qid] ?? "unknown",
      });
    }
    const edgeId = `${id}-${pid}-${qid}`;
    if (!edges.find((e) => e.id === edgeId)) {
      edges.push({
        id: edgeId,
        source: id,
        target: qid,
        label: GRAPH_PROP_LABELS[pid] ?? pid,
        propertyId: pid,
      });
    }
    if (depth > 1 && !visited.has(qid)) {
      visited.add(qid);
      await expandNode(qid, depth - 1, visited, nodes, edges);
    }
  }
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
  await expandFamilyNode(rootId, depth, visited, nodes, edges, claimsCache);
  // Leaf nodes (depth 0) were not expanded for neighbors; still wire family
  // claims between people already on the graph (e.g. spouse → shared child).
  linkFamilyClaimsAmongKnown(claimsCache, nodes, edges);
  const normalized = normalizeChildEdgesToParent(edges, nodes);
  return { nodes: [...nodes.values()], edges: dedupeFamilyEdges(normalized) };
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

async function expandFamilyNode(
  id: string,
  depth: number,
  visited: Set<string>,
  nodes: Map<string, import("./types.ts").GraphNode>,
  edges: import("./types.ts").GraphEdge[],
  claimsCache: Map<string, Record<string, ClaimSnakValue[] | undefined>>,
): Promise<void> {
  if (depth < 0) return;

  const params = new URLSearchParams({
    action: "wbgetentities",
    ids: id,
    languages: "en",
    languagefallback: "1",
    format: "json",
    origin: "*",
    props: "labels|descriptions|claims",
  });

  const res = await fetch(`${WIKIDATA_API}?${params}`);
  if (!res.ok) return;
  const data = await res.json() as { entities: Record<string, WikidataEntity> };
  const entity = data.entities[id];
  if (!entity) return;

  claimsCache.set(id, (entity.claims ?? {}) as Record<string, ClaimSnakValue[] | undefined>);

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
    if (gender && !existing.gender) existing.gender = gender;
    if (lifespan && !existing.label.includes("\n")) {
      existing.label = `${label}\n${lifespan}`;
    }
  }

  if (depth === 0) return;

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

  const newQids = neighbors.map((n) => n.qid).filter((q) => !visited.has(q));
  const batchLabels = newQids.length > 0 ? await resolveLabels(newQids) : {};

  for (const { qid, pid } of neighbors) {
    if (!nodes.has(qid)) {
      nodes.set(qid, { id: qid, label: batchLabels[qid] ?? qid, type: "person" });
    }
    const edgeId = `${id}-${pid}-${qid}`;
    if (!edges.find((e) => e.id === edgeId)) {
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
      await expandFamilyNode(qid, depth - 1, visited, nodes, edges, claimsCache);
    }
  }
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
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
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
    if (!res.ok) continue;
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
  }
  return results;
}

async function resolvePropertyLabels(pids: string[]): Promise<Record<string, string>> {
  if (!pids.length) return {};
  const results: Record<string, string> = {};
  for (let i = 0; i < pids.length; i += 50) {
    const chunk = pids.slice(i, i + 50);
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
    if (!res.ok) continue;
    const data = await res.json() as {
      entities: Record<string, { labels?: Record<string, { value: string }> }>;
    };
    for (const [pid, ent] of Object.entries(data.entities)) {
      results[pid] = pickLabel(ent.labels) ?? pid;
    }
  }
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

/** Complete in-app Wikipedia dossier: full HTML + text sections + gallery + extra languages */
async function fetchWikipediaArticle(title: string): Promise<WikipediaArticle | undefined> {
  try {
    const [parsed, textArticle, otherLanguages] = await Promise.all([
      fetchWikipediaParsedHtml(title),
      fetchWikipediaPlainExtract(title),
      fetchOtherLanguageExtracts(title),
    ]);

    if (!parsed && !textArticle) {
      const short = await fetchWikipediaFullSummary(title);
      if (!short) return undefined;
      return {
        title,
        url: wikiUrl(title),
        lead: short,
        sections: [],
        otherLanguages,
      };
    }

    const lead = textArticle?.lead || stripHtmlToText(parsed?.html ?? "").slice(0, 1200);
    const sections = textArticle?.sections ?? [];

    // Prefer Wikipedia pageimages / REST over first parse-gallery file (often an icon SVG)
    const portrait =
      textArticle?.thumbnail ||
      pickPortraitFromGallery(parsed?.gallery) ||
      parsed?.thumbnail;

    return {
      title: parsed?.title || textArticle?.title || title,
      url: wikiUrl(title),
      lead,
      sections, // keep ALL sections including references
      html: parsed?.html,
      thumbnail: portrait,
      gallery: parsed?.gallery ?? [],
      otherLanguages,
    };
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
  };
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
  const encoded = encodeURIComponent(filename.replace(/ /g, "_"));
  // Special:FilePath redirects to an allowed Wikimedia thumbnail size
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encoded}?width=${width}`;
}

/** Skip icons, audio, and decorative wiki chrome — keep real photos/illustrations */
function isUsableMediaFilename(filename: string): boolean {
  if (!/\.(jpe?g|png|gif|webp)$/i.test(filename)) return false;
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
