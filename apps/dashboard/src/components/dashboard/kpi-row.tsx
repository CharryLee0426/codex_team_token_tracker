"use client";

import { useTranslations } from "next-intl";
import { formatInt, formatPercent, formatTokens, formatUSD } from "@codex-tracker/shared/format";
import type { UsageModel } from "@/lib/usage-model";
import { StatTile } from "@/components/ui/stat-tile";
import { LiveDot } from "@/components/ui/live-dot";
import { cn } from "@/lib/utils";

interface Props {
  model: UsageModel | null;
  loading: boolean;
  scope: "personal" | "team";
  liveCount: number;
  deviceCount?: number;
  className?: string;
}

const TREND_POINTS = 30;

/** The figures row: total tokens is the hero (with its daily trend), the rest support it. */
export function KpiRow({ model, loading, scope, liveCount, deviceCount, className }: Props) {
  const t = useTranslations("kpi");
  const u = model?.summary.usage;
  const trend = model ? model.dailyTotals.slice(-TREND_POINTS) : [];
  return (
    <div className={cn("grid grid-cols-2 gap-3 @2xl:grid-cols-3 @6xl:grid-cols-7", className)}>
      <StatTile
        hero
        className="col-span-2 @2xl:col-span-1 @6xl:col-span-2"
        label={t("totalTokens")}
        value={u?.total ?? 0}
        format={formatTokens}
        loading={loading}
        trend={trend}
        sub={u ? t("inputOutput", { input: formatTokens(u.input), output: formatTokens(u.output) }) : undefined}
      />
      <StatTile label={t("cost")} value={model?.summary.cost ?? 0} format={formatUSD} hint={t("costHint")} loading={loading} sub={t("costHint")} />
      <StatTile
        label={t("cacheHit")}
        value={model?.summary.cacheHit ?? 0}
        format={(n) => formatPercent(n)}
        hint={t("cacheHitHint")}
        loading={loading}
        meter={model?.summary.cacheHit ?? 0}
        sub={u ? t("cachedTokens", { tokens: formatTokens(u.cached) }) : undefined}
      />
      <StatTile
        label={t("requests")}
        value={u?.requests ?? 0}
        format={formatInt}
        loading={loading}
        sub={u?.requests ? t("perRequest", { tokens: formatTokens(u.total / u.requests) }) : undefined}
      />
      {scope === "team" ? (
        <StatTile label={t("activeMembers")} value={model?.summary.activeUsers ?? 0} format={formatInt} hint={t("activeMembersHint")} loading={loading} sub={t("activeMembersHint")} />
      ) : (
        <StatTile label={t("devices")} value={deviceCount ?? 0} format={formatInt} loading={loading && deviceCount === undefined} sub={t("devicesHint")} />
      )}
      <StatTile
        className="col-span-2 @2xl:col-span-1"
        label={t("liveNow")}
        value={liveCount}
        format={formatInt}
        hint={t("liveNowHint")}
        sub={t("liveNowHint")}
        accent={liveCount > 0 ? <LiveDot /> : undefined}
      />
    </div>
  );
}
