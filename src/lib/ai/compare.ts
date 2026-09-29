import type { CompareCareerStats } from "@/lib/wikidata/api.ts";
import type { EntitySummary } from "@/lib/wikidata/types.ts";

export type CompareContrast = {
  label: string;
  left: string;
  right: string;
  note?: string;
};

export type CompareBrief = {
  headline: string;
  verdict: string;
  overlap: string[];
  contrasts: CompareContrast[];
  leftAngle: string;
  rightAngle: string;
  shareBlurb: string;
  /** Org / category add-ons */
  differences?: string[];
  leadership?: string[];
  leftMotto?: string;
  rightMotto?: string;
  fallback?: boolean;
  hint?: string;
};

export type CompareCareerPair = {
  left?: CompareCareerStats | null;
  right?: CompareCareerStats | null;
};

const FACT_PIDS: Array<{ pid: string; label: string }> = [
  { pid: "P569", label: "Born" },
  { pid: "P570", label: "Died" },
  { pid: "P19", label: "Birthplace" },
  { pid: "P106", label: "Occupation" },
  { pid: "P27", label: "Citizenship" },
  { pid: "P26", label: "Spouse" },
  { pid: "P800", label: "Notable work" },
  { pid: "P166", label: "Awards" },
  { pid: "P69", label: "Education" },
  { pid: "P1412", label: "Languages" },
  { pid: "P136", label: "Genre" },
  { pid: "P412", label: "Voice type" },
  { pid: "P1303", label: "Instrument" },
  { pid: "P452", label: "Industry" },
  { pid: "P551", label: "Residence" },
  { pid: "P1830", label: "Owner of" },
  { pid: "P2218", label: "Net worth" },
  { pid: "P937", label: "Work location" },
  { pid: "P571", label: "Inception" },
  { pid: "P112", label: "Founded by" },
  { pid: "P159", label: "Headquarters" },
  { pid: "P17", label: "Country" },
  { pid: "P169", label: "Chief executive" },
  { pid: "P1128", label: "Employees" },
  { pid: "P2139", label: "Revenue" },
  { pid: "P2295", label: "Net profit" },
  { pid: "P414", label: "Stock exchange" },
  { pid: "P249", label: "Ticker" },
  { pid: "P1056", label: "Product / service" },
  { pid: "P856", label: "Website" },
  { pid: "P1454", label: "Legal form" },
];

function factOf(entity: EntitySummary, pid: string) {
  return entity.facts.find((x) => x.propertyId === pid);
}

function factLine(entity: EntitySummary, pid: string, limit = 3): string {
  const f = factOf(entity, pid);
  if (!f?.values.length) return "—";
  return f.values.slice(0, limit).map((v) => v.label).join(" · ");
}

function factCount(entity: EntitySummary, pid: string): number {
  return factOf(entity, pid)?.values.length ?? 0;
}

function yearFrom(label?: string): number | null {
  if (!label) return null;
  const m = label.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function decadeOf(y: number | null): string | null {
  if (y == null) return null;
  return `${Math.floor(y / 10) * 10}s`;
}

function occupations(entity: EntitySummary): string[] {
  return (factOf(entity, "P106")?.values ?? []).map((v) => v.label);
}

function isSingerOcc(labels: string[]): boolean {
  return labels.some((l) => /singer|vocalist|playback/i.test(l));
}

function isActorOcc(labels: string[]): boolean {
  return labels.some((l) => /actor|actress|film actor/i.test(l));
}

function craftFocus(entity: EntitySummary): string {
  if (entity.type === "organization") {
    const industry = factLine(entity, "P452", 2);
    if (industry !== "—") return industry;
    const inst = entity.instanceOf.map((x) => x.label).filter(Boolean).slice(0, 2);
    if (inst.length) return inst.join(" · ");
    return entity.description?.split(",")[0]?.trim() || "Company";
  }
  const occ = occupations(entity);
  if (!occ.length) return entity.description?.split(",")[0]?.trim() || entity.type;
  const singer = isSingerOcc(occ);
  const actor = isActorOcc(occ);
  if (singer && actor) return "Actor–singer";
  if (singer) {
    if (occ.some((l) => /playback/i.test(l))) return "Playback singer";
    return "Singer";
  }
  if (actor) {
    if (occ.some((l) => /actress/i.test(l))) return "Film actress";
    if (/actress/i.test(entity.description ?? "")) return "Film actress";
    return "Film actor";
  }
  if (occ.some((l) => /composer|music director/i.test(l))) return "Music director";
  return occ.slice(0, 2).join(" · ");
}

function eraLabel(entity: EntitySummary): string {
  if (entity.type === "organization") {
    const years = (factOf(entity, "P571")?.values ?? [])
      .map((v) => yearFrom(v.label))
      .filter((y): y is number => y != null)
      .sort((a, b) => a - b);
    if (years.length >= 2) return `${years[0]} · ${years[years.length - 1]}`;
    if (years.length === 1) {
      const d = decadeOf(years[0]!);
      return d ? `${d} onward` : `${years[0]} onward`;
    }
    return "—";
  }
  const born = yearFrom(factLine(entity, "P569"));
  const died = yearFrom(factLine(entity, "P570"));
  const d = decadeOf(born);
  if (d && died) return `${d}–${decadeOf(died)}`;
  if (d) return `${d} onward`;
  return entity.lifespan?.replace(/[–-]/g, "–") || "—";
}

function parseAmountLabel(text: string): number | undefined {
  const cleaned = text
    .replace(/,/g, "")
    .replace(/united states dollar|us\$|usd|eur|gbp|\$/gi, " ")
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

function asMoneyLabel(text: string): string {
  const n = parseAmountLabel(text);
  if (n == null) return text.replace(/\s*USD$/i, "").trim() || "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  const fmt = (x: number, suffix: string) => {
    const body =
      x >= 10 || Number.isInteger(x)
        ? x.toFixed(0)
        : x.toFixed(1).replace(/\.0$/, "");
    return `${sign}$${body}${suffix}`;
  };
  if (abs >= 1e9) return fmt(abs / 1e9, "B");
  if (abs >= 1e6) return fmt(abs / 1e6, "M");
  if (abs >= 1e3) return `${sign}$${Math.round(abs / 1e3)}K`;
  return `${sign}$${Math.round(abs)}`;
}

function asHeadcountLabel(text: string): string {
  const n = parseAmountLabel(text);
  if (n == null) return text.trim() || "—";
  if (n >= 1e6) {
    const m = n / 1e6;
    return `${m >= 10 || Number.isInteger(m) ? m.toFixed(0) : m.toFixed(1)}M`;
  }
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  return Math.round(n).toLocaleString("en-US");
}

/** Prefer the newest dated quantity (P585 year), else the last listed value. */
function latestFactValue(entity: EntitySummary, pid: string) {
  const values = factOf(entity, pid)?.values ?? [];
  if (!values.length) return null;
  const dated = values
    .map((v) => ({ v, y: v.year ?? yearFrom(v.label) }))
    .filter((x) => x.y != null)
    .sort((a, b) => (b.y! - a.y!));
  return (dated[0]?.v ?? values[values.length - 1]) ?? null;
}

function quantityLine(
  entity: EntitySummary,
  pid: string,
  format: (raw: string) => string,
): string {
  const v = latestFactValue(entity, pid);
  if (!v) return "—";
  const body = format(v.label);
  return v.year ? `${body} (${v.year})` : body;
}

function foundedLine(entity: EntitySummary): string {
  const years = (factOf(entity, "P571")?.values ?? [])
    .map((v) => yearFrom(v.label))
    .filter((y): y is number => y != null)
    .sort((a, b) => a - b);
  if (!years.length) return "—";
  if (years.length === 1) return String(years[0]);
  return `${years[0]} · ${years[years.length - 1]}`;
}

function websiteHost(entity: EntitySummary): string {
  const raw = factLine(entity, "P856", 1);
  if (raw === "—") return "—";
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0] || "—";
  }
}

