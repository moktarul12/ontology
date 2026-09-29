/** Auto-updated by `./deploy/deploy-vps.sh` — do not edit by hand for production releases. */
export const RELEASE = {
  name: "ontology",
  version: "0.0.8",
  /** ISO-8601 UTC (browser formats this to local time in the console) */
  releasedAt: "2026-09-29T19:21:42.000Z",
  /** Stamp from the machine that ran the deploy script */
  releasedAtLocal: "2026-09-30 00:51:42 +0530",
} as const;

export type ReleaseInfo = typeof RELEASE;
