"use client";

import { useTranslations } from "next-intl";
import { formatInt, formatPercent, formatTokens, formatUSD } from "@codex-tracker/shared/format";
import type { Summary } from "@/lib/analytics";
import { StatTile } from "@/components/ui/stat-tile";
import { LiveDot } from "@/components/ui/live-dot";

interface Props {
  summary: Summary;
  loading: boolean;
  scope: "personal" | "team";
  liveCount: number;
  deviceCount?: number;
}

export function KpiRow({ summary, loading, scope, liveCount, deviceCount }: Props) {
  const t = useTranslations("kpi");
  const u = summary.usage;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatTile label={t("totalTokens")} value={formatTokens(u.total)} loading={loading} sub={t("inputOutput", { input: formatTokens(u.input), output: formatTokens(u.output) })} />
      <StatTile label={t("cost")} value={formatUSD(summary.cost)} hint={t("costHint")} loading={loading} sub={t("costHint")} />
      <StatTile label={t("cacheHit")} value={formatPercent(summary.cacheHit)} hint={t("cacheHitHint")} loading={loading} sub={`${formatTokens(u.cached)} ${t("cacheHitHint").toLowerCase().split(" ")[0]}`} />
      <StatTile label={t("requests")} value={formatInt(u.requests)} loading={loading} sub={u.requests ? `${formatTokens(u.total / u.requests)} / req` : undefined} />
      {scope === "team" ? (
        <StatTile label={t("activeMembers")} value={formatInt(summary.activeUsers)} hint={t("activeMembersHint")} loading={loading} sub={t("activeMembersHint")} />
      ) : (
        <StatTile label={t("devices")} value={formatInt(deviceCount ?? 0)} loading={loading && deviceCount === undefined} />
      )}
      <StatTile
        label={t("liveNow")}
        value={formatInt(liveCount)}
        hint={t("liveNowHint")}
        sub={t("liveNowHint")}
        accent={liveCount > 0 ? <LiveDot /> : undefined}
      />
    </div>
  );
}
