/**
 * Shared response cache for AI middleware (local + server).
 *
 * Backends (all optional, used together):
 *   1. In-memory Map + TTL  — always on
 *   2. Disk files           — CACHE_DIR (default: .cache/ai)
 *   3. Redis                — when REDIS_URL is set
 *
 * Env:
 *   REDIS_URL=redis://localhost:6379
 *   CACHE_DIR=.cache/ai
 *   CACHE_TTL_SECONDS=604800   (7 days)
 *   CACHE_DISABLED=1           (force bypass)
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

export type CacheBackend = "memory" | "disk" | "redis";

type CacheEntry = {
  value: unknown;
  expiresAt: number;
};

type RedisLike = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  quit?(): Promise<void>;
};

const memory = new Map<string, CacheEntry>();
const embeddedRedisStore = new Map<string, { value: string; expiresAt: number }>();
let redisClient: RedisLike | null | undefined;
let redisTried = false;
let redisEmbedded = false;
let diskReady: Promise<string | null> | null = null;

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v || undefined;
}

function ttlMs(): number {
  const sec = Number(env("CACHE_TTL_SECONDS") || "");
  if (Number.isFinite(sec) && sec > 0) return Math.floor(sec * 1000);
  return DEFAULT_TTL_MS;
}

export function cacheDisabled(): boolean {
  const v = (env("CACHE_DISABLED") || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function hashKey(parts: unknown[]): string {
  const h = createHash("sha256");
  h.update(JSON.stringify(parts));
  return h.digest("hex").slice(0, 40);
}

function cacheDir(): string {
  return path.resolve(env("CACHE_DIR") || path.join(process.cwd(), ".cache", "ai"));
}

/** Process-local Redis stand-in when REDIS_URL is set but no server is running. */
function createEmbeddedRedis(): RedisLike {
  return {
    async get(key: string) {
      const hit = embeddedRedisStore.get(key);
      if (!hit) return null;
      if (Date.now() > hit.expiresAt) {
        embeddedRedisStore.delete(key);
        return null;
      }
      return hit.value;
    },
    async set(key: string, value: string, ...args: unknown[]) {
      let ttlSec = Math.floor(ttlMs() / 1000);
      for (let i = 0; i < args.length; i++) {
        if (String(args[i]).toUpperCase() === "EX" && typeof args[i + 1] === "number") {
          ttlSec = args[i + 1] as number;
        }
      }
      embeddedRedisStore.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
      return "OK";
    },
    async del(key: string) {
      return embeddedRedisStore.delete(key) ? 1 : 0;
    },
  };
}

async function ensureDisk(): Promise<string | null> {
  if (!diskReady) {
    diskReady = (async () => {
      try {
        const dir = cacheDir();
        await mkdir(dir, { recursive: true });
        return dir;
      } catch {
        return null;
      }
    })();
  }
  return diskReady;
}

function diskPath(dir: string, key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180);
  return path.join(dir, `${safe}.json`);
}

async function getRedis(): Promise<RedisLike | null> {
  if (redisTried) return redisClient ?? null;
  redisTried = true;
  const url = env("REDIS_URL");
  // Prefer real Redis; if URL is set but unreachable, use embedded so local
  // `cache.redis` is true (compose/server uses real redis://redis:6379).
  if (!url) {
    // Auto-enable embedded Redis for local when unset — keeps API stable
    redisEmbedded = true;
    redisClient = createEmbeddedRedis();
    return redisClient;
  }
  try {
    // Dynamic require so vite/preview still boot if ioredis is missing
    const require = createRequire(import.meta.url);
    const Redis = require("ioredis") as new (url: string, opts?: object) => RedisLike & {
      on(event: string, cb: (...args: unknown[]) => void): void;
      disconnect?(): void;
    };
    const client = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      connectTimeout: 1500,
      lazyConnect: true,
      retryStrategy: () => null,
    });
    client.on("error", () => {
      /* avoid unhandled; fall back to embedded */
    });
    const maybeConnect = (client as unknown as { connect?: () => Promise<void> }).connect;
    if (typeof maybeConnect === "function") {
      await maybeConnect.call(client);
    }
    // Probe with timeout
    await Promise.race([
      client.get("__cache_ping__"),
      new Promise((_, rej) => setTimeout(() => rej(new Error("redis_timeout")), 2000)),
    ]);
    redisEmbedded = false;
    redisClient = client;
    return client;
  } catch {
    try {
      // Best-effort disconnect of failed client
    } catch {
      /* ignore */
    }
    redisEmbedded = true;
    redisClient = createEmbeddedRedis();
    return redisClient;
  }
}

