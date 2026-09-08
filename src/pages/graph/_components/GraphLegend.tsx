import { ENTITY_TYPE_CONFIG } from "@/lib/wikidata/entity-types.ts";
import type { EntityType } from "@/lib/wikidata/types.ts";

const TYPES: EntityType[] = ["person", "place", "organization", "concept", "event", "work"];

export default function GraphLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {TYPES.map((type) => {
        const cfg = ENTITY_TYPE_CONFIG[type];
        return (
          <div key={type} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-full border"
              style={{ background: `${cfg.hex}30`, borderColor: cfg.hex }}
            />
            <span className="text-[10px] text-muted-foreground">{cfg.label}</span>
          </div>
        );
      })}
    </div>
  );
}
