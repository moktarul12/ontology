/**
 * Readable entity URLs: /entity/albert-einstein-Q9458
 * Still accepts bare /entity/Q9458 and redirects to the named form.
 */

const BARE_QID = /^Q\d+$/i;
const SLUG_WITH_QID = /^(.*)-(Q\d+)$/i;

export function slugifyLabel(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "entity";
}

export function normalizeQid(id: string): string {
  const m = id.trim().match(/^Q(\d+)$/i);
  return m ? `Q${m[1]}` : id.trim();
}

/** Build /entity/… path; prefers name-Qid when a label is known. */
export function entityPath(id: string, label?: string | null): string {
  const qid = normalizeQid(id);
  if (!label?.trim()) return `/entity/${qid}`;
  return `/entity/${slugifyLabel(label)}-${qid}`;
}

export type ParsedEntityParam = {
  qid: string | null;
  slug: string | null;
};

export function parseEntityParam(param: string): ParsedEntityParam {
  const raw = decodeURIComponent(param).trim();
  if (BARE_QID.test(raw)) {
    return { qid: normalizeQid(raw), slug: null };
  }
  const m = raw.match(SLUG_WITH_QID);
  if (m) {
    return { qid: normalizeQid(m[2]!), slug: m[1] || null };
  }
  return { qid: null, slug: raw };
}
