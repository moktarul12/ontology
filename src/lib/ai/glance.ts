import type { EntitySummary } from "@/lib/wikidata/types.ts";

export type GlanceMetric = {
  label: string;
  value: string;
  note?: string;
};

export type GlanceCard = {
  label: string;
  value: string;
  tone?: "hq" | "people" | "market" | "product" | "life" | "default";
};

export type GlanceSnapshot = {
  heading: string;
  pulse: string;
  metrics: GlanceMetric[];
  cards: GlanceCard[];
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

/** Best 1–2 sentences of identity — never the short Wikidata description. */
function highlightPulse(entity: EntitySummary): string {
  const desc = (entity.description || "").trim();
  const lead = (entity.wikipedia?.lead || "").replace(/\s+/g, " ").trim();
  const sentences = lead
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 50);

  const useful = sentences.filter((s) => !desc || !similarTo(s, desc));
  const pick = (useful.length ? useful : sentences).slice(0, 2).join(" ");
  if (pick) return pick.length > 340 ? `${pick.slice(0, 337).trimEnd()}…` : pick;

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
  return highlightPulse(entity);
}

/** Deterministic snapshot — AI polish when available. */
export function buildLocalGlance(entity: EntitySummary): GlanceSnapshot {
  if (entity.type === "organization") {
    const metrics: GlanceMetric[] = [];
    const mcap =
      factLabel(entity, "P2226") ||
      wikiByLabel(entity, ["market cap", "market capitalisation", "market capitalization"]);
    if (mcap) metrics.push({ label: "Market cap", value: compactStat(mcap) });
    const revenue =
      factLabel(entity, "P2139") ||
      wikiRow(entity, /^revenue$/i) ||
      wikiByLabel(entity, ["revenue"]);
    if (revenue) metrics.push({ label: "Revenue", value: compactStat(revenue) });
    const profit =
      factLabel(entity, "P2295") ||
      wikiRow(entity, /^net (income|profit)$/i) ||
      wikiByLabel(entity, ["net income", "net profit"]);
    if (profit) metrics.push({ label: "Net profit", value: compactStat(profit) });
    const employees =
      factLabel(entity, "P1128") ||
      wikiByLabel(entity, ["number of employees", "employees"]);
    if (employees) metrics.push({ label: "Employees", value: compactStat(employees) });
    const locations = wikiByLabel(entity, ["number of locations", "locations", "stores", "number of stores"]);
    if (locations && metrics.length < 5) {
      metrics.push({ label: "Locations", value: compactStat(locations) });
    }
    const founded =
      yearOf(factLabel(entity, "P571")) ||
      yearOf(wikiRow(entity, /^founded|inception$/i)) ||
      yearOf(wikiByLabel(entity, ["founded"]));
    if (founded && metrics.length < 5) metrics.push({ label: "Founded", value: founded });
    const ticker = factLabel(entity, "P249");
    const exchange = factLabel(entity, "P414") || wikiByLabel(entity, ["traded as"]);
    if (ticker && metrics.length < 6) {
      metrics.push({ label: "Ticker", value: exchange ? `${ticker} · ${compactStat(exchange)}` : ticker });
    }

    const cards: GlanceCard[] = [];
    const hq =
      factLabel(entity, "P159") ||
      wikiRow(entity, /^headquarters|hq$/i);
    if (hq) cards.push({ label: "Headquarters", value: compactStat(hq), tone: "hq" });
    const ceo =
      factLabel(entity, "P169") ||
      wikiRow(entity, /^ceo|chief executive|key people$/i);
    if (ceo) cards.push({ label: "Leadership", value: ceo.split(/[;|]/)[0]!.trim(), tone: "people" });
    const industry =
      factLabels(entity, "P452", 2).join(" · ") ||
      wikiRow(entity, /^industry$/i);
    if (industry) cards.push({ label: "Industry", value: industry, tone: "market" });
    const products =
      factLabels(entity, "P1056", 3).join(" · ") ||
      wikiRow(entity, /^products?$/i);
    if (products) cards.push({ label: "Products", value: compactStat(products), tone: "product" });
    if (exchange) cards.push({ label: "Listed", value: compactStat(exchange), tone: "market" });
    const country = factLabel(entity, "P17");
    if (country && cards.length < 6) {
      cards.push({ label: "Country", value: country, tone: "hq" });
    }

    return {
      heading: "Company highlights",
      pulse: orgHighlightPulse(entity, metrics),
      metrics: metrics.slice(0, 6),
      cards: cards.slice(0, 6),
      fallback: true,
    };
  }

  // Person — achievements, not a mini-biography
  const metrics: GlanceMetric[] = [];
  const awards = fact(entity, "P166")?.values.length;
  if (awards) metrics.push({ label: "Awards", value: String(awards) });
  const workCount =
    (fact(entity, "P800")?.values.length ?? 0) +
    (fact(entity, "CR_SONG")?.values.length ?? 0) +
    (fact(entity, "CR_FILM")?.values.length ?? 0);
  if (workCount) metrics.push({ label: "Notable works", value: String(workCount) });
  const nominated = fact(entity, "P1411")?.values.length;
  if (nominated) metrics.push({ label: "Nominations", value: String(nominated) });

  const cards: GlanceCard[] = [];
  const awardNames = factLabels(entity, "P166", 4).join(" · ");
  if (awardNames) cards.push({ label: "Honours", value: awardNames, tone: "market" });
  const knownFor = factLabels(entity, "P800", 4).join(" · ");
  if (knownFor) cards.push({ label: "Known for", value: knownFor, tone: "product" });
  const songs = factLabels(entity, "CR_SONG", 3).join(" · ");
  if (songs && cards.length < 4) cards.push({ label: "Songs", value: songs, tone: "product" });
  const films = factLabels(entity, "CR_FILM", 3).join(" · ");
  if (films && cards.length < 4) cards.push({ label: "Films", value: films, tone: "product" });
  const occ =
    factLabels(entity, "P106", 3).join(" · ") ||
    wikiRow(entity, /^occupations?$/i);
  if (occ) cards.push({ label: "Craft", value: occ, tone: "people" });

  return {
    heading: entity.type === "person" ? "Life snapshot" : "At a glance",
    pulse: "",
    metrics: metrics.slice(0, 4),
    cards: cards.slice(0, 6),
    fallback: true,
  };
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
            tone,
          };
        })
        .filter((c) => c.label && c.value)
    : local.cards;

  return {
    heading: o.heading != null ? String(o.heading) : local.heading,
    pulse,
    metrics: metrics.length ? metrics : local.metrics,
    cards: cards.length ? cards : local.cards,
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
        "P414", "P249", "P17", "P1454", "P2226", "P2403", "P793",
        "P569", "P570", "P19", "P20", "P106", "P26", "P27", "P166", "P800", "P1411",
        "CR_SONG", "CR_FILM", "CR_ALBUM",
      ].includes(f.propertyId),
    )
    .slice(0, 14)
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
        type: entity.type,
        wikipediaLead: (entity.wikipedia?.lead ?? "").slice(0, 900),
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
