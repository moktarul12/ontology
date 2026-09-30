/**
 * Song audio resolve — Vite middleware.
 * 1) Archive.org album-track match (server-side; browser hits 403/CORS)
 * 2) Fallback: yt-dlp bestaudio → same-origin proxy for <audio>
 */
import { spawn } from "node:child_process";
import { chmodSync, createWriteStream, existsSync, mkdirSync } from "node:fs";
import { chmod } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { Connect, Plugin } from "vite";

const UA =
  "DigiDarpan/1.0 (knowledge explorer; +https://digidarpan.com) Mozilla/5.0";

const resolveCache = new Map<string, { audioUrl: string; source: string; at: number }>();
const CACHE_TTL_MS = 1000 * 60 * 45;

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[''`´]/g, "")
    .replace(/\.mp3$/i, "")
    .replace(/[^a-z0-9\u0900-\u097f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titlesMatch(a: string, b: string): boolean {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  // Avoid false positives like track "s" matching any title that contains "s"
  if (shorter.length >= 6 && longer.includes(shorter)) return true;
  const wa = new Set(na.split(" ").filter((w) => w.length > 2));
  const wb = nb.split(" ").filter((w) => w.length > 2);
  if (wa.size < 2 || wb.length < 2) return false;
  const hit = wb.filter((w) => wa.has(w)).length;
  return hit >= 2 && hit / Math.max(wa.size, wb.length) >= 0.5;
}

function scoreTitle(candidate: string, want: string): number {
  const na = normalizeTitle(candidate);
  const nb = normalizeTitle(want);
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= 6 && longer.includes(shorter)) return 80;
  const wa = new Set(na.split(" ").filter((w) => w.length > 2));
  const wb = nb.split(" ").filter((w) => w.length > 2);
  if (wa.size < 2 || wb.length < 2) return 0;
  const hit = wb.filter((w) => wa.has(w)).length;
  if (hit < 2) return 0;
  return (hit / Math.max(wa.size, wb.length)) * 70;
}

async function archiveJson<T>(url: string): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type ArchiveFile = { name?: string; format?: string; source?: string; title?: string };

async function listAlbumTracks(identifier: string): Promise<Array<{ name: string; title: string }>> {
  const data = await archiveJson<{ files?: ArchiveFile[] }>(
    `https://archive.org/metadata/${encodeURIComponent(identifier)}`,
  );
  if (!data?.files) return [];
  const out: Array<{ name: string; title: string }> = [];
  for (const f of data.files) {
    if (!f.name || !/\.mp3$/i.test(f.name)) continue;
    if (f.source === "metadata") continue;
    const title = (f.title || f.name.replace(/\.mp3$/i, "")).trim();
    out.push({ name: f.name, title });
  }
  return out;
}

function trackUrl(identifier: string, fileName: string): string {
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(fileName)}`;
}

async function searchArchive(
  q: string,
  rows = 24,
): Promise<Array<{ id: string; title: string }>> {
  const url =
    `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}` +
    `&fl[]=identifier&fl[]=title&rows=${rows}&page=1&output=json&sort[]=downloads+desc`;
  const data = await archiveJson<{
    response?: { docs?: Array<{ identifier?: string; title?: string }> };
  }>(url);
  const out: Array<{ id: string; title: string }> = [];
  const seen = new Set<string>();
  for (const doc of data?.response?.docs ?? []) {
    if (!doc.identifier || !doc.title || seen.has(doc.identifier)) continue;
    seen.add(doc.identifier);
    out.push({ id: doc.identifier, title: doc.title });
  }
  return out;
}

async function collectArtistAlbums(artist: string): Promise<Array<{ id: string; title: string }>> {
  const a = artist.replace(/"/g, "");
  const queries = [
    `creator:("${a}") AND mediatype:audio`,
    `title:("${a}") AND mediatype:audio`,
  ];
  const seen = new Set<string>();
  const out: Array<{ id: string; title: string }> = [];
  for (const q of queries) {
    const hits = await searchArchive(q, 16);
    for (const h of hits) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      out.push(h);
      if (out.length >= 20) return out;
    }
  }
  return out;
}

async function bestTrackInAlbum(
  identifier: string,
  songTitle: string,
): Promise<{ audioUrl: string; archiveId: string; track: string } | null> {
  const tracks = await listAlbumTracks(identifier);
  if (!tracks.length) return null;
  let best: { name: string; title: string; score: number } | null = null;
  for (const t of tracks) {
    const score = Math.max(scoreTitle(t.title, songTitle), scoreTitle(t.name, songTitle));
    if (score < 55) continue;
    if (!best || score > best.score) best = { ...t, score };
  }
  if (!best) return null;
  return {
    audioUrl: trackUrl(identifier, best.name),
    archiveId: identifier,
    track: best.title,
  };
}

function ytDlpBin(): string {
  const cached = path.join(process.cwd(), "node_modules", ".cache", "yt-dlp");
  if (existsSync(cached)) return cached;
  if (existsSync("/tmp/yt-dlp")) return "/tmp/yt-dlp";
  return cached;
}

function ytDlpDownloadUrl(): string {
  // Standalone binary for Linux containers; zipapp elsewhere (needs python).
  if (process.platform === "linux") {
    return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
  }
  if (process.platform === "darwin") {
    return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
  }
  return "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp";
}

async function ensureYtDlp(): Promise<string | null> {
  const bin = ytDlpBin();
  if (existsSync(bin)) return bin;
  try {
    const dir = path.dirname(bin);
    mkdirSync(dir, { recursive: true });
    const res = await fetch(ytDlpDownloadUrl(), {
      headers: { "User-Agent": UA },
    });
    if (!res.ok || !res.body) return null;
    const file = createWriteStream(bin);
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), file);
    await chmod(bin, 0o755);
    try {
      chmodSync(bin, 0o755);
    } catch {
      /* ignore */
    }
    return bin;
  } catch {
    return null;
  }
}

function runCmd(bin: string, args: string[], timeoutMs = 45_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("timeout"));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      out += String(d);
    });
    child.stderr.on("data", (d) => {
      err += String(d);
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(err.trim() || `exit ${code}`));
    });
  });
}

async function resolveYoutubeAudio(opts: {
  title: string;
  artist?: string;
  film?: string;
  youtubeId?: string;
}): Promise<{ audioUrl: string; source: string } | null> {
  const bin = await ensureYtDlp();
  if (!bin) return null;
  const query = [opts.title, opts.artist, opts.film, "song"].filter(Boolean).join(" ");
  const target = opts.youtubeId
    ? `https://www.youtube.com/watch?v=${opts.youtubeId}`
    : `ytsearch1:${query}`;
  try {
    const url = await runCmd(bin, [
      "-f",
      "bestaudio[ext=m4a]/bestaudio/best",
      "-g",
      "--no-playlist",
      "--no-warnings",
      target,
    ]);
    const direct = url.split("\n").map((l) => l.trim()).find((l) => /^https?:\/\//.test(l));
    if (!direct) return null;
    // Same-origin proxy so <audio> can play googlevideo streams
    const proxied = `/api/audio/proxy?u=${encodeURIComponent(direct)}`;
    return { audioUrl: proxied, source: "youtube" };
  } catch {
    return null;
  }
}

