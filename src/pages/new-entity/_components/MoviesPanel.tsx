import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Clapperboard,
  Film,
  Link2,
  Music2,
  Pause,
  Play,
  Search,
  UserRound,
} from "lucide-react";
import {
  fetchEntitySummary,
  fetchHowPersonRelatesToWork,
  fetchPersonFilmography,
  fetchPersonSongs,
  resolveSongYoutubeId,
  type FilmographyEntry,
  type SongEntry,
} from "@/lib/wikidata/api.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { toast } from "sonner";

type Props = {
  personId: string;
  personLabel: string;
  personThumb?: string;
  onOpenWork: (id: string, label: string) => void;
};

const DECADES = ["All", "2020s", "2010s", "2000s", "1990s", "Earlier"] as const;

function decadeOf(year?: number): (typeof DECADES)[number] {
  if (!year) return "Earlier";
  if (year >= 2020) return "2020s";
  if (year >= 2010) return "2010s";
  if (year >= 2000) return "2000s";
  if (year >= 1990) return "1990s";
  return "Earlier";
}

function MovieCard({
  film,
  onOpen,
}: {
  film: FilmographyEntry;
  onOpen: (film: FilmographyEntry) => void;
}) {
  const accent =
    film.year && film.year >= 2015
      ? "#38bdf8"
      : film.year && film.year >= 2005
        ? "#fbbf24"
        : film.year && film.year >= 1995
          ? "#a78bfa"
          : "#94a3b8";

  return (
    <button
      type="button"
      onClick={() => onOpen(film)}
      style={{
        display: "flex",
        flexDirection: "column",
        textAlign: "left",
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "linear-gradient(160deg, rgba(18,26,43,0.95), rgba(8,14,28,0.98))",
        overflow: "hidden",
        cursor: "pointer",
        color: "inherit",
        padding: 0,
        transition: "transform 0.15s ease, border-color 0.15s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = `${accent}66`;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
        e.currentTarget.style.transform = "none";
      }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "16/10",
          background: `linear-gradient(135deg, ${accent}22, #0b1220 55%, #070b14)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {film.thumbnail ? (
          <img
            src={film.thumbnail}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <Film className="size-10" style={{ color: `${accent}99` }} />
        )}
        {film.thumbnail && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(180deg, transparent 40%, rgba(7,11,20,0.75))",
              pointerEvents: "none",
            }}
          />
        )}
        {film.year != null && (
          <span
            style={{
              position: "absolute",
              top: 10,
              right: 10,
              borderRadius: 999,
              padding: "3px 9px",
              fontSize: 11,
              fontWeight: 700,
              fontFamily: "Space Mono, monospace",
              background: "rgba(7,11,20,0.75)",
              border: `1px solid ${accent}55`,
              color: accent,
            }}
          >
            {film.year}
          </span>
        )}
        <span
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            borderRadius: 8,
            padding: "3px 8px",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            background: "rgba(255,255,255,0.06)",
            color: "#cbd5e1",
          }}
        >
          {film.role}
        </span>
      </div>
      <div style={{ padding: "12px 14px 14px" }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#f8fafc", lineHeight: 1.3 }}>
          {film.title}
        </p>
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#94a3b8", lineHeight: 1.4 }}>
          {film.character ? (
            <>
              as <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{film.character}</span>
            </>
          ) : (
            "Featured role"
          )}
        </p>
      </div>
    </button>
  );
}

function MovieDetail({
  film,
  personId,
  personLabel,
  personThumb,
  onBack,
  onOpenFull,
}: {
  film: FilmographyEntry;
  personId: string;
  personLabel: string;
  personThumb?: string;
  onBack: () => void;
  onOpenFull: () => void;
}) {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["movie-summary", film.qid],
    queryFn: () => fetchEntitySummary(film.qid),
    staleTime: 1000 * 60 * 30,
  });

  const { data: links = [], isLoading: linksLoading } = useQuery({
    queryKey: ["person-work-link", personId, film.qid],
    queryFn: () => fetchHowPersonRelatesToWork(personId, film.qid),
    staleTime: 1000 * 60 * 30,
  });

  const about =
    summary?.wikipedia?.lead ||
    summary?.wikipediaSummary ||
    summary?.description ||
    "";

  const directors = summary
    ? (summary.facts.find((f) => f.propertyId === "P57")?.values ?? []).slice(0, 3)
    : [];
  const genres = summary
    ? (summary.facts.find((f) => f.propertyId === "P136")?.values ?? []).slice(0, 4)
    : [];

  const relationRows =
    links.length > 0
      ? links
      : [
          {
            role: film.role,
            pid: "local",
            character: film.character,
          },
        ];

  const poster = film.thumbnail || summary?.thumbnail;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          onClick={onBack}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "#e2e8f0",
            padding: "8px 14px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <ArrowLeft className="size-3.5" />
          Back to movies
        </button>
        <button
          type="button"
          onClick={onOpenFull}
          style={{
            marginLeft: "auto",
            borderRadius: 999,
            border: "1px solid rgba(56,189,248,0.35)",
            background: "rgba(14,165,233,0.12)",
            color: "#7dd3fc",
            padding: "8px 14px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Open full profile
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gap: 20,
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          alignItems: "start",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "linear-gradient(145deg, rgba(18,26,43,0.98), rgba(8,14,28,0.98))",
          padding: 18,
        }}
      >
        <div
          style={{
            maxWidth: 220,
            borderRadius: 14,
            overflow: "hidden",
            aspectRatio: "2/3",
            background: "linear-gradient(160deg, #1e293b, #020617)",
            border: "1px solid rgba(255,255,255,0.08)",
            position: "relative",
          }}
        >
          {poster ? (
            <img
              src={poster}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              referrerPolicy="no-referrer"
            />
          ) : (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <Film className="size-10" style={{ color: "#475569" }} />
            </div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            Film detail
          </p>
          <h2 style={{ margin: "6px 0 0", fontSize: 24, fontWeight: 800, color: "#f8fafc", lineHeight: 1.2 }}>
            {film.title}
          </h2>
          <p style={{ margin: "8px 0 0", fontSize: 13, color: "#94a3b8" }}>
            {[film.year, summary?.description].filter(Boolean).join(" · ")}
          </p>

          {(genres.length > 0 || directors.length > 0) && (
            <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {genres.map((g) => (
                <span
                  key={g.id ?? g.label}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#bae6fd",
                    borderRadius: 999,
                    border: "1px solid rgba(56,189,248,0.25)",
                    background: "rgba(14,165,233,0.1)",
                    padding: "4px 10px",
                  }}
                >
                  {g.label}
                </span>
              ))}
              {directors.map((d) => (
                <span
                  key={d.id ?? d.label}
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#fde68a",
                    borderRadius: 999,
                    border: "1px solid rgba(251,191,36,0.25)",
                    background: "rgba(251,191,36,0.08)",
                    padding: "4px 10px",
                  }}
                >
                  Dir. {d.label}
                </span>
              ))}
            </div>
          )}

          <div style={{ marginTop: 18 }}>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              Summary
            </p>
            {summaryLoading ? (
              <div style={{ display: "grid", gap: 8 }}>
                <Skeleton className="h-4 w-full" style={{ background: "rgba(255,255,255,0.06)" }} />
                <Skeleton className="h-4 w-5/6" style={{ background: "rgba(255,255,255,0.06)" }} />
                <Skeleton className="h-4 w-4/5" style={{ background: "rgba(255,255,255,0.06)" }} />
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: "#cbd5e1", whiteSpace: "pre-wrap" }}>
                {about || "No summary available for this film yet."}
              </p>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(251,191,36,0.22)",
          background: "linear-gradient(120deg, rgba(251,191,36,0.1), rgba(14,165,233,0.06))",
          padding: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              overflow: "hidden",
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "#0f172a",
              border: "2px solid rgba(251,191,36,0.45)",
            }}
          >
            {personThumb ? (
              <img
                src={personThumb}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
              />
            ) : (
              <UserRound className="size-4" style={{ color: "#fcd34d" }} />
            )}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Link2 className="size-3.5" style={{ color: "#fcd34d" }} />
              <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: "#fde68a" }}>
                How this relates to {personLabel}
              </p>
            </div>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94a3b8" }}>
              Connection between the film and the person you searched
            </p>
          </div>
        </div>

        {linksLoading ? (
          <div style={{ display: "grid", gap: 8 }}>
            <Skeleton className="h-10 w-full rounded-xl" style={{ background: "rgba(255,255,255,0.06)" }} />
            <Skeleton className="h-10 w-full rounded-xl" style={{ background: "rgba(255,255,255,0.06)" }} />
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 8 }}>
            {relationRows.map((link, i) => (
              <li
                key={`${link.pid}-${link.role}-${link.character ?? i}`}
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "flex-start",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(7,11,20,0.45)",
                  padding: "12px 14px",
                }}
              >
                <span
                  style={{
                    marginTop: 2,
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    flexShrink: 0,
                    display: "grid",
                    placeItems: "center",
                    background: "rgba(251,191,36,0.15)",
                    color: "#fcd34d",
                  }}
                >
                  <Clapperboard className="size-3.5" />
                </span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#f1f5f9" }}>
                    {personLabel}
                    <span style={{ fontWeight: 500, color: "#94a3b8" }}> — {link.role}</span>
                  </p>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "#cbd5e1", lineHeight: 1.45 }}>
                    {link.character
                      ? (
                        <>
                          Appears in <span style={{ fontWeight: 600, color: "#fff" }}>{film.title}</span>
                          {" "}as{" "}
                          <span style={{ fontWeight: 600, color: "#fde68a" }}>{link.character}</span>
                          {film.year != null ? ` (${film.year})` : ""}.
                        </>
                      )
                      : (
                        <>
                          Credited on <span style={{ fontWeight: 600, color: "#fff" }}>{film.title}</span>
                          {film.year != null ? ` (${film.year})` : ""} as {link.role.toLowerCase()}.
                        </>
                      )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function SongsPlaylist({
  personId,
  personLabel,
  personThumb,
}: {
  personId: string;
  personLabel: string;
  personThumb?: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playlist, setPlaylist] = useState<SongEntry[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [songFilter, setSongFilter] = useState("");
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const { data: songs = [], isLoading } = useQuery({
    queryKey: ["person-songs-v1", personId, personLabel],
    queryFn: () => fetchPersonSongs(personId, { personLabel, limit: 48 }),
    staleTime: 1000 * 60 * 30,
  });

  useEffect(() => {
    setPlaylist(songs);
  }, [songs]);

  const filtered = useMemo(() => {
    const needle = songFilter.trim().toLowerCase();
    if (!needle) return playlist;
    return playlist.filter(
      (s) =>
        s.title.toLowerCase().includes(needle) ||
        (s.film?.toLowerCase().includes(needle) ?? false),
    );
  }, [playlist, songFilter]);

  const current = playlist.find((s) => s.qid === currentId) ?? null;
  const playableCount = playlist.filter((s) => s.audioUrl || s.youtubeId).length;

  useEffect(() => {
    setCurrentId(null);
    setPlaying(false);
    setProgress(0);
    setDuration(0);
    setSongFilter("");
    setResolvingId(null);
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
    }
  }, [personId]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !current?.audioUrl) return;
    if (audio.src !== current.audioUrl) {
      audio.src = current.audioUrl;
      audio.load();
    }
    if (playing) {
      void audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [current?.audioUrl, current?.qid, playing]);

  const patchSong = (qid: string, patch: Partial<SongEntry>) => {
    setPlaylist((prev) => prev.map((s) => (s.qid === qid ? { ...s, ...patch } : s)));
  };

  const playSong = async (song: SongEntry) => {
    // Toggle pause on same track
    if (currentId === song.qid && (song.audioUrl || song.youtubeId)) {
      if (song.audioUrl) setPlaying((p) => !p);
      return;
    }

    setCurrentId(song.qid);
    setProgress(0);
    setDuration(0);

    if (song.audioUrl) {
      setPlaying(true);
      return;
    }

    if (song.youtubeId) {
      setPlaying(false);
      return;
    }

    // Resolve playable source on demand
    setResolvingId(song.qid);
    setPlaying(false);
    try {
      const query = [song.title, personLabel, song.film].filter(Boolean).join(" ");
      const yt = await resolveSongYoutubeId(`${query} song`);
      if (yt) {
        patchSong(song.qid, { youtubeId: yt });
        setCurrentId(song.qid);
        toast.success(`Playing “${song.title}”`);
      } else {
        // Last resort: open YouTube search in a new tab
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        window.open(url, "_blank", "noopener,noreferrer");
        toast.message("Opened YouTube search for this song");
      }
    } catch {
      toast.error("Could not resolve audio for this song");
    } finally {
      setResolvingId(null);
    }
  };

  if (isLoading) {
    return (
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(251,191,36,0.2)",
          background: "rgba(251,191,36,0.04)",
          padding: 16,
          display: "grid",
          gap: 10,
        }}
      >
        <Skeleton className="h-5 w-48" style={{ background: "rgba(255,255,255,0.06)" }} />
        <Skeleton className="h-16 w-full rounded-xl" style={{ background: "rgba(255,255,255,0.06)" }} />
        <Skeleton className="h-12 w-full rounded-xl" style={{ background: "rgba(255,255,255,0.06)" }} />
      </div>
    );
  }

  if (!playlist.length) return null;

  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid rgba(251,191,36,0.28)",
        background: "linear-gradient(145deg, rgba(40,28,12,0.55), rgba(12,18,32,0.95))",
        overflow: "hidden",
      }}
    >
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onEnded={() => {
          const idx = playlist.findIndex((s) => s.qid === currentId);
          const next = playlist.slice(idx + 1).find((s) => s.audioUrl);
          if (next) {
            setCurrentId(next.qid);
            setPlaying(true);
          } else {
            setPlaying(false);
          }
        }}
        onError={() => setPlaying(false)}
      />

      <div
        style={{
          padding: "14px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              display: "grid",
              placeItems: "center",
              background: "rgba(251,191,36,0.15)",
              color: "#fcd34d",
              flexShrink: 0,
            }}
          >
            <Music2 className="size-4" />
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#fef3c7" }}>
              Songs by {personLabel}
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94a3b8" }}>
              {playlist.length} titles · tap ▶ to play · {playableCount} ready
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#78716c" }}>
              digidarpan.com
            </p>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(0,0,0,0.25)",
            padding: "6px 10px",
            minWidth: 160,
          }}
        >
          <Search className="size-3.5" style={{ color: "#64748b" }} />
          <input
            value={songFilter}
            onChange={(e) => setSongFilter(e.target.value)}
            placeholder="Find a song…"
            style={{
              flex: 1,
              background: "transparent",
              border: 0,
              outline: "none",
              color: "#f1f5f9",
              fontSize: 12,
            }}
          />
        </div>
      </div>

      {current && (
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(0,0,0,0.28)",
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                overflow: "hidden",
                flexShrink: 0,
                border: "2px solid rgba(251,191,36,0.45)",
                display: "grid",
                placeItems: "center",
                background: "#0f172a",
              }}
            >
              {personThumb ? (
                <img
                  src={personThumb}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
                />
              ) : (
                <Music2 className="size-4" style={{ color: "#fcd34d" }} />
              )}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#fbbf24" }}>
                Now playing
              </p>
              <p style={{ margin: "2px 0 0", fontSize: 15, fontWeight: 700, color: "#fff" }}>{current.title}</p>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#94a3b8" }}>
                {[current.film, current.year, personLabel].filter(Boolean).join(" · ")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void playSong(current)}
              disabled={resolvingId === current.qid}
              style={{
                width: 44,
                height: 44,
                borderRadius: 999,
                border: 0,
                background: "linear-gradient(135deg, #fbbf24, #f59e0b)",
                color: "#111827",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                flexShrink: 0,
                opacity: resolvingId === current.qid ? 0.6 : 1,
              }}
            >
              {current.audioUrl && playing ? (
                <Pause className="size-4" fill="currentColor" />
              ) : (
                <Play className="size-4" fill="currentColor" />
              )}
            </button>
          </div>

          {current.audioUrl && (
            <div style={{ display: "grid", gap: 6 }}>
              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.1}
                value={progress}
                onChange={(e) => {
                  const t = Number(e.target.value);
                  setProgress(t);
                  if (audioRef.current) audioRef.current.currentTime = t;
                }}
                style={{ width: "100%", accentColor: "#fbbf24" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b", fontFamily: "Space Mono, monospace" }}>
                <span>{formatTime(progress)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          )}

          {!current.audioUrl && current.youtubeId && (
            <div style={{ borderRadius: 12, overflow: "hidden", aspectRatio: "16/9", background: "#000" }}>
              <iframe
                title={current.title}
                src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(current.youtubeId)}?autoplay=1&rel=0`}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ width: "100%", height: "100%", border: 0 }}
              />
            </div>
          )}

          {resolvingId === current.qid && (
            <p style={{ margin: 0, fontSize: 12, color: "#fcd34d" }}>Finding a playable version…</p>
          )}
        </div>
      )}

      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          maxHeight: 380,
          overflowY: "auto",
        }}
      >
        {filtered.length === 0 ? (
          <li style={{ padding: "16px", fontSize: 13, color: "#64748b" }}>No songs match this filter.</li>
        ) : (
          filtered.map((song, i) => {
            const active = song.qid === currentId;
            const busy = resolvingId === song.qid;
            return (
              <li
                key={song.qid}
                style={{
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                  background: active ? "rgba(251,191,36,0.08)" : "transparent",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    width: "100%",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px 8px 16px",
                  }}
                >
                  <span
                    style={{
                      width: 22,
                      flexShrink: 0,
                      fontSize: 11,
                      fontWeight: 700,
                      fontFamily: "Space Mono, monospace",
                      color: "#64748b",
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: active ? "#fef3c7" : "#f1f5f9" }}>
                      {song.title}
                    </span>
                    <span style={{ display: "block", marginTop: 2, fontSize: 11, color: "#64748b" }}>
                      {[song.film, song.year].filter(Boolean).join(" · ") || "Recording"}
                      {song.audioUrl ? " · MP3" : song.youtubeId ? " · YouTube" : " · tap play"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void playSong(song)}
                    disabled={busy}
                    title={`Play ${song.title}`}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      border: active ? "1px solid rgba(251,191,36,0.5)" : "1px solid rgba(255,255,255,0.12)",
                      background: active ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.04)",
                      color: active ? "#fcd34d" : "#e2e8f0",
                      display: "grid",
                      placeItems: "center",
                      cursor: busy ? "wait" : "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {busy ? (
                      <span style={{ fontSize: 10, fontWeight: 700 }}>…</span>
                    ) : active && song.audioUrl && playing ? (
                      <Pause className="size-3.5" />
                    ) : (
                      <Play className="size-3.5" />
                    )}
                  </button>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

export default function MoviesPanel({
  personId,
  personLabel,
  personThumb,
  onOpenWork,
}: Props) {
  const [decade, setDecade] = useState<(typeof DECADES)[number]>("All");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<FilmographyEntry | null>(null);
  const [view, setView] = useState<"films" | "songs">("songs");

  useEffect(() => {
    setSelected(null);
    setDecade("All");
    setQ("");
    setView("songs");
  }, [personId]);

  const { data: films = [], isLoading, isFetching } = useQuery({
    queryKey: ["filmography-detail-v2", personId],
    queryFn: () => fetchPersonFilmography(personId, 100),
    staleTime: 1000 * 60 * 30,
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return films.filter((f) => {
      if (decade !== "All" && decadeOf(f.year) !== decade) return false;
      if (!needle) return true;
      return (
        f.title.toLowerCase().includes(needle) ||
        (f.character?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [films, decade, q]);

  if (selected) {
    return (
      <MovieDetail
        film={selected}
        personId={personId}
        personLabel={personLabel}
        personThumb={personThumb}
        onBack={() => setSelected(null)}
        onOpenFull={() => onOpenWork(selected.qid, selected.title)}
      />
    );
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(56,189,248,0.2)",
          background: "linear-gradient(120deg, rgba(14,165,233,0.12), rgba(15,23,42,0.4))",
          padding: "16px 18px",
          display: "flex",
          flexWrap: "wrap",
          gap: 14,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <Clapperboard className="size-4" style={{ color: "#7dd3fc" }} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>
              Movies & songs
            </h2>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>
            {isLoading
              ? "Loading filmography…"
              : `${films.length} films · tap Songs for ${personLabel}'s playback`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, padding: 3, borderRadius: 999, background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.08)" }}>
          {(
            [
              { id: "films" as const, label: "Films", icon: Film },
              { id: "songs" as const, label: "Songs", icon: Music2 },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setView(t.id)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 999,
                border: 0,
                padding: "7px 14px",
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                background: view === t.id ? "rgba(56,189,248,0.22)" : "transparent",
                color: view === t.id ? "#e0f2fe" : "#94a3b8",
              }}
            >
              <t.icon className="size-3.5" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {view === "songs" ? (
        <SongsPlaylist personId={personId} personLabel={personLabel} personThumb={personThumb} />
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            {DECADES.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDecade(d)}
                style={{
                  borderRadius: 999,
                  border: decade === d ? "1px solid rgba(56,189,248,0.5)" : "1px solid rgba(255,255,255,0.1)",
                  background: decade === d ? "rgba(14,165,233,0.18)" : "rgba(255,255,255,0.04)",
                  color: decade === d ? "#e0f2fe" : "#94a3b8",
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {d}
              </button>
            ))}
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.1)",
                background: "rgba(255,255,255,0.04)",
                padding: "6px 10px",
                minWidth: 180,
              }}
            >
              <Search className="size-3.5" style={{ color: "#64748b" }} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter title or character…"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: 0,
                  outline: "none",
                  color: "#f1f5f9",
                  fontSize: 12,
                }}
              />
            </div>
          </div>

          {isLoading ? (
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-48 rounded-2xl" style={{ background: "rgba(255,255,255,0.06)" }} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "#64748b" }}>
              {isFetching ? "Refreshing…" : "No films match this filter."}
            </p>
          ) : (
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
              {filtered.map((f) => (
                <MovieCard key={f.qid} film={f} onOpen={setSelected} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

