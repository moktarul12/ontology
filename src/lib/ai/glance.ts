import type { EntitySummary, EntityType } from "@/lib/wikidata/types.ts";

export type GlanceMetric = {
  label: string;
  value: string;
  note?: string;
};

export type GlanceCard = {
  label: string;
  value: string;
  note?: string;
  tone?: "hq" | "people" | "market" | "product" | "life" | "default";
};

export type GlanceItem = {
  label: string;
  value: string;
  note?: string;
  icon?: string;
};

export type GlanceBand = {
  id: string;
  title: string;
  layout: "rows" | "tiles" | "roles";
  items: GlanceItem[];
};

export type GlanceIdentity = {
  name: string;
  years?: string;
  crafts?: string;
  quote?: string;
  quoteNative?: string;
  featureTitle?: string;
  bio?: string;
};

export type GlanceSnapshot = {
  heading: string;
  pulse: string;
  metrics: GlanceMetric[];
  cards: GlanceCard[];
  bands?: GlanceBand[];
  identity?: GlanceIdentity;
  footnote?: string;
  fallback?: boolean;
  hint?: string;
};

function fact(entity: EntitySummary, pid: string) {
  return entity.facts.find((x) => x.propertyId === pid);
}

function factLabel(entity: EntitySummary, pid: string): string | undefined {
  return fact(entity, pid)?.values[0]?.label;
}

function factLabels(entity: EntitySummary, pid: string, limit = 4): string[] {
  return (fact(entity, pid)?.values ?? [])
    .slice(0, limit)
    .map((v) => v.label)
    .filter(Boolean);
}

function shortMoney(label: string): string {
  return label
    .replace(/\s*United States dollar\b/gi, " USD")
    .replace(/\s*euro\b/gi, " EUR")
    .replace(/\s*pound sterling\b/gi, " GBP")
    .replace(/\s*Indian rupee\b/gi, " INR")
    .trim();
}

function wikiRow(entity: EntitySummary, labelRe: RegExp): string | undefined {
  const row = entity.wikipedia?.infobox?.find(
    (r) => r.kind !== "section" && labelRe.test(r.label),
  );
  return row?.value?.replace(/\s+/g, " ").trim();
}

function wikiByLabel(entity: EntitySummary, needles: string[]): string | undefined {
  const rows = entity.wikipedia?.infobox ?? [];
  for (const needle of needles) {
    const n = needle.toLowerCase();
    const row = rows.find(
      (r) => r.kind !== "section" && r.label.toLowerCase().includes(n) && r.value,
    );
    if (row?.value) return row.value.replace(/\s+/g, " ").trim();
  }
}

function compactStat(label: string): string {
  const s = shortMoney(label)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= 42) return s;
  return `${s.slice(0, 39).trimEnd()}…`;
}

function yearOf(text?: string): string | undefined {
  return text?.match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1];
}

function similarTo(a: string, b: string): boolean {
  const x = a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const y = b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!x || !y) return false;
  if (x === y) return true;
  return x.includes(y) || y.includes(x);
}

function blobOf(entity: EntitySummary): string {
  const infobox = (entity.wikipedia?.infobox ?? [])
    .filter((r) => r.kind !== "section")
    .map((r) => r.value)
    .join(" ");
  return `${entity.description ?? ""} ${entity.wikipedia?.lead ?? ""} ${infobox}`;
}

