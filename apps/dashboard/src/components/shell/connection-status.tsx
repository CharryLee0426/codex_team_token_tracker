"use client";

import { useConvexConnectionState } from "convex/react";
import { useTranslations } from "next-intl";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";

/** Realtime link indicator: the Convex WebSocket state, rendered as a quiet telemetry readout. */
export function ConnectionStatus({ compact = false, className }: { compact?: boolean; className?: string }) {
  const t = useTranslations("shell");
  const state = useConvexConnectionState();
  // The socket may already be open by the time we hydrate; render the readout client-side only.
  const mounted = useMounted();
  const online = mounted && state.isWebSocketConnected;
  const label = !mounted ? t("linkConnecting") : online ? t("linkOnline") : state.hasEverConnected ? t("linkReconnecting") : t("linkConnecting");
  return (
    <div className={cn("flex items-center gap-2 text-[11px] text-muted", className)} role="status" aria-live="polite" title={label}>
      <span className="relative inline-flex h-2 w-2 shrink-0">
        <span className={cn("absolute inset-0 rounded-full", online ? "bg-success live-dot text-success" : "bg-warning")} />
      </span>
      {!compact ? <span className="eyebrow truncate">{label}</span> : <span className="sr-only">{label}</span>}
    </div>
  );
}
