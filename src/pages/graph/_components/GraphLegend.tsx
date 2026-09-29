import { ENTITY_TYPE_CONFIG } from "@/lib/wikidata/entity-types.ts";
import type { EntityType } from "@/lib/wikidata/types.ts";

const TYPES: EntityType[] = ["person", "place", "organization", "concept", "event", "work"];

export default function GraphLegend() {
  return (
    <div className="flex flex-wrap gap-3">
      {TYPES.map((type) => {
        const cfg = ENTITY_TYPE_CONFIG[type];
        return (
          <div key={type} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-[3px] border"
              style={{ background: `${cfg.hex}30`, borderColor: cfg.hex }}
            />
            <span className="text-[10px] text-slate-500">{cfg.label}</span>
          </div>
        );
      })}
    </div>
  );
}