function isRetailOrg(entity: EntitySummary): boolean {
  return /retail|store|shop|supermarket|grocery|hardware|home improvement|chain|mall/.test(
    [
      entity.description,
      entity.label,
      ...entity.instanceOf.map((x) => x.label),
      factLine(entity, "P452", 4),
      factLine(entity, "P1056", 4),
    ]
      .join(" ")
      .toLowerCase(),
  );
}

function inceptionGap(left: EntitySummary, right: EntitySummary): string | null {
  const a = yearFrom(foundedLine(left));
  const b = yearFrom(foundedLine(right));
  if (a == null || b == null) return null;
  const gap = Math.abs(a - b);
  if (gap < 5) return "Near-contemporaries in founding era";
  if (gap < 20) return `~${gap} years apart in founding`;
  if (gap < 40) return `A generation apart in founding (~${gap} yrs)`;
  return `Different founding eras (~${gap} yrs)`;
}

function wikiInfobox(entity: EntitySummary, needles: string[]): string | undefined {
  const rows = entity.wikipedia?.infobox ?? [];
  for (const needle of needles) {
    const n = needle.toLowerCase();
    const row = rows.find(
      (r) => r.kind !== "section" && r.label.toLowerCase().includes(n),
    );
    const v = row?.value?.replace(/\s+/g, " ").trim();
    if (v) return v;
  }
}

function cleanInfoboxValue(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*;\s*/g, "; ")
    .trim();
}

function compactPlaces(raw: string): string {
  return cleanInfoboxValue(raw)
    .replace(/Target Plaza/i, "")
    .replace(/,?\s*United States\.?$/i, ", USA")
    .replace(/,?\s*U\.S\.A?\.?$/i, ", USA")
    .replace(/\s+,/g, ",")
    .replace(/^,\s*/, "")
    .trim();
}

function storesLine(entity: EntitySummary): string {
  const raw = wikiInfobox(entity, [
    "number of locations",
    "number of stores",
    "locations",
    "stores",
  ]);
  if (!raw) return "—";
  const cleaned = cleanInfoboxValue(raw);
  const m = cleaned.match(/([\d,]+)/);
  if (!m) return cleaned.length > 48 ? `${cleaned.slice(0, 45)}…` : cleaned;
  const n = Number(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(n)) return cleaned;
  const year = cleaned.match(/\b(20\d{2})\b/)?.[1];
  const body = `${n.toLocaleString("en-US")}+`;
  return year ? `${body} (${year})` : body;
}

function employeesBest(entity: EntitySummary): string {
  const fromWd = quantityLine(entity, "P1128", asHeadcountLabel);
  if (fromWd !== "—") return fromWd;
  const wiki = wikiInfobox(entity, ["number of employees", "employees"]);
  if (!wiki) return "—";
  return asHeadcountLabel(cleanInfoboxValue(wiki));
}

function revenueBest(entity: EntitySummary): string {
  const fromWd = quantityLine(entity, "P2139", asMoneyLabel);
  const wiki = wikiInfobox(entity, ["revenue"]);
  if (wiki) {
    const cleaned = cleanInfoboxValue(wiki);
    const money = asMoneyLabel(cleaned);
    const year = cleaned.match(/\b(20\d{2})\b/)?.[1];
    if (money !== "—") return year ? `${money} (${year})` : money;
  }
  return fromWd;
}

