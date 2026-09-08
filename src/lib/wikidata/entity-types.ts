import type { EntityType } from "./types.ts";

export const ENTITY_TYPE_CONFIG = {
  person: {
    label: "Person",
    color: "oklch(0.72 0.18 210)",
    bgClass: "bg-[oklch(0.72_0.18_210/0.15)]",
    textClass: "text-[oklch(0.72_0.18_210)]",
    borderClass: "border-[oklch(0.72_0.18_210/0.4)]",
    hex: "#4DBFEF",
  },
  place: {
    label: "Place",
    color: "oklch(0.68 0.17 145)",
    bgClass: "bg-[oklch(0.68_0.17_145/0.15)]",
    textClass: "text-[oklch(0.68_0.17_145)]",
    borderClass: "border-[oklch(0.68_0.17_145/0.4)]",
    hex: "#4DC48A",
  },
  organization: {
    label: "Organization",
    color: "oklch(0.68 0.2 300)",
    bgClass: "bg-[oklch(0.68_0.2_300/0.15)]",
    textClass: "text-[oklch(0.68_0.2_300)]",
    borderClass: "border-[oklch(0.68_0.2_300/0.4)]",
    hex: "#B46DE8",
  },
  concept: {
    label: "Concept",
    color: "oklch(0.75 0.19 60)",
    bgClass: "bg-[oklch(0.75_0.19_60/0.15)]",
    textClass: "text-[oklch(0.75_0.19_60)]",
    borderClass: "border-[oklch(0.75_0.19_60/0.4)]",
    hex: "#E8B84D",
  },
  event: {
    label: "Event",
    color: "oklch(0.68 0.2 25)",
    bgClass: "bg-[oklch(0.68_0.2_25/0.15)]",
    textClass: "text-[oklch(0.68_0.2_25)]",
    borderClass: "border-[oklch(0.68_0.2_25/0.4)]",
    hex: "#E86B4D",
  },
  work: {
    label: "Work",
    color: "oklch(0.7 0.16 330)",
    bgClass: "bg-[oklch(0.7_0.16_330/0.15)]",
    textClass: "text-[oklch(0.7_0.16_330)]",
    borderClass: "border-[oklch(0.7_0.16_330/0.4)]",
    hex: "#D46EC8",
  },
  unknown: {
    label: "Entity",
    color: "oklch(0.55 0.04 230)",
    bgClass: "bg-muted",
    textClass: "text-muted-foreground",
    borderClass: "border-border",
    hex: "#6B7A9E",
  },
} satisfies Record<EntityType, {
  label: string;
  color: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
  hex: string;
}>;

export function getEntityTypeConfig(type: EntityType) {
  return ENTITY_TYPE_CONFIG[type] ?? ENTITY_TYPE_CONFIG.unknown;
}
