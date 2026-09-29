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
const CACHE_PROMPT_VERSION = "ai-v14-org-retail";

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

const GLANCE_SYSTEM_PROMPT = `You write CINEMATIC HERO copy for a knowledge explorer — a magazine poster, not a Wikipedia infobox.
Use wikipediaLead, factsDigest, and local.*. You MAY write vivid original prose and a well-known associated quote, lyric, motto, or epithet widely attributed to this entity. Do NOT invent revenue, headcount, store counts, award totals, or dates that contradict the sources.

Return ONLY JSON:
{
  "heading": string,
  "pulse": string,
  "metrics": [{ "label": string, "value": string, "note"?: string }],
  "cards": [{ "label": string, "value": string, "note"?: string, "tone"?: "hq"|"people"|"market"|"product"|"life"|"default" }],
  "bands": [{ "id": string, "title": string, "layout": "rows"|"tiles"|"roles", "items": [{ "label": string, "value": string, "note"?: string, "icon"?: string }] }],
  "identity": {
    "name": string,
    "years"?: string,
    "crafts"?: string,
    "quote"?: string,
    "quoteNative"?: string,
    "featureTitle"?: string,
    "bio"?: string
  },
  "footnote"?: string
}

Rules:
- pulse: 2–3 sentences for the featured story under featureTitle (e.g. Filmfare record + why they endure). Organizations: a scale story, not a metric dump.
- identity.quote: a famous associated line (song lyric, motto, epithet). identity.quoteNative: original-script line when it exists (e.g. Hindi).
- identity.featureTitle: poster headline, Title Case. Person singer in Indian cinema → "Legendary Voice of Indian Cinema". Org retail → "Retail at Continental Scale". Place → "The Character of This Place". Event → "What This Moment Changed". Work → "Why This Work Endures".
- identity.bio: 2 short encyclopedia paragraphs separated by a blank line (who they are; why they matter). Not the stub "X is a … (years)".
- identity.crafts: 4–6 roles/industries joined with " · " (e.g. Singer · Composer · Musician · Actor · Playback Singer).
- Persons: bands id=roles layout=roles with EXACTLY 4 items when occupations allow (Versatile singer / Actor / Composer / Musician or the real crafts). Each note is 1 vivid sentence (e.g. "From romantic to comic, he could sing every emotion."). cards: Born (date + place note), Hometown, Active years, Filmfare/Honours, Languages with note "(and others)" when more than one.
- Organizations: heading "Company highlights". metrics compact ($65B, 270K, 1,700+). bands id=scale (network, reach, digital, listed) and id=digital when retail/tech. Do not invent counts.
- Places / events / works / concepts: same poster chassis — 5 pills as cards, 4 stage items with 1-sentence notes.
- Prefer local.* structure; polish and enrich wording; keep numbers faithful.
- No markdown. Prefer complete valid JSON.`;

const RELATION_STORY_SYSTEM_PROMPT = `You are a feature writer for a premium culture magazine inside a knowledge explorer.
Write a FULL, vivid essay about ONE FACET of a person (relationLabel) — e.g. acting career, singing, directing, awards.
Use ONLY wikipediaLead, linkedWorks, occupations, description, and local.*. Do NOT invent film/song titles, years, or awards absent from the inputs.

Return ONLY JSON:
{
  "heading": string,
  "kicker": string,
  "summary": string,
  "paragraphs": string[] (4–7 longform paragraphs),
  "beats": string[] (5–10 short memorable beats or titles)
}

Rules:
- If relationLabel / propertyId points to acting, cast, film, or actor: write an ACTING CAREER feature — comic timing, screen presence, notable roles from linkedWorks, how acting sits beside other crafts (e.g. singing) when occupations say so.
- heading: magazine title (e.g. "Kishore Kumar on screen").
- kicker: 3–7 word eyebrow.
- summary: 2–3 sentence hook.
- paragraphs: flowing literary prose, not bullet dumps; specific when linkedWorks allow; never paste Wikipedia citation junk.
- beats: concrete titles or motifs from linkedWorks / lead.
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

const COMPARE_SYSTEM_PROMPT = `You write a vivid, magazine-style side-by-side comparison of two Wikidata entities for a knowledge explorer.
Use the digests (labels, descriptions, leads, craftFocus, era, awardCount, career stats, org vitals, structured facts) and the local contrasts as a starting point.
Do NOT invent dates, award titles, works, relatives, collab counts, revenue, headcount, or places absent from the sources. You MAY rephrase and choose creative attribute labels.

