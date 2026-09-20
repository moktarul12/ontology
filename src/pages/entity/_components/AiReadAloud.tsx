import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Volume2, Square } from "lucide-react";
import { cn } from "@/lib/utils.ts";
import type { EntitySummary } from "@/lib/wikidata/types.ts";

export type ReadLang = "bn" | "hi" | "en";

const READ_LANGS: { id: ReadLang; native: string; english: string }[] = [
  { id: "bn", native: "বাংলা", english: "Bengali" },
  { id: "hi", native: "हिन्दी", english: "Hindi" },
  { id: "en", native: "English", english: "English" },
];

const LANG_EVENT = "wikigraph-read-lang";

function factBlob(entity: EntitySummary, pid: string): string {
  return (entity.facts.find((f) => f.propertyId === pid)?.values ?? [])
    .map((v) => `${v.label} ${v.id ?? ""}`)
    .join(" ");
}

function factLabels(entity: EntitySummary, pid: string, limit = 6): string[] {
  return (entity.facts.find((f) => f.propertyId === pid)?.values ?? [])
    .map((v) => v.label.replace(/\s*\([^)]*\)\s*$/, "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function cinemaBlob(entity: EntitySummary): string {
  return [
    entity.description,
    factBlob(entity, "P106"),
    factBlob(entity, "P136"),
    factBlob(entity, "P27"),
    entity.wikipedia?.lead ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function isCinemaPerson(entity: EntitySummary): boolean {
  return /actor|actress|singer|playback|film|cinema|bollywood|director|composer|lyricist|screen/.test(
    cinemaBlob(entity),
  );
}

function isIndianCinema(entity: EntitySummary): boolean {
  const blob = cinemaBlob(entity);
  return (
    isCinemaPerson(entity) &&
    /india|hindi|bollywood|bengali|tamil|telugu|malayalam|marathi|\bq668\b/.test(blob)
  );
}

function langStorageKey(id: string) {
  return `wikigraph-read-lang:${id}`;
}

/** Native language of this person, used as the default Listen language. */
function defaultReadLang(entity: EntitySummary): ReadLang {
  const native = `${factBlob(entity, "P103")} ${factBlob(entity, "P1412")} ${entity.wikipedia?.lead ?? ""}`.toLowerCase();
  if (/bengali|bangla|বাংলা|\bq9610\b/.test(native)) return "bn";
  if (/hindi|हिन्दी|हिंदी|\bq1568\b/.test(native)) return "hi";
  const blob = [
    entity.description,
    entity.wikipedia?.lead ?? "",
    factBlob(entity, "P27"),
    factBlob(entity, "P19"),
    factBlob(entity, "P103"),
    factBlob(entity, "P1412"),
  ]
    .join(" ")
    .toLowerCase();
  if (/bengali|bangla|kolkata|west bengal|bangladesh|\bq9610\b/.test(blob)) return "bn";
  if (/hindi|bollywood|\bq1568\b/.test(blob)) return "hi";
  return "en";
}

function loadReadLang(entity: EntitySummary): ReadLang {
  try {
    const stored = localStorage.getItem(langStorageKey(entity.id));
    if (stored === "bn" || stored === "hi" || stored === "en") return stored;
  } catch {
    /* ignore */
  }
  return defaultReadLang(entity);
}

function voiceLangsFor(lang: ReadLang, entity: EntitySummary): string[] {
  if (lang === "bn") return ["bn-IN", "bn-BD", "bn"];
  if (lang === "hi") return ["hi-IN", "hi"];
  if (isIndianCinema(entity) || /india|\bq668\b/i.test(factBlob(entity, "P27"))) {
    return ["en-IN", "en-GB", "en-US"];
  }
  return ["en-US", "en-GB", "en"];
}

function scoreVoice(voice: SpeechSynthesisVoice, langs: string[], lang: ReadLang): number {
  const n = `${voice.name} ${voice.lang}`.toLowerCase().replace(/_/g, "-");
  let s = 0;
  if (lang === "bn") {
    if (/^bn[-_]|bengali|bangla/.test(n)) s += 100;
  } else if (lang === "hi") {
    if (/^hi[-_]|hindi/.test(n)) s += 100;
    if (/ravi|heera|aditi|priya|neerja|veena|ananya/.test(n) && /hi/.test(n)) s += 20;
  } else {
    if (/en-in/.test(n)) s += 80;
    if (/india|indian/.test(n)) s += 70;
    if (/ravi|heera|aditi|priya|neerja|rishi|veena|ananya|kavya|shruti/.test(n)) s += 75;
  }
  for (const [i, want] of langs.entries()) {
    const L = want.toLowerCase().replace(/_/g, "-");
    if (n.includes(L)) s += 40 - i * 6;
  }
  if (/compact|premium/.test(n)) s += 4;
  return s;
}

function pickVoice(langs: string[], lang: ReadLang): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices?.() ?? [];
  if (!voices.length) return undefined;
  const ranked = [...voices].sort(
    (a, b) => scoreVoice(b, langs, lang) - scoreVoice(a, langs, lang),
  );
  const best = ranked[0];
  if (best && scoreVoice(best, langs, lang) >= 20) return best;
  const norm = (s: string) => s.toLowerCase().replace(/_/g, "-");
  for (const want of langs) {
    const w = norm(want);
    const exact = voices.find((v) => norm(v.lang) === w || norm(v.lang).startsWith(`${w}-`));
    if (exact) return exact;
  }
  const prefix = lang === "en" ? "en" : lang;
  return voices.find((v) => norm(v.lang).startsWith(prefix)) ?? voices.find((v) => norm(v.lang).startsWith("en"));
}

function filmographyScript(entity: EntitySummary, base: string): { text: string; style: "filmi" | "cinematic" | "local" } {
  const filmi = isIndianCinema(entity);
  const cinema = isCinemaPerson(entity);
  const films = [
    ...factLabels(entity, "CR_FILM", 6),
    ...factLabels(entity, "P161", 4),
    ...factLabels(entity, "P800", 6),
  ].filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
  const songs = factLabels(entity, "CR_SONG", 5);
  const awards = factLabels(entity, "P166", 3);
  const intro = filmi
    ? `${entity.label}. A life in Indian cinema.`
    : cinema
      ? `${entity.label}. A life on screen.`
      : "";
  const extra = [
    films.length ? `The filmography includes ${films.slice(0, 5).join(", ")}.` : "",
    songs.length ? `Songs that still play: ${songs.slice(0, 4).join(", ")}.` : "",
    awards.length ? `Honours include ${awards.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const text = [intro, extra, base]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .trim()
    .slice(0, 1500);
  return {
    text,
    style: filmi ? "filmi" : cinema ? "cinematic" : "local",
  };
}

export function AiReadAloud({
  entity,
  text,
  variant = "hero",
}: {
  entity: EntitySummary;
  text: string;
  variant?: "hero" | "header";
}) {
  const instanceId = useId();
  const [playing, setPlaying] = useState(false);
  const [lang, setLang] = useState<ReadLang>(() => loadReadLang(entity));
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const keepAliveRef = useRef<number | null>(null);
  const langs = useMemo(() => voiceLangsFor(lang, entity), [lang, entity]);
  const script = useMemo(() => filmographyScript(entity, text), [entity, text]);

  const stop = () => {
    if (keepAliveRef.current) {
      window.clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    window.speechSynthesis?.cancel();
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      try {
        audio.load();
      } catch {
        /* ignore */
      }
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPlaying(false);
  };

  const chooseLang = (next: ReadLang) => {
    if (next === lang) return;
    stop();
    setLang(next);
    try {
      localStorage.setItem(langStorageKey(entity.id), next);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent(LANG_EVENT, { detail: { entityId: entity.id, lang: next, from: instanceId } }),
    );
  };

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    const onVoices = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener("voiceschanged", onVoices);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
  }, []);

  useEffect(() => {
    setLang(loadReadLang(entity));
    stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.id, script.text]);

  useEffect(() => {
    const onPeer = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id !== instanceId) stop();
    };
    const onLang = (e: Event) => {
      const d = (e as CustomEvent<{ entityId: string; lang: ReadLang; from: string }>).detail;
      if (!d || d.entityId !== entity.id || d.from === instanceId) return;
      setLang(d.lang);
      stop();
    };
    window.addEventListener("wikigraph-read", onPeer);
    window.addEventListener(LANG_EVENT, onLang);
    return () => {
      window.removeEventListener("wikigraph-read", onPeer);
      window.removeEventListener(LANG_EVENT, onLang);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, entity.id]);

  if (!script.text || typeof window === "undefined") return null;

  const unlockPlayback = () => {
    try {
      window.speechSynthesis?.cancel();
      window.speechSynthesis?.resume();
      const priming = new SpeechSynthesisUtterance(".");
      priming.volume = 0;
      priming.rate = 2;
      window.speechSynthesis?.speak(priming);
    } catch {
      /* ignore */
    }
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.src =
        "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
      void audio.play().catch(() => undefined);
    } catch {
      /* ignore */
    }
  };

  const speakLocal = (spoken = script.text) => {
    if (!window.speechSynthesis) return;
    const chunks: string[] = [];
    const bits = spoken.split(/(?<=[।.!?…\n])\s+/);
    let buf = "";
    for (const bit of bits) {
      if (`${buf} ${bit}`.trim().length > 160 && buf) {
        chunks.push(buf.trim());
        buf = bit;
      } else {
        buf = `${buf} ${bit}`.trim();
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
    const queue = chunks.length ? chunks : [spoken.slice(0, 160)];
    const voice = pickVoice(langs, lang);
    const utterLang = voice?.lang || langs[0] || (lang === "bn" ? "bn-IN" : lang === "hi" ? "hi-IN" : "en-IN");
    const speakNext = (i: number) => {
      if (i >= queue.length) {
        setPlaying(false);
        return;
      }
      const utter = new SpeechSynthesisUtterance(queue[i]);
      utter.lang = utterLang;
      if (voice) utter.voice = voice;
      utter.rate = lang === "en" ? 0.92 : 0.88;
      utter.pitch = 1;
      utter.onend = () => speakNext(i + 1);
      utter.onerror = () => {
        if (i + 1 < queue.length) speakNext(i + 1);
        else setPlaying(false);
      };
      window.speechSynthesis.speak(utter);
    };
    if (keepAliveRef.current) window.clearInterval(keepAliveRef.current);
    keepAliveRef.current = window.setInterval(() => {
      if (window.speechSynthesis.speaking) window.speechSynthesis.resume();
    }, 8000);
    window.speechSynthesis.resume();
    speakNext(0);
  };

  const playAudioBlob = async (blob: Blob) => {
    const audio = audioRef.current;
    if (!audio) throw new Error("no audio element");
    const url = URL.createObjectURL(blob);
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = url;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => setPlaying(false);
    audio.src = url;
    audio.load();
    await audio.play();
  };

  const toggle = async () => {
    if (playing) {
      stop();
      return;
    }
    stop();
    unlockPlayback();
    window.dispatchEvent(new CustomEvent("wikigraph-read", { detail: instanceId }));
    setPlaying(true);
    try {
      const res = await fetch("/api/ai/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: script.text, style: script.style, language: lang }),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (res.ok && ct.includes("audio")) {
        try {
          await playAudioBlob(await res.blob());
          return;
        } catch {
          speakLocal();
          return;
        }
      }
      if (res.ok && ct.includes("json")) {
        const data = (await res.json()) as { text?: string };
        if (data.text) {
          speakLocal(data.text);
          return;
        }
      }
    } catch {
      /* fall back to device voices */
    }
    speakLocal();
  };

  const current = READ_LANGS.find((l) => l.id === lang)!;
  const listenLabel = playing ? "Stop" : `Listen · ${current.native}`;

  const langPills = (compact: boolean) => (
    <div
      role="radiogroup"
      aria-label="Listen language"
      className={cn(
        "inline-flex items-center rounded-full p-0.5",
        compact
          ? "hidden sm:inline-flex bg-white/[0.06] ring-1 ring-white/10"
          : "bg-white/10 ring-1 ring-white/12",
      )}
    >
      {READ_LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          role="radio"
          aria-checked={lang === l.id}
          title={`${l.english} — native speaker`}
          onClick={() => chooseLang(l.id)}
          className={cn(
            "cursor-pointer rounded-full px-2 py-0.5 font-semibold transition-colors",
            compact ? "text-[10px] sm:text-[11px]" : "text-[11px] px-2.5 py-1",
            lang === l.id
              ? "bg-amber-300 text-slate-950"
              : compact
                ? "text-slate-400 hover:text-white"
                : "text-white/70 hover:text-white",
          )}
        >
          {l.native}
        </button>
      ))}
    </div>
  );

  if (variant === "header") {
    return (
      <div className="inline-flex items-center gap-1">
        <audio ref={audioRef} className="hidden" preload="auto" playsInline />
        {langPills(true)}
        <button
          type="button"
          onClick={() => void toggle()}
          title={playing ? "Stop reading" : `Listen as a native ${current.english} speaker`}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg border px-2 sm:px-2.5 py-1.5 text-[11px] sm:text-[12px] font-medium cursor-pointer transition-colors",
            playing
              ? "border-amber-300/40 bg-amber-300 text-slate-950"
              : "border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white",
          )}
        >
          {playing ? <Square className="size-3.5 shrink-0" /> : <Volume2 className="size-3.5 shrink-0" />}
          <span className="hidden lg:inline">{playing ? "Stop" : "Listen"}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <audio ref={audioRef} className="hidden" preload="auto" playsInline />
      <button
        type="button"
        onClick={() => void toggle()}
        title={playing ? "Stop reading" : `Listen as a native ${current.english} speaker`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold cursor-pointer transition-colors",
          playing
            ? "bg-amber-300 text-slate-950"
            : "bg-white/10 text-white/85 ring-1 ring-white/12 hover:bg-white/16",
        )}
      >
        {playing ? <Square className="size-3.5" /> : <Volume2 className="size-3.5" />}
        {listenLabel}
      </button>
      {langPills(false)}
    </div>
  );
}
