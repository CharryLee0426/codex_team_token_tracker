/**
 * "One device per machine" helpers shared by the tracker, the Convex backend and the dashboard.
 *
 * A device row used to be created on every `codex-tracker login`, so a machine that signed in twice —
 * the menu bar app and the headless agent, or simply a re-login — uploaded its whole history under two
 * device ids and was counted twice. Now every login carries a hashed hardware identity (`machineId`);
 * the backend keeps one canonical device per (user, machineId) and folds further logins into it.
 *
 * Devices created before 0.3.0 have no machineId. Those are recognised by their usage instead: two
 * device rows that report *identical* token counts for the same hours can only be reading the same
 * transcripts — a different computer never produces the same (hour, model, agent, tokens, requests)
 * tuples for hours on end — so such a pair is merged as well.
 */

/** Prefix of every machineId so the backend can tell a hashed identity from anything else. */
export const MACHINE_ID_PREFIX = "m1_";
export const MACHINE_ID_MAX_LENGTH = 64;

export function isMachineId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(MACHINE_ID_PREFIX) && value.length <= MACHINE_ID_MAX_LENGTH && /^[A-Za-z0-9_-]+$/.test(value);
}

/** Hostnames as seen from Windows, WSL and macOS differ in case and in a `.local` suffix; compare them loosely. */
export function normalizeHostname(host: string | null | undefined): string {
  if (!host) return "";
  return host
    .trim()
    .toLowerCase()
    .replace(/\.(local|localdomain|lan|home)$/, "")
    .replace(/\s*\(.*\)\s*$/, ""); // device names are "<host> (<platform>)"
}

/** Everything the overlap test needs from one hourly row. */
export interface HourFingerprint {
  hourStart: number;
  total: number;
  requests: number;
  /** `${agent}|${model}` → total tokens. */
  models: Array<{ agent: string; model: string; total: number; requests: number }>;
}

export interface OverlapVerdict {
  /** Hours present on both devices. */
  compared: number;
  /** Of those, hours whose counts were identical. */
  matched: number;
  same: boolean;
}

/** At least this many overlapping hours must exist before two rows can be called the same machine … */
export const OVERLAP_MIN_HOURS = 3;
/** … and at least this share of them must be identical (the last hour may differ while one side is still uploading). */
export const OVERLAP_MIN_RATIO = 0.8;

function fingerprintKey(f: HourFingerprint): string {
  const models = f.models
    .map((m) => `${m.agent}|${m.model}|${m.total}|${m.requests}`)
    .sort()
    .join(";");
  return `${f.total}|${f.requests}|${models}`;
}

/**
 * Decide whether two devices are the same machine from their hourly rows. `pairs` holds one entry per
 * hour of the probe device; `other` is the second device's row for the same hour, or null when it has
 * none. Hours only one side knows about are ignored — they say nothing either way.
 */
export function usageOverlapVerdict(pairs: Array<{ probe: HourFingerprint; other: HourFingerprint | null }>): OverlapVerdict {
  let compared = 0;
  let matched = 0;
  for (const { probe, other } of pairs) {
    if (!other || other.hourStart !== probe.hourStart) continue;
    if (probe.total <= 0 && other.total <= 0) continue; // an empty hour is no evidence
    compared++;
    if (fingerprintKey(probe) === fingerprintKey(other)) matched++;
  }
  const same = compared >= OVERLAP_MIN_HOURS && matched / compared >= OVERLAP_MIN_RATIO;
  return { compared, matched, same };
}
