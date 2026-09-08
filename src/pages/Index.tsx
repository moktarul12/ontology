import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import SearchBox from "@/components/search/SearchBox.tsx";
import { Network } from "lucide-react";

const EXAMPLE_CHIPS = [
  { label: "Albert Einstein", id: "Q937", type: "person" as const },
  { label: "Leonardo da Vinci", id: "Q762", type: "person" as const },
  { label: "Cleopatra", id: "Q1523", type: "person" as const },
  { label: "Marie Curie", id: "Q7186", type: "person" as const },
  { label: "Tokyo", id: "Q1490", type: "place" as const },
  { label: "NASA", id: "Q23548", type: "organization" as const },
  { label: "Quantum mechanics", id: "Q944", type: "concept" as const },
  { label: "World War II", id: "Q362", type: "event" as const },
];

const TYPE_COLORS: Record<string, string> = {
  person: "oklch(0.72 0.18 210)",
  place: "oklch(0.68 0.17 145)",
  organization: "oklch(0.68 0.2 300)",
  concept: "oklch(0.75 0.19 60)",
  event: "oklch(0.68 0.2 25)",
};

export default function Index() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen overflow-hidden bg-background flex flex-col">
      {/* Atmospheric background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Radial gradient glow */}
        <div
          className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/4 w-[900px] h-[700px] rounded-full opacity-20"
          style={{ background: "radial-gradient(ellipse at center, oklch(0.72 0.18 210) 0%, transparent 70%)" }}
        />
        <div
          className="absolute right-0 bottom-0 w-[600px] h-[500px] rounded-full opacity-10"
          style={{ background: "radial-gradient(ellipse at center, oklch(0.68 0.2 300) 0%, transparent 70%)" }}
        />
        {/* Subtle grid */}
        <svg className="absolute inset-0 w-full h-full opacity-[0.04]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M 48 0 L 0 0 0 48" fill="none" stroke="currentColor" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>
        {/* Floating nodes decoration */}
        <FloatingNodes />
      </div>

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-primary/20 border border-primary/30">
            <Network className="size-4 text-primary" />
          </div>
          <span className="font-serif font-semibold text-base tracking-tight text-foreground">
            Wikigraph
          </span>
        </div>
        <div className="hidden md:flex items-center gap-1 text-xs text-muted-foreground">
          <span>Powered by</span>
          <a
            href="https://www.wikidata.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary/80 hover:text-primary transition-colors"
          >
            Wikidata
          </a>
          <span>&</span>
          <a
            href="https://www.wikipedia.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary/80 hover:text-primary transition-colors"
          >
            Wikipedia
          </a>
        </div>
      </nav>

      {/* Hero */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.25, 0.1, 0.25, 1] as const }}
          className="flex flex-col items-center gap-6 max-w-3xl"
        >
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary"
          >
            <span className="size-1.5 rounded-full bg-primary animate-pulse inline-block" />
            Explore the world's knowledge graph
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.6 }}
            className="font-serif text-5xl font-extrabold tracking-tight text-balance leading-tight md:text-6xl lg:text-7xl"
          >
            Discover{" "}
            <span
              className="bg-clip-text text-transparent"
              style={{ backgroundImage: "linear-gradient(135deg, oklch(0.72 0.18 210), oklch(0.65 0.15 185))" }}
            >
              connections
            </span>
            {" "}in everything
          </motion.h1>

          {/* Subheadline */}
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.5 }}
            className="text-lg text-muted-foreground max-w-xl text-balance leading-relaxed"
          >
            Search any person, place, organization, or concept — then explore it as an interactive
            knowledge graph or family tree, powered by Wikidata.
          </motion.p>

          {/* Search box */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.5 }}
            className="w-full flex justify-center"
          >
            <SearchBox size="lg" autoFocus />
          </motion.div>

          {/* Example chips */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="flex flex-wrap justify-center gap-2"
          >
            <span className="text-xs text-muted-foreground mr-1 self-center">Try:</span>
            {EXAMPLE_CHIPS.map((chip, i) => (
              <motion.button
                key={chip.id}
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.5 + i * 0.04, duration: 0.25 }}
                onClick={() => navigate(`/entity/${chip.id}`)}
                className="rounded-full border px-3 py-1 text-xs font-medium cursor-pointer transition-all duration-150 hover:scale-105 hover:brightness-125"
                style={{
                  borderColor: `${TYPE_COLORS[chip.type]}40`,
                  backgroundColor: `${TYPE_COLORS[chip.type]}12`,
                  color: TYPE_COLORS[chip.type],
                }}
              >
                {chip.label}
              </motion.button>
            ))}
          </motion.div>

        </motion.div>

        {/* Feature highlights */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7, duration: 0.6 }}
          className="mt-24 grid grid-cols-1 gap-4 md:grid-cols-3 max-w-3xl w-full"
        >
          {[
            {
              title: "Entity Overview",
              desc: "Rich profiles with facts, images, and Wikipedia summaries",
              icon: "◎",
              color: "oklch(0.72 0.18 210)",
            },
            {
              title: "Knowledge Graph",
              desc: "Force-directed graph with labeled nodes and relationship edges",
              icon: "⬡",
              color: "oklch(0.68 0.2 300)",
            },
            {
              title: "Family Tree",
              desc: "Hierarchical genealogy view with multi-hop expansion",
              icon: "⬢",
              color: "oklch(0.68 0.17 145)",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm px-5 py-5 text-left"
            >
              <div className="text-2xl mb-3" style={{ color: f.color }}>{f.icon}</div>
              <div className="text-sm font-semibold text-foreground mb-1">{f.title}</div>
              <div className="text-xs text-muted-foreground leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 py-5 text-center text-xs text-muted-foreground/50">
        Data from{" "}
        <a href="https://www.wikidata.org" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">Wikidata</a>
        {" · "}
        <a href="https://en.wikipedia.org" target="_blank" rel="noopener noreferrer" className="hover:text-muted-foreground transition-colors">Wikipedia</a>
        {" · "}
        CC BY-SA
      </footer>
    </div>
  );
}

// ─── Floating animated nodes for background decoration ───────────────────────

function FloatingNodes() {
  const nodes = [
    { x: "8%", y: "20%", delay: 0, color: "oklch(0.72 0.18 210)" },
    { x: "85%", y: "15%", delay: 0.5, color: "oklch(0.68 0.2 300)" },
    { x: "15%", y: "75%", delay: 1, color: "oklch(0.68 0.17 145)" },
    { x: "90%", y: "65%", delay: 1.5, color: "oklch(0.75 0.19 60)" },
    { x: "50%", y: "85%", delay: 0.8, color: "oklch(0.68 0.2 25)" },
    { x: "72%", y: "40%", delay: 0.3, color: "oklch(0.72 0.18 210)" },
    { x: "25%", y: "45%", delay: 1.2, color: "oklch(0.68 0.2 300)" },
  ] as const;

  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
      {nodes.map((n, i) => (
        <motion.circle
          key={i}
          cx={n.x}
          cy={n.y}
          r="0.4"
          fill={n.color}
          opacity={0.4}
          animate={{ opacity: [0.2, 0.5, 0.2], scale: [1, 1.4, 1] }}
          transition={{
            duration: 3 + i * 0.5,
            delay: n.delay,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </svg>
  );
}