function retailCategoryLine(entity: EntitySummary): string {
  const industry = factLine(entity, "P452", 2);
  const wikiInd = wikiInfobox(entity, ["industry"]);
  const blob = `${industry} ${wikiInd ?? ""} ${entity.description ?? ""}`.toLowerCase();
  if (/home improvement|hardware|diy/.test(blob)) return "Home improvement";
  if (/supermarket|grocery/.test(blob)) return "General merchandise & grocery";
  if (/retail|merchandise|department|discount/.test(blob)) return "General merchandise";
  if (industry !== "—") return industry;
  if (wikiInd) return cleanInfoboxValue(wikiInd).slice(0, 48);
  return "—";
}

function businessModelLine(entity: EntitySummary): string {
  const stores = storesLine(entity);
  const host = websiteHost(entity);
  const retail = isRetailOrg(entity);
  if (retail && stores !== "—" && host !== "—") {
    const cat = retailCategoryLine(entity).toLowerCase();
    if (/home improvement|hardware/.test(cat)) {
      return "Omnichannel (stores + online + pro)";
    }
    return "Omnichannel (stores + online)";
  }
  if (host !== "—") return "Digital + brand";
  if (stores !== "—") return "Store network";
  return "—";
}

function productsLine(entity: EntitySummary): string {
  const fromWd = factLine(entity, "P1056", 4);
  const wdCount = factCount(entity, "P1056");
  const wiki = wikiInfobox(entity, ["products", "services", "product"]);
  if (wiki) {
    const cleaned = cleanInfoboxValue(wiki)
      .replace(/\s*;\s*/g, ", ")
      .split(/,\s*/)
      .map((s) => s.trim())
      .filter((s) => s.length > 2 && s.length < 40)
      .slice(0, 6);
    // Prefer Wikipedia when Wikidata product list is sparse (e.g. Lowe's P1056)
    if (cleaned.length >= 2 && wdCount < 2) return cleaned.join(", ");
    if (cleaned.length && fromWd === "—") return cleaned.join(", ");
  }
  if (fromWd !== "—") return fromWd;
  const cat = retailCategoryLine(entity);
  if (/home improvement/i.test(cat)) {
    return "Tools, appliances, building materials, garden";
  }
  if (/general merchandise/i.test(cat)) {
    return "Apparel, home, electronics, groceries, beauty";
  }
  return "—";
}

function technologyFocusLine(entity: EntitySummary): string {
  const blob = [
    entity.wikipedia?.lead ?? "",
    entity.description ?? "",
    ...(entity.wikipedia?.infobox ?? []).map((r) => r.value),
  ]
    .join(" ")
    .toLowerCase();
  const bits: string[] = [];
  if (/e-?commerce|online|digital|app\b|mobile/.test(blob)) bits.push("Digital commerce");
  if (/\bai\b|artificial intelligence|personaliz|machine learning|data/.test(blob)) {
    bits.push("AI / data");
  }
  if (/supply chain|logistics|fulfillment/.test(blob)) bits.push("Supply chain");
  if (/pro customer|professional|contractor/.test(blob)) bits.push("Pro services");
  if (!bits.length && isRetailOrg(entity) && websiteHost(entity) !== "—") {
    bits.push("E-commerce", "Operations");
  }
  return bits.length ? [...new Set(bits)].slice(0, 4).join(", ") : "—";
}

function mottoLine(entity: EntitySummary): string | undefined {
  const fromWd = factLine(entity, "P1451", 1);
  if (fromWd !== "—" && fromWd.length >= 6 && fromWd.length <= 90) return fromWd;
  const wiki = wikiInfobox(entity, ["motto", "slogan", "tagline"]);
  if (wiki) {
    const cleaned = cleanInfoboxValue(wiki);
    if (cleaned.length >= 6 && cleaned.length <= 90) return cleaned;
  }
}

