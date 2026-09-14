/**
 * Narrative timeline AI — Vite middleware.
 *
 * Providers (tried in order, with auth failover):
 *   1. Gemini — rich prose (GEMINI_API_KEY)
 *   2. Groq   — free, fast  (GROQ_API_KEY)
 *   3. OpenAI — paid        (OPENAI_API_KEY)
 *
 * Optional: AI_PROVIDER=gemini|groq|openai to force one provider.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";
import { loadEnv } from "vite";
import { cacheGet, cacheSet, cacheStats, hashKey } from "./src/server/responseCache";

/** Bump when prompts / response shape change to invalidate cached AI JSON. */
const CACHE_PROMPT_VERSION = "ai-v3-gemini-dense";

type ProviderId = "groq" | "gemini" | "openai";

type Provider = {
  id: ProviderId;
  apiKey: string;
  model: string;
};

const TIMELINE_SYSTEM_PROMPT = `You build a Gemini-style vertical life chronology for a knowledge explorer.
Sources: wikipediaDigest (primary), wikipediaLead, wikiSections, infobox, factsDigest, creativeHints, skeleton.

GOAL — dense year-by-year biography like Google Gemini timelines:
- 20–36 chronological events from birth/start through death/present (never stop mid-career).
- Memorable titles (e.g. "Birth in Khandwa", "Move to Bombay and film debut", "Marriage to Madhubala") — not bare "Born" / "Career begins".
- Each event: year, 2–4 sentence summary, and highlights[] with 2–6 nested factual bullets (names, places, songs, films, awards, schools) grounded in the sources.
- Cover personal life, education, debuts, marriages, peak hits, awards, later years, death/legacy when sources support them.
- Prefer many distinct years across the lifespan; cluster only when sources only support a decade label (use earliest year of that decade as year, put range in title/summary).

Grounding rules:
- Extract liberally from wikipediaDigest / wikiSections / infobox — every dated milestone mentioned should become an event or a highlight bullet.
- Do NOT invent song/film/award titles or exact dates absent from the sources.
- You MAY rephrase Wikipedia prose into original narrative; keep facts faithful.
- Keep era ids stable when skeleton eras exist; expand event count far beyond the thin skeleton.

Return ONLY JSON:
{
  "tagline": string,
  "legacy": string,
  "eras": [{ "id", "title", "years", "summary" }],
  "events": [{
    "year", "sortKey", "title",
    "summary": string (2–4 sentences),
    "detail": string (optional longer paragraph),
    "whyItMatters": string (optional 1 sentence),
    "kind": "life"|"career"|"award"|"work"|"tour"|"legacy",
    "eraId",
    "highlights": string[] (2–6 nested bullets — required when sources allow)
  }],
  "signatureWorks": [{ "year", "title", "context"?: string }]
}
4–7 eras, 20–36 events. Prefer complete valid JSON.`;

const ENRICH_SYSTEM_PROMPT = `You write a rich encyclopedia-style BRIEF for one section of a knowledge profile.
Use wikipediaLead + local.fields + digest. Do NOT invent dates, relatives, employers, titles, or places that are not supported.

Return ONLY JSON:
{
  "heading": string,
  "summary": string,
  "paragraphs": string[] (optional, 1–3 short paragraphs expanding the story),
  "fields": [{ "label": string, "value": string }]
}

Rules:
- For overview: summary should be 4–7 complete sentences covering who they are, era, significance, and key life beats.
- For other sections: summary 3–5 sentences focused on that section.
- paragraphs: optional deeper prose (no markdown headings).
- fields: keep local.fields labels; lightly clarify values; do not add unsupported facts.
- No markdown. Prefer complete valid JSON.`;

