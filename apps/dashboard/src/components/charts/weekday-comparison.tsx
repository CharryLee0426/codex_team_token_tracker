"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslations } from "next-intl";
import { formatTokens, formatUSD } from "@codex-tracker/shared/format";
import type { WeekdayPoint } from "@/lib/analytics";
import { useChartTheme } from "./use-chart-theme";
import { TooltipBox, TooltipRow } from "./chart-tooltip";

export function WeekdayComparison({ data }: { data: WeekdayPoint[] }) {
  const theme = useChartTheme();
  const tw = useTranslations("weekdays.short");
  const tl = useTranslations("weekdays.long");
  const t = useTranslations("charts");
  const tc = useTranslations("common");
  const max = Math.max(...data.map((d) => d.total), 0);
  const rows = data.map((d) => ({ ...d, label: tw(String(d.weekday)) }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={10}>
          <CartesianGrid vertical={false} stroke={theme.grid} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: theme.axis }} tickLine={false} axisLine={{ stroke: theme.border }} />
          <YAxis tickFormatter={(v: number) => formatTokens(v, 1)} tick={{ fontSize: 11, fill: theme.axis }} tickLine={false} axisLine={false} width={46} />
          <Tooltip
            cursor={{ fill: theme.dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as WeekdayPoint;
              return (
                <TooltipBox title={tl(String(d.weekday))}>
                  <TooltipRow label={tc("total")} value={formatTokens(d.total)} />
                  <TooltipRow label={t("avgPerDay", { weekday: tw(String(d.weekday)) })} value={formatTokens(d.avg)} />
                  <TooltipRow label={tc("cost")} value={formatUSD(d.cost)} muted />
                  <TooltipRow label={t("occurrences", { count: d.days })} value="" muted />
                </TooltipBox>
              );
            }}
          />
          <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={40} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.weekday} fill={r.total === max && max > 0 ? theme.categorical[0] : theme.categorical[0] + "b3"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
