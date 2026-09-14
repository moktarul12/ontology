import type {
  EntitySummary,
  NarrativeTimeline,
  TimelineEvent,
  TimelineEra,
  TimelineItem,
  TimelineKind,
} from "@/lib/wikidata/types.ts";

const KINDS = new Set<TimelineKind>([
  "life", "career", "award", "work", "tour", "legacy",
]);

export type TimelineRequestBody = {
  id: string;
  label: string;
  description?: string;
  type: string;
  factsDigest: Array<{ property: string; propertyId: string; values: string[] }>;
  wikipediaLead?: string;
  /** Longer wiki extract for Gemini-dense chronology */
  wikipediaDigest?: string;
  wikiSections?: Array<{ title: string; excerpt: string }>;
  infobox?: Array<{ label: string; value: string }>;
  /** Wikipedia last revision — included in server cache key */
  wikiRevisedAt?: string;
  seedEvents: TimelineItem[];
  creativeHints: string[];
  /** Local skeleton the model should polish, not invent from scratch */
  skeleton: NarrativeTimeline;
};

const WIKI_SECTION_PRIORITY =
  /early life|personal|career|film|music|death|legacy|discograph|award|family|education|childhood|debut|bombay|mumbai|calcutta|kolkata|singing|playback/i;

function buildWikipediaDigest(entity: EntitySummary): {
  lead: string;
  digest: string;
  sections: Array<{ title: string; excerpt: string }>;
  infobox: Array<{ label: string; value: string }>;
} {
  const lead = (entity.wikipedia?.lead ?? entity.wikipediaSummary ?? "").trim();
  const wikiSections = entity.wikipedia?.sections ?? [];
  const ranked = [...wikiSections].sort((a, b) => {
    const ap = WIKI_SECTION_PRIORITY.test(a.title) ? 0 : 1;
    const bp = WIKI_SECTION_PRIORITY.test(b.title) ? 0 : 1;
    return ap - bp;
  });
  const sections = ranked.slice(0, 14).map((s) => ({
    title: s.title,
    excerpt: s.content.replace(/\s+/g, " ").trim().slice(0, 900),
  }));
  const infobox = (entity.wikipedia?.infobox ?? [])
    .filter((r) => r.kind !== "section" && r.label && r.value)
    .slice(0, 24)
    .map((r) => ({ label: r.label, value: r.value.slice(0, 200) }));

  const parts = [
    lead.slice(0, 2800),
    ...sections.map((s) => `## ${s.title}\n${s.excerpt}`),
    infobox.length
      ? `Infobox:\n${infobox.map((r) => `${r.label}: ${r.value}`).join("\n")}`
      : "",
  ].filter(Boolean);

  return {
    lead: lead.slice(0, 2800),
    digest: parts.join("\n\n").slice(0, 9000),
    sections,
    infobox,
  };
}

