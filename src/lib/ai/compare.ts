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
  fallback?: boolean;
  hint?: string;
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
  { pid: "P452", label: "Industry" },
  { pid: "P571", label: "Inception" },
  { pid: "P112", label: "Founded by" },
  { pid: "P159", label: "Headquarters" },
];

function factLine(entity: EntitySummary, pid: string, limit = 3): string {
  const f = entity.facts.find((x) => x.propertyId === pid);
  if (!f?.values.length) return "—";
  return f.values.slice(0, limit).map((v) => v.label).join(" · ");
}

function digestSide(entity: EntitySummary) {
  return {
    id: entity.id,
    label: entity.label,
    description: entity.description,
    type: entity.type,
    lifespan: entity.lifespan,
    wikipediaLead: (entity.wikipedia?.lead || entity.wikipediaSummary || "").slice(0, 700),
    wikiRevisedAt: entity.wikipedia?.revisedAt,
    facts: FACT_PIDS.map(({ pid, label }) => ({
      label,
      value: factLine(entity, pid),
    })).filter((f) => f.value !== "—"),
  };
}

export function buildLocalCompareBrief(
  left: EntitySummary,
  right: EntitySummary,
): CompareBrief {
  const contrasts: CompareContrast[] = FACT_PIDS.map(({ pid, label }) => {
    const l = factLine(left, pid);
    const r = factLine(right, pid);
    if (l === "—" && r === "—") return null;
    return { label, left: l, right: r };
  }).filter((c): c is CompareContrast => c != null).slice(0, 8);

  const sharedOcc = overlapTokens(
    factLine(left, "P106"),
    factLine(right, "P106"),
  );
  const sharedCit = overlapTokens(
    factLine(left, "P27"),
    factLine(right, "P27"),
  );
  const overlap = [
    left.type === right.type ? `Both are ${left.type}s` : `${left.type} vs ${right.type}`,
    ...sharedOcc.map((t) => `Shared craft: ${t}`),
    ...sharedCit.map((t) => `Citizenship overlap: ${t}`),
  ].slice(0, 6);

  return {
    headline: `${left.label} vs ${right.label}`,
    verdict:
      `${left.label} and ${right.label} make a natural comparison. ` +
      `${left.description || "See vitals on the left."} ` +
      `${right.description || "See vitals on the right."} ` +
      `The table below lines up the clearest Wikidata signals side by side.`,
    overlap,
    contrasts,
    leftAngle: left.description || `${left.label} — explore the profile for the full story.`,
    rightAngle: right.description || `${right.label} — explore the profile for the full story.`,
    shareBlurb: `Comparing ${left.label} and ${right.label} — eras, craft, and legacy side by side.`,
    fallback: true,
  };
}

function overlapTokens(a: string, b: string): string[] {
  if (a === "—" || b === "—") return [];
  const norm = (s: string) =>
    s.toLowerCase().split(/[·,;/|]+/).map((x) => x.trim()).filter((x) => x.length > 2);
  const setB = new Set(norm(b));
  return [...new Set(norm(a).filter((t) => setB.has(t)))].slice(0, 4);
}

function normalizeCompareBrief(raw: unknown, local: CompareBrief): CompareBrief {
  if (!raw || typeof raw !== "object") return local;
  const o = raw as Record<string, unknown>;
  const contrasts = Array.isArray(o.contrasts)
    ? o.contrasts.slice(0, 10).map((row) => {
        const r = (row ?? {}) as Record<string, unknown>;
        return {
          label: String(r.label ?? "").trim(),
          left: String(r.left ?? "").trim(),
          right: String(r.right ?? "").trim(),
          note: r.note != null ? String(r.note).trim() : undefined,
        };
      }).filter((c) => c.label && (c.left || c.right))
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
    leftAngle: o.leftAngle != null ? String(o.leftAngle).trim() : local.leftAngle,
    rightAngle: o.rightAngle != null ? String(o.rightAngle).trim() : local.rightAngle,
    shareBlurb: o.shareBlurb != null ? String(o.shareBlurb).trim() : local.shareBlurb,
    fallback: false,
  };
}

export async function fetchCompareEnrichment(
  left: EntitySummary,
  right: EntitySummary,
): Promise<CompareBrief> {
  const local = buildLocalCompareBrief(left, right);
  const digest = {
    left: digestSide(left),
    right: digestSide(right),
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
        hint: res.status === 503
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
