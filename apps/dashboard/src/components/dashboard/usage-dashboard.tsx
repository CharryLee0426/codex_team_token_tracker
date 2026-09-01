"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { Inbox } from "lucide-react";
import { api } from "@codex-tracker/backend/convex/_generated/api";
import type { Id } from "@codex-tracker/backend/convex/_generated/dataModel";
import { buildHeatmap, groupByLocalDay } from "@codex-tracker/shared/aggregate";
import { addLocalDays, dayKeyToLocalStart, hourStartOf } from "@codex-tracker/shared/time";
import { activeHoursRows, dailyStack, memberStats, modelBreakdown, orderModels, summarize, weekdaySeries } from "@/lib/analytics";
import { rangeBounds, type RangeKey } from "@/lib/ranges";
import { useHourlyRange, type Scope } from "@/hooks/use-hourly-range";
import { useMe } from "@/hooks/use-me";
import { useNow } from "@/hooks/use-now";
import { useChartTheme } from "@/components/charts/use-chart-theme";
import { UsageOverTime } from "@/components/charts/usage-over-time";
import { ContributionHeatmap } from "@/components/charts/contribution-heatmap";
import { ActiveHoursHeatmap } from "@/components/charts/active-hours-heatmap";
import { WeekdayComparison } from "@/components/charts/weekday-comparison";
import { ModelDistribution } from "@/components/charts/model-distribution";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageTitle } from "@/components/ui/page-title";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RangeControl } from "./range-control";
import { KpiRow } from "./kpi-row";
import { Leaderboard } from "./leaderboard";
import { RecentSessions } from "./recent-sessions";
import { DevicesList } from "./devices-list";

const RANGE_STORAGE = "codex-tracker:range";
const RANGE_VALUES: RangeKey[] = ["today", "7d", "30d", "90d", "365d"];

interface Props {
  scope: Scope;
  orgId?: Id<"orgs">;
  orgName?: string;
}