async function resolveArchive(opts: {
  title: string;
  artist?: string;
  film?: string;
  archiveId?: string;
}): Promise<{ audioUrl: string; archiveId?: string; track?: string } | null> {
  const title = opts.title.trim();
  if (!title) return null;

  if (opts.archiveId) {
    const hit = await bestTrackInAlbum(opts.archiveId, title);
    if (hit) return hit;
    const tracks = await listAlbumTracks(opts.archiveId);
    if (tracks[0]) {
      return {
        audioUrl: trackUrl(opts.archiveId, tracks[0].name),
        archiveId: opts.archiveId,
        track: tracks[0].title,
      };
    }
  }

  const albums = opts.artist ? await collectArtistAlbums(opts.artist) : [];
  const batchSize = 8;
  for (let i = 0; i < albums.length; i += batchSize) {
    const chunk = albums.slice(i, i + batchSize);
    const found = await Promise.all(chunk.map((a) => bestTrackInAlbum(a.id, title)));
    const hit = found.find(Boolean);
    if (hit) return hit!;
  }

  const t = title.replace(/"/g, "");
  const a = opts.artist?.replace(/"/g, "");
  const titledQueries = [
    a ? `("${t}") AND ("${a}") AND mediatype:audio` : `("${t}") AND mediatype:audio`,
    `title:("${t}") AND mediatype:audio`,
  ];
  for (const q of titledQueries) {
    const titled = await searchArchive(q, 16);
    for (const item of titled) {
      if (titlesMatch(item.title, title)) {
        const tracks = await listAlbumTracks(item.id);
        const exact = tracks.find(
          (tr) => titlesMatch(tr.title, title) || titlesMatch(tr.name, title),
        );
        if (exact) {
          return {
            audioUrl: trackUrl(item.id, exact.name),
            archiveId: item.id,
            track: exact.title,
          };
        }
        if (tracks.length === 1) {
          return {
            audioUrl: trackUrl(item.id, tracks[0].name),
            archiveId: item.id,
            track: tracks[0].title,
          };
        }
      }
      const hit = await bestTrackInAlbum(item.id, title);
      if (hit) return hit;
    }
  }

  return null;
}

async function resolveAudio(opts: {
  title: string;
  artist?: string;
  film?: string;
  archiveId?: string;
  youtubeId?: string;
}): Promise<{ audioUrl: string; archiveId?: string; track?: string; source: string } | null> {
  const key = JSON.stringify({
    t: opts.title.trim().toLowerCase(),
    a: opts.artist?.trim().toLowerCase() || "",
    f: opts.film?.trim().toLowerCase() || "",
    ia: opts.archiveId || "",
    yt: opts.youtubeId || "",
  });
  const cached = resolveCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { audioUrl: cached.audioUrl, source: cached.source };
  }

  // Archive first (fast path for known albums), YouTube fallback in parallel after a short wait
  const archivePromise = resolveArchive(opts);
  const ytPromise = resolveYoutubeAudio(opts);

  const archive = await archivePromise;
  if (archive?.audioUrl) {
    resolveCache.set(key, { audioUrl: archive.audioUrl, source: "archive", at: Date.now() });
    return { ...archive, source: "archive" };
  }

  const yt = await ytPromise;
  if (yt?.audioUrl) {
    resolveCache.set(key, { audioUrl: yt.audioUrl, source: yt.source, at: Date.now() });
    return { audioUrl: yt.audioUrl, source: yt.source };
  }

  return null;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const raw = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=600");
  res.end(raw);
}

async function proxyAudio(req: IncomingMessage, res: ServerResponse, target: string) {
  const range = req.headers.range;
  const upstream = await fetch(target, {
    headers: {
      "User-Agent": UA,
      ...(range ? { Range: range } : {}),
    },
  });
  if (!upstream.ok && upstream.status !== 206) {
    res.statusCode = upstream.status || 502;
    res.end("upstream error");
    return;
  }
  res.statusCode = upstream.status;
  const ct = upstream.headers.get("content-type");
  if (ct) res.setHeader("Content-Type", ct);
  const cl = upstream.headers.get("content-length");
  if (cl) res.setHeader("Content-Length", cl);
  const cr = upstream.headers.get("content-range");
  if (cr) res.setHeader("Content-Range", cr);
  const ar = upstream.headers.get("accept-ranges");
  res.setHeader("Accept-Ranges", ar || "bytes");
  res.setHeader("Cache-Control", "private, max-age=300");
  if (!upstream.body) {
    res.end();
    return;
  }
  await pipeline(
    Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream),
    res,
  );
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const rawUrl = req.url || "/";
  const url = new URL(rawUrl, "http://localhost");
  const pathName = url.pathname.replace(/\/+$/, "") || "/";

  if (
    (req.method === "GET" || req.method === "HEAD") &&
    (pathName === "/proxy" || pathName.endsWith("/proxy"))
  ) {
    const target = url.searchParams.get("u") || "";
    if (!/^https:\/\//i.test(target)) {
      res.statusCode = 400;
      res.end("bad url");
      return;
    }
    // Only proxy known audio CDNs
    if (
      !/(googlevideo\.com|googleusercontent\.com|archive\.org)/i.test(target)
    ) {
      res.statusCode = 403;
      res.end("forbidden host");
      return;
    }
    if (req.method === "HEAD") {
      try {
        const upstream = await fetch(target, {
          method: "HEAD",
          headers: { "User-Agent": UA },
        });
        res.statusCode = upstream.status;
        const ct = upstream.headers.get("content-type");
        if (ct) res.setHeader("Content-Type", ct);
        const cl = upstream.headers.get("content-length");
        if (cl) res.setHeader("Content-Length", cl);
        res.setHeader("Accept-Ranges", "bytes");
        res.end();
      } catch {
        res.statusCode = 502;
        res.end();
      }
      return;
    }
    try {
      await proxyAudio(req, res, target);
    } catch {
      if (!res.headersSent) {
        res.statusCode = 502;
        res.end("proxy failed");
      }
    }
    return;
  }

  const isResolve =
    pathName === "/resolve" || pathName.endsWith("/resolve");

  if (req.method === "GET" && isResolve) {
    const title = url.searchParams.get("title")?.trim() || "";
    if (!title) {
      sendJson(res, 400, { error: "title required" });
      return;
    }
    const hit = await resolveAudio({
      title,
      artist: url.searchParams.get("artist")?.trim() || undefined,
      film: url.searchParams.get("film")?.trim() || undefined,
      archiveId: url.searchParams.get("archiveId")?.trim() || undefined,
      youtubeId: url.searchParams.get("youtubeId")?.trim() || undefined,
    });
    if (!hit) {
      sendJson(res, 404, { error: "no audio" });
      return;
    }
    sendJson(res, 200, hit);
    return;
  }

  if (req.method === "POST" && isResolve) {
    const raw = await readBody(req);
    let body: {
      title?: string;
      artist?: string;
      film?: string;
      archiveId?: string;
      youtubeId?: string;
    } = {};
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      sendJson(res, 400, { error: "invalid json" });
      return;
    }
    const title = body.title?.trim() || "";
    if (!title) {
      sendJson(res, 400, { error: "title required" });
      return;
    }
    const hit = await resolveAudio({
      title,
      artist: body.artist?.trim() || undefined,
      film: body.film?.trim() || undefined,
      archiveId: body.archiveId?.trim() || undefined,
      youtubeId: body.youtubeId?.trim() || undefined,
    });
    if (!hit) {
      sendJson(res, 404, { error: "no audio" });
      return;
    }
    sendJson(res, 200, hit);
    return;
  }

  sendJson(res, 404, { error: "not found" });
}

function attach(middlewares: Connect.Server) {
  middlewares.use("/api/audio", (req, res, next) => {
    handleRequest(req, res).catch(next);
  });
}

export function audioPlugin(): Plugin {
  return {
    name: "song-audio-api",
    configureServer(server) {
      attach(server.middlewares);
    },
    configurePreviewServer(server) {
      attach(server.middlewares);
    },
  };
}
