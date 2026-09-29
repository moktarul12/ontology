import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clapperboard, Film, Search, Sparkles } from "lucide-react";
import { fetchPersonFilmography, type FilmographyEntry } from "@/lib/wikidata/api.ts";
import { Skeleton } from "@/components/ui/skeleton.tsx";

type Props = {
  personId: string;
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
  onOpen: (id: string, label: string) => void;
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
      onClick={() => onOpen(film.qid, film.title)}
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
          {film.character
            ? (
              <>
                as <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{film.character}</span>
              </>
            )
            : "Featured role"}
        </p>
      </div>
    </button>
  );
}

export default function MoviesPanel({ personId, onOpenWork }: Props) {
  const [decade, setDecade] = useState<(typeof DECADES)[number]>("All");
  const [q, setQ] = useState("");

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

  const withChar = films.filter((f) => f.character).length;
  const withYear = films.filter((f) => f.year).length;

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
              Movies & screen credits
            </h2>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "#94a3b8" }}>
            {isLoading ? "Loading filmography…" : `${films.length} titles · ${withChar} with character · ${withYear} dated`}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#fcd34d", fontSize: 11, fontWeight: 600 }}>
          <Sparkles className="size-3.5" />
          Cast · Year · Character
        </div>
      </div>

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
            <MovieCard key={f.qid} film={f} onOpen={onOpenWork} />
          ))}
        </div>
      )}
    </div>
  );
}
