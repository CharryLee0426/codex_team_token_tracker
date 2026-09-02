"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Inbox, ArrowUpRight } from "lucide-react";
import type { PublicUser, Scope } from "@/hooks/use-hourly-range";
import type { RangeKey } from "@/lib/ranges";
import type { UsageModel } from "@/lib/usage-model";
import { useChartTheme } from "@/components/charts/use-chart-theme";
import { ChartCard } from "@/components/charts/chart-card";
import { UsageOverTime, UsageOverTimeTable } from "@/components/charts/usage-over-time";
import { ContributionHeatmap } from "@/components/charts/contribution-heatmap";
import { ActiveHoursHeatmap } from "@/components/charts/active-hours-heatmap";
import { WeekdayComparison, WeekdayTable } from "@/components/charts/weekday-comparison";
import { ModelDistribution, ModelTable } from "@/components/charts/model-distribution";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RangeControl } from "./range-control";
import { KpiRow } from "./kpi-row";
import { Leaderboard } from "./leaderboard";
import { RecentSessions, type SessionItem } from "./recent-sessions";
import { DevicesList, type DeviceItem } from "./devices-list";
import { SourcesBreakdown } from "./sources-breakdown";

export interface UsageDashboardViewProps {
  scope: Scope;
  orgName?: string;
  range: RangeKey;
  onRangeChange: (k: RangeKey) => void;
  model: UsageModel | null;
  users: Map<string, PublicUser>;
  loading: boolean;
  stale: boolean;
  error: Error | null;
  empty: boolean;
  liveCount: number;
  liveUserIds: Set<string>;
  deviceCount?: number;
  sessions: SessionItem[] | undefined;
  devices?: DeviceItem[];
  meId: string | null;
  now: number;
  /** Landing-page preview: no page header, sessions or sources; a shorter board. */
  preview?: boolean;
}

/**
 * Pure usage view: everything is passed in, so the same board renders live data on the dashboard,
 * sample data on the landing page and in the design-preview harness.
 */
export function UsageDashboardView(p: UsageDashboardViewProps) {
  const t = useTranslations();
  const theme = useChartTheme();
  const { model, loading, stale, scope } = p;
  const series = model?.series ?? [];
  const colorOf = (m: string) => theme.colorAt(series.indexOf(m));
  const hasRows = !!model && model.rangeRows.length > 0;

  return (
    <div className={cn("@container space-y-4", !p.preview && "space-y-5")}>
      {!p.preview ? (
        <PageHeader
          eyebrow={scope === "team" ? (p.orgName ?? t("nav.team")) : t("nav.personal")}
          title={scope === "team" ? t("team.title") : t("personal.title")}
          subtitle={scope === "team" ? t("team.subtitle", { org: p.orgName ?? "" }) : t("personal.subtitle")}
          actions={<RangeControl value={p.range} onChange={p.onRangeChange} />}
        />
      ) : (
        <div className="flex items-center justify-end">
          <RangeControl value={p.range} onChange={p.onRangeChange} />
        </div>
      )}

      {p.error ? <Card className="p-4 text-sm text-danger">{String(p.error.message ?? p.error)}</Card> : null}

      <KpiRow model={model} loading={loading} scope={scope} liveCount={p.liveCount} deviceCount={p.deviceCount} />

      {!p.preview && model ? <SourcesBreakdown stats={model.agents} /> : null}

      {p.empty && !p.preview ? (
        <Card>
          <EmptyState
            icon={<Inbox size={20} />}
            title={t("empty.title")}
            body={t("empty.body")}
            action={
              <Link href="/settings" className={buttonClasses("primary", "sm")}>
                {t("empty.cta")}
              </Link>
            }
          />
        </Card>
      ) : null}

      <ChartCard
        title={t("charts.usageOverTime")}
        hint={t("charts.usageOverTimeHint")}
        loading={loading}
        stale={stale}
        hasData={hasRows}
        table={model ? <UsageOverTimeTable data={model.daily} /> : null}
      >
        {model ? <UsageOverTime data={model.daily} series={series} colorOf={colorOf} /> : null}
      </ChartCard>

      <ChartCard title={t("charts.heatmap")} hint={t("charts.heatmapHint")} loading={loading} stale={stale} hasData={!!model} skeletonClassName="h-32">
        {model ? <ContributionHeatmap grid={model.heat} /> : null}
      </ChartCard>

      <div className="grid gap-4 @4xl:grid-cols-3">
        <ChartCard className="@4xl:col-span-2" title={t("charts.activeHours")} hint={t("charts.activeHoursHint")} loading={loading} stale={stale} hasData={hasRows} skeletonClassName="h-44">
          {model ? <ActiveHoursHeatmap rows={model.active} /> : null}
        </ChartCard>
        <ChartCard
          title={t("charts.weekday")}
          hint={t("charts.weekdayHint")}
          loading={loading}
          stale={stale}
          hasData={hasRows}
          table={model ? <WeekdayTable data={model.weekday} /> : null}
        >
          {model ? <WeekdayComparison data={model.weekday} /> : null}
        </ChartCard>
      </div>

      <div className={cn("grid gap-4", scope === "team" ? "@4xl:grid-cols-5" : "@4xl:grid-cols-2")}>
        <ChartCard
          className={scope === "team" ? "@4xl:col-span-2" : undefined}
          title={t("charts.modelDist")}
          hint={t("charts.modelDistHint")}
          loading={loading}
          stale={stale}
          hasData={!!model && model.stats.length > 0}
          skeletonClassName="h-48"
          table={model ? <ModelTable stats={model.stats} series={series} colorOf={colorOf} /> : null}
        >
          {model ? <ModelDistribution stats={model.stats} series={series} colorOf={colorOf} /> : null}
        </ChartCard>
        {scope === "team" ? (
          <Card className="@4xl:col-span-3" stale={stale}>
            <CardHeader title={t("members.leaderboard")} hint={t("members.leaderboardHint")} />
            {loading || !model ? (
              <CardBody>
                <Skeleton className="h-40" />
              </CardBody>
            ) : (
              <Leaderboard stats={model.members} users={p.users} liveUserIds={p.liveUserIds} meId={p.meId} now={p.now} />
            )}
          </Card>
        ) : (
          <Card>
            <CardHeader
              title={t("devices.title")}
              hint={t("devices.subtitle")}
              action={
                !p.preview ? (
                  <Link href="/dashboard/devices" className={buttonClasses("ghost", "sm")}>
                    {t("nav.devices")} <ArrowUpRight size={14} />
                  </Link>
                ) : undefined
              }
            />
            <CardBody>
              <DevicesList devices={p.devices} compact now={p.now} />
            </CardBody>
          </Card>
        )}
      </div>

      {!p.preview ? (
        <Card>
          <CardHeader title={t("sessions.title")} hint={t("sessions.subtitle")} />
          <RecentSessions sessions={p.sessions} scope={scope} now={p.now} />
        </Card>
      ) : null}
    </div>
  );
}
