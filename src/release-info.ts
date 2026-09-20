/** Auto-updated by `./deploy/deploy-vps.sh` — do not edit by hand for production releases. */
export const RELEASE = {
  name: "ontology",
  version: "0.0.6",
  /** ISO-8601 UTC (browser formats this to local time in the console) */
  releasedAt: "2026-09-18T20:11:48.000Z",
  /** Stamp from the machine that ran the deploy script */
  releasedAtLocal: "2026-09-19 01:41:48 +0530",
} as const;

export type ReleaseInfo = typeof RELEASE;
