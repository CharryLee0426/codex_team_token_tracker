import { ConvexHttpClient } from "convex/browser";
import { api } from "@codex-tracker/backend/convex/_generated/api";
import { clearState, updateConfig, type TrackerConfig } from "./config";
import { deviceName, hostname, platformKind, openUrl } from "./platform";
import { resolveConvexUrl, errorMessage } from "./uploader";

export interface LoginHandlers {
  /** Called once the code is known (print it / show it in the UI). */
  onCode: (code: string, verifyUrl: string) => void;
  openBrowser: boolean;
  signal?: AbortSignal;
  pollIntervalMs?: number;
}

export type LoginResult =
  | { status: "approved"; user: { name: string | null; email: string | null }; deviceId: string }
  | { status: "denied" | "expired" | "cancelled" };

export function verifyUrlFor(dashboardUrl: string, code: string): string {
  return `${dashboardUrl.replace(/\/+$/, "")}/cli-auth?code=${encodeURIComponent(code)}`;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

/**
 * Device-code login: the dashboard (Clerk: Google / GitHub) approves this device and mints a device token.
 * Works without a browser on this machine — the URL/code are printed for WSL / SSH sessions.
 */
export async function deviceLogin(cfg: TrackerConfig, h: LoginHandlers): Promise<LoginResult> {
  const convexUrl = await resolveConvexUrl(cfg, true);
  const client = new ConvexHttpClient(convexUrl);
  const start = await client.mutation(api.deviceAuth.start, {
    deviceName: deviceName(),
    platform: platformKind(),
    hostname: hostname(),
  });
  const url = verifyUrlFor(cfg.dashboardUrl, start.code);
  h.onCode(start.code, url);
  if (h.openBrowser) void openUrl(url);

  const interval = h.pollIntervalMs ?? 3000;
  while (!h.signal?.aborted) {
    if (Date.now() > start.expiresAt + 60_000) return { status: "expired" };
    await sleep(interval, h.signal);
    if (h.signal?.aborted) break;
    let res: Awaited<ReturnType<typeof client.mutation<typeof api.deviceAuth.poll>>>;
    try {
      res = await client.mutation(api.deviceAuth.poll, { code: start.code, pollSecret: start.pollSecret });
    } catch (err) {
      // transient network error: keep polling
      if (process.env.CODEX_TRACKER_DEBUG) console.error("[auth] poll failed:", errorMessage(err));
      continue;
    }
    if (res.status === "pending") continue;
    if (res.status === "approved") {
      const user = { name: res.user?.name ?? null, email: res.user?.email ?? null };
      updateConfig({ deviceToken: res.token, deviceId: res.deviceId, user, convexUrl });
      clearState(); // new device identity → re-push full history
      return { status: "approved", user, deviceId: res.deviceId };
    }
    if (res.status === "denied") return { status: "denied" };
    return { status: "expired" };
  }
  return { status: "cancelled" };
}

export function logoutDevice() {
  updateConfig({ deviceToken: null, deviceId: null, user: null });
  clearState();
}