Return ONLY JSON:
{
  "headline": string,
  "verdict": string,
  "overlap": string[],
  "contrasts": [{ "label": string, "left": string, "right": string, "note"?: string }],
  "differences"?: string[],
  "leadership"?: string[],
  "leftMotto"?: string,
  "rightMotto"?: string,
  "leftAngle": string,
  "rightAngle": string,
  "shareBlurb": string
}

Rules:
- headline: punchy 6–14 word title (e.g. "Two playback eras, one golden mic" or "Two retail giants, different aisles").
- verdict: 3–5 sentences — relative eras, craft or industry, career/scale depth, cultural/market footprint; balanced, never crown a "winner".
- overlap: 4–7 short shared traits grounded in facts (craft, region, language, honours, industry, listing, collabs).
- contrasts: 8–12 rows with CREATIVE labels tailored to the pair.
  Persons (especially singers): prefer when career data exists —
  Craft focus · Era · First singing · Last singing · Career span · Recorded works · With Lata · Top music director · Screen credits · House / base · Assets · Earnings · Born · Roots · Signature works · Honours
  Keep House/Assets/Earnings only when a side has real values; otherwise omit those rows.
  Skip empty Spouse/Education unless both sides have real data.
  Organizations / companies: prefer Founded · Headquarters · Retail category / Industry · Business model · Total stores · Employees · Annual revenue · Key products · Technology focus · Area served · Chief executive · Stock exchange · Website.
  Prefer digest.org vitals (stores/employees/revenue from Wikipedia infobox + Wikidata) — do not invent store counts or FY figures.
  For two retailers: lean into aisle focus, store networks, omnichannel, and product mix.
  Also return optional differences[] (3 short ↔ contrasts) and leadership[] (2–4 grounded bullets).
  Optional leftMotto / rightMotto only when digest.org.motto or facts have a real slogan.
  For two film actors / actresses: prefer Craft focus · Era · Stage vibe · Screen credits · Signature works · Honours · Born · Roots · Languages.
  Lead with roles, eras, and Filmfare/honours — not spouse or education unless both sides have distinctive family-film lineage worth one row.
  Never invent Filmfare win counts; if unsure, omit the numeric Filmfare row and keep Honours qualitative.
  Do not add singing / Lata / music-director rows unless both are singers.
  left/right: short punchy values (not walls of text); optional witty one-line note.
- leftAngle / rightAngle: 1–2 sentences on what makes each distinctive.
- shareBlurb: 1–2 casual shareable sentences (no hashtag spam).
- For two Indian playback singers: lean into first/last songs, music directors, Lata collabs, and legacy — not marital status.
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
      model: env.GEMINI_MODEL?.trim() || "gemini-3.6-flash",
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
    const preferred = out.filter((p) => p.id === forced);
    const rest = out.filter((p) => p.id !== forced);
    if (preferred.length) return [...preferred, ...rest];
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
  return (
    m.includes("model_not_found") ||
    m.includes("does not exist") ||
    m.includes("model not found") ||
    m.includes("no longer available") ||
    m.includes("is not found") ||
    (m.includes('"code": 404') && m.includes("model"))
  );
}

function isRetryableProviderError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    isModelError(message) ||
    m.includes("unavailable") ||
    m.includes("high demand") ||
    m.includes("overloaded") ||
    m.includes('"code": 503') ||
    m.includes("json_validate_failed") ||
    m.includes("max completion tokens")
  );
}