function headquartersBest(entity: EntitySummary): string {
  const fromWd = factLine(entity, "P159", 2);
  if (fromWd !== "—") {
    const country = factLine(entity, "P17", 1);
    if (country !== "—" && !new RegExp(country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(fromWd)) {
      return `${fromWd}, ${country === "United States" ? "USA" : country}`;
    }
    return fromWd;
  }
  const wiki = wikiInfobox(entity, ["headquarters", "headquartered"]);
  return wiki ? compactPlaces(wiki) : "—";
}

function areaServedLine(entity: EntitySummary): string {
  const wiki = wikiInfobox(entity, ["area served", "areas served"]);
  if (wiki) {
    const cleaned = cleanInfoboxValue(wiki)
      .replace(/\(formerly[^)]*\)/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.length > 56 ? `${cleaned.slice(0, 53)}…` : cleaned;
  }
  return factLine(entity, "P17", 2);
}

function orgDifferences(left: EntitySummary, right: EntitySummary): string[] {
  const out: string[] = [];
  const lc = retailCategoryLine(left);
  const rc = retailCategoryLine(right);
  if (lc !== "—" && rc !== "—" && lc !== rc) {
    out.push(`${left.label}: ${lc} ↔ ${right.label}: ${rc}`);
  }
  const la = areaServedLine(left);
  const ra = areaServedLine(right);
  if (la !== "—" && ra !== "—" && la.toLowerCase() !== ra.toLowerCase()) {
    out.push(`${left.label}: ${la} ↔ ${right.label}: ${ra}`);
  }
  if (lc !== rc && lc !== "—" && rc !== "—") {
    const leftShort = /general merchandise/i.test(lc) ? "Broader product mix" : "Specialized categories";
    const rightShort = /home improvement/i.test(rc) ? "Specialized categories" : "Broader product mix";
    if (leftShort !== rightShort) {
      out.push(`${left.label}: ${leftShort} ↔ ${right.label}: ${rightShort}`);
    }
  }
  return out.slice(0, 5);
}

function orgLeadershipNotes(left: EntitySummary, right: EntitySummary): string[] {
  const out: string[] = [];
  const lCeo = factLine(left, "P169", 1);
  const rCeo = factLine(right, "P169", 1);
  if (lCeo !== "—" || rCeo !== "—") {
    out.push(
      `Leadership: ${left.label} — ${lCeo !== "—" ? lCeo : "—"}; ${right.label} — ${rCeo !== "—" ? rCeo : "—"}`,
    );
  }
  if (factCount(left, "P414") && factCount(right, "P414")) {
    out.push("Both are publicly listed companies");
  }
  if (employeesBest(left) !== "—" || employeesBest(right) !== "—") {
    out.push("Both operate large retail workforces at continental scale");
  }
  if (websiteHost(left) !== "—" && websiteHost(right) !== "—") {
    out.push("Both invest in digital channels alongside stores");
  }
  return out.slice(0, 5);
}

function buildOrgCompareBrief(left: EntitySummary, right: EntitySummary): CompareBrief {
  const contrasts: CompareContrast[] = [];
  const push = (label: string, l: string, r: string, note?: string) => {
    if (l === "—" && r === "—") return;
    contrasts.push({ label, left: l, right: r, note });
  };

  const bothRetail = isRetailOrg(left) && isRetailOrg(right);

  push("Founded", foundedLine(left), foundedLine(right), inceptionGap(left, right) ?? undefined);
  push("Headquarters", headquartersBest(left), headquartersBest(right));
  push(
    bothRetail ? "Retail category" : "Industry",
    bothRetail ? retailCategoryLine(left) : craftFocus(left),
    bothRetail ? retailCategoryLine(right) : craftFocus(right),
  );
  push("Business model", businessModelLine(left), businessModelLine(right));
  push("Total stores", storesLine(left), storesLine(right), "Wikipedia number of locations");
  push("Employees", employeesBest(left), employeesBest(right));
  push("Annual revenue", revenueBest(left), revenueBest(right));
  push("Key products", productsLine(left), productsLine(right));
  push("Technology focus", technologyFocusLine(left), technologyFocusLine(right));
  push("Area served", areaServedLine(left), areaServedLine(right));
  push("Chief executive", factLine(left, "P169", 2), factLine(right, "P169", 2));
  push("Stock exchange", factLine(left, "P414", 2), factLine(right, "P414", 2));
  push("Website", websiteHost(left), websiteHost(right));
  push("Founded by", factLine(left, "P112", 2), factLine(right, "P112", 2));
  push(
    "Net profit",
    quantityLine(left, "P2295", asMoneyLabel),
    quantityLine(right, "P2295", asMoneyLabel),
  );

  const sharedInd = overlapTokens(factLine(left, "P452"), factLine(right, "P452"));
  const sharedCountry = overlapTokens(factLine(left, "P17"), factLine(right, "P17"));
  const sharedEx = overlapTokens(factLine(left, "P414"), factLine(right, "P414"));

  const overlap: string[] = [];
  if (bothRetail) {
    overlap.push("Both are leading retail brands");
    overlap.push("Both have strong omnichannel presence");
    overlap.push("Both focus on customer experience");
    overlap.push("Both invest in technology and innovation");
  } else {
    overlap.push("Both are organizations");
  }
  for (const t of sharedInd) overlap.push(`Shared industry: ${t}`);
  for (const t of sharedCountry) overlap.push(`Same country: ${t}`);
  for (const t of sharedEx) overlap.push(`Same exchange: ${t}`);
  if (factCount(left, "P414") > 0 && factCount(right, "P414") > 0) {
    overlap.push("Both publicly listed");
  }
  const gap = inceptionGap(left, right);
  if (gap) overlap.push(gap);

  const priority = [
    "Founded",
    "Headquarters",
    "Retail category",
    "Industry",
    "Business model",
    "Total stores",
    "Employees",
    "Annual revenue",
    "Key products",
    "Technology focus",
    "Area served",
    "Chief executive",
    "Stock exchange",
    "Website",
    "Founded by",
    "Net profit",
  ];
  const rank = (label: string) => {
    const i = priority.indexOf(label);
    return i >= 0 ? i : 80;
  };
  contrasts.sort((a, b) => rank(a.label) - rank(b.label));

  const leftMotto = mottoLine(left);
  const rightMotto = mottoLine(right);

  return {
    headline: bothRetail
      ? `${left.label} vs ${right.label} — retail at continental scale`
      : `${left.label} vs ${right.label}`,
    verdict: bothRetail
      ? `${left.label} and ${right.label} are two pillars of U.S. big-box retail — ` +
        `one leaning general merchandise and everyday essentials, the other home improvement and hardware. ` +
        `Line up stores, headcount, revenue, and product mix below — a map of two chains, not a scoreboard.`
      : `${left.label} and ${right.label} make a natural company matchup. ` +
        `The cards below line up industry, founding, scale, and market signals from Wikidata and Wikipedia.`,
    overlap: [...new Set(overlap)].slice(0, 8),
    contrasts: contrasts.slice(0, 12),
    differences: orgDifferences(left, right),
    leadership: orgLeadershipNotes(left, right),
    leftMotto,
    rightMotto,
    leftAngle:
      leftMotto ||
      left.description ||
      `${left.label} — ${craftFocus(left)}; explore the profile for the full company story.`,
    rightAngle:
      rightMotto ||
      right.description ||
      `${right.label} — ${craftFocus(right)}; explore the profile for the full company story.`,
    shareBlurb: bothRetail
      ? `Comparing ${left.label} & ${right.label} — two retail giants, different aisles, same scale game.`
      : `Comparing ${left.label} and ${right.label} — industry, founding, and scale side by side.`,
    fallback: true,
  };
}

function generationGap(left: EntitySummary, right: EntitySummary): string | null {
  const a = yearFrom(factLine(left, "P569"));
  const b = yearFrom(factLine(right, "P569"));
  if (a == null || b == null) return null;
  const gap = Math.abs(a - b);
  if (gap < 5) return "Near-contemporaries";
  if (gap < 15) return `~${gap} years apart`;
  if (gap < 30) return `A generation apart (~${gap} yrs)`;
  return `Different eras (~${gap} yrs)`;
}

function awardsLine(entity: EntitySummary): string {
  const n = factCount(entity, "P166");
  if (!n) return "—";
  const top = factLine(entity, "P166", 2);
  if (n <= 2) return top;
  return `${top} · +${n - 2} more`;
}

function notableLine(entity: EntitySummary): string {
  const works = factLine(entity, "P800", 2);
  if (works !== "—") return works;
  const desc = entity.description;
  if (desc && desc.length <= 72) return desc;
  return "—";
}

function languageLine(entity: EntitySummary): string {
  const langs = factLine(entity, "P1412", 4);
  if (langs !== "—") return langs;
  const cit = factLine(entity, "P27", 2).toLowerCase();
  const desc = (entity.description ?? "").toLowerCase();
  if (/india|indian/.test(cit) || /bollywood|hindi|playback/.test(desc)) {
    return "Hindi (inferred)";
  }
  return "—";
}

function stageVibe(entity: EntitySummary): string {
  const occ = occupations(entity);
  const desc = (entity.description ?? "").toLowerCase();
  if (/playback/.test(desc) || occ.some((l) => /playback/i.test(l))) {
    return "Playback legend";
  }
  if (/composer|music director/.test(desc) || occ.some((l) => /composer|music director/i.test(l))) {
    return "Behind the score";
  }
  if (isActorOcc(occ) && isSingerOcc(occ)) return "Screen & song";
  if (isActorOcc(occ)) return "On-screen presence";
  if (isSingerOcc(occ)) return "Voice first";
  return entity.type === "person" ? "Public figure" : entity.type;
}

function firstSingingLine(stats?: CompareCareerStats | null): string {
  if (!stats?.firstSinging) return "—";
  const t = stats.firstSinging.title;
  const short = t.length > 42 ? `${t.slice(0, 40)}…` : t;
  return `${stats.firstSinging.year} — ${short}`;
}

function lastSingingLine(stats?: CompareCareerStats | null): string {
  if (!stats?.lastSinging) return "—";
  const t = stats.lastSinging.title;
  const short = t.length > 42 ? `${t.slice(0, 40)}…` : t;
  return `${stats.lastSinging.year} — ${short}`;
}

function worksLine(stats?: CompareCareerStats | null): string {
  if (stats?.recordedWorks == null) return "—";
  return `${stats.recordedWorks.toLocaleString()} credited works`;
}

function spanLine(stats?: CompareCareerStats | null): string {
  if (stats?.careerSpanYears == null) return "—";
  const a = stats.firstSinging?.year;
  const b = stats.lastSinging?.year;
  if (a != null && b != null) return `${stats.careerSpanYears} yrs (${a}–${b})`;
  return `${stats.careerSpanYears} years`;
}

function topDirectorLine(stats?: CompareCareerStats | null): string {
  const top = stats?.topMusicDirectors?.[0];
  if (!top) return "—";
  return `${top.label} (${top.count})`;
}

function topDirectorsNote(stats?: CompareCareerStats | null): string | undefined {
  const rest = stats?.topMusicDirectors?.slice(1, 3);
  if (!rest?.length) return undefined;
  return rest.map((d) => `${d.label} ${d.count}`).join(" · ");
}

function lataLine(stats?: CompareCareerStats | null): string {
  if (stats?.lataCollaborations == null) return "—";
  if (stats.lataCollaborations === 0) return "None tagged on Wikidata";
  return `${stats.lataCollaborations.toLocaleString()} shared credits`;
}

function listOrDash(values?: string[], limit = 2): string {
  if (!values?.length) return "—";
  return values.slice(0, limit).join(" · ");
}

function houseLine(entity: EntitySummary, stats?: CompareCareerStats | null): string {
  const fromStats = listOrDash(stats?.residence);
  if (fromStats !== "—") return fromStats;
  const fromFacts = factLine(entity, "P551", 2);
  if (fromFacts !== "—") return fromFacts;
  const workLoc = listOrDash(stats?.workLocation) !== "—"
    ? listOrDash(stats?.workLocation)
    : factLine(entity, "P937", 2);
  if (workLoc !== "—") return `Based around ${workLoc}`;
  return "—";
}

function assetsLine(entity: EntitySummary, stats?: CompareCareerStats | null): string {
  const fromStats = listOrDash(stats?.assets);
  if (fromStats !== "—") return fromStats;
  return factLine(entity, "P1830", 2);
}

function earningsLine(entity: EntitySummary, stats?: CompareCareerStats | null): string {
  const fromStats = listOrDash(stats?.netWorth, 1);
  if (fromStats !== "—") return fromStats;
  return factLine(entity, "P2218", 1);
}

function filmCreditsLine(stats?: CompareCareerStats | null): string {
  if (stats?.filmCredits == null || stats.filmCredits <= 0) return "—";
  return `${stats.filmCredits} on-screen credits`;
}

function digestSide(entity: EntitySummary, career?: CompareCareerStats | null) {
  const born = factLine(entity, "P569");
  const founded = foundedLine(entity);
  return {
    id: entity.id,
    label: entity.label,
    description: entity.description,
    type: entity.type,
    lifespan: entity.lifespan,
    craftFocus: craftFocus(entity),
    era: eraLabel(entity),
    bornYear: yearFrom(born),
    foundedYear: yearFrom(founded),
    awardCount: factCount(entity, "P166"),
    wikipediaLead: (entity.wikipedia?.lead || entity.wikipediaSummary || "").slice(0, 900),
    wikiRevisedAt: entity.wikipedia?.revisedAt,
    career: career
      ? {
          recordedWorks: career.recordedWorks,
          firstSinging: career.firstSinging,
          lastSinging: career.lastSinging,
          careerSpanYears: career.careerSpanYears,
          topMusicDirectors: career.topMusicDirectors,
          lataCollaborations: career.lataCollaborations,
          filmCredits: career.filmCredits,
          residence: career.residence,
          assets: career.assets,
          netWorth: career.netWorth,
          workLocation: career.workLocation,
        }
      : undefined,
    org: entity.type === "organization"
      ? {
          industry: factLine(entity, "P452", 3),
          retailCategory: retailCategoryLine(entity),
          headquarters: headquartersBest(entity),
          country: factLine(entity, "P17", 2),
          founded: founded,
          employees: employeesBest(entity),
          revenue: revenueBest(entity),
          stores: storesLine(entity),
          businessModel: businessModelLine(entity),
          products: productsLine(entity),
          technologyFocus: technologyFocusLine(entity),
          areaServed: areaServedLine(entity),
          netProfit: quantityLine(entity, "P2295", asMoneyLabel),
          exchange: factLine(entity, "P414", 2),
          ticker: factLine(entity, "P249", 1),
          ceo: factLine(entity, "P169", 2),
          website: websiteHost(entity),
          motto: mottoLine(entity) ?? null,
        }
      : undefined,
    facts: FACT_PIDS.map(({ pid, label }) => ({
      label,
      value: factLine(entity, pid, pid === "P166" ? 5 : 3),
      count: factCount(entity, pid),
    })).filter((f) => f.value !== "—"),
  };
}

function overlapTokens(a: string, b: string): string[] {
  if (a === "—" || b === "—") return [];
  const norm = (s: string) =>
    s
      .toLowerCase()
      .split(/[·,;/|]+/)
      .map((x) => x.trim())
      .filter((x) => x.length > 2 && !/^(and|the|of|in|a)$/.test(x));
  const setB = new Set(norm(b));
  return [...new Set(norm(a).filter((t) => setB.has(t)))].slice(0, 4);
}

/**
 * Smart local brief — domain-aware rows (singers get craft/era/voice + dynamic career stats;
 * organizations get industry / scale / market signals).
 * AI polish upgrades this when keys are present.
 */
export function buildLocalCompareBrief(
  left: EntitySummary,
  right: EntitySummary,
  career?: CompareCareerPair | null,
): CompareBrief {
  if (left.type === "organization" && right.type === "organization") {
    return buildOrgCompareBrief(left, right);
  }

  const leftOcc = occupations(left);
  const rightOcc = occupations(right);
  const bothSingers = isSingerOcc(leftOcc) && isSingerOcc(rightOcc);
  const bothActors = isActorOcc(leftOcc) && isActorOcc(rightOcc);
  const bothPeople = left.type === "person" && right.type === "person";
  const leftCareer = career?.left ?? null;
  const rightCareer = career?.right ?? null;
  const hasSingingDepth =
    Boolean(leftCareer?.recordedWorks || leftCareer?.firstSinging) ||
    Boolean(rightCareer?.recordedWorks || rightCareer?.firstSinging);
  // Only treat singing stats as career depth for singer matchups — stray P175
  // credits on actors (Rani/Kajol) must not open the playback block.
  const showSingingCareer = bothSingers || (hasSingingDepth && !bothActors);

  const contrasts: CompareContrast[] = [];

  const push = (label: string, l: string, r: string, note?: string) => {
    if (l === "—" && r === "—") return;
    contrasts.push({ label, left: l, right: r, note });
  };

  // Creative / intelligent rows first
  push(
    "Craft focus",
    craftFocus(left),
    craftFocus(right),
    bothSingers ? "Voice & screen craft" : bothActors ? "Screen craft" : undefined,
  );
  push("Era", eraLabel(left), eraLabel(right), generationGap(left, right) ?? undefined);
  push("Stage vibe", stageVibe(left), stageVibe(right));

  // Dynamic career block (playback / film music) — singers only
  if (showSingingCareer) {
    push("First singing", firstSingingLine(leftCareer), firstSingingLine(rightCareer), "Earliest dated P175 credit");
    push("Last singing", lastSingingLine(leftCareer), lastSingingLine(rightCareer), "Latest dated P175 credit");
    push("Career span", spanLine(leftCareer), spanLine(rightCareer));
    push("Recorded works", worksLine(leftCareer), worksLine(rightCareer), "Wikidata performer credits");
    push(
      "With Lata",
      lataLine(leftCareer),
      lataLine(rightCareer),
      "Shared song credits with Lata Mangeshkar",
    );
    const leftDirNote = topDirectorsNote(leftCareer);
    const rightDirNote = topDirectorsNote(rightCareer);
    push(
      "Top music director",
      topDirectorLine(leftCareer),
      topDirectorLine(rightCareer),
      [leftDirNote, rightDirNote].filter(Boolean).join(" · ") || "Most frequent P86 composer",
    );
  }

  if (bothActors || filmCreditsLine(leftCareer) !== "—" || filmCreditsLine(rightCareer) !== "—") {
    push("Screen credits", filmCreditsLine(leftCareer), filmCreditsLine(rightCareer));
  }

  if (!bothActors) {
    push("House / base", houseLine(left, leftCareer), houseLine(right, rightCareer));
    push("Assets", assetsLine(left, leftCareer), assetsLine(right, rightCareer));
    push("Earnings", earningsLine(left, leftCareer), earningsLine(right, rightCareer), "Net worth when Wikidata has P2218");
  }

  const lb = factLine(left, "P569");
  const rb = factLine(right, "P569");
  push(
    "Born",
    lb !== "—" ? lb : "—",
    rb !== "—" ? rb : "—",
    generationGap(left, right) ?? undefined,
  );

  push("Roots", factLine(left, "P19"), factLine(right, "P19"));
  push("Citizenship", factLine(left, "P27", 2), factLine(right, "P27", 2));

  if (bothSingers || bothActors || bothPeople) {
    push("Languages", languageLine(left), languageLine(right));
  }

  const leftGenre = factLine(left, "P136", 3);
  const rightGenre = factLine(right, "P136", 3);
  if (leftGenre !== "—" || rightGenre !== "—") {
    push("Genre", leftGenre, rightGenre);
  }

  push("Signature works", notableLine(left), notableLine(right), "From Wikidata notable works");
  push("Honours", awardsLine(left), awardsLine(right));

  // Spouse / education are secondary for actress matchups — keep only if both sides have data
  const ls = factLine(left, "P26", 2);
  const rs = factLine(right, "P26", 2);
  if (ls !== "—" && rs !== "—") push("Personal life", ls, rs);

  const le = factLine(left, "P69", 2);
  const re = factLine(right, "P69", 2);
  if (le !== "—" && re !== "—") push("Education", le, re);

  if (!bothSingers && !bothActors) {
    push("Listed roles", factLine(left, "P106", 4), factLine(right, "P106", 4));
  }

  const sharedOcc = overlapTokens(factLine(left, "P106"), factLine(right, "P106"));
  const sharedCit = overlapTokens(factLine(left, "P27"), factLine(right, "P27"));
  const sharedLang = overlapTokens(languageLine(left), languageLine(right));

  const overlap: string[] = [];
  if (left.type === right.type) overlap.push(`Both are ${left.type}s`);
  if (bothSingers) overlap.push("Playback / singing lineage");
  if (bothActors) overlap.push("Shared film world");
  for (const t of sharedOcc) overlap.push(`Shared craft: ${t}`);
  for (const t of sharedCit) overlap.push(`Same citizenship: ${t}`);
  for (const t of sharedLang.filter((x) => !/inferred/.test(x))) {
    overlap.push(`Language overlap: ${t}`);
  }
  const gap = generationGap(left, right);
  if (gap) overlap.push(gap);
  if (factCount(left, "P166") > 0 && factCount(right, "P166") > 0) {
    overlap.push("Both decorated with major honours");
  }
  if (
    leftCareer?.lataCollaborations &&
    rightCareer?.lataCollaborations &&
    leftCareer.lataCollaborations > 0 &&
    rightCareer.lataCollaborations > 0
  ) {
    overlap.push("Both share Wikidata credits with Lata Mangeshkar");
  }
  if (leftCareer?.topMusicDirectors?.[0] && rightCareer?.topMusicDirectors?.[0]) {
    const a = leftCareer.topMusicDirectors[0].label;
    const b = rightCareer.topMusicDirectors[0].label;
    if (a === b) overlap.push(`Shared music-director orbit: ${a}`);
  }

  const leftBorn = yearFrom(lb);
  const rightBorn = yearFrom(rb);
  let verdict: string;
  if (bothSingers) {
    const careerBits: string[] = [];
    if (leftCareer?.recordedWorks) {
      careerBits.push(`${left.label} has ~${leftCareer.recordedWorks} Wikidata song credits`);
    }
    if (rightCareer?.recordedWorks) {
      careerBits.push(`${right.label} has ~${rightCareer.recordedWorks}`);
    }
    verdict =
      `${left.label} and ${right.label} sit on the same golden thread of Indian film music — ` +
      `voices that defined playback for their generations. ` +
      (leftBorn && rightBorn
        ? `${left.label} (${leftBorn}) and ${right.label} (${rightBorn}) mark different chapters of the same soundtrack. `
        : "") +
      (careerBits.length ? `${careerBits.join("; ")}. ` : "") +
      `Line up first songs, collabs, and music directors below — not to crown a winner, but to hear how two legends echo.`;
  } else if (bothActors) {
    verdict =
      `${left.label} and ${right.label} are two screen landmarks. ` +
      `${left.description || "Their craft shaped an era."} ` +
      `${right.description || "Their presence still travels."} ` +
      `The matchup below is about eras, roles, and legacy — not a scoreboard.`;
  } else {
    verdict =
      `${left.label} and ${right.label} make a natural comparison. ` +
      `${left.description || "See vitals on the left."} ` +
      `${right.description || "See vitals on the right."} ` +
      `The cards below line up the clearest Wikidata signals — craft, era, and what each is remembered for.`;
  }

  const priority = bothActors && !bothSingers
    ? [
        "Craft focus",
        "Era",
        "Stage vibe",
        "Screen credits",
        "Signature works",
        "Honours",
        "Born",
        "Roots",
        "Languages",
        "Genre",
        "Citizenship",
        "Personal life",
        "Education",
      ]
    : [
        "Craft focus",
        "Era",
        "First singing",
        "Last singing",
        "Career span",
        "Recorded works",
        "With Lata",
        "Top music director",
        "Screen credits",
        "Stage vibe",
        "House / base",
        "Assets",
        "Earnings",
        "Born",
        "Roots",
        "Signature works",
        "Honours",
        "Languages",
        "Genre",
        "Citizenship",
        "Personal life",
        "Education",
        "Listed roles",
      ];
  const rank = (label: string) => {
    const i = priority.indexOf(label);
    return i >= 0 ? i : 80;
  };
  contrasts.sort((a, b) => rank(a.label) - rank(b.label));

  const maxRows = showSingingCareer || bothActors ? 12 : 10;

  return {
    headline: bothSingers
      ? `${left.label} vs ${right.label} — voices of an era`
      : bothActors
        ? `${left.label} vs ${right.label} — two screen eras`
        : `${left.label} vs ${right.label}`,
    verdict,
    overlap: [...new Set(overlap)].slice(0, 8),
    contrasts: contrasts.slice(0, maxRows),
    leftAngle:
      left.description ||
      `${left.label} — ${craftFocus(left)}; explore the profile for the full story.`,
    rightAngle:
      right.description ||
      `${right.label} — ${craftFocus(right)}; explore the profile for the full story.`,
    shareBlurb: bothSingers
      ? `Comparing ${left.label} & ${right.label} — two playback legends, eras apart, still on every playlist.`
      : bothActors
        ? `Comparing ${left.label} & ${right.label} — two screen landmarks, eras, roles, and Filmfare legacy.`
        : `Comparing ${left.label} and ${right.label} — craft, eras, and legacy side by side.`,
    fallback: true,
  };
}

/** Compact profile metrics for organization compare cards. */
export function orgCompareStats(entity: EntitySummary): Array<{ label: string; value: string }> {
  const stores = storesLine(entity);
  const employees = employeesBest(entity);
  const revenue = revenueBest(entity);
  return [
    {
      label: "Stores",
      value: stores === "—" ? "—" : stores.replace(/\s*\(\d{4}\)$/, ""),
    },
    {
      label: "Employees",
      value: employees === "—" ? "—" : employees.replace(/\s*\(\d{4}\)$/, ""),
    },
    {
      label: "Revenue",
      value: revenue === "—" ? "—" : revenue.replace(/\s*\(\d{4}\)$/, ""),
    },
  ];
}

function normalizeCompareBrief(raw: unknown, local: CompareBrief): CompareBrief {
  if (!raw || typeof raw !== "object") return local;
  const o = raw as Record<string, unknown>;
  const contrasts = Array.isArray(o.contrasts)
    ? o.contrasts
        .slice(0, 14)
        .map((row) => {
          const r = (row ?? {}) as Record<string, unknown>;
          return {
            label: String(r.label ?? "").trim(),
            left: String(r.left ?? "").trim(),
            right: String(r.right ?? "").trim(),
            note: r.note != null ? String(r.note).trim() : undefined,
          };
        })
        .filter((c) => c.label && (c.left || c.right))
    : local.contrasts;
  const overlap = Array.isArray(o.overlap)
    ? o.overlap.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 8)
    : local.overlap;
  const verdict = o.verdict != null ? String(o.verdict).trim() : local.verdict;
  if (!verdict) return local;
  return {
    headline: o.headline != null ? String(o.headline).trim() : local.headline,
    verdict,
    overlap: overlap.length ? overlap : local.overlap,
    contrasts: contrasts.length ? contrasts : local.contrasts,
    differences: Array.isArray(o.differences)
      ? o.differences.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 6)
      : local.differences,
    leadership: Array.isArray(o.leadership)
      ? o.leadership.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 6)
      : local.leadership,
    leftMotto:
      o.leftMotto != null ? String(o.leftMotto).trim() : local.leftMotto,
    rightMotto:
      o.rightMotto != null ? String(o.rightMotto).trim() : local.rightMotto,
    leftAngle: o.leftAngle != null ? String(o.leftAngle).trim() : local.leftAngle,
    rightAngle: o.rightAngle != null ? String(o.rightAngle).trim() : local.rightAngle,
    shareBlurb: o.shareBlurb != null ? String(o.shareBlurb).trim() : local.shareBlurb,
    fallback: false,
  };
}

export async function fetchCompareEnrichment(
  left: EntitySummary,
  right: EntitySummary,
  career?: CompareCareerPair | null,
): Promise<CompareBrief> {
  const local = buildLocalCompareBrief(left, right, career);
  const digest = {
    left: digestSide(left, career?.left),
    right: digestSide(right, career?.right),
    local: {
      headline: local.headline,
      verdict: local.verdict,
      overlap: local.overlap,
      contrasts: local.contrasts,
      leftAngle: local.leftAngle,
      rightAngle: local.rightAngle,
      shareBlurb: local.shareBlurb,
    },
  };

  try {
    const res = await fetch("/api/ai/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(digest),
    });
    if (!res.ok) {
      return {
        ...local,
        hint:
          res.status === 503
            ? "Local compare — add an AI key for a richer matchup."
            : "Local compare (AI polish unavailable).",
      };
    }
    const data: unknown = await res.json();
    return normalizeCompareBrief(data, local);
  } catch {
    return { ...local, hint: "Local compare (AI offline)." };
  }
}
