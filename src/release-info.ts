/** Auto-updated by `./deploy/deploy-vps.sh` — do not edit by hand for production releases. */
export const RELEASE = {
  name: "ontology",
  version: "0.0.9",
  /** ISO-8601 UTC (browser formats this to local time in the console) */
  releasedAt: "2026-09-30T04:07:29.000Z",
  /** Stamp from the machine that ran the deploy script */
  releasedAtLocal: "2026-09-30 09:37:29 +0530",
} as const;

export type ReleaseInfo = typeof RELEASE;
