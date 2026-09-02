import { ConvexHttpClient } from "convex/browser";
import { api } from "@codex-tracker/backend/convex/_generated/api";
import { backendSupports, clearState, updateConfig, type TrackerConfig } from "./config";
import { deviceName, hostname, machineId, platformKind, openUrl } from "./platform";
import { resolveConvexUrl, errorMessage, WIRE_MACHINE_ID } from "./uploader";

export interface LoginHandlers {
  /** Called once the code is known (print it / show it in the UI). `expiresAt` is when the code stops working. */
  onCode: (code: string, verifyUrl: string, expiresAt: number) => void;
  openBrowser: boolean;
  /** Called after the browser was (or could not be) opened; only when `openBrowser` is set. */
  onBrowser?: (opened: boolean) => void;
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
 * Works without a browser on this machine — the URL/code are handed to `onCode` (the CLI prints them
 * with a QR code) so the approval can be done from a phone or any other computer.
 *
 * The machine id makes a repeat login from this computer (tray app + headless agent, or a re-login)
 * reuse the machine's existing device on the dashboard instead of creating — and double counting — a
 * second one.
 */
export async function deviceLogin(cfg: TrackerConfig, h: LoginHandlers): Promise<LoginResult> {
  const convexUrl = await resolveConvexUrl(cfg, true);
  const client = new ConvexHttpClient(convexUrl);
  const start = await client.mutation(api.deviceAuth.start, {
    deviceName: deviceName(),
    platform: platformKind(),
    hostname: hostname(),
    ...(backendSupports(cfg, WIRE_MACHINE_ID) ? { machineId: machineId() } : {}),
  });
  const url = verifyUrlFor(cfg.dashboardUrl, start.code);
  h.onCode(start.code, url, start.expiresAt);
  if (h.openBrowser) {
    const opened = await openUrl(url);
    h.onBrowser?.(opened);
  }

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