const WIKI_PAGE_ENRICH_PROMPT = `You present a Wikipedia MAIN ARTICLE (Discography / Filmography / Awards / similar) inside a biography overview.
Use only pageTitle, wikipediaLead, sectionDigest, and local.*. Do NOT invent titles, awards, years, or film names absent from the digest.

Return ONLY JSON:
{
  "heading": string,
  "pageTitle": string,
  "summary": string,
  "paragraphs": string[] (2–4 readable paragraphs),
  "highlights": string[] (6–12 short bullets: songs, films, awards, eras)
}

Rules:
- summary: 4–6 sentences introducing the scope of this list page and why it matters for the person.
- paragraphs: narrative presentation — group by era or theme when the digest supports it.
- highlights: concrete items from sectionDigest titles/excerpts (song/film/award names when present).
- No markdown. Prefer complete valid JSON.`;

const COMPARE_SYSTEM_PROMPT = `You write a vivid, fair side-by-side comparison of two Wikidata entities for a knowledge explorer.
Use ONLY the provided digests (labels, descriptions, leads, structured facts). Do NOT invent dates, awards, works, relatives, or places.

Return ONLY JSON:
{
  "headline": string,
  "verdict": string,
  "overlap": string[],
  "contrasts": [{ "label": string, "left": string, "right": string, "note"?: string }],
  "leftAngle": string,
  "rightAngle": string,
  "shareBlurb": string
}

Rules:
- headline: punchy 6–14 word title for the matchup.
- verdict: 3–5 sentences — who they are relative to each other, eras, significance; balanced, not a "winner".
- overlap: 3–6 short shared traits (occupation, era, region, style) grounded in facts.
- contrasts: 4–8 rows; label like Born / Era / Craft / Legacy; left/right short values; optional one-line note.
- leftAngle / rightAngle: 1–2 sentences each on what makes that person/entity distinctive.
- shareBlurb: 1–2 casual sentences suitable for WhatsApp/Facebook (no hashtags spam; may include both names).
- No markdown. Prefer complete valid JSON.`;

const OPENAI_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tagline: { type: "string" },
    legacy: { type: "string" },
    eras: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          years: { type: "string" },
          summary: { type: "string" },
        },
        required: ["id", "title", "years", "summary"],
      },
    },
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          year: { type: "string" },
          sortKey: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          detail: { type: "string" },
          whyItMatters: { type: "string" },
          kind: {
            type: "string",
            enum: ["life", "career", "award", "work", "tour", "legacy"],
          },
          eraId: { type: "string" },
          highlights: { type: "array", items: { type: "string" } },
          entityId: { type: "string" },
        },
        required: ["year", "sortKey", "title", "summary", "kind", "eraId"],
      },
    },
    signatureWorks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          year: { type: "string" },
          title: { type: "string" },
          context: { type: "string" },
        },
        required: ["year", "title"],
      },
    },
  },
  required: ["eras", "events"],
} as const;

function listProviders(env: Record<string, string>): Provider[] {
  const out: Provider[] = [];
  const groq = env.GROQ_API_KEY?.trim();
  const gemini = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  const openai = env.OPENAI_API_KEY?.trim();

  // Gemini first for richer long-form prose when available
  if (gemini) {
    out.push({
      id: "gemini",
      apiKey: gemini,
      model: env.GEMINI_MODEL?.trim() || "gemini-2.0-flash",
    });
  }
  if (groq) {
    out.push({
      id: "groq",
      apiKey: groq,
      model: env.GROQ_MODEL?.trim() || "openai/gpt-oss-20b",
    });
  }
  if (openai) {
    out.push({
      id: "openai",
      apiKey: openai,
      model: env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    });
  }

  const forced = (env.AI_PROVIDER || "").trim().toLowerCase() as ProviderId | "";
  if (forced === "groq" || forced === "gemini" || forced === "openai") {
    const only = out.filter((p) => p.id === forced);
    return only.length ? only : [];
  }
  return out;
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error("Model did not return JSON");
  }
}

function isAuthError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("api key not valid") ||
    m.includes("invalid_api_key") ||
    m.includes("incorrect api key") ||
    m.includes("unauthorized") ||
    m.includes("authentication") ||
    m.includes("api_key_invalid") ||
    (m.includes('"code": 400') && m.includes("api key")) ||
    m.includes('"code":401') ||
    m.includes("status\": 401") ||
    m.includes("permission_denied")
  );
}

