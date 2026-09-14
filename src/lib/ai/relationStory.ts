import type { EntitySummary } from "@/lib/wikidata/types.ts";

export type RelationStory = {
  heading: string;
  kicker?: string;
  summary: string;
  paragraphs: string[];
  beats?: string[];
  fallback?: boolean;
  hint?: string;
};

function isActingAngle(relation: string, propertyId?: string): boolean {
  const r = relation.toLowerCase();
  if (propertyId === "P161" || propertyId === "CR_FILM") return true;
  return /\b(act|actor|actress|acting|cast|film|cinema|screen)\b/.test(r);
}

function actingSentencesFromLead(lead: string): string[] {
  return lead
    .split(/(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length > 40 &&
        /\b(act|actor|actress|film|cinema|screen|role|movie|bollywood|comedy)\b/i.test(s),
    )
    .slice(0, 5);
}

/** Deterministic magazine-style brief until AI returns. */
export function buildLocalRelationStory(opts: {
  personLabel: string;
  relationLabel: string;
  propertyId?: string;
  description?: string;
  wikipediaLead?: string;
  linkedWorks?: string[];
}): RelationStory {
  const {
    personLabel,
    relationLabel,
    propertyId,
    description,
    wikipediaLead = "",
    linkedWorks = [],
  } = opts;
  const acting = isActingAngle(relationLabel, propertyId);
  const works = linkedWorks.filter(Boolean).slice(0, 8);
  const fromLead = actingSentencesFromLead(wikipediaLead);

  const heading = acting
    ? `The acting life of ${personLabel}`
    : `${personLabel} · ${relationLabel}`;

  const kicker = acting
    ? "Screen craft · roles · presence"
    : `Through the lens of ${relationLabel.toLowerCase()}`;

  const summary = acting
    ? `${personLabel} did not treat acting as a side door — it was a second stage where voice, timing, and mischief met the camera.${works.length ? ` Linked credits include ${works.slice(0, 3).join(", ")}.` : ""}`
    : `${personLabel}'s ${relationLabel.toLowerCase()} thread in the knowledge graph${works.length ? `, with ${works.length} linked items such as ${works.slice(0, 2).join(" and ")}` : ""}.`;

  const paragraphs: string[] = [];
  if (description) {
    paragraphs.push(
      acting
        ? `Beyond the shorthand of “${description}”, the acting years show how ${personLabel} shaped scenes — not only as a playback singer remembered for voice, but as a performer who could bend a frame toward laughter or ache.`
        : `${personLabel}: ${description}. This panel follows the ${relationLabel.toLowerCase()} connections gathered from Wikidata and Wikipedia.`,
    );
  }
  if (fromLead.length) {
    paragraphs.push(fromLead.join(" "));
  } else if (wikipediaLead) {
    paragraphs.push(
      wikipediaLead
        .split(/(?<=\.)\s+/)
        .slice(0, 3)
        .join(" "),
    );
  }
  if (works.length) {
    paragraphs.push(
      acting
        ? `On the graph, the acting arm opens onto titles such as ${works.join(" · ")}. Expand the hub to walk those films one by one — each credit is a doorway back into how ${personLabel} inhabited the screen.`
        : `Linked under ${relationLabel}: ${works.join(" · ")}. Expand to explore each connection on the canvas.`,
    );
  }
  if (paragraphs.length < 2) {
    paragraphs.push(
      acting
        ? `What remains striking is the range: comic chaos, romantic lightness, and the odd quiet beat where the performer behind the legend shows through. This write-up will deepen when AI polish is available.`
        : `A fuller narrative of this relation will appear when AI enrichment is available.`,
    );
  }

  const beats = [
    ...works.slice(0, 5),
    ...(acting ? ["Comic timing", "Screen presence", "Dual craft with music"] : []),
  ].slice(0, 8);

  return {
    heading,
    kicker,
    summary,
    paragraphs: paragraphs.slice(0, 6),
    beats: beats.length ? beats : undefined,
    fallback: true,
  };
}

function normalizeStory(raw: unknown, local: RelationStory): RelationStory {
  if (!raw || typeof raw !== "object") return local;
  const o = raw as Record<string, unknown>;
  const summary = o.summary != null ? String(o.summary).trim() : local.summary;
  if (!summary) return local;
  const paragraphs = Array.isArray(o.paragraphs)
    ? o.paragraphs.map(String).map((p) => p.trim()).filter((p) => p.length > 20).slice(0, 8)
    : local.paragraphs;
  const beats = Array.isArray(o.beats)
    ? o.beats.map(String).map((b) => b.trim()).filter(Boolean).slice(0, 10)
    : local.beats;
  return {
    heading: o.heading != null ? String(o.heading).trim() : local.heading,
    kicker: o.kicker != null ? String(o.kicker).trim() : local.kicker,
    summary,
    paragraphs: paragraphs.length ? paragraphs : local.paragraphs,
    beats: beats?.length ? beats : local.beats,
    fallback: false,
  };
}

export async function fetchRelationStory(opts: {
  personId: string;
  personLabel: string;
  relationLabel: string;
  propertyId?: string;
  description?: string;
  wikipediaLead?: string;
  wikiRevisedAt?: string;
  linkedWorks?: string[];
  occupations?: string[];
}): Promise<RelationStory> {
  const local = buildLocalRelationStory(opts);
  try {
    const res = await fetch("/api/ai/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        section: "relationStory",
        id: opts.personId,
        label: opts.personLabel,
        description: opts.description,
        type: "person",
        relationLabel: opts.relationLabel,
        propertyId: opts.propertyId,
        wikipediaLead: (opts.wikipediaLead ?? "").slice(0, 1200),
        wikiRevisedAt: opts.wikiRevisedAt,
        linkedWorks: (opts.linkedWorks ?? []).slice(0, 16),
        occupations: (opts.occupations ?? []).slice(0, 8),
        local,
      }),
    });
    if (!res.ok) {
      return {
        ...local,
        hint: res.status === 503
          ? "Local essay — add an AI key for a fuller rewrite."
          : "Local essay (AI unavailable).",
      };
    }
    const data: unknown = await res.json();
    return normalizeStory(data, local);
  } catch {
    return { ...local, hint: "Local essay (AI offline)." };
  }
}
