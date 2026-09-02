"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLocale, useTranslations } from "next-intl";
import { formatTokens, formatUSD } from "@codex-tracker/shared/format";
import { fmtDayKey } from "@/lib/format";
import { OTHER_KEY, type DailyStackPoint } from "@/lib/analytics";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useChartTheme } from "./use-chart-theme";
import { useFirstRenderAnimation } from "./use-first-render-animation";
import { TooltipBox, TooltipRow } from "./chart-tooltip";
import { SeriesLegend } from "./series-legend";

interface Props {
  data: DailyStackPoint[];
  series: string[]; // model names in stable color order
  colorOf: (model: string) => string;
}

/** Daily stacked bars by model (local days). Series keys are index-based: recharts treats dots in dataKeys as paths. */
export function UsageOverTime({ data, series, colorOf }: Props) {
  const theme = useChartTheme();
  const locale = useLocale();
  const t = useTranslations("common");
  const { animate, duration } = useFirstRenderAnimation();
  const keys = useMemo(() => {
    const k = series.map((m, i) => ({ key: `s${i}`, name: m, color: colorOf(m) }));
    const hasOther = data.some((d) => (d.values[OTHER_KEY] ?? 0) > 0);
    if (hasOther) k.push({ key: "other", name: t("other"), color: theme.other });
    return k;
  }, [series, colorOf, data, theme.other, t]);
  const rows = useMemo(
    () =>
      data.map((d) => {
        const row: Record<string, number | string> = { day: d.day, total: d.total, cost: d.cost };
        series.forEach((m, i) => (row[`s${i}`] = d.values[m] ?? 0));
        row.other = d.values[OTHER_KEY] ?? 0;
        return row;
      }),
    [data, series],
  );
  const dense = data.length > 45;
  // Gaps scale with the band so 30 bars on a phone stay readable; a 1px surface gap once bands get narrow.
  const gapPct = dense ? "8%" : data.length > 14 ? "18%" : "28%";
  const strokeWidth = data.length > 14 ? 1 : 2;

  return (
    <div>
      <div className="h-56 w-full sm:h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap={gapPct}>
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis
              dataKey="day"
              tickFormatter={(d: string) => fmtDayKey(d, locale)}
              tick={{ fontSize: 11, fill: theme.axis }}
              tickLine={false}
              axisLine={{ stroke: theme.border }}
              minTickGap={36}
              interval="preserveStartEnd"
            />
            <YAxis tickFormatter={(v: number) => formatTokens(v, 0)} tick={{ fontSize: 11, fill: theme.axis }} tickLine={false} axisLine={false} width={42} />
            <Tooltip
              cursor={{ fill: theme.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Record<string, number>;
                const items = [...keys].reverse().filter((k) => (row[k.key] ?? 0) > 0);
                return (
                  <TooltipBox title={fmtDayKey(String(label), locale, { weekday: "short", month: "short", day: "numeric" })}>
                    {items.map((k) => (
                      <TooltipRow key={k.key} color={k.color} label={k.name} value={formatTokens(row[k.key])} />
                    ))}
                    <div className="mt-1 border-t border-border pt-1">
                      <TooltipRow label={t("total")} value={formatTokens(row.total)} />
                      <TooltipRow label={t("cost")} value={formatUSD(row.cost)} muted />
                    </div>
                  </TooltipBox>
                );
              }}
            />
            {keys.map((k) => (
              <Bar
                key={k.key}
                dataKey={k.key}
                name={k.name}
                stackId="stack"
                fill={k.color}
                stroke={theme.surface}
                strokeWidth={strokeWidth}
                maxBarSize={24}
                isAnimationActive={animate}
                animationDuration={duration}
                animationEasing="ease-out"
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {keys.length >= 2 ? <SeriesLegend items={keys.map((k) => ({ name: k.name, color: k.color }))} /> : null}
    </div>
  );
}

/** Table twin: one row per local day. */
export function UsageOverTimeTable({ data }: { data: DailyStackPoint[] }) {
  const locale = useLocale();
  const t = useTranslations("common");
  const tc = useTranslations("charts");
  const rows = [...data].reverse().filter((d) => d.total > 0);
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>{tc("day")}</Th>
            <Th right>{t("tokens")}</Th>
            <Th right>{t("cost")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.day} className="hover:bg-card-2/60">
              <Td primary className="font-medium text-fg">
                {fmtDayKey(d.day, locale, { weekday: "short", month: "short", day: "numeric" })}
              </Td>
              <Td right mono label={t("tokens")}>
                {formatTokens(d.total)}
              </Td>
              <Td right mono label={t("cost")}>
                {formatUSD(d.cost)}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