class ProviderError extends Error {
  constructor(
    public provider: ProviderId,
    message: string,
    public authFailed = false,
  ) {
    super(message);
  }
}

async function callOpenAiCompatible(
  url: string,
  provider: Provider,
  userContent: string,
  useJsonSchema: boolean,
  systemPrompt: string,
  maxTokens = 8192,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: provider.model,
    temperature: 0.55,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  };
  if (useJsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "narrative_timeline",
        strict: false,
        schema: OPENAI_SCHEMA,
      },
    };
  } else {
    body.response_format = { type: "json_object" };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderError(provider.id, text.slice(0, 500), isAuthError(text) || res.status === 401);
  }
  const data = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new ProviderError(provider.id, "empty_response");
  return raw;
}

async function callGemini(
  provider: Provider,
  userContent: string,
  systemPrompt: string,
  maxTokens = 8192,
): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(provider.model)}:generateContent` +
    `?key=${encodeURIComponent(provider.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      generationConfig: {
        temperature: 0.55,
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new ProviderError(provider.id, text.slice(0, 500), isAuthError(text) || res.status === 401 || res.status === 403);
  }
  const data = JSON.parse(text) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!raw) throw new ProviderError(provider.id, "empty_response");
  return raw;
}

function isModelError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("model_not_found") || m.includes("does not exist") || m.includes("model not found");
}

/** Free-tier Groq chat models (post Aug 2026 deprecations). Tried in order on model_not_found. */
const GROQ_MODEL_FALLBACKS = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "qwen/qwen3-32b",
];

async function generateWithProvider(
  provider: Provider,
  userContent: string,
  systemPrompt: string,
  opts?: { useJsonSchema?: boolean; maxTokens?: number },
): Promise<{ raw: string; model: string }> {
  const useJsonSchema = opts?.useJsonSchema ?? false;
  const maxTokens = opts?.maxTokens ?? 8192;
  if (provider.id === "groq") {
    const models = [
      provider.model,
      ...GROQ_MODEL_FALLBACKS.filter((m) => m !== provider.model),
    ];
    let lastErr: ProviderError | null = null;
    for (const model of models) {
      try {
        const raw = await callOpenAiCompatible(
          "https://api.groq.com/openai/v1/chat/completions",
          { ...provider, model },
          userContent,
          false,
          systemPrompt,
          maxTokens,
        );
        return { raw, model };
      } catch (err) {
        const pe =
          err instanceof ProviderError
            ? err
            : new ProviderError(provider.id, err instanceof Error ? err.message : String(err));
        lastErr = pe;
        if (pe.authFailed) throw pe;
        if (isModelError(pe.message)) continue;
        throw pe;
      }
    }
    throw lastErr ?? new ProviderError(provider.id, "No Groq model available");
  }
  if (provider.id === "gemini") {
    return {
      raw: await callGemini(provider, userContent, systemPrompt, maxTokens),
      model: provider.model,
    };
  }
  return {
    raw: await callOpenAiCompatible(
      "https://api.openai.com/v1/chat/completions",
      provider,
      userContent,
      useJsonSchema,
      systemPrompt,
      maxTokens,
    ),
    model: provider.model,
  };
}