/** Free-tier Groq chat models (post Aug 2026 deprecations). Tried in order on model_not_found. */
const GROQ_MODEL_FALLBACKS = [
  "openai/gpt-oss-20b",
  "openai/gpt-oss-120b",
  "qwen/qwen3-32b",
];

const GEMINI_MODEL_FALLBACKS = [
  "gemini-3.6-flash",
  "gemini-2.5-flash",
  "gemini-flash-latest",
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
        if (isRetryableProviderError(pe.message)) continue;
        throw pe;
      }
    }
    throw lastErr ?? new ProviderError(provider.id, "No Groq model available");
  }
  if (provider.id === "gemini") {
    const models = [
      provider.model,
      ...GEMINI_MODEL_FALLBACKS.filter((m) => m !== provider.model),
    ];
    let lastErr: ProviderError | null = null;
    for (const model of models) {
      try {
        const raw = await callGemini({ ...provider, model }, userContent, systemPrompt, maxTokens);
        return { raw, model };
      } catch (err) {
        const pe =
          err instanceof ProviderError
            ? err
            : new ProviderError(provider.id, err instanceof Error ? err.message : String(err));
        lastErr = pe;
        if (pe.authFailed) throw pe;
        if (isRetryableProviderError(pe.message)) continue;
        throw pe;
      }
    }
    throw lastErr ?? new ProviderError(provider.id, "No Gemini model available");
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

function pcm16ToWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function concatWavs(wavs: Buffer[]): Buffer {
  if (wavs.length === 1) return wavs[0]!;
  const rate = wavs[0]!.readUInt32LE(24) || 24000;
  const pcm = Buffer.concat(wavs.map((w) => w.subarray(44)));
  return pcm16ToWav(pcm, rate);
}

function splitSpoken(text: string, max = 1100): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return [clean];
  const parts: string[] = [];
  const bits = clean.split(/(?<=[।.!?…])\s+/);
  let buf = "";
  for (const bit of bits) {
    if ((buf + " " + bit).trim().length > max && buf) {
      parts.push(buf.trim());
      buf = bit;
    } else {
      buf = (buf + " " + bit).trim();
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts.length ? parts : [clean.slice(0, max)];
}

function ttsSpeakLead(language: string, style: string): string {
  if (language === "bn") {
    return "Speak the following in fluent native Bengali (Bangla). Warm, natural, like a person from Kolkata telling a story. Do not speak English.";
  }
  if (language === "hi") {
    return "Speak the following in fluent native Hindi. Warm, natural, like a person from India telling a story. Do not speak English.";
  }
  if (style === "filmi") {
    return "Speak the following in warm Indian English, like a Hindi-film documentary narrator. Not American, not British RP.";
  }
  return "Speak the following in natural Indian English, like a native speaker telling a story.";
}

async function openaiSpeech(
  apiKey: string,
  model: string,
  language: string,
  style: string,
  input: string,
): Promise<Buffer | null> {
  const tts = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice: language === "bn" ? "nova" : language === "hi" || style === "filmi" ? "onyx" : "echo",
      input,
      instructions: ttsSpeakLead(language, style),
    }),
  });
  if (!tts.ok) return null;
  return Buffer.from(await tts.arrayBuffer());
}