export function UsageDashboard({ scope, orgId, orgName }: Props) {
  const t = useTranslations();
  const theme = useChartTheme();
  const now = useNow(60_000);
  const { me, ready } = useMe();

  const [range, setRange] = useState<RangeKey>("30d");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RANGE_STORAGE);
      if (saved && (RANGE_VALUES as string[]).includes(saved)) setRange(saved as RangeKey);
    } catch {
      /* ignore */
    }
  }, []);
  const changeRange = useCallback((k: RangeKey) => {
    setRange(k);
    try {
      localStorage.setItem(RANGE_STORAGE, k);
    } catch {
      /* ignore */
    }
  }, []);

  // Range + heatmap span (26 weeks, or 53 for the 1-year view). One live subscription covers both.
  const hourTick = hourStartOf(now);
  const bounds = useMemo(() => rangeBounds(range, hourTick), [range, hourTick]);
  const weeks = range === "365d" ? 53 : 26;
  const spanDays = Math.max(bounds.days, weeks * 7);
  const spanFromKey = addLocalDays(bounds.toKey, -(spanDays - 1));
  const spanFromMs = hourStartOf(dayKeyToLocalStart(spanFromKey));

  const data = useHourlyRange(scope, orgId, spanFromMs, bounds.toMs, ready);
  const liveNow = useQuery(api.usage.liveNow, ready && (scope === "personal" || orgId) ? (scope === "team" ? { scope, orgId } : { scope }) : "skip");
  const sessions = useQuery(api.usage.recentSessions, ready && (scope === "personal" || orgId) ? (scope === "team" ? { scope, orgId, limit: 12 } : { scope, limit: 12 }) : "skip");
  const devices = useQuery(api.usage.myDevices, ready && scope === "personal" ? {} : "skip");

  const rangeRows = useMemo(() => data.rows.filter((r) => r.hourStart >= bounds.fromMs), [data.rows, bounds.fromMs]);
  const summary = useMemo(() => summarize(rangeRows), [rangeRows]);
  const stats = useMemo(() => modelBreakdown(rangeRows), [rangeRows]);

  // Stable series → color assignment: never repaints a model once it has a slot.
  const orderRef = useRef<string[]>([]);
  const series = useMemo(() => {
    const next = orderModels(stats, orderRef.current);
    orderRef.current = next;
    return next;
  }, [stats]);
  const colorOf = useCallback((model: string) => theme.colorAt(series.indexOf(model)), [series, theme]);

  const daily = useMemo(() => dailyStack(rangeRows, bounds.fromKey, bounds.toKey, series), [rangeRows, bounds.fromKey, bounds.toKey, series]);
  const weekday = useMemo(() => weekdaySeries(rangeRows, bounds.fromKey, bounds.toKey), [rangeRows, bounds.fromKey, bounds.toKey]);
  const active = useMemo(() => activeHoursRows(rangeRows), [rangeRows]);
  const heat = useMemo(() => buildHeatmap(groupByLocalDay(data.rows), bounds.toKey, weeks), [data.rows, bounds.toKey, weeks]);
  const members = useMemo(() => (scope === "team" ? memberStats(rangeRows) : []), [scope, rangeRows]);
  const liveUserIds = useMemo(() => new Set((liveNow ?? []).map((l) => l.user.id)), [liveNow]);
  const [modelView, setModelView] = useState<"chart" | "table">("chart");

  const loading = !ready || data.loading;
  const empty = !loading && data.active && data.rows.length === 0;

  return (
    <div className="space-y-4">
      <PageTitle
        title={scope === "team" ? t("team.title") : t("personal.title")}
        subtitle={scope === "team" ? t("team.subtitle", { org: orgName ?? "" }) : t("personal.subtitle")}
        action={<RangeControl value={range} onChange={changeRange} />}
      />

      {data.error ? (
        <Card className="p-4 text-sm text-danger">{String(data.error.message ?? data.error)}</Card>
      ) : null}

      <KpiRow summary={summary} loading={loading} scope={scope} liveCount={liveNow?.length ?? 0} deviceCount={devices?.length} />

      {empty ? (
        <Card>
          <EmptyState
            icon={<Inbox size={28} />}
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

      <Card>
        <CardHeader title={t("charts.usageOverTime")} hint={t("charts.usageOverTimeHint")} />
        <CardBody>{loading ? <Skeleton className="h-64" /> : <UsageOverTime data={daily} series={series} colorOf={colorOf} />}</CardBody>
      </Card>

      <Card>
        <CardHeader title={t("charts.heatmap")} hint={t("charts.heatmapHint")} />
        <CardBody>{loading ? <Skeleton className="h-32" /> : <ContributionHeatmap grid={heat} />}</CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={t("charts.activeHours")} hint={t("charts.activeHoursHint")} />
          <CardBody>{loading ? <Skeleton className="h-44" /> : <ActiveHoursHeatmap rows={active} />}</CardBody>
        </Card>
        <Card>
          <CardHeader title={t("charts.weekday")} hint={t("charts.weekdayHint")} />
          <CardBody>{loading ? <Skeleton className="h-64" /> : <WeekdayComparison data={weekday} />}</CardBody>
        </Card>
      </div>

      <div className={cn("grid gap-4", scope === "team" ? "xl:grid-cols-5" : "xl:grid-cols-2")}>
        <Card className={scope === "team" ? "xl:col-span-2" : ""}>
          <CardHeader
            title={t("charts.modelDist")}
            hint={t("charts.modelDistHint")}
            action={
              <div className="inline-flex rounded-md border border-border p-0.5">
                {(["chart", "table"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setModelView(v)}
                    className={cn("h-6 rounded px-2 text-[11px] font-medium", modelView === v ? "bg-accent-soft text-accent" : "text-fg-2")}
                    aria-pressed={modelView === v}
                  >
                    {t(`common.${v}`)}
                  </button>
                ))}
              </div>
            }
          />
          <CardBody>
            {loading ? (
              <Skeleton className="h-48" />
            ) : stats.length ? (
              <ModelDistribution stats={stats} series={series} colorOf={colorOf} view={modelView} />
            ) : (
              <EmptyState title={t("charts.noData")} className="py-8" />
            )}
          </CardBody>
        </Card>
        {scope === "team" ? (
          <Card className="xl:col-span-3">
            <CardHeader title={t("members.leaderboard")} hint={t("members.leaderboardHint")} />
            {loading ? (
              <CardBody>
                <Skeleton className="h-40" />
              </CardBody>
            ) : (
              <Leaderboard stats={members} users={data.users} liveUserIds={liveUserIds} meId={me?.id ?? null} now={now} />
            )}
          </Card>
        ) : (
          <Card>
            <CardHeader
              title={t("devices.title")}
              hint={t("devices.subtitle")}
              action={
                <Link href="/dashboard/devices" className={buttonClasses("ghost", "sm")}>
                  {t("nav.devices")} →
                </Link>
              }
            />
            <CardBody>
              <DevicesList compact />
            </CardBody>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader title={t("sessions.title")} hint={t("sessions.subtitle")} />
        <RecentSessions sessions={ready ? sessions : undefined} scope={scope} now={now} />
      </Card>
    </div>
  );
}
