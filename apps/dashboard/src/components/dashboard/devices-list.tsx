"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { Laptop, Monitor, Terminal } from "lucide-react";
import { api } from "@codex-tracker/backend/convex/_generated/api";
import type { Id } from "@codex-tracker/backend/convex/_generated/dataModel";
import { formatTokens, formatUSD } from "@codex-tracker/shared/format";
import { useMe } from "@/hooks/use-me";
import { useNow } from "@/hooks/use-now";
import { fmtDate, fmtRelative } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { EmptyState } from "@/components/ui/empty-state";
import { LiveDot } from "@/components/ui/live-dot";
import { Skeleton } from "@/components/ui/skeleton";

export interface DeviceLive {
  sessionId: string | null;
  model: string | null;
  tokensPerSecond: number;
  lastEventAt: number | null;
  todayTotal: number;
  todayCost: number;
  updatedAt: number;
}

export interface DeviceItem {
  id: string;
  name: string;
  platform: string;
  hostname: string | null;
  appVersion: string | null;
  timezone: string | null;
  createdAt: number;
  lastSeenAt: number;
  live: DeviceLive | null;
  /** Active tokens for this machine — 2 when both the tray app and the headless agent ran `login`. */
  logins?: number;
}

const LIVE_WINDOW_MS = 2 * 60 * 1000;

function PlatformIcon({ platform }: { platform: string }) {
  if (platform.startsWith("darwin")) return <Laptop size={16} />;
  if (platform.startsWith("win")) return <Monitor size={16} />;
  return <Terminal size={16} />;
}

interface ListProps {
  devices: DeviceItem[] | undefined;
  compact?: boolean;
  /** When provided, each device gets a revoke action (confirmed inline). */
  onRevoke?: (deviceId: string) => Promise<void>;
  now: number;
}

/** Presentational device list; `MyDevices` wires it to Convex. */
export function DevicesList({ devices, compact = false, onRevoke, now }: ListProps) {
  const t = useTranslations("devices");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (devices === undefined) {
    return (
      <div className="space-y-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }
  if (!devices.length) {
    return <EmptyState title={t("empty")} body={t("connectHint")} action={compact ? null : <CodeBlock code="npm i -g codex-token-tracker && codex-tracker login" />} />;
  }
  return (
    <ul className="space-y-2">
      {devices.map((d) => {
        const live = d.live && now - d.live.updatedAt < LIVE_WINDOW_MS ? d.live : null;
        return (
          <Card as="li" key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3" interactive>
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card-2 text-fg-2">
              <PlatformIcon platform={d.platform} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-medium text-fg">{d.name}</span>
                <Badge variant="muted">{d.platform}</Badge>
                {d.appVersion ? <Badge variant="muted">v{d.appVersion}</Badge> : null}
                {d.logins && d.logins > 1 ? (
                  <Badge variant="muted" title={t("loginsHint")}>
                    {t("logins", { count: d.logins })}
                  </Badge>
                ) : null}
                {live ? (
                  <Badge variant="success">
                    <LiveDot size={6} /> {live.sessionId ? t("liveSession") : t("idle")}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                {d.hostname ? <span>{d.hostname}</span> : null}
                {d.timezone ? <span>{d.timezone}</span> : null}
                <span>
                  {t("lastSeen")}: {fmtRelative(d.lastSeenAt, now, locale)}
                </span>
                <span>
                  {t("added")}: {fmtDate(d.createdAt, locale)}
                </span>
              </div>
              {live ? (
                <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-fg-2 tabular">
                  {live.model ? <span className="font-mono">{live.model}</span> : null}
                  <span>{live.tokensPerSecond.toFixed(1)} tok/s</span>
                  <span>
                    {tc("today")}: {formatTokens(live.todayTotal)} · {formatUSD(live.todayCost)}
                  </span>
                </div>
              ) : null}
            </div>
            {onRevoke && !compact ? (
              confirming === d.id ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="max-w-[240px] text-fg-2">{t("revokeConfirm")}</span>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy === d.id}
                    onClick={async () => {
                      setBusy(d.id);
                      try {
                        await onRevoke(d.id);
                      } finally {
                        setBusy(null);
                        setConfirming(null);
                      }
                    }}
                  >
                    {tc("confirm")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                    {tc("cancel")}
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirming(d.id)}>
                  {t("revoke")}
                </Button>
              )
            ) : null}
          </Card>
        );
      })}
    </ul>
  );
}

/** The signed-in user's devices, live from Convex. */
export function MyDevices({ compact = false }: { compact?: boolean }) {
  const now = useNow(30_000);
  const { ready } = useMe();
  const devices = useQuery(api.usage.myDevices, ready ? {} : "skip");
  const revoke = useMutation(api.usage.revokeDevice);
  return <DevicesList devices={devices} compact={compact} now={now} onRevoke={compact ? undefined : (id) => revoke({ deviceId: id as Id<"devices"> }).then(() => undefined)} />;
}
