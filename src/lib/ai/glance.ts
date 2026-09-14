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

function yearOf(text?: string): string | undefined {
  return text?.match(/\b(1[5-9]\d{2}|20\d{2})\b/)?.[1];
}

/** Deterministic snapshot — AI polish when available. */
export function buildLocalGlance(entity: EntitySummary): GlanceSnapshot {
  if (entity.type === "organization") {
    const metrics: GlanceMetric[] = [];
    const revenue = factLabel(entity, "P2139") || wikiRow(entity, /^revenue$/i);
    if (revenue) metrics.push({ label: "Revenue", value: shortMoney(revenue) });
    const profit = factLabel(entity, "P2295") || wikiRow(entity, /^net (income|profit)$/i);
    if (profit) metrics.push({ label: "Net profit", value: shortMoney(profit) });
    const employees = factLabel(entity, "P1128") || wikiRow(entity, /^number of employees|employees$/i);
    if (employees) metrics.push({ label: "Employees", value: employees });
    const founded =
      yearOf(factLabel(entity, "P571")) ||
      yearOf(wikiRow(entity, /^founded|inception$/i));
    if (founded) metrics.push({ label: "Founded", value: founded });
    const mcap = factLabel(entity, "P2226");
    if (mcap && metrics.length < 5) {
      metrics.push({ label: "Market cap", value: shortMoney(mcap) });
    }

    const cards: GlanceCard[] = [];
    const hq =
      factLabel(entity, "P159") ||
      wikiRow(entity, /^headquarters|hq$/i);
    if (hq) cards.push({ label: "Headquarters", value: hq, tone: "hq" });
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
    if (products) cards.push({ label: "Products", value: products, tone: "product" });
    const exchange = factLabel(entity, "P414") || factLabel(entity, "P249");
    if (exchange) cards.push({ label: "Listed", value: exchange, tone: "market" });
    const country = factLabel(entity, "P17");
    if (country && cards.length < 5) {
      cards.push({ label: "Country", value: country, tone: "hq" });
    }

    const pulse =
      entity.description ||
      (industry
        ? `${entity.label} operates in ${industry}${hq ? `, headquartered in ${hq}` : ""}.`
        : `${entity.label} is an organization in the knowledge graph.`);

    return {
      heading: "Company pulse",
      pulse,
      metrics: metrics.slice(0, 5),
      cards: cards.slice(0, 6),
      fallback: true,
    };
  }

  // Person / other — life snapshot
  const metrics: GlanceMetric[] = [];
  if (entity.lifespan) metrics.push({ label: "Lifespan", value: entity.lifespan });
  const awards = fact(entity, "P166")?.values.length;
  if (awards) metrics.push({ label: "Awards", value: String(awards) });
  const works = fact(entity, "P800")?.values.length;
  if (works) metrics.push({ label: "Notable works", value: String(works) });

  const cards: GlanceCard[] = [];
  const born =
    wikiRow(entity, /^born$/i) ||
    [factLabel(entity, "P569"), factLabel(entity, "P19")].filter(Boolean).join(" · ");
  if (born) cards.push({ label: "Born", value: born, tone: "life" });
  const died =
    wikiRow(entity, /^died$/i) ||
    [factLabel(entity, "P570"), factLabel(entity, "P20")].filter(Boolean).join(" · ");
  if (died) cards.push({ label: "Died", value: died, tone: "life" });
  const occ =
    factLabels(entity, "P106", 3).join(" · ") ||
    wikiRow(entity, /^occupations?$/i);
  if (occ) cards.push({ label: "Craft", value: occ, tone: "people" });
  const spouses = factLabels(entity, "P26", 3).join(" · ");
  if (spouses) cards.push({ label: "Family", value: spouses, tone: "people" });
  const nationality = factLabels(entity, "P27", 2).join(" · ");
  if (nationality) cards.push({ label: "Nationality", value: nationality, tone: "hq" });

  return {
    heading: entity.type === "person" ? "Life snapshot" : "At a glance",
    pulse:
      entity.description ||
      entity.wikipedia?.lead?.split(/(?<=\.)\s+/).slice(0, 2).join(" ") ||
      `${entity.label} in the knowledge graph.`,
    metrics: metrics.slice(0, 4),
    cards: cards.slice(0, 6),
    fallback: true,
  };
}

function normalizeGlance(raw: unknown, local: GlanceSnapshot): GlanceSnapshot {
  if (!raw || typeof raw !== "object") return local;
  const o = raw as Record<string, unknown>;
  const pulse = o.pulse != null ? String(o.pulse).trim() : local.pulse;
  if (!pulse) return local;

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
        "P414", "P249", "P17", "P1454", "P2226", "P2403",
        "P569", "P570", "P19", "P20", "P106", "P26", "P27", "P166", "P800",
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
