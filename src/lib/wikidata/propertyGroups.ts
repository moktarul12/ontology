/**
 * Maps Wikidata property IDs → overview sections.
 * Unknown properties fall into "other" so nothing is omitted.
 */

export type SectionId =
  | "identity"
  | "life"
  | "family"
  | "career"
  | "organization"
  | "place"
  | "creative"
  | "event"
  | "science"
  | "timeline"
  | "media"
  | "identifiers"
  | "other";

export type SectionDef = {
  id: SectionId;
  title: string;
  properties: string[];
};

export const IMAGE_PROPERTY_IDS = new Set([
  "P18", "P154", "P94", "P41", "P242", "P117", "P2716", "P109", "P158", "P3451", "P1943",
]);

export const LINK_PROPERTY_IDS = new Set([
  "P856", "P2002", "P2003", "P2013", "P2397", "P2037", "P1581", "P973", "P1325", "P11266",
]);

export const IDENTIFIER_PROPERTY_IDS = new Set([
  "P213", "P214", "P227", "P244", "P345", "P496", "P646", "P1566", "P2002", "P2003",
  "P2013", "P2037", "P2397", "P3500", "P402", "P238", "P6782", "P1006", "P1015",
  "P950", "P268", "P269", "P349", "P409", "P434", "P436", "P691", "P1225", "P2397",
]);

export const PROPERTY_SECTIONS: SectionDef[] = [
  {
    id: "identity",
    title: "Identity & Names",
    properties: [
      "P1559", "P1448", "P1705", "P1476", "P2561", "P1813", "P742", "P735", "P734",
      "P97", "P21", "P91", "P172", "P103", "P1412", "P27", "P495", "P17", "P37",
      "P31", "P279", "P361", "P460", "P138", "P1449", "P1539", "P1549",
    ],
  },
  {
    id: "life",
    title: "Life & Biography",
    properties: [
      "P569", "P19", "P570", "P20", "P1196", "P509", "P119", "P106", "P101",
      "P69", "P512", "P140", "P551", "P937", "P241", "P410", "P607", "P598",
      "P793", "P1344", "P800", "P737", "P1411",
    ],
  },
  {
    id: "family",
    title: "Family & Relationships",
    properties: [
      "P22", "P25", "P26", "P40", "P3373", "P1038", "P3448", "P43", "P44", "P451",
      "P53", "P3342", "P1971",
    ],
  },
  {
    id: "career",
    title: "Career, Roles & Affiliations",
    properties: [
      "P39", "P108", "P463", "P102", "P54", "P413", "P118", "P641", "P1346",
      "P1416", "P803", "P2650", "P488", "P1303", "P412", "P264", "P358",
      "P800", "P136", "P106", "P101", "P937",
    ],
  },
  {
    id: "organization",
    title: "Organization & Structure",
    properties: [
      "P571", "P576", "P112", "P169", "P35", "P6", "P159", "P452", "P1056",
      "P749", "P355", "P1830", "P127", "P1454", "P2403", "P2139", "P1128",
      "P2295", "P414", "P740", "P3320", "P2388", "P1037", "P282",
    ],
  },
  {
    id: "place",
    title: "Geography & Place",
    properties: [
      "P625", "P131", "P17", "P30", "P36", "P1376", "P1082", "P2046", "P2044",
      "P421", "P281", "P473", "P38", "P47", "P206", "P4552", "P706", "P190",
      "P150", "P1383", "P610", "P1589", "P1332", "P1333", "P1334", "P1335",
    ],
  },
  {
    id: "creative",
    title: "Creative Work",
    properties: [
      "P50", "P57", "P58", "P161", "P86", "P170", "P175", "P136", "P577",
      "P123", "P407", "P364", "P495", "P166", "P921", "P179", "P1434",
      "P840", "P674", "P110", "P162", "P1040", "P2437", "P2047", "P1113",
    ],
  },
  {
    id: "event",
    title: "Event Details",
    properties: [
      "P585", "P580", "P582", "P276", "P710", "P1344", "P664", "P1923",
      "P2501", "P793", "P1542", "P828",
    ],
  },
  {
    id: "science",
    title: "Science & Classification",
    properties: [
      "P279", "P527", "P361", "P2283", "P1542", "P828", "P105", "P171",
      "P225", "P274", "P231", "P233", "P234", "P235", "P486", "P668",
      "P351", "P703", "P2175", "P780", "P4044",
    ],
  },
  {
    id: "timeline",
    title: "Timeline & Dates",
    properties: [
      "P580", "P582", "P585", "P571", "P576", "P569", "P570", "P577",
      "P1619", "P793", "P166", "P39", "P607",
    ],
  },
  {
    id: "media",
    title: "Media & Visuals",
    properties: [...IMAGE_PROPERTY_IDS],
  },
  {
    id: "identifiers",
    title: "Identifiers & External Links",
    properties: [
      ...IDENTIFIER_PROPERTY_IDS,
      ...LINK_PROPERTY_IDS,
      "P856", "P973", "P1325", "P953", "P2699",
    ],
  },
];

const SECTION_LOOKUP = new Map<string, SectionId>();
for (const section of PROPERTY_SECTIONS) {
  for (const pid of section.properties) {
    if (!SECTION_LOOKUP.has(pid)) SECTION_LOOKUP.set(pid, section.id);
  }
}

export const SECTION_TITLES: Record<SectionId, string> = {
  identity: "Identity & Names",
  life: "Life & Biography",
  family: "Family & Relationships",
  career: "Career, Roles & Affiliations",
  organization: "Organization & Structure",
  place: "Geography & Place",
  creative: "Creative Work",
  event: "Event Details",
  science: "Science & Classification",
  timeline: "Timeline & Dates",
  media: "Media & Visuals",
  identifiers: "Identifiers & External Links",
  other: "Other Properties",
};

export function getSectionForProperty(propertyId: string): SectionId {
  return SECTION_LOOKUP.get(propertyId) || "other";
}

export function sectionOrderForType(entityType: string): SectionId[] {
  const base: SectionId[] = [
    "identity", "life", "family", "career", "organization", "place",
    "creative", "event", "science", "timeline", "media", "identifiers", "other",
  ];

  if (entityType === "person") {
    return ["identity", "life", "family", "career", "timeline", "creative", "organization", "place", "media", "identifiers", "other"];
  }
  if (entityType === "place") {
    return ["identity", "place", "organization", "event", "timeline", "media", "identifiers", "other"];
  }
  if (entityType === "organization") {
    return ["identity", "organization", "place", "career", "timeline", "creative", "media", "identifiers", "other"];
  }
  if (entityType === "event") {
    return ["identity", "event", "place", "timeline", "career", "media", "identifiers", "other"];
  }
  if (entityType === "work") {
    return ["identity", "creative", "timeline", "science", "media", "identifiers", "other"];
  }
  if (entityType === "concept") {
    return ["identity", "science", "creative", "timeline", "place", "media", "identifiers", "other"];
  }
  return base;
}

export function groupFactsBySection(facts: Array<{ propertyId: string }>) {
  const groups: Record<SectionId, typeof facts> = {
    identity: [], life: [], family: [], career: [], organization: [],
    place: [], creative: [], event: [], science: [], timeline: [],
    media: [], identifiers: [], other: [],
  };
  for (const fact of facts) {
    groups[getSectionForProperty(fact.propertyId)].push(fact);
  }
  return groups;
}
