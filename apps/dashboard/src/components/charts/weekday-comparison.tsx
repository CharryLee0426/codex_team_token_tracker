"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslations } from "next-intl";
import { formatTokens, formatUSD } from "@codex-tracker/shared/format";
import type { WeekdayPoint } from "@/lib/analytics";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useChartTheme } from "./use-chart-theme";
import { useFirstRenderAnimation } from "./use-first-render-animation";
import { TooltipBox, TooltipRow } from "./chart-tooltip";

/** One series (slot 1); the busiest weekday at full strength, the rest slightly recessed. */
export function WeekdayComparison({ data }: { data: WeekdayPoint[] }) {
  const theme = useChartTheme();
  const tw = useTranslations("weekdays.short");
  const tl = useTranslations("weekdays.long");
  const t = useTranslations("charts");
  const tc = useTranslations("common");
  const { animate, duration } = useFirstRenderAnimation();
  const max = Math.max(...data.map((d) => d.total), 0);
  const rows = data.map((d) => ({ ...d, label: tw(String(d.weekday)) }));

  return (
    <div className="h-56 w-full sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={theme.grid} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: theme.axis }} tickLine={false} axisLine={{ stroke: theme.border }} />
          <YAxis tickFormatter={(v: number) => formatTokens(v, 0)} tick={{ fontSize: 11, fill: theme.axis }} tickLine={false} axisLine={false} width={42} />
          <Tooltip
            cursor={{ fill: theme.dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)" }}
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
          <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={animate} animationDuration={duration} animationEasing="ease-out">
            {rows.map((r) => (
              <Cell key={r.weekday} fill={theme.categorical[0]} fillOpacity={r.total === max && max > 0 ? 1 : 0.55} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WeekdayTable({ data }: { data: WeekdayPoint[] }) {
  const tl = useTranslations("weekdays.long");
  const t = useTranslations("charts");
  const tc = useTranslations("common");
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>{t("day")}</Th>
            <Th right>{tc("tokens")}</Th>
            <Th right>{t("tokensPerDay")}</Th>
            <Th right>{tc("cost")}</Th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.weekday} className="hover:bg-card-2/60">
              <Td primary className="font-medium text-fg">
                {tl(String(d.weekday))}
              </Td>
              <Td right mono label={tc("tokens")}>
                {formatTokens(d.total)}
              </Td>
              <Td right mono label={t("tokensPerDay")}>
                {formatTokens(d.avg)}
              </Td>
              <Td right mono label={tc("cost")}>
                {formatUSD(d.cost)}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
