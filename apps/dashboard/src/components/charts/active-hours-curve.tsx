"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLocale, useTranslations } from "next-intl";
import { formatTokens } from "@codex-tracker/shared/format";
import type { ActiveHoursDay } from "@/lib/analytics";
import { fmtDayKey } from "@/lib/format";
import { useChartTheme } from "./use-chart-theme";
import { useFirstRenderAnimation } from "./use-first-render-animation";
import { TooltipBox, TooltipRow } from "./chart-tooltip";
import { SeriesLegend } from "./series-legend";

/** One hourly curve per selected local date, with a shared 00–23 hour axis. */
export function ActiveHoursCurve({ days }: { days: ActiveHoursDay[] }) {
  const theme = useChartTheme();
  const locale = useLocale();
  const t = useTranslations("charts");
  const tc = useTranslations("common");
  const { animate, duration } = useFirstRenderAnimation();
  const series = days.map((day, i) => ({
    key: `d${i}`,
    name: fmtDayKey(day.day, locale, { weekday: "short", month: "short", day: "numeric" }),
    color: theme.colorAt(i),
  }));
  const rows = Array.from({ length: 24 }, (_, hour) => {
    const row: Record<string, number> = { hour };
    days.forEach((day, i) => (row[`d${i}`] = day.hours[hour]));
    return row;
  });

  return (
    <div>
      <div className="h-56 w-full sm:h-64" role="group" aria-label={t("activeHours")}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="hour" type="number" domain={[0, 23]} ticks={[0, 6, 12, 18, 23]} tickFormatter={(h: number) => t("hour", { hour: String(h).padStart(2, "0") })} tick={{ fontSize: 11, fill: theme.axis }} tickLine={false} axisLine={{ stroke: theme.border }} />
            <YAxis tickFormatter={(v: number) => formatTokens(v, 0)} tick={{ fontSize: 11, fill: theme.axis }} tickLine={false} axisLine={false} width={42} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Record<string, number>;
                return (
                  <TooltipBox title={t("hour", { hour: String(label).padStart(2, "0") })}>
                    {series.map((s) => <TooltipRow key={s.key} color={s.color} label={s.name} value={`${formatTokens(row[s.key])} ${tc("tokens")}`} />)}
                  </TooltipBox>
                );
              }}
            />
            {series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={2} strokeDasharray={i === 1 ? "6 3" : i === 2 ? "2 3" : undefined} dot={false} activeDot={{ r: 4 }} isAnimationActive={animate} animationDuration={duration} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <SeriesLegend items={series} />
    </div>
  );
}