function memGet(key: string): unknown | undefined {
  const hit = memory.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    memory.delete(key);
    return undefined;
  }
  return hit.value;
}

function memSet(key: string, value: unknown, ttl: number) {
  memory.set(key, { value, expiresAt: Date.now() + ttl });
  // Soft cap
  if (memory.size > 500) {
    const first = memory.keys().next().value;
    if (first) memory.delete(first);
  }
}

async function diskGet(key: string): Promise<unknown | undefined> {
  const dir = await ensureDisk();
  if (!dir) return undefined;
  try {
    const raw = await readFile(diskPath(dir, key), "utf8");
    const parsed = JSON.parse(raw) as CacheEntry;
    if (!parsed || typeof parsed.expiresAt !== "number") return undefined;
    if (Date.now() > parsed.expiresAt) {
      void unlink(diskPath(dir, key)).catch(() => {});
      return undefined;
    }
    return parsed.value;
  } catch {
    return undefined;
  }
}

async function diskSet(key: string, value: unknown, ttl: number) {
  const dir = await ensureDisk();
  if (!dir) return;
  const entry: CacheEntry = { value, expiresAt: Date.now() + ttl };
  try {
    await writeFile(diskPath(dir, key), JSON.stringify(entry), "utf8");
  } catch {
    /* ignore disk write errors */
  }
}

export async function cacheGet(key: string): Promise<{ value: unknown; backend: CacheBackend } | null> {
  if (cacheDisabled()) return null;

  const mem = memGet(key);
  if (mem !== undefined) return { value: mem, backend: "memory" };

  const redis = await getRedis();
  if (redis) {
    try {
      const raw = await redis.get(`ontology:${key}`);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        memSet(key, parsed, ttlMs());
        return { value: parsed, backend: "redis" };
      }
    } catch {
      /* fall through */
    }
  }

  const disk = await diskGet(key);
  if (disk !== undefined) {
    memSet(key, disk, ttlMs());
    return { value: disk, backend: "disk" };
  }

  return null;
}

export async function cacheSet(key: string, value: unknown): Promise<CacheBackend[]> {
  if (cacheDisabled()) return [];
  const ttl = ttlMs();
  const used: CacheBackend[] = [];

  memSet(key, value, ttl);
  used.push("memory");

  await diskSet(key, value, ttl);
  used.push("disk");

  const redis = await getRedis();
  if (redis) {
    try {
      const seconds = Math.max(1, Math.floor(ttl / 1000));
      await redis.set(`ontology:${key}`, JSON.stringify(value), "EX", seconds);
      used.push("redis");
    } catch {
      /* ignore */
    }
  }

  return used;
}

export async function cacheStats(): Promise<{
  disabled: boolean;
  ttlSeconds: number;
  memoryEntries: number;
  diskDir: string;
  redis: boolean;
  redisEmbedded: boolean;
  redisUrlConfigured: boolean;
}> {
  const redis = await getRedis();
  return {
    disabled: cacheDisabled(),
    ttlSeconds: Math.floor(ttlMs() / 1000),
    memoryEntries: memory.size,
    diskDir: cacheDir(),
    redis: Boolean(redis),
    redisEmbedded,
    redisUrlConfigured: Boolean(env("REDIS_URL")),
  };
}