async function generateJson(
  providers: Provider[],
  userContent: string,
  systemPrompt: string,
  validate: (parsed: Record<string, unknown>) => boolean,
  opts?: { useJsonSchema?: boolean; maxTokens?: number },
): Promise<{ parsed: Record<string, unknown>; provider: ProviderId; model: string }> {
  const errors: Array<{ provider: ProviderId; message: string }> = [];

  for (const provider of providers) {
    try {
      const { raw, model } = await generateWithProvider(provider, userContent, systemPrompt, opts);
      const parsed = extractJsonObject(raw);
      if (!validate(parsed)) {
        throw new ProviderError(provider.id, "JSON failed validation");
      }
      return { parsed, provider: provider.id, model };
    } catch (err) {
      const pe =
        err instanceof ProviderError
          ? err
          : new ProviderError(
              provider.id,
              err instanceof Error ? err.message : String(err),
              false,
            );
      errors.push({ provider: pe.provider, message: pe.message.slice(0, 240) });
      continue;
    }
  }

  const detail = errors.map((e) => `${e.provider}: ${e.message}`).join(" | ");
  throw new Error(detail || "No AI providers available");
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: Record<string, string>,
) {
  const url = req.url?.split("?")[0] ?? "";

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.end();
    return;
  }

  // GET /api/ai/status — which keys are configured (never returns secrets)
  if (req.method === "GET" && (url === "/api/ai/status" || url.endsWith("/status"))) {
    const providers = listProviders(env);
    const cache = await cacheStats();
    sendJson(res, 200, {
      ok: providers.length > 0,
      providers: providers.map((p) => ({ id: p.id, model: p.model })),
      order: providers.map((p) => p.id),
      cache: {
        disabled: cache.disabled,
        ttlSeconds: cache.ttlSeconds,
        memoryEntries: cache.memoryEntries,
        redis: cache.redis,
        redisEmbedded: cache.redisEmbedded,
        redisUrlConfigured: cache.redisUrlConfigured,
        diskDir: cache.diskDir,
      },
      hint:
        providers.length === 0
          ? "Add GROQ_API_KEY to .env (free at console.groq.com/keys), then restart Vite."
          : undefined,
    });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const providers = listProviders(env);
  if (!providers.length) {
    sendJson(res, 503, {
      error: "missing_key",
      message:
        "No AI key found. Add GROQ_API_KEY (free) to .env — https://console.groq.com/keys — then restart yarn/npm dev.",
    });
    return;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(await readBody(req)) as Record<string, unknown>;
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const isEnrich = url === "/enrich" || url.endsWith("/enrich");
  const isCompare = url === "/compare" || url.endsWith("/compare");
  const bypassCache =
    String(payload.noCache ?? "").toLowerCase() === "true" ||
    String(payload.noCache ?? "") === "1";

  try {
    if (isCompare) {
      const left = payload.left as Record<string, unknown> | undefined;
      const right = payload.right as Record<string, unknown> | undefined;
      if (!left?.id || !right?.id) {
        sendJson(res, 400, { error: "left and right entity digests required" });
        return;
      }
      const userContent = compactComparePayload(payload);
      const cacheKey = `compare:${CACHE_PROMPT_VERSION}:${hashKey([
        left.id,
        right.id,
        left.wikiRevisedAt ?? "",
        right.wikiRevisedAt ?? "",
        userContent,
      ])}`;

      if (!bypassCache) {
        const hit = await cacheGet(cacheKey);
        if (hit && hit.value && typeof hit.value === "object") {
          sendJson(res, 200, {
            ...(hit.value as Record<string, unknown>),
            _meta: {
              ...((hit.value as { _meta?: object })._meta ?? {}),
              cache: hit.backend,
            },
          });
          return;
        }
      }

      const { parsed, provider, model } = await generateJson(
        providers,
        userContent,
        COMPARE_SYSTEM_PROMPT,
        (p) => typeof p.verdict === "string" || typeof p.headline === "string",
        { maxTokens: 4096 },
      );
      const body = { ...parsed, _meta: { provider, model } };
      const backends = await cacheSet(cacheKey, body);
      sendJson(res, 200, {
        ...body,
        _meta: { ...body._meta, cache: "miss", stored: backends },
      });
      return;
    }

    if (isEnrich) {
      const section = String(payload.section ?? "");
      const allowed = new Set(["overview", "life", "family", "career", "creative", "wikiPage"]);
      if (!allowed.has(section)) {
        sendJson(res, 400, {
          error: "section must be overview, life, family, career, creative, or wikiPage",
        });
        return;
      }
      const isWikiPage = section === "wikiPage";
      const userContent = isWikiPage
        ? compactWikiPagePayload(payload)
        : compactEnrichPayload(payload);
      const cacheKey = `enrich:${CACHE_PROMPT_VERSION}:${hashKey([
        payload.id,
        section,
        isWikiPage ? String(payload.pageTitle ?? "") : "",
        payload.wikiRevisedAt ?? "",
        userContent,
      ])}`;

      if (!bypassCache) {
        const hit = await cacheGet(cacheKey);
        if (hit && hit.value && typeof hit.value === "object") {
          sendJson(res, 200, {
            ...(hit.value as Record<string, unknown>),
            section,
            _meta: {
              ...((hit.value as { _meta?: object })._meta ?? {}),
              cache: hit.backend,
            },
          });
          return;
        }
      }

      const { parsed, provider, model } = await generateJson(
        providers,
        userContent,
        isWikiPage ? WIKI_PAGE_ENRICH_PROMPT : ENRICH_SYSTEM_PROMPT,
        (p) => typeof p.summary === "string" || typeof p.capsule === "string" || typeof p.intro === "string",
        { maxTokens: isWikiPage ? 5120 : 4096 },
      );
      const body = { ...parsed, section, _meta: { provider, model } };
      const backends = await cacheSet(cacheKey, body);
      sendJson(res, 200, {
        ...body,
        _meta: { ...body._meta, cache: "miss", stored: backends },
      });
      return;
    }

    const userContent = compactTimelinePayload(payload);
    const cacheKey = `timeline:${CACHE_PROMPT_VERSION}:${hashKey([
      payload.id,
      payload.wikiRevisedAt ?? "",
      userContent,
    ])}`;

    if (!bypassCache) {
      const hit = await cacheGet(cacheKey);
      if (hit && hit.value && typeof hit.value === "object") {
        sendJson(res, 200, {
          ...(hit.value as Record<string, unknown>),
          _meta: {
            ...((hit.value as { _meta?: object })._meta ?? {}),
            cache: hit.backend,
          },
        });
        return;
      }
    }

    const { parsed, provider, model } = await generateJson(
      providers,
      userContent,
      TIMELINE_SYSTEM_PROMPT,
      (p) => Array.isArray(p.eras) && Array.isArray(p.events) && (p.events as unknown[]).length >= 6,
      { useJsonSchema: true, maxTokens: 12288 },
    );
    const body = { ...parsed, _meta: { provider, model } };
    const backends = await cacheSet(cacheKey, body);
    sendJson(res, 200, {
      ...body,
      _meta: { ...body._meta, cache: "miss", stored: backends },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 600) : "Unknown error";
    sendJson(res, 502, {
      error: "all_providers_failed",
      message,
      tried: providers.map((p) => p.id),
      hint: isCompare
        ? "Local compare still shows in the UI; AI polish failed."
        : isEnrich
          ? "Local section summary still shows in the UI; AI polish failed."
          : "Local Wikidata chronology still shows in the UI; AI polish failed.",
    });
  }
}

/** Compact body — Wikipedia digest first so the model can build a dense Gemini-style spine. */
function compactTimelinePayload(payload: Record<string, unknown>): string {
  const skeleton = payload.skeleton ?? null;
  const lead = String(payload.wikipediaLead ?? "").slice(0, 2800);
  const digest = String(payload.wikipediaDigest ?? lead).slice(0, 9000);
  const hints = Array.isArray(payload.creativeHints)
    ? payload.creativeHints.map(String).slice(0, 20)
    : [];
  const sections = Array.isArray(payload.wikiSections)
    ? payload.wikiSections.slice(0, 14)
    : [];
  const infobox = Array.isArray(payload.infobox) ? payload.infobox.slice(0, 24) : [];
  const facts = Array.isArray(payload.factsDigest) ? payload.factsDigest.slice(0, 16) : [];
  const seeds = Array.isArray(payload.seedEvents) ? payload.seedEvents.slice(0, 28) : [];

  // Thin skeleton: keep eras + a few anchors so the model expands, not copies sparseness
  let thinSkeleton = skeleton;
  if (skeleton && typeof skeleton === "object") {
    const sk = skeleton as { eras?: unknown; events?: unknown[]; tagline?: unknown; legacy?: unknown; signatureWorks?: unknown };
    thinSkeleton = {
      tagline: sk.tagline,
      legacy: sk.legacy,
      eras: sk.eras,
      events: Array.isArray(sk.events) ? sk.events.slice(0, 8) : [],
      signatureWorks: Array.isArray(sk.signatureWorks) ? sk.signatureWorks.slice(0, 8) : sk.signatureWorks,
    };
  }

  return JSON.stringify({
    id: payload.id,
    label: payload.label,
    description: payload.description,
    type: payload.type,
    wikipediaLead: lead,
    wikipediaDigest: digest,
    wikiSections: sections,
    infobox,
    factsDigest: facts,
    seedEvents: seeds,
    wikiRevisedAt: payload.wikiRevisedAt ?? null,
    creativeHints: hints,
    skeleton: thinSkeleton,
    instruction:
      "Build 20–36 Gemini-style timeline events from wikipediaDigest/wikiSections. Expand far beyond the thin skeleton.",
  });
}

function compactEnrichPayload(payload: Record<string, unknown>): string {
  return JSON.stringify({
    section: payload.section,
    sectionTitle: payload.sectionTitle,
    id: payload.id,
    label: payload.label,
    description: payload.description,
    type: payload.type,
    wikipediaLead: String(payload.wikipediaLead ?? "").slice(0, 600),
    wikiRevisedAt: payload.wikiRevisedAt ?? null,
    fields: payload.fields,
    local: payload.local,
  });
}

function compactWikiPagePayload(payload: Record<string, unknown>): string {
  return JSON.stringify({
    section: "wikiPage",
    sectionTitle: payload.sectionTitle,
    id: payload.id,
    label: payload.label,
    description: payload.description,
    type: payload.type,
    pageTitle: payload.pageTitle,
    parentSection: payload.parentSection,
    wikipediaLead: String(payload.wikipediaLead ?? "").slice(0, 900),
    wikiRevisedAt: payload.wikiRevisedAt ?? null,
    sectionDigest: Array.isArray(payload.sectionDigest)
      ? payload.sectionDigest.slice(0, 12)
      : [],
    local: payload.local,
  });
}

function compactEntitySide(side: Record<string, unknown> | undefined) {
  if (!side) return null;
  return {
    id: side.id,
    label: side.label,
    description: side.description,
    type: side.type,
    lifespan: side.lifespan ?? null,
    wikipediaLead: String(side.wikipediaLead ?? "").slice(0, 700),
    wikiRevisedAt: side.wikiRevisedAt ?? null,
    facts: Array.isArray(side.facts) ? side.facts.slice(0, 14) : [],
  };
}

function compactComparePayload(payload: Record<string, unknown>): string {
  return JSON.stringify({
    left: compactEntitySide(payload.left as Record<string, unknown> | undefined),
    right: compactEntitySide(payload.right as Record<string, unknown> | undefined),
    local: payload.local ?? null,
  });
}

function attach(middlewares: Connect.Server, mode: string, envDir: string) {
  const env = loadEnv(mode, envDir, "");
  // Mirror Vite-loaded env into process.env so responseCache sees REDIS_URL / CACHE_*
  for (const [k, v] of Object.entries(env)) {
    if (v !== undefined && process.env[k] === undefined) process.env[k] = v;
  }
  // Status + timeline share the /api/ai prefix
  middlewares.use("/api/ai", (req, res, next) => {
    // Normalize: Connect strips mount path from req.url sometimes inconsistently
    handleRequest(req, res, env).catch(next);
  });
}

export function aiTimelinePlugin(): Plugin {
  return {
    name: "ai-timeline-api",
    configureServer(server) {
      const envDir = server.config.envDir || server.config.root || process.cwd();
      attach(server.middlewares, server.config.mode, envDir);
    },
    configurePreviewServer(server) {
      const envDir = server.config.envDir || server.config.root || process.cwd();
      attach(server.middlewares, "production", envDir);
    },
  };
}