/** Pull year-bearing sentences from Wikipedia into timeline beats. */
function milestonesFromWikipedia(
  entity: EntitySummary,
  bands: Array<TimelineEra & { start: number; end: number }>,
  birth: number | null,
  death: number | null,
): TimelineEvent[] {
  const { digest } = buildWikipediaDigest(entity);
  if (!digest) return [];

  const sentences = digest
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^#+\s*/, "").replace(/\[[\d\s,]+\]/g, "").trim())
    .filter((s) => s.length > 35 && s.length < 420);

  const perYear = new Map<number, number>();
  const out: TimelineEvent[] = [];
  const seen = new Set<string>();

  for (const sent of sentences) {
    const y = yearFrom(sent);
    if (y == null) continue;
    if (birth != null && y < birth - 1) continue;
    if (death != null && y > death + 1) continue;
    const n = perYear.get(y) ?? 0;
    if (n >= 3) continue;
    perYear.set(y, n + 1);

    const clean = sent.replace(/\s+/g, " ");
    const clause = clean.split(/[;:—–]/)[0]?.trim() ?? clean;
    let title =
      clause.length >= 12 && clause.length <= 72
        ? clause.replace(/\.$/, "")
        : clean.slice(0, 68).replace(/\s+\S*$/, "") || `Milestone · ${y}`;
    // Avoid dumping whole paragraphs as titles
    if (title.length > 72) title = title.slice(0, 69) + "…";

    const key = `${y}|${title.toLowerCase().slice(0, 40)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const bullets = clean
      .split(/,\s+(?=[A-Z])|(?<=\.)\s+/)
      .map((b) => b.trim())
      .filter((b) => b.length > 20 && b.length < 160)
      .slice(0, 4);

    out.push({
      year: String(y),
      sortKey: `${y}-25-${String(out.length).padStart(2, "0")}-${slug(title)}`,
      title,
      summary: clean.endsWith(".") ? clean : `${clean}.`,
      kind: /award|won|received/i.test(clean)
        ? "award"
        : /married|spouse|wife|husband|divorc/i.test(clean)
          ? "life"
          : /film|song|album|sang|acted|playback|music/i.test(clean)
            ? "work"
            : "career",
      eraId: assignEraId(y, bands),
      highlights: bullets.length >= 2 ? bullets : [clean.slice(0, 140)],
    });
    if (out.length >= 28) break;
  }
  return out;
}

function yearFrom(text?: string | null): number | null {
  if (!text) return null;
  const m = text.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function factYear(entity: EntitySummary, pid: string): number | null {
  const f = entity.facts.find((x) => x.propertyId === pid);
  return yearFrom(f?.values[0]?.label);
}

function factLabel(entity: EntitySummary, pid: string): string | undefined {
  return entity.facts.find((x) => x.propertyId === pid)?.values[0]?.label;
}

function factValues(entity: EntitySummary, pid: string, limit = 8): Array<{ label: string; id?: string; year?: number | null }> {
  const f = entity.facts.find((x) => x.propertyId === pid);
  if (!f) return [];
  return f.values.slice(0, limit).map((v) => {
    const yq = v.qualifiers?.find((q) => ["P577", "P580", "P585"].includes(q.propertyId));
    return { label: v.label, id: v.id, year: yearFrom(yq?.label) ?? yearFrom(v.label) };
  });
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "era";
}

function assignEraId(year: number, eras: Array<TimelineEra & { start: number; end: number }>): string {
  for (const e of eras) {
    if (year >= e.start && year <= e.end) return e.id;
  }
  return eras[eras.length - 1]?.id ?? "career";
}

/**
 * Deterministic ChatGPT-style chronology from Wikidata — always usable without AI.
 */
export function buildLocalNarrative(entity: EntitySummary): NarrativeTimeline {
  const birth = factYear(entity, "P569");
  const death = factYear(entity, "P570");
  const careerStart = factYear(entity, "P2031") ?? (birth != null ? birth + 17 : null);
  const birthPlace = factLabel(entity, "P19");
  const deathPlace = factLabel(entity, "P20");
  const occupations = factValues(entity, "P106", 6).map((v) => v.label);
  const now = new Date().getFullYear();
  const endYear = death ?? now;
  const startYear = birth ?? careerStart ?? endYear - 40;

  type EraBand = TimelineEra & { start: number; end: number };
  const bands: EraBand[] = [];

  if (entity.type === "person" && birth != null) {
    const rise = careerStart ?? birth + 17;
    const careerSpan = Math.max(1, endYear - rise);
    // Three career thirds so peak does not swallow the whole arc (e.g. Kishore → 1987)
    const t1 = rise + Math.floor(careerSpan / 3);
    const t2 = rise + Math.floor((2 * careerSpan) / 3);
    bands.push({
      id: "early-life",
      title: "Early life",
      years: `${birth}–${Math.max(birth, rise - 1)}`,
      start: birth,
      end: Math.max(birth, rise - 1),
      summary: birthPlace
        ? `Born in ${birthPlace}${occupations.length ? `; later known as ${occupations.slice(0, 3).join(", ")}` : ""}.`
        : `Formative years before a public career.`,
    });
    if (rise <= endYear) {
      bands.push({
        id: "rising",
        title: "Rising years",
        years: `${rise}–${Math.max(rise, t1)}`,
        start: rise,
        end: Math.max(rise, t1),
        summary: `Public career takes shape${occupations.length ? ` as ${occupations[0]}` : ""}.`,
      });
    }
    if (t1 + 1 <= endYear) {
      bands.push({
        id: "peak",
        title: "Peak years",
        years: `${Math.min(t1 + 1, endYear)}–${Math.max(t1 + 1, t2)}`,
        start: Math.min(t1 + 1, endYear),
        end: Math.max(t1 + 1, t2),
        summary: `High-visibility creative period — songs, films, and recognition cluster here.`,
      });
    }
    if (t2 + 1 <= endYear || death != null) {
      bands.push({
        id: "later",
        title: death != null ? "Final chapter" : "Later years",
        years: `${Math.min(t2 + 1, endYear)}–${endYear}`,
        start: Math.min(t2 + 1, endYear),
        end: endYear,
        summary: death != null
          ? `Closing years${deathPlace ? ` in ${deathPlace}` : ""} through ${endYear}.`
          : `Continuing work and public presence into ${endYear}.`,
      });
    }
  } else {
    bands.push({
      id: "timeline",
      title: "Timeline",
      years: `${startYear}–${endYear}`,
      start: startYear,
      end: endYear,
      summary: entity.description ?? "Key recorded milestones.",
    });
  }

  const events: TimelineEvent[] = [];
  const push = (ev: TimelineEvent) => {
    if (!ev.title.trim()) return;
    events.push(ev);
  };

  if (birth != null) {
    push({
      year: String(birth),
      sortKey: `${birth}-01`,
      title: birthPlace ? `Birth in ${birthPlace}` : "Birth",
      summary: [
        factLabel(entity, "P569"),
        birthPlace ? `in ${birthPlace}` : null,
      ].filter(Boolean).join(" — ") + ".",
      kind: "life",
      eraId: assignEraId(birth, bands),
      highlights: [
        birthPlace ? `Born in ${birthPlace}` : `Born in ${birth}`,
        occupations.length ? `Later known as ${occupations.slice(0, 3).join(", ")}` : null,
      ].filter(Boolean) as string[],
    });
  }

  // Education
  for (const school of factValues(entity, "P69", 4)) {
    const y = school.year ?? (birth != null ? birth + 12 : careerStart);
    if (y == null) continue;
    push({
      year: String(y),
      sortKey: `${y}-12-${slug(school.label)}`,
      title: `Education at ${school.label}`,
      summary: `Associated with ${school.label} during the formative years.`,
      kind: "life",
      eraId: assignEraId(y, bands),
      entityId: school.id,
      highlights: [`Studied at ${school.label}`],
    });
  }

  if (careerStart != null) {
    push({
      year: String(careerStart),
      sortKey: `${careerStart}-02`,
      title: "Move into a public career",
      summary: `Work period starts around ${careerStart}${occupations[0] ? ` as a ${occupations[0]}` : ""}.`,
      kind: "career",
      eraId: assignEraId(careerStart, bands),
      highlights: [
        `Career start around ${careerStart}`,
        occupations[0] ? `Primary craft: ${occupations[0]}` : null,
      ].filter(Boolean) as string[],
    });
  }

  // Spouses / partners
  for (const spouse of factValues(entity, "P26", 6)) {
    const y = spouse.year ?? (careerStart != null ? careerStart + 4 : birth != null ? birth + 22 : null);
    if (y == null) continue;
    push({
      year: String(y),
      sortKey: `${y}-15-${slug(spouse.label)}`,
      title: `Marriage to ${spouse.label}`,
      summary: `Personal life chapter with ${spouse.label}.`,
      kind: "life",
      eraId: assignEraId(y, bands),
      entityId: spouse.id,
      highlights: [`Married ${spouse.label}${spouse.year ? ` (${spouse.year})` : ""}`],
    });
  }

  // Children as life beats when dated
  for (const child of factValues(entity, "P40", 4)) {
    if (child.year == null) continue;
    push({
      year: String(child.year),
      sortKey: `${child.year}-16-${slug(child.label)}`,
      title: `Child: ${child.label}`,
      summary: `${child.label} enters the family record.`,
      kind: "life",
      eraId: assignEraId(child.year, bands),
      entityId: child.id,
      highlights: [`${child.label} · ${child.year}`],
    });
  }

  // Awards — prefer known year; otherwise place in peak / later, not all in one year
  const peakBand = bands.find((b) => b.id === "peak");
  const laterBand = bands.find((b) => b.id === "later");
  const awardList = factValues(entity, "P166", 14);
  awardList.forEach((a, i) => {
    const fallbackY =
      a.year ??
      (peakBand
        ? peakBand.start + Math.floor(((peakBand.end - peakBand.start) * (i + 1)) / (awardList.length + 1))
        : endYear - 5);
    const y = a.year ?? fallbackY;
    push({
      year: String(y),
      sortKey: `${y}-50-${slug(a.label)}`,
      title: a.label,
      summary: `Recognized with ${a.label}.`,
      kind: "award",
      eraId: assignEraId(y, bands),
      entityId: a.id,
      highlights: [a.label, a.year ? `Award year ${a.year}` : `Placed in ${y} on the chronology`],
    });
  });

  // Structured Wikidata timeline items with real dates
  for (const item of entity.timeline.slice(0, 40)) {
    const y = yearFrom(item.date) ?? yearFrom(item.sortKey);
    if (y == null) continue;
    if (birth != null && y < birth - 1) continue;
    if (death != null && y > death + 1) continue;
    const title = item.value
      ? `${item.label}: ${item.value}`
      : item.label;
    if (/^date of birth$/i.test(item.label) || /^date of death$/i.test(item.label)) continue;
    push({
      year: String(y),
      sortKey: `${y}-22-${slug(title)}`,
      title: title.length > 70 ? title.slice(0, 67) + "…" : title,
      summary: item.value
        ? `${item.label} — ${item.value} (${item.date}).`
        : `${item.label}: ${item.date}.`,
      kind: /award/i.test(item.label) ? "award" : "career",
      eraId: assignEraId(y, bands),
      entityId: item.entityId,
      highlights: [item.value ?? item.date, item.date].filter(Boolean),
    });
  }

  // Creative works — spread across rising / peak / later through the full lifespan
  const workPool: Array<{ label: string; id?: string; kind: TimelineKind; context: string; year?: number | null }> = [];
  for (const pid of ["CR_SONG", "P175", "CR_FILM", "P161", "CR_ALBUM", "P800", "P86"] as const) {
    const ctx =
      pid === "CR_SONG" || pid === "P175" ? "Song"
        : pid === "CR_FILM" || pid === "P161" ? "Film"
          : pid === "CR_ALBUM" ? "Album"
            : pid === "P86" ? "Composition"
              : "Work";
    for (const v of factValues(entity, pid, 14)) {
      if (/^Q\d+$/.test(v.label)) continue;
      if (workPool.some((w) => w.label === v.label)) continue;
      workPool.push({ label: v.label, id: v.id, kind: "work", context: ctx, year: v.year });
    }
  }

  const careerBands = bands.filter((b) => b.id === "rising" || b.id === "peak" || b.id === "later");
  const distributeBands = careerBands.length ? careerBands : bands;
  workPool.slice(0, 24).forEach((w, i) => {
    const band = distributeBands[i % distributeBands.length]!;
    const span = Math.max(0, band.end - band.start);
    const slot = Math.floor(i / distributeBands.length);
    const y = w.year ?? band.start + Math.min(slot, span);
    push({
      year: String(y),
      sortKey: `${y}-30-${String(i).padStart(2, "0")}-${slug(w.label)}`,
      title: w.label,
      summary: `${w.context} linked to ${entity.label} in Wikidata / MusicBrainz credits.`,
      kind: w.kind,
      eraId: band.id,
      entityId: w.id,
      highlights: [w.context, w.label, w.year ? `Dated ${w.year}` : null].filter(Boolean) as string[],
    });
  });

  // Wikipedia-mined beats (Gemini density without AI)
  for (const ev of milestonesFromWikipedia(entity, bands, birth, death)) {
    push(ev);
  }

  // Mid-career / later anchors so the spine never stops in the 1960s for long lives
  if (peakBand && peakBand.end > peakBand.start) {
    const midPeak = Math.floor((peakBand.start + peakBand.end) / 2);
    push({
      year: String(midPeak),
      sortKey: `${midPeak}-40-prime`,
      title: "Creative prime",
      summary: `Deep into ${peakBand.title.toLowerCase()} (${peakBand.years}) — the catalogue thickens and the public voice is unmistakable.`,
      kind: "career",
      eraId: peakBand.id,
      highlights: [
        `Peak window ${peakBand.years}`,
        workPool[0] ? `Signature work: ${workPool[0].label}` : null,
      ].filter(Boolean) as string[],
    });
  }
  if (laterBand && laterBand.end > laterBand.start) {
    const midLater = Math.floor((laterBand.start + laterBand.end) / 2);
    push({
      year: String(midLater),
      sortKey: `${midLater}-40-later`,
      title: laterBand.title === "Final chapter" ? "Late career" : "Continuing presence",
      summary: `Through ${laterBand.years}, ${entity.label} remains an active name in ${occupations[0] ?? "the field"}.`,
      kind: "career",
      eraId: laterBand.id,
      highlights: [`Active through ${laterBand.years}`],
    });
  }

  if (death != null) {
    push({
      year: String(death),
      sortKey: `${death}-99`,
      title: deathPlace ? `Death in ${deathPlace}` : "Death",
      summary: [
        factLabel(entity, "P570"),
        deathPlace ? `in ${deathPlace}` : null,
      ].filter(Boolean).join(" — ") + ".",
      kind: "life",
      eraId: assignEraId(death, bands),
      highlights: [
        deathPlace ? `Died in ${deathPlace}` : `Died in ${death}`,
        `Lifespan closes ${death}`,
      ],
    });
  }

  // Dedupe near-identical title+year, keep denser highlights
  {
    const byKey = new Map<string, TimelineEvent>();
    for (const ev of events) {
      const k = `${ev.year}|${ev.title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 36)}`;
      const prev = byKey.get(k);
      if (!prev) {
        byKey.set(k, ev);
        continue;
      }
      const prevH = prev.highlights?.length ?? 0;
      const nextH = ev.highlights?.length ?? 0;
      if (nextH > prevH || (ev.summary?.length ?? 0) > (prev.summary?.length ?? 0)) {
        byKey.set(k, { ...ev, highlights: [...new Set([...(prev.highlights ?? []), ...(ev.highlights ?? [])])].slice(0, 8) });
      }
    }
    events.length = 0;
    events.push(...byKey.values());
  }

  // Keep every era that has a band for persons with a known death (avoid dropping Final chapter)
  events.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  if (events.length > 40) events.splice(40);

  // Enrich each moment with creative long-form detail for the drawer
  for (const ev of events) {
    const era = bands.find((b) => b.id === ev.eraId);
    const packed = expandMomentDetail(entity, ev, era, events);
    ev.detail = packed.story;
    ev.whyItMatters = packed.whyItMatters;
  }

  const used = new Set(events.map((e) => e.eraId));
  const eras: TimelineEra[] = bands
    .filter((b) => used.has(b.id) || b.id === "later" || bands.length <= 2)
    .map(({ id, title, years, summary }) => ({ id, title, years, summary }));

  // Reassign orphaned events
  const eraIds = new Set(eras.map((e) => e.id));
  for (const ev of events) {
    if (!eraIds.has(ev.eraId) && eras[0]) ev.eraId = eras[0].id;
  }

  const signatureWorks = workPool.slice(0, 8).map((w, i) => {
    const band = distributeBands[i % distributeBands.length]!;
    const span = Math.max(0, band.end - band.start);
    return {
      year: String(band.start + Math.min(i, span)),
      title: w.label,
      context: w.context,
    };
  });

  const tagline =
    entity.description ??
    (occupations.length
      ? `${occupations.slice(0, 3).join(" · ")}`
      : undefined);

  const legacy =
    entity.type === "person" && (death != null || workPool.length > 0)
      ? `${entity.label} remains defined by ${
          workPool[0] ? `works like “${workPool[0].label}”` : "a wide creative catalogue"
        }${occupations[0] ? ` and a lasting mark as a ${occupations[0]}` : ""}.`
      : undefined;

  return {
    tagline,
    legacy,
    eras,
    events,
    signatureWorks: signatureWorks.length ? signatureWorks : undefined,
    fallback: true,
  };
}

export function buildTimelineSeed(entity: EntitySummary): TimelineRequestBody {
  const skeleton = buildLocalNarrative(entity);
  const wiki = buildWikipediaDigest(entity);
  const priority = new Set([
    "P569", "P570", "P19", "P20", "P106", "P166", "P2031", "P26", "P69", "P40",
    "CR_SONG", "CR_ALBUM", "CR_FILM", "P800",
  ]);

  return {
    id: entity.id,
    label: entity.label,
    description: entity.description,
    type: entity.type,
    factsDigest: entity.facts
      .filter((f) => priority.has(f.propertyId))
      .slice(0, 16)
      .map((f) => ({
        property: f.property,
        propertyId: f.propertyId,
        values: f.values.slice(0, 8).map((v) => {
          const yq = v.qualifiers?.find((q) =>
            ["P577", "P580", "P585"].includes(q.propertyId),
          );
          return yq?.label ? `${v.label} (${yq.label})` : v.label;
        }),
      })),
    wikipediaLead: wiki.lead,
    wikipediaDigest: wiki.digest,
    wikiSections: wiki.sections,
    infobox: wiki.infobox,
    wikiRevisedAt: entity.wikipedia?.revisedAt,
    seedEvents: entity.timeline.slice(0, 28),
    creativeHints: (skeleton.signatureWorks ?? []).map((w) => `${w.context}: ${w.title}`),
    skeleton: {
      tagline: skeleton.tagline,
      legacy: skeleton.legacy,
      eras: skeleton.eras,
      events: skeleton.events.slice(0, 28).map((e) => ({
        year: e.year,
        sortKey: e.sortKey,
        title: e.title,
        summary: e.summary,
        kind: e.kind,
        eraId: e.eraId,
        highlights: e.highlights?.slice(0, 6),
      })),
      signatureWorks: skeleton.signatureWorks?.slice(0, 10),
    },
  };
}

function asKind(v: unknown): TimelineKind {
  return typeof v === "string" && KINDS.has(v as TimelineKind) ? (v as TimelineKind) : "career";
}

/**
 * Creative long-form copy for a clicked timeline moment.
 * Grounded in entity facts + era + Wikipedia — used by the depth flyout.
 */
export function expandMomentDetail(
  entity: EntitySummary,
  event: TimelineEvent,
  era?: TimelineEra | (TimelineEra & { start?: number; end?: number }),
  allEvents: TimelineEvent[] = [],
): {
  story: string;
  whyItMatters: string;
  scene: string;
  related: TimelineEvent[];
  sameYear: TimelineEvent[];
  neighbors: { prev?: TimelineEvent; next?: TimelineEvent };
  contextNotes: string[];
  wikiExcerpts: Array<{ title: string; excerpt: string }>;
  eraSummary?: string;
} {
  const name = entity.label;
  const occupations = factValues(entity, "P106", 4).map((v) => v.label);
  const birthPlace = factLabel(entity, "P19");
  const genre = factValues(entity, "P136", 3).map((v) => v.label);
  const eraTitle = era?.title ?? "this chapter";
  const eraYears = era?.years ?? event.year;
  const y = yearFrom(event.year) ?? yearFrom(event.sortKey);

  const sorted = [...allEvents].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const idx = sorted.findIndex(
    (e) => e.sortKey === event.sortKey && e.title === event.title,
  );
  const neighbors = {
    prev: idx > 0 ? sorted[idx - 1] : undefined,
    next: idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : undefined,
  };

  const related = allEvents
    .filter((e) => e.eraId === event.eraId && e.sortKey !== event.sortKey)
    .slice(0, 6);

  const sameYear = allEvents
    .filter(
      (e) =>
        (yearFrom(e.year) ?? yearFrom(e.sortKey)) === y &&
        !(e.sortKey === event.sortKey && e.title === event.title),
    )
    .slice(0, 8);

  const contextNotes: string[] = [];
  if (era?.summary) contextNotes.push(era.summary);
  if (occupations.length) {
    contextNotes.push(`${name} is recorded as ${occupations.slice(0, 3).join(", ")}.`);
  }
  if (birthPlace) contextNotes.push(`Place of birth: ${birthPlace}.`);
  const deathPlace = factLabel(entity, "P20");
  if (deathPlace) contextNotes.push(`Place of death: ${deathPlace}.`);
  for (const spouse of factValues(entity, "P26", 3)) {
    contextNotes.push(
      spouse.year
        ? `Spouse: ${spouse.label} (${spouse.year}).`
        : `Spouse: ${spouse.label}.`,
    );
  }
  for (const a of factValues(entity, "P166", 4)) {
    if (a.year != null && y != null && Math.abs(a.year - y) <= 2) {
      contextNotes.push(`Nearby award: ${a.label}${a.year ? ` (${a.year})` : ""}.`);
    }
  }
  if (event.highlights?.length) {
    for (const h of event.highlights.slice(0, 4)) {
      if (h.trim() && !contextNotes.includes(h.trim())) contextNotes.push(h.trim());
    }
  }

  // Pull Wikipedia sentences that mention this year (or title keywords)
  const wikiExcerpts: Array<{ title: string; excerpt: string }> = [];
  const titleBits = event.title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3)
    .slice(0, 4);
  const lead = entity.wikipedia?.lead ?? entity.wikipediaSummary ?? "";
  const sections = [
    { title: "Lead", content: lead },
    ...(entity.wikipedia?.sections ?? []).slice(0, 16),
  ];
  for (const sec of sections) {
    if (wikiExcerpts.length >= 4) break;
    const sentences = sec.content
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length > 40 && s.length < 420);
    for (const sent of sentences) {
      if (wikiExcerpts.length >= 4) break;
      const yearHit = y != null && sent.includes(String(y));
      const titleHit =
        titleBits.length > 0 &&
        titleBits.some((b) => sent.toLowerCase().includes(b));
      if (!yearHit && !titleHit) continue;
      if (wikiExcerpts.some((w) => w.excerpt === sent)) continue;
      wikiExcerpts.push({ title: sec.title, excerpt: sent });
    }
  }

  let story = event.detail || event.summary;
  let whyItMatters = event.whyItMatters || "";
  let scene = `${event.year} · ${eraTitle}`;

  if (event.kind === "life" && /born|birth/i.test(event.title)) {
    story =
      event.detail ||
      `In ${event.year}, ${name} enters the record${birthPlace ? ` in ${birthPlace}` : ""}. ` +
        `The years ahead will fold ${occupations.slice(0, 2).join(" and ") || "a public craft"} into one of the most recognizable arcs in the field. ` +
        `This is the quiet beginning of ${eraTitle.toLowerCase()} (${eraYears}). ` +
        (neighbors.next
          ? `What follows next on the spine is “${neighbors.next.title}” (${neighbors.next.year}).`
          : "");
    whyItMatters =
      whyItMatters ||
      `Without this origin point, the later songs, films, and awards have no stage to stand on.`;
    scene = birthPlace ? `Dawn in ${birthPlace}` : `A life begins`;
  } else if (event.kind === "life" && /died|death/i.test(event.title)) {
    story =
      event.detail ||
      `${event.year} closes the living chapter${deathPlace ? ` in ${deathPlace}` : ""}. ` +
        `What remains is the catalogue — the voice, the screen presence, the awards — already woven through ${eraTitle.toLowerCase()}. ` +
        (neighbors.prev
          ? `The beat just before was “${neighbors.prev.title}” (${neighbors.prev.year}).`
          : "");
    whyItMatters =
      whyItMatters ||
      `An ending that freezes a legend in public memory rather than ending the work’s afterlife.`;
    scene = `Curtain · ${event.year}`;
  } else if (event.kind === "life" && /marri/i.test(event.title)) {
    story =
      event.detail ||
      `In ${event.year}, personal life intersects the public arc: ${event.title}. ` +
        `Inside ${eraTitle} (${eraYears}), private choices sit beside the professional catalogue and help explain the pace of the years around them.`;
    whyItMatters =
      whyItMatters ||
      `Family beats are not footnotes — they reshape where someone works, lives, and is remembered.`;
    scene = `Private life · ${event.year}`;
  } else if (event.kind === "career" && /career|begins|start|move into/i.test(event.title)) {
    story =
      event.detail ||
      `Around ${event.year}, ${name} steps into professional light` +
        `${occupations[0] ? ` as a ${occupations[0]}` : ""}. ` +
        `This is the hinge between private formation and the public arc of ${eraTitle} (${eraYears}).`;
    whyItMatters =
      whyItMatters ||
      `Career start marks when the name stops being potential and starts being a credit line.`;
    scene = `First professional light`;
  } else if (event.kind === "award") {
    story =
      event.detail ||
      `${event.year}: ${name} is marked with “${event.title}”. ` +
        `In the atmosphere of ${eraTitle}, recognition arrives not as a surprise bolt but as the industry’s way of saying the work had already changed the room. ` +
        (sameYear.length
          ? `The same year also carries ${sameYear.map((e) => e.title).slice(0, 3).join("; ")}.`
          : "");
    whyItMatters =
      whyItMatters ||
      `Awards freeze a moment of consensus — useful for history, even when the art was already ahead of the trophy.`;
    scene = `Applause on the record`;
  } else if (event.kind === "work") {
    const ctx = event.highlights?.[0] ?? "Work";
    story =
      event.detail ||
      `“${event.title}” surfaces in ${event.year} as a ${ctx.toLowerCase()} in ${name}’s orbit. ` +
        `Placed inside ${eraTitle} (${eraYears})${genre.length ? `, amid ${genre.slice(0, 2).join(" / ")}` : ""}, ` +
        `it is one of the concrete artifacts listeners and viewers still reach for when they say the name.`;
    whyItMatters =
      whyItMatters ||
      `Individual works are how a reputation becomes tangible — not a résumé line, but something you can hear or watch.`;
    scene = `${ctx} in the air`;
  } else {
    story =
      event.detail ||
      event.summary ||
      `In ${event.year}, during ${eraTitle}, “${event.title}” lands as a documented beat in ${name}’s chronology.`;
    whyItMatters =
      whyItMatters ||
      `Small documented beats keep the chronology honest when myth wants to smooth everything into legend.`;
  }

  // Lengthen story when we have wiki excerpts
  if (wikiExcerpts[0] && !(event.detail && event.detail.length > 180)) {
    story = `${story} Wikipedia notes: ${wikiExcerpts[0].excerpt}`;
  }

  return {
    story,
    whyItMatters,
    scene,
    related,
    sameYear,
    neighbors,
    contextNotes: [...new Set(contextNotes)].slice(0, 10),
    wikiExcerpts,
    eraSummary: era?.summary,
  };
}

/** Coerce messy model JSON into a safe NarrativeTimeline. */
export function normalizeNarrative(
  raw: unknown,
  fallback: NarrativeTimeline,
): NarrativeTimeline | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const erasIn = Array.isArray(o.eras) ? o.eras : [];
  const eventsIn = Array.isArray(o.events) ? o.events : [];
  if (erasIn.length < 1 || eventsIn.length < 1) return null;

  const eras: TimelineEra[] = erasIn.slice(0, 10).map((e, i) => {
    const row = (e ?? {}) as Record<string, unknown>;
    const id = String(row.id ?? `era-${i}`);
    return {
      id,
      title: String(row.title ?? `Era ${i + 1}`),
      years: String(row.years ?? ""),
      summary: String(row.summary ?? ""),
    };
  });
  const eraIds = new Set(eras.map((e) => e.id));
  const fallbackEra = eras[0]!.id;

  const events: TimelineEvent[] = eventsIn.slice(0, 40).map((e, i) => {
    const row = (e ?? {}) as Record<string, unknown>;
    const year = String(row.year ?? "");
    const sortKey = String(row.sortKey ?? yearFrom(year) ?? String(1000 + i));
    let eraId = String(row.eraId ?? fallbackEra);
    if (!eraIds.has(eraId)) eraId = fallbackEra;
    const highlights = Array.isArray(row.highlights)
      ? row.highlights.map(String).filter(Boolean).slice(0, 8)
      : undefined;
    return {
      year: year || sortKey.slice(0, 4),
      sortKey,
      title: String(row.title ?? "Milestone"),
      summary: String(row.summary ?? ""),
      kind: asKind(row.kind),
      eraId,
      highlights,
      entityId: typeof row.entityId === "string" ? row.entityId : undefined,
      detail: row.detail != null ? String(row.detail) : undefined,
      whyItMatters: row.whyItMatters != null ? String(row.whyItMatters) : undefined,
    };
  });

  events.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  const signatureWorks = Array.isArray(o.signatureWorks)
    ? o.signatureWorks.slice(0, 10).map((w) => {
        const row = (w ?? {}) as Record<string, unknown>;
        return {
          year: String(row.year ?? "—"),
          title: String(row.title ?? ""),
          context: row.context != null ? String(row.context) : undefined,
        };
      }).filter((w) => w.title)
    : fallback.signatureWorks;

  return {
    tagline: o.tagline != null ? String(o.tagline) : fallback.tagline,
    legacy: o.legacy != null ? String(o.legacy) : fallback.legacy,
    eras,
    events,
    signatureWorks,
    fallback: false,
  };
}

/**
 * If AI truncates mid-career (e.g. stops at 1969), append local later/death moments
 * and any missing lifespan eras so the spine reaches birth→death.
 * If AI stays thin (<16 events), merge unique local Wikipedia/Wikidata beats.
 */
function stitchFullLifespan(
  local: NarrativeTimeline,
  ai: NarrativeTimeline,
): NarrativeTimeline {
  const yearOf = (e: TimelineEvent) => yearFrom(e.year) ?? yearFrom(e.sortKey) ?? 0;
  const eventKey = (e: TimelineEvent) =>
    `${yearOf(e)}|${e.title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40)}`;

  let events = [...ai.events];
  const titles = new Set(ai.events.map((e) => e.title.toLowerCase()));
  const keys = new Set(ai.events.map(eventKey));

  const aiMax = Math.max(0, ...ai.events.map(yearOf));
  const localMax = Math.max(0, ...local.events.map(yearOf));

  const bookendTitles = new Set([
    "died", "death", "born", "birth", "career begins", "late career", "continuing presence",
  ]);

  for (const e of local.events) {
    const t = e.title.toLowerCase();
    const isBookend =
      bookendTitles.has(t) ||
      t.startsWith("birth ") ||
      t.startsWith("death ") ||
      t.startsWith("marriage ");
    const late = yearOf(e) > aiMax;
    const thin = ai.events.length < 16;
    if (keys.has(eventKey(e))) continue;
    if (isBookend && !titles.has(t) && !titles.has(t.replace(/^death.*/, "died"))) {
      events.push(e);
      keys.add(eventKey(e));
      continue;
    }
    if (late && localMax > aiMax + 1) {
      events.push(e);
      keys.add(eventKey(e));
      continue;
    }
    if (thin) {
      events.push(e);
      keys.add(eventKey(e));
    }
  }

  events = events.sort((a, b) => a.sortKey.localeCompare(b.sortKey)).slice(0, 40);

  const eraIds = new Set(ai.eras.map((e) => e.id));
  const eras = [...ai.eras];
  for (const e of local.eras) {
    if (!eraIds.has(e.id)) eras.push(e);
  }
  const byId = new Map(local.eras.map((e) => [e.id, e]));
  const mergedEras = eras.map((e) => byId.get(e.id) ?? e);

  return {
    ...ai,
    eras: mergedEras,
    events,
    signatureWorks: ai.signatureWorks?.length ? ai.signatureWorks : local.signatureWorks,
    fallback: false,
  };
}

/**
 * Local chronology first; AI polish when available.
 */
export async function fetchNarrativeTimeline(
  entity: EntitySummary,
): Promise<NarrativeTimeline> {
  const local = buildLocalNarrative(entity);
  const seed = buildTimelineSeed(entity);

  try {
    const res = await fetch("/api/ai/timeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(seed),
    });

    if (!res.ok) {
      return {
        ...local,
        fallback: true,
        hint: res.status === 503
          ? "Showing structured Wikidata chronology. Add GROQ_API_KEY for AI prose polish."
          : "Showing structured Wikidata chronology (AI polish unavailable).",
      };
    }

    const data: unknown = await res.json();
    const normalized = normalizeNarrative(data, local);
    if (!normalized) {
      return {
        ...local,
        fallback: true,
        hint: "Showing structured Wikidata chronology (AI returned incomplete JSON).",
      };
    }
    // Fill creative drawer copy using real entity context when AI omitted it
    for (const ev of normalized.events) {
      const era = normalized.eras.find((e) => e.id === ev.eraId);
      const packed = expandMomentDetail(entity, ev, era, normalized.events);
      if (!ev.detail) ev.detail = packed.story;
      if (!ev.whyItMatters) ev.whyItMatters = packed.whyItMatters;
    }
    return stitchFullLifespan(local, normalized);
  } catch {
    return {
      ...local,
      fallback: true,
      hint: "Showing structured Wikidata chronology (AI offline).",
    };
  }
}