function parseAmount(text: string): number | undefined {
  const cleaned = text
    .replace(/,/g, "")
    .replace(/united states dollar/gi, " ")
    .replace(/us\$|usd|eur|gbp|inr|\$/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = cleaned.match(/([\d.]+)\s*(trillion|billion|million|thousand|[KMBT])?/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const u = (m[2] || "").toLowerCase();
  const mul =
    u.startsWith("trillion") || u === "t" ? 1e12
      : u.startsWith("billion") || u === "b" ? 1e9
        : u.startsWith("million") || u === "m" ? 1e6
          : u.startsWith("thousand") || u === "k" ? 1e3
            : 1;
  return n * mul;
}

function asMoney(text: string): string {
  const n = parseAmount(text);
  if (n == null) return compactStat(text).replace(/\s*USD$/i, "");
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  const fmt = (x: number, suffix: string) => {
    const body = x >= 10 || Number.isInteger(x)
      ? x.toFixed(0)
      : x.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    return `${sign}$${body}${suffix}`;
  };
  if (abs >= 1e9) return fmt(abs / 1e9, "B");
  if (abs >= 1e6) return fmt(abs / 1e6, "M");
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function asHeadcount(text: string): string {
  const n = parseAmount(text);
  if (n == null) return compactStat(text);
  if (n >= 1e6) {
    const m = n / 1e6;
    return `${m >= 10 || Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return Math.round(n).toLocaleString("en-US");
}

function asPlaces(text: string, plus = false): string {
  const n = parseAmount(text);
  if (n == null) return compactStat(text);
  if (plus && n >= 100) {
    const floor = Math.floor(n / 100) * 100;
    return `${floor.toLocaleString("en-US")}+`;
  }
  return Math.round(n).toLocaleString("en-US");
}

function neatPlace(label: string): string {
  return label
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,?\s*United States\.?$/i, "")
    .replace(/,?\s*U\.S\.A?\.?$/i, "")
    .trim();
}

function compactDate(label: string): string {
  return label
    .replace(/\bJanuary\b/g, "Jan").replace(/\bFebruary\b/g, "Feb")
    .replace(/\bMarch\b/g, "Mar").replace(/\bApril\b/g, "Apr")
    .replace(/\bJune\b/g, "Jun").replace(/\bJuly\b/g, "Jul")
    .replace(/\bAugust\b/g, "Aug").replace(/\bSeptember\b/g, "Sep")
    .replace(/\bOctober\b/g, "Oct").replace(/\bNovember\b/g, "Nov")
    .replace(/\bDecember\b/g, "Dec")
    .replace(/\s+/g, " ")
    .trim();
}

function exchangeCode(name: string): string {
  const l = name.toLowerCase();
  if (/new york|nyse/.test(l)) return "NYSE";
  if (/nasdaq/.test(l)) return "NASDAQ";
  if (/london|lse/.test(l)) return "LSE";
  if (/bombay|bse/.test(l)) return "BSE";
  if (/national stock exchange/.test(l)) return "NSE";
  if (/tokyo|tse/.test(l)) return "TSE";
  return compactStat(name);
}

function siteHost(entity: EntitySummary): string | undefined {
  const raw =
    entity.officialUrl ||
    entity.links.find((l) => l.kind === "website")?.url ||
    factLabel(entity, "P856");
  if (!raw) return undefined;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0];
  }
}

function orgFlavor(entity: EntitySummary): string {
  return [
    entity.description,
    entity.label,
    ...entity.instanceOf.map((x) => x.label),
    ...factLabels(entity, "P452", 4),
    ...factLabels(entity, "P1056", 4),
  ]
    .join(" ")
    .toLowerCase();
}

function isRetailOrg(entity: EntitySummary): boolean {
  return /retail|store|shop|supermarket|grocery|hardware|home improvement|chain|mall/.test(
    orgFlavor(entity),
  );
}

function shortCraft(label: string): string {
  const l = label.toLowerCase();
  if (/yodel/.test(l)) return "";
  if (/playback/.test(l)) return "Playback Singer";
  if (/singer|vocal/.test(l)) return "Singer";
  if (/musician/.test(l)) return "Musician";
  if (/actor|actress/.test(l)) return "Actor";
  if (/compos|music director/.test(l)) return "Composer";
  if (/director/.test(l)) return "Director";
  if (/produc/.test(l)) return "Producer";
  if (/poet|lyric|writer|screenwrit/.test(l)) return "Writer";
  if (/comed/.test(l)) return "Comedian";
  if (/physic/.test(l)) return "Physicist";
  if (/scient/.test(l)) return "Scientist";
  return label.replace(/\b\w/g, (c) => c.toUpperCase());
}

const CRAFT_ORDER = [
  "Singer", "Composer", "Musician", "Actor", "Playback Singer",
  "Director", "Producer", "Writer", "Comedian", "Physicist", "Scientist",
];

function uniqueCrafts(labels: string[]): string[] {
  const set = new Set(labels.map(shortCraft).filter(Boolean));
  const ordered = CRAFT_ORDER.filter((c) => set.has(c));
  for (const c of set) if (!ordered.includes(c)) ordered.push(c);
  return ordered;
}

function countMatch(text: string, re: RegExp): number | undefined {
  const m = text.match(re);
  if (!m?.[1]) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function filmfareWins(entity: EntitySummary): number | undefined {
  const named = (fact(entity, "P166")?.values ?? []).filter((v) =>
    /filmfare/i.test(v.label),
  ).length;
  const fromText = countMatch(blobOf(entity), /(\d+)\s*Filmfare/i);
  return Math.max(named, fromText ?? 0) || fromText || (named || undefined);
}

function filmCount(entity: EntitySummary): number | undefined {
  const blob = blobOf(entity);
  const fromText =
    countMatch(blob, /appeared in (\d{2,3})\s*(?:Hindi\s+)?films/i) ||
    countMatch(blob, /(\d{2,3})\s*Hindi films as an actor/i) ||
    countMatch(blob, /(\d{2,3})\+?\s*(?:Hindi\s+)?films?\b/i);
  if (fromText && fromText >= 10 && fromText <= 400) return fromText;
  const listed = fact(entity, "CR_FILM")?.values.length ?? 0;
  if (listed >= 5 && listed <= 400) return listed;
  return undefined;
}

function cinematicQuote(entity: EntitySummary): { quote?: string; quoteNative?: string } {
  if (/kishore kumar/i.test(entity.label)) {
    return {
      quote: "Zindagi ek safar hai suhana...",
      quoteNative: "ज़िन्दगी एक सफर है सुहाना...",
    };
  }
  const motto =
    factLabel(entity, "P1451") ||
    factLabel(entity, "P163") ||
    wikiByLabel(entity, ["motto", "slogan", "nickname"]);
  if (motto && motto.length >= 8 && motto.length <= 90) return { quote: motto };
  const works = [...factLabels(entity, "CR_SONG", 10), ...factLabels(entity, "P800", 10)];
  const hit = works.find((s) =>
    /safar|zindagi|yeh |pyar|dil |love |life |dream |imagine |star |road |heart /i.test(s),
  );
  if (hit) return { quote: hit.replace(/\s*\([^)]*\)\s*$/, "").trim() };
  const native = (entity.wikipedia?.lead ?? "").match(/[\u0900-\u097F][^。.\n]{8,70}/);
  return { quoteNative: native?.[0] };
}

function localFeatureTitle(entity: EntitySummary): string {
  const kind = cinematicType(entity);
  const blob = blobOf(entity).toLowerCase();
  if (kind === "person") {
    if (/sing|playback/.test(blob) && /india|hindi|bollywood/.test(blob)) {
      return "Legendary Voice of Indian Cinema";
    }
    if (/physic|relativity/.test(blob)) return "The Mind That Reshaped Physics";
    if (/act/.test(blob)) return "A Life on Screen";
    return "A Life in Frames";
  }
  if (kind === "organization") {
    if (/retail|store|shop/.test(blob)) return "Retail at Continental Scale";
    return "Built to Operate at Scale";
  }
  if (kind === "place") return "The Character of This Place";
  if (kind === "event") return "What This Moment Changed";
  if (kind === "work") return "Why This Work Endures";
  return "At a Glance";
}

function personPulse(entity: EntitySummary): string {
  const n = filmfareWins(entity);
  const occ = factLabels(entity, "P106", 8).join(" ").toLowerCase();
  const lead = (entity.wikipedia?.lead ?? "").replace(/\s+/g, " ");
  const parts: string[] = [];
  if (n && /playback|sing/.test(occ)) {
    parts.push(
      `${entity.label} won ${n} Filmfare Awards for Best Playback Singer (Male), a record that still defines playback singing.`,
    );
  } else {
    const award = factLabels(entity, "P166", 1)[0];
    if (award && /nobel/i.test(award)) parts.push(`${entity.label} received the ${award}.`);
    else if (award) parts.push(`${entity.label} — honoured with ${award}.`);
  }
  const extra = lead
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .find(
      (s) =>
        s.length > 70 &&
        /versatil|icon|popular|cinema|music|voice|unmatched|timeless|generation/.test(s) &&
        !/born|died|january|august|october 13/.test(s.toLowerCase()),
    );
  if (extra && !parts.some((p) => extra.startsWith(p.slice(0, 36)))) parts.push(extra);
  const joined = parts.join(" ");
  if (joined) return joined.length > 420 ? `${joined.slice(0, 417).trimEnd()}…` : joined;
  return highlightPulse(entity);
}

function buildOrgBands(
  entity: EntitySummary,
  metrics: GlanceMetric[],
  extra: {
    hq?: string;
    ticker?: string;
    exchange?: string;
    locations?: string;
    host?: string;
  },
): GlanceBand[] {
  const retail = isRetailOrg(entity);
  const locN = extra.locations ? parseAmount(extra.locations) : undefined;
  const empN = parseAmount(metrics.find((m) => /employee/i.test(m.label))?.value ?? "");
  const scale: GlanceItem[] = [];

  if (extra.locations) {
    scale.push({
      icon: "store",
      label: retail ? "Retail network" : "Locations",
      value: `${asPlaces(extra.locations, retail)} ${retail ? "stores" : "sites"}`,
    });
  }
  if (retail && ((locN ?? 0) >= 400 || (empN ?? 0) >= 50_000)) {
    scale.push({
      icon: "cart",
      label: "Customer reach",
      value: "Millions of customers",
    });
  } else {
    const area = factLabels(entity, "P2541", 2).join(" · ") || factLabel(entity, "P17");
    if (area) scale.push({ icon: "globe", label: "Serves", value: compactStat(area) });
  }
  if (extra.host) {
    scale.push({
      icon: "globe",
      label: "Digital business",
      value: retail ? `${extra.host} + Mobile` : extra.host,
    });
  }
  if (extra.ticker || extra.exchange) {
    const code = extra.exchange ? exchangeCode(extra.exchange) : "Listed";
    scale.push({
      icon: "chart",
      label: "Public company",
      value: extra.ticker ? `${code}: ${extra.ticker}` : code,
    });
  }
  if (extra.hq) {
    scale.push({ icon: "building", label: "Headquarters", value: extra.hq });
  }

  const bands: GlanceBand[] = [];
  if (scale.length) {
    bands.push({ id: "scale", title: "Business scale", layout: "rows", items: scale.slice(0, 6) });
  }

  const techish = /software|technolog|internet|e-?commerc|digital|telecom|bank|retail|store/.test(
    orgFlavor(entity),
  );
  if (extra.host && (retail || techish)) {
    bands.push({
      id: "digital",
      title: "Technology & digital",
      layout: "tiles",
      items: retail
        ? [
            { icon: "spark", label: "Digital", value: "E-commerce", note: "Platform" },
            { icon: "phone", label: "Mobile", value: "iOS / Android", note: "Experience" },
            { icon: "cpu", label: "AI / Data", value: "Personalization", note: "Analytics & automation" },
          ]
        : [
            { icon: "globe", label: "Web", value: extra.host, note: "Official site" },
            { icon: "phone", label: "Digital", value: "Online presence", note: "Customer access" },
            { icon: "cpu", label: "Data", value: "Operations", note: "Scale systems" },
          ],
    });
  }
  return bands;
}

function buildPersonRoles(entity: EntitySummary): GlanceItem[] {
  const occ = factLabels(entity, "P106", 10);
  const occL = occ.map((o) => o.toLowerCase());
  const lead = blobOf(entity).toLowerCase();
  const has = (re: RegExp) => occL.some((o) => re.test(o)) || re.test(lead);
  const items: GlanceItem[] = [];

  if (has(/sing|playback|vocal/)) {
    items.push({
      icon: "mic",
      label: has(/comic|yodel|versatil|hindi|bollywood/) ? "Versatile singer" : has(/playback/) ? "Playback singer" : "Singer",
      value: /hindi|bollywood|indian cinema/.test(lead) ? "Voice of Indian cinema" : "Recording artist",
      note: /hindi|bollywood|comic|yodel|versatil/.test(lead)
        ? "From romantic to comic, he could sing every emotion."
        : "A distinctive voice across every mood.",
    });
  }
  if (has(/act/)) {
    const n = filmCount(entity);
    items.push({
      icon: "film",
      label: "Actor",
      value: n ? `${n}+ films` : "On screen",
      note: has(/comed/)
        ? "A brilliant performer on and off screen."
        : "A screen presence as vivid as the voice.",
    });
  }
  if (has(/compos|music director|lyric/)) {
    items.push({
      icon: "music",
      label: "Composer",
      value: "Film music",
      note: "Created timeless music across genres.",
    });
  }
  if (items.length < 4 && has(/sing|music|musician/) && !items.some((i) => i.label === "Musician")) {
    items.push({
      icon: "music",
      label: "Musician",
      value: /india/.test(lead) ? "Indian music" : "Performer",
      note: /india/.test(lead)
        ? "A multi-talented genius of Indian music."
        : "A multi-instrument presence beyond the microphone.",
    });
  }
  if (has(/director/) && items.length < 4 && !items.some((i) => /director/i.test(i.label))) {
    items.push({ icon: "film", label: "Director", value: "Film director", note: "Behind the camera" });
  }
  if (has(/physic|scient|mathematic|chemist|theor/) && items.length < 4) {
    items.push({
      icon: "spark",
      label: shortCraft(occ[0] ?? "Scientist"),
      value: uniqueCrafts(occ).slice(0, 2).join(" · "),
      note: factLabels(entity, "P800", 1)[0],
    });
  }
  if (items.length < 4) {
    const nFilmfare = filmfareWins(entity);
    const awardsN = fact(entity, "P166")?.values.length;
    if (nFilmfare) {
      items.push({
        icon: "award",
        label: "Awards",
        value: `${nFilmfare} Filmfare`,
        note: "Best Male Playback",
      });
    } else if (awardsN) {
      items.push({
        icon: "award",
        label: "Awards",
        value: `${awardsN} honours`,
        note: factLabels(entity, "P166", 1)[0],
      });
    }
  }

  return items.slice(0, 4);
}

function buildPersonGrid(entity: EntitySummary): GlanceCard[] {
  const cards: GlanceCard[] = [];
  const born = factLabel(entity, "P569");
  const homeFull = factLabel(entity, "P19") || wikiByLabel(entity, ["birthplace", "place of birth"]);
  const homeTown = homeFull?.split(",")[0]!.trim();
  if (born) {
    cards.push({
      label: "Born",
      value: compactDate(born),
      note: homeFull ? neatPlace(homeFull) : undefined,
      tone: "life",
    });
  }
  if (homeTown) cards.push({ label: "Hometown", value: homeTown, tone: "hq" });

  const wikiActive = wikiByLabel(entity, ["years active", "active"]);
  const deathY = yearOf(factLabel(entity, "P570"));
  const birthY = yearOf(born);
  let active = wikiActive?.replace(/[–-]/g, " — ");
  if (!active && birthY && deathY) {
    const decade = Math.floor((Number(birthY) + 16) / 10) * 10;
    active = `${decade}s — ${deathY}`;
  }
  if (active) cards.push({ label: "Active years", value: active, tone: "life" });

  const nFilmfare = filmfareWins(entity);
  if (nFilmfare) {
    cards.push({
      label: "Filmfare awards",
      value: String(nFilmfare),
      note: "Best Male Playback",
      tone: "market",
    });
  } else {
    const awardsN = fact(entity, "P166")?.values.length;
    if (awardsN) {
      cards.push({
        label: "Honours",
        value: `${awardsN}`,
        note: factLabels(entity, "P166", 1)[0],
        tone: "market",
      });
    }
  }

  const langs = factLabels(entity, "P1412", 6);
  if (langs.length) {
    cards.push({
      label: "Languages",
      value: langs[0]!,
      note: langs.length > 1 ? "(and others)" : undefined,
      tone: "people",
    });
  }

  const lead = entity.wikipedia?.lead ?? "";
  if (/yodel/i.test(lead) && cards.length < 6) {
    cards.push({ label: "Signature style", value: "Yodeling", tone: "product" });
  } else {
    const known = factLabels(entity, "P800", 1)[0];
    if (known && cards.length < 6) cards.push({ label: "Known for", value: known, tone: "product" });
  }

  const craft = uniqueCrafts(factLabels(entity, "P106", 3)).join(" · ");
  if (craft && cards.length < 6) cards.push({ label: "Craft", value: craft, tone: "people" });

  return cards.slice(0, 6);
}

/** Best 1–2 sentences of identity — never the short Wikidata description. */
function highlightPulse(entity: EntitySummary): string {
  const desc = (entity.description || "").trim();
  const lead = (entity.wikipedia?.lead || "").replace(/\s+/g, " ").trim();
  const sentences = lead
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 50);

  const useful = sentences.filter(
    (s) =>
      (!desc || !similarTo(s, desc)) &&
      !/\(born\b/i.test(s) &&
      !/^\S.+\(\d{4}\s*[–-]\s*\d{4}\)/.test(s),
  );
  const pick = (useful.length ? useful : sentences).slice(0, 2).join(" ");
  const clean = pick
    .replace(/^\([^)]{1,16}\)\s*/g, "")
    .replace(/\(\s*[A-Z.]{1,6}\s*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (clean) return clean.length > 340 ? `${clean.slice(0, 337).trimEnd()}…` : clean;

  const occ = factLabels(entity, "P106", 3);
  const works = factLabels(entity, "P800", 2);
  const awards = factLabels(entity, "P166", 2);
  const bits: string[] = [];
  if (occ.length) bits.push(occ.join(", "));
  if (works.length) bits.push(`Known for ${works.join(" and ")}`);
  if (awards.length) bits.push(awards[0]!);
  if (bits.length) return `${bits.join(". ")}.`;
  return `${entity.label} in the knowledge graph.`;
}

function orgHighlightPulse(entity: EntitySummary, metrics: GlanceMetric[]): string {
  const story = highlightPulse(entity);
  if (story && story.length > 80) return story;
  if (metrics.length) {
    return metrics
      .slice(0, 4)
      .map((m) => `${m.label} ${m.value}`)
      .join(" · ");
  }
  const industry = factLabels(entity, "P452", 2).join(" · ");
  const hq = factLabel(entity, "P159");
  if (industry) {
    return `${entity.label} in ${industry}${hq ? `, based in ${hq}` : ""}.`;
  }
  return story;
}

function pushCard(
  cards: GlanceCard[],
  label: string,
  value?: string,
  tone: GlanceCard["tone"] = "default",
  note?: string,
) {
  if (!value) return;
  cards.push({ label, value: compactStat(value), tone, note });
}

function typeCrafts(entity: EntitySummary): string | undefined {
  const inst = entity.instanceOf
    .map((x) => x.label)
    .filter((l) => !/^(human|entity|wikimedia|human settlement)$/i.test(l));
  const extra =
    entity.type === "organization"
      ? factLabels(entity, "P452", 4)
      : entity.type === "work"
        ? factLabels(entity, "P136", 4)
        : entity.type === "place"
          ? factLabels(entity, "P31", 3)
          : entity.type === "event"
            ? factLabels(entity, "P31", 3)
            : factLabels(entity, "P279", 3);
  const bits = [...extra, ...inst].filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of bits) {
    const k = b.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(b);
    if (out.length >= 5) break;
  }
  return out.join(" · ") || undefined;
}

function withIdentity(
  entity: EntitySummary,
  identity: GlanceIdentity,
): GlanceIdentity {
  const q = cinematicQuote(entity);
  const bio = highlightPulse(entity);
  return {
    ...identity,
    quote: identity.quote || q.quote,
    quoteNative: identity.quoteNative || q.quoteNative,
    featureTitle: identity.featureTitle || localFeatureTitle(entity),
    bio: identity.bio || (bio.length > 80 ? bio : undefined),
  };
}
export function cinematicType(entity: EntitySummary): EntityType {
  if (entity.type !== "unknown") return entity.type;
  const labels = entity.instanceOf.map((i) => i.label).join(" ").toLowerCase();
  if (/commune|city|capital|town|village|municipality|country|island|settlement/.test(labels)) {
    return "place";
  }
  if (fact(entity, "P1082") || fact(entity, "P625") || fact(entity, "P131")) return "place";
  if (/compan|corporation|business|retail|organisation|organization/.test(labels)) {
    return "organization";
  }
  if (/film|album|novel|book|painting|song|software/.test(labels)) return "work";
  if (/war|battle|election|festival|conference/.test(labels)) return "event";
  return entity.type;
}
export function buildLocalGlance(entity: EntitySummary): GlanceSnapshot {
  const kind = cinematicType(entity);
  if (kind === "organization") {
    const retail = isRetailOrg(entity);
    const metrics: GlanceMetric[] = [];
    const revenue =
      factLabel(entity, "P2139") ||
      wikiRow(entity, /^revenue$/i) ||
      wikiByLabel(entity, ["revenue"]);
    if (revenue) metrics.push({ label: "Revenue", value: asMoney(revenue) });
    const profit =
      factLabel(entity, "P2295") ||
      wikiRow(entity, /^net (income|profit)$/i) ||
      wikiByLabel(entity, ["net income", "net profit"]);
    if (profit) metrics.push({ label: "Net profit", value: asMoney(profit) });
    const mcap =
      factLabel(entity, "P2226") ||
      wikiByLabel(entity, ["market cap", "market capitalisation", "market capitalization"]);
    if (mcap && metrics.length < 2) metrics.push({ label: "Market cap", value: asMoney(mcap) });
    const employees =
      factLabel(entity, "P1128") ||
      wikiByLabel(entity, ["number of employees", "employees"]);
    if (employees) metrics.push({ label: "Employees", value: asHeadcount(employees) });
    const locations = wikiByLabel(entity, [
      "number of locations",
      "locations",
      "stores",
      "number of stores",
    ]);
    if (locations) {
      metrics.push({
        label: retail ? "Stores" : "Locations",
        value: asPlaces(locations, retail),
      });
    }
    if (mcap && !metrics.some((m) => /market cap/i.test(m.label)) && metrics.length < 4) {
      metrics.push({ label: "Market cap", value: asMoney(mcap) });
    }
    if (!profit) {
      const opinc = factLabel(entity, "P2402") || wikiByLabel(entity, ["operating income"]);
      if (opinc) metrics.push({ label: "Operating income", value: asMoney(opinc) });
    }
    const founded =
      yearOf(factLabel(entity, "P571")) ||
      yearOf(wikiRow(entity, /^founded|inception$/i)) ||
      yearOf(wikiByLabel(entity, ["founded"]));
    if (founded) metrics.push({ label: "Founded", value: founded });
    const traded = wikiByLabel(entity, ["traded as", "ticker symbol", "ticker"]);
    const ticker =
      factLabel(entity, "P249") ||
      traded?.match(/(?:NYSE|NASDAQ|LSE|BSE|NSE)[:\s]+([A-Z.]{1,6})/i)?.[1] ||
      blobOf(entity).match(/\((?:NYSE|NASDAQ):\s*([A-Z.]{1,6})\)/i)?.[1];
    const exchange = factLabel(entity, "P414") || traded;
    if (ticker) {
      metrics.push({
        label: "Ticker",
        value: exchange ? `${ticker} · ${exchangeCode(exchange)}` : ticker,
      });
    }

    const hq =
      wikiByLabel(entity, ["headquarters", "headquartered"]) ||
      factLabel(entity, "P159") ||
      wikiRow(entity, /^headquarters|hq$/i);
    const hqNice = hq ? neatPlace(hq) : undefined;
    const ceo =
      factLabel(entity, "P169") ||
      wikiRow(entity, /^ceo|chief executive|key people$/i);
    const cards: GlanceCard[] = [];
    if (hqNice) cards.push({ label: "Headquarters", value: hqNice, tone: "hq" });
    if (ceo) cards.push({ label: "Leadership", value: ceo.split(/[;|]/)[0]!.trim(), tone: "people" });
    const industry =
      factLabels(entity, "P452", 2).join(" · ") || wikiRow(entity, /^industry$/i);
    if (industry) cards.push({ label: "Industry", value: industry, tone: "market" });
    if (exchange) cards.push({ label: "Listed", value: exchangeCode(exchange), tone: "market" });

    return {
      heading: "Company highlights",
      pulse: orgHighlightPulse(entity, metrics),
      metrics: metrics.slice(0, 8),
      cards: cards.slice(0, 8),
      bands: buildOrgBands(entity, metrics, {
        hq: hqNice,
        ticker,
        exchange,
        locations,
        host: siteHost(entity),
      }),
      identity: withIdentity(entity, {
        name: entity.label,
        years: founded ? `Est. ${founded}` : undefined,
        crafts: typeCrafts(entity),
      }),
      fallback: true,
    };
  }

  if (kind === "place") {
    const cards: GlanceCard[] = [];
    pushCard(cards, "Country", factLabel(entity, "P17"), "hq");
    const pop = factLabel(entity, "P1082");
    if (pop) pushCard(cards, "Population", asHeadcount(pop), "people");
    pushCard(cards, "Region", factLabel(entity, "P131"), "life");
    pushCard(cards, "Area", factLabel(entity, "P2046"), "market");
    pushCard(cards, "Elevation", factLabel(entity, "P2044"), "product");
    const founded = yearOf(factLabel(entity, "P571"));
    if (founded) pushCard(cards, "Founded", founded, "life");
    const tz = factLabel(entity, "P421");
    if (tz && cards.length < 5) pushCard(cards, "Timezone", tz, "default");
    const placeItems = [
      factLabel(entity, "P17") && { icon: "globe", label: "Country", value: factLabel(entity, "P17")! },
      factLabel(entity, "P131") && { icon: "building", label: "Region", value: factLabel(entity, "P131")! },
      factLabel(entity, "P36") && { icon: "building", label: "Capital", value: factLabel(entity, "P36")! },
      factLabel(entity, "P1376") && { icon: "building", label: "Capital of", value: factLabel(entity, "P1376")! },
    ].filter(Boolean).slice(0, 4) as GlanceItem[];
    return {
      heading: `${entity.label} at a glance`,
      pulse: highlightPulse(entity),
      metrics: [],
      cards: cards.slice(0, 5),
      bands: placeItems.length
        ? [{ id: "place", title: "Character", layout: "roles", items: placeItems }]
        : [],
      identity: withIdentity(entity, {
        name: entity.label,
        years: founded,
        crafts: typeCrafts(entity),
      }),
      fallback: true,
    };
  }

  if (kind === "event") {
    const cards: GlanceCard[] = [];
    const when =
      factLabel(entity, "P585") ||
      factLabel(entity, "P580") ||
      wikiByLabel(entity, ["date", "start"]);
    pushCard(cards, "Date", when ? compactDate(when) : undefined, "life");
    pushCard(cards, "Location", factLabel(entity, "P276") || factLabel(entity, "P131"), "hq");
    pushCard(cards, "Country", factLabel(entity, "P17"), "hq");
    const part = factLabels(entity, "P710", 2).join(" · ");
    pushCard(cards, "Participants", part || undefined, "people");
    pushCard(cards, "Part of", factLabel(entity, "P361"), "market");
    return {
      heading: `${entity.label} at a glance`,
      pulse: highlightPulse(entity),
      metrics: [],
      cards: cards.slice(0, 5),
      bands: [{
        id: "event",
        title: "Impact",
        layout: "roles",
        items: cards.slice(0, 4).map((c) => ({
          icon: /date|year/i.test(c.label) ? "award" : /location|country/i.test(c.label) ? "globe" : "spark",
          label: c.label,
          value: c.value,
          note: c.note,
        })),
      }],
      identity: withIdentity(entity, {
        name: entity.label,
        years: when ? compactDate(when) : undefined,
        crafts: typeCrafts(entity),
      }),
      fallback: true,
    };
  }

  if (kind === "work") {
    const cards: GlanceCard[] = [];
    const published = factLabel(entity, "P577");
    pushCard(cards, "Published", published ? compactDate(published) : undefined, "life");
    pushCard(cards, "Genre", factLabels(entity, "P136", 2).join(" · ") || undefined, "product");
    pushCard(
      cards,
      "Creator",
      factLabel(entity, "P50") || factLabel(entity, "P170") || factLabel(entity, "P57") || factLabel(entity, "P86"),
      "people",
    );
    pushCard(cards, "Language", factLabel(entity, "P407"), "default");
    const awardsN = fact(entity, "P166")?.values.length;
    if (awardsN) pushCard(cards, "Awards", `${awardsN} honours`, "market", factLabels(entity, "P166", 1)[0]);
    return {
      heading: `${entity.label} at a glance`,
      pulse: highlightPulse(entity),
      metrics: [],
      cards: cards.slice(0, 5),
      bands: [{
        id: "work",
        title: "Craft",
        layout: "roles",
        items: [
          factLabel(entity, "P136") && { icon: "film", label: "Genre", value: factLabels(entity, "P136", 2).join(" · ") },
          (factLabel(entity, "P50") || factLabel(entity, "P170") || factLabel(entity, "P57")) && {
            icon: "spark",
            label: "Creator",
            value: factLabel(entity, "P50") || factLabel(entity, "P170") || factLabel(entity, "P57") || "",
          },
          published && { icon: "award", label: "Released", value: compactDate(published) },
          factLabel(entity, "P166") && { icon: "award", label: "Awards", value: factLabels(entity, "P166", 1)[0]! },
        ].filter(Boolean).slice(0, 4) as GlanceItem[],
      }],
      identity: withIdentity(entity, {
        name: entity.label,
        years: published ? yearOf(published) : undefined,
        crafts: typeCrafts(entity),
      }),
      fallback: true,
    };
  }

  if (kind === "concept") {
    const cards: GlanceCard[] = [];
    pushCard(cards, "Field", factLabel(entity, "P31") || entity.instanceOf[0]?.label, "market");
    pushCard(cards, "Subclass of", factLabel(entity, "P279"), "life");
    pushCard(cards, "Part of", factLabel(entity, "P361"), "hq");
    pushCard(cards, "Studied by", factLabel(entity, "P2579"), "people");
    pushCard(cards, "Has part", factLabels(entity, "P527", 2).join(" · ") || undefined, "product");
    return {
      heading: `${entity.label} at a glance`,
      pulse: highlightPulse(entity),
      metrics: [],
      cards: cards.slice(0, 5),
      bands: [{
        id: "concept",
        title: "Ideas",
        layout: "tiles",
        items: cards.slice(0, 4).map((c) => ({
          icon: "spark",
          label: c.label,
          value: c.value,
        })),
      }],
      identity: withIdentity(entity, {
        name: entity.label,
        crafts: typeCrafts(entity),
      }),
      fallback: true,
    };
  }

  const roles = buildPersonRoles(entity);
  const personCards = buildPersonGrid(entity);
  let crafts = uniqueCrafts(factLabels(entity, "P106", 8));
  if (/playback/i.test(blobOf(entity)) && !crafts.includes("Playback Singer")) {
    crafts = [...crafts.filter((c) => c !== "Director" && c !== "Producer").slice(0, 4), "Playback Singer"];
  }

  return {
    heading: `${entity.label} at a glance`,
    pulse: personPulse(entity) || highlightPulse(entity),
    metrics: [],
    cards: personCards,
    bands: roles.length ? [{ id: "roles", title: "Craft", layout: "roles", items: roles }] : [],
    identity: withIdentity(entity, {
      name: entity.label,
      years: entity.lifespan?.replace(/[–-]/g, " — "),
      crafts: crafts.slice(0, 5).join(" · ") || undefined,
    }),
    fallback: true,
  };
}

function asItems(raw: unknown): GlanceItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 8)
    .map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      return {
        label: String(r.label ?? "").trim(),
        value: String(r.value ?? "").trim(),
        note: r.note != null ? String(r.note) : undefined,
        icon: r.icon != null ? String(r.icon) : undefined,
      };
    })
    .filter((x) => x.label && x.value);
}

function normalizeGlance(raw: unknown, local: GlanceSnapshot): GlanceSnapshot {
  if (!raw || typeof raw !== "object") return local;
  const o = raw as Record<string, unknown>;
  const pulseRaw = o.pulse != null ? String(o.pulse).trim() : local.pulse;
  const pulse =
    pulseRaw.length < 90 &&
    /\(\d{4}\s*[–-]\s*\d{4}\)/.test(pulseRaw) &&
    local.pulse.length > pulseRaw.length
      ? local.pulse
      : pulseRaw || local.pulse;

  const metrics = Array.isArray(o.metrics)
    ? o.metrics
        .slice(0, 6)
        .map((row) => {
          const r = (row ?? {}) as Record<string, unknown>;
          return {
            label: String(r.label ?? "").trim(),
            value: String(r.value ?? "").trim(),
            note: r.note != null ? String(r.note) : undefined,
          };
        })
        .filter((m) => m.label && m.value)
    : local.metrics;

  const cards = Array.isArray(o.cards)
    ? o.cards
        .slice(0, 8)
        .map((row) => {
          const r = (row ?? {}) as Record<string, unknown>;
          const toneRaw = String(r.tone ?? "default");
          const tone = (
            ["hq", "people", "market", "product", "life", "default"] as const
          ).includes(toneRaw as never)
            ? (toneRaw as GlanceCard["tone"])
            : "default";
          return {
            label: String(r.label ?? "").trim(),
            value: String(r.value ?? "").trim(),
            note: r.note != null ? String(r.note) : undefined,
            tone,
          };
        })
        .filter((c) => c.label && c.value)
    : local.cards;

  const bands: GlanceBand[] = Array.isArray(o.bands)
    ? o.bands
        .slice(0, 4)
        .map((row) => {
          const r = (row ?? {}) as Record<string, unknown>;
          const layoutRaw = String(r.layout ?? "rows");
          const layout = (
            ["rows", "tiles", "roles"] as const
          ).includes(layoutRaw as never)
            ? (layoutRaw as GlanceBand["layout"])
            : "rows";
          return {
            id: String(r.id ?? r.title ?? "band"),
            title: String(r.title ?? "").trim() || "Highlights",
            layout,
            items: asItems(r.items),
          };
        })
        .filter((b) => b.items.length)
    : [];

  const mergedBands = [...bands];
  for (const b of local.bands ?? []) {
    if (!mergedBands.some((x) => x.id === b.id || x.title.toLowerCase() === b.title.toLowerCase())) {
      mergedBands.push(b);
    }
  }

  const idRaw = o.identity && typeof o.identity === "object"
    ? (o.identity as Record<string, unknown>)
    : null;

  return {
    heading: o.heading != null ? String(o.heading) : local.heading,
    pulse,
    metrics: metrics.length ? metrics : local.metrics,
    cards: cards.length ? cards : local.cards,
    bands: mergedBands.length ? mergedBands : local.bands,
    identity: idRaw
      ? {
          name: String(idRaw.name ?? local.identity?.name ?? ""),
          years: idRaw.years != null ? String(idRaw.years) : local.identity?.years,
          crafts: idRaw.crafts != null ? String(idRaw.crafts) : local.identity?.crafts,
          quote: idRaw.quote != null ? String(idRaw.quote) : local.identity?.quote,
          quoteNative: idRaw.quoteNative != null ? String(idRaw.quoteNative) : local.identity?.quoteNative,
          featureTitle: idRaw.featureTitle != null ? String(idRaw.featureTitle) : local.identity?.featureTitle,
          bio: idRaw.bio != null ? String(idRaw.bio) : local.identity?.bio,
        }
      : local.identity,
    footnote: o.footnote != null ? String(o.footnote) : local.footnote,
    fallback: false,
  };
}

export async function fetchGlanceSnapshot(
  entity: EntitySummary,
): Promise<GlanceSnapshot> {
  const local = buildLocalGlance(entity);
  const factsDigest = entity.facts
    .filter((f) =>
      [
        "P159", "P169", "P452", "P1056", "P2139", "P2295", "P1128", "P571",
        "P414", "P249", "P17", "P1454", "P2226", "P2403", "P2402", "P793",
        "P112", "P749", "P127", "P2541", "P488", "P355", "P166",
        "P569", "P570", "P19", "P20", "P106", "P26", "P27", "P800", "P1411",
        "P1412", "P2031", "P856", "CR_SONG", "CR_FILM", "CR_ALBUM", "P161",
      ].includes(f.propertyId),
    )
    .slice(0, 20)
    .map((f) => ({
      property: f.property,
      propertyId: f.propertyId,
      values: f.values.slice(0, 4).map((v) => v.label),
    }));

  try {
    const res = await fetch("/api/ai/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section: "glance",
        sectionTitle: "At a glance",
        id: entity.id,
        label: entity.label,
        description: entity.description,
        type: cinematicType(entity),
        wikipediaLead: (entity.wikipedia?.lead ?? "").slice(0, 1800),
        wikiRevisedAt: entity.wikipedia?.revisedAt,
        factsDigest,
        local,
      }),
    });

    if (!res.ok) {
      return {
        ...local,
        fallback: true,
        hint: res.status === 503
          ? "Local snapshot — add an AI key for polish."
          : "Local snapshot (AI unavailable).",
      };
    }

    const data: unknown = await res.json();
    return normalizeGlance(data, local);
  } catch {
    return { ...local, fallback: true, hint: "Local snapshot (AI offline)." };
  }
}