async function geminiTtsWav(
  apiKey: string,
  model: string,
  spokenText: string,
  language: string,
  style: string,
): Promise<Buffer> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;
  const voiceName = language === "en" ? "Fenrir" : "Kore";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${ttsSpeakLead(language, style)}\n\n${spokenText}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`${model}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 180)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{
      finishReason?: string;
      content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
    }>;
  };
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const inline = parts.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) {
    throw new Error(
      `${model}: no audio finish=${data.candidates?.[0]?.finishReason ?? "?"} keys=${JSON.stringify(parts.map((p) => Object.keys(p))).slice(0, 80)}`,
    );
  }
  const raw = Buffer.from(inline.data, "base64");
  const mime = (inline.mimeType ?? "").toLowerCase();
  if (mime.includes("wav") || mime.includes("mpeg") || mime.includes("mp3")) return raw;
  const rateMatch = mime.match(/rate=(\d+)/);
  return pcm16ToWav(raw, rateMatch ? Number(rateMatch[1]) : 24000);
}

async function geminiSpokenScript(
  apiKey: string,
  models: string[],
  language: string,
  input: string,
): Promise<string> {
  if (language !== "bn" && language !== "hi") return input;
  const langName =
    language === "bn"
      ? "Bengali (Bangla, Bengali script). Sound like a native speaker from Kolkata."
      : "Hindi (Devanagari). Sound like a native speaker from India.";
  for (const model of models) {
    const gurl =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
      `?key=${encodeURIComponent(apiKey)}`;
    const gres = await fetch(gurl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `Rewrite this biography as fluent spoken ${langName} Three short paragraphs, about 90 seconds of speech. A person telling the story, not a machine translation. Keep names and film titles. Return ONLY the spoken text.\n\n${input}`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0.45, maxOutputTokens: 1024 },
      }),
    });
    if (!gres.ok) continue;
    const gdata = (await gres.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const spokenText = (gdata.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "")
      .replace(/^```[\w]*\n?|\n?```$/g, "")
      .trim();
    if (spokenText) return spokenText.slice(0, 2400);
  }
  return input;
}

  // POST /api/ai/speech — native Bengali / Hindi / English narration
  if (req.method === "POST" && (url === "/speech" || url.endsWith("/speech"))) {
    const openaiKey = env.OPENAI_API_KEY?.trim();
    const geminiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
    if (!openaiKey && !geminiKey) {
      sendJson(res, 503, { error: "missing_key", message: "GEMINI_API_KEY or OPENAI_API_KEY required for AI speech." });
      return;
    }
    let speechPayload: Record<string, unknown>;
    try {
      speechPayload = JSON.parse(await readBody(req)) as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }
    const input = String(speechPayload.text ?? "").replace(/\s+/g, " ").trim().slice(0, 1600);
    if (!input) {
      sendJson(res, 400, { error: "text required" });
      return;
    }
    const language = String(speechPayload.language ?? "en").toLowerCase();
    const style = String(speechPayload.style ?? "local");
    const textModels = [
      env.GEMINI_MODEL?.trim(),
      "gemini-3.6-flash",
      "gemini-2.5-flash",
    ].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);
    const ttsModels = [
      env.GEMINI_TTS_MODEL?.trim(),
      "gemini-2.5-flash-preview-tts",
      "gemini-2.5-pro-preview-tts",
      "gemini-3.1-flash-tts-preview",
    ].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);
    try {
      let spoken = input;
      if (geminiKey && (language === "bn" || language === "hi")) {
        spoken = await geminiSpokenScript(geminiKey, textModels, language, input);
      }
      let buf: Buffer | null = null;
      let contentType = "audio/wav";
      if (openaiKey) {
        buf = await openaiSpeech(openaiKey, env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts", language, style, spoken);
        if (buf) contentType = "audio/mpeg";
      }
      if (!buf && geminiKey) {
        const wavs: Buffer[] = [];
        for (const chunk of splitSpoken(spoken, 1100)) {
          let chunkBuf: Buffer | null = null;
          for (const model of ttsModels) {
            try {
              chunkBuf = await geminiTtsWav(geminiKey, model, chunk, language, style);
              break;
            } catch {
              /* try next TTS model */
            }
          }
          if (!chunkBuf) break;
          wavs.push(chunkBuf);
        }
        if (wavs.length) buf = concatWavs(wavs);
      }
      if (buf) {
        res.statusCode = 200;
        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "no-store");
        res.end(buf);
        return;
      }
      if (spoken && (language === "bn" || language === "hi")) {
        sendJson(res, 200, { text: spoken, language });
        return;
      }
      sendJson(res, 502, { error: "tts_failed", message: "Native speech could not be generated." });
    } catch (err) {
      sendJson(res, 502, {
        error: "tts_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
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
      const allowed = new Set([
        "overview", "life", "family", "career", "creative", "wikiPage", "glance", "relationStory",
      ]);
      if (!allowed.has(section)) {
        sendJson(res, 400, {
          error: "section must be overview, life, family, career, creative, wikiPage, glance, or relationStory",
        });
        return;
      }
      const isWikiPage = section === "wikiPage";
      const isGlance = section === "glance";
      const isRelationStory = section === "relationStory";
      const userContent = isWikiPage
        ? compactWikiPagePayload(payload)
        : isGlance
          ? compactGlancePayload(payload)
          : isRelationStory
            ? compactRelationStoryPayload(payload)
            : compactEnrichPayload(payload);
      const cacheKey = `enrich:${CACHE_PROMPT_VERSION}:${hashKey([
        payload.id,
        section,
        isWikiPage ? String(payload.pageTitle ?? "") : "",
        isRelationStory ? String(payload.relationLabel ?? "") + String(payload.propertyId ?? "") : "",
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

      const systemPrompt = isWikiPage
        ? WIKI_PAGE_ENRICH_PROMPT
        : isGlance
          ? GLANCE_SYSTEM_PROMPT
          : isRelationStory
            ? RELATION_STORY_SYSTEM_PROMPT
            : ENRICH_SYSTEM_PROMPT;
      const validate = isGlance
        ? (p: Record<string, unknown>) => typeof p.pulse === "string"
        : isRelationStory
          ? (p: Record<string, unknown>) =>
              typeof p.summary === "string" && Array.isArray(p.paragraphs)
          : (p: Record<string, unknown>) =>
              typeof p.summary === "string" ||
              typeof p.capsule === "string" ||
              typeof p.intro === "string";

      const { parsed, provider, model } = await generateJson(
        providers,
        userContent,
        systemPrompt,
        validate,
        { maxTokens: isWikiPage ? 5120 : isRelationStory ? 6144 : isGlance ? 3072 : 4096 },
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

function compactGlancePayload(payload: Record<string, unknown>): string {
  return JSON.stringify({
    section: "glance",
    id: payload.id,
    label: payload.label,
    description: payload.description,
    type: payload.type,
    wikipediaLead: String(payload.wikipediaLead ?? "").slice(0, 1800),
    wikiRevisedAt: payload.wikiRevisedAt ?? null,
    factsDigest: Array.isArray(payload.factsDigest) ? payload.factsDigest.slice(0, 14) : [],
    local: payload.local ?? null,
  });
}

function compactRelationStoryPayload(payload: Record<string, unknown>): string {
  return JSON.stringify({
    section: "relationStory",
    id: payload.id,
    label: payload.label,
    description: payload.description,
    relationLabel: payload.relationLabel,
    propertyId: payload.propertyId ?? null,
    wikipediaLead: String(payload.wikipediaLead ?? "").slice(0, 1200),
    wikiRevisedAt: payload.wikiRevisedAt ?? null,
    linkedWorks: Array.isArray(payload.linkedWorks) ? payload.linkedWorks.slice(0, 16) : [],
    occupations: Array.isArray(payload.occupations) ? payload.occupations.slice(0, 8) : [],
    local: payload.local ?? null,
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
    craftFocus: side.craftFocus ?? null,
    era: side.era ?? null,
    bornYear: side.bornYear ?? null,
    awardCount: side.awardCount ?? null,
    wikipediaLead: String(side.wikipediaLead ?? "").slice(0, 900),
    wikiRevisedAt: side.wikiRevisedAt ?? null,
    facts: Array.isArray(side.facts) ? side.facts.slice(0, 16) : [],
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
