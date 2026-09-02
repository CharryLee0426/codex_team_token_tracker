"use client";

import { useMemo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useTranslations } from "next-intl";
import { formatPercent, formatTokens, formatUSD } from "@codex-tracker/shared/format";
import { cacheHitRate } from "@codex-tracker/shared/usage";
import type { ModelStat } from "@/lib/analytics";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useChartTheme } from "./use-chart-theme";
import { useFirstRenderAnimation } from "./use-first-render-animation";
import { TooltipBox, TooltipRow } from "./chart-tooltip";

interface Props {
  stats: ModelStat[];
  series: string[];
  colorOf: (model: string) => string;
}

interface Slice {
  name: string;
  value: number;
  cost: number;
  color: string;
  estimated: boolean;
  share: number;
}

function useSlices(stats: ModelStat[], series: string[], colorOf: (m: string) => string, otherColor: string, otherLabel: string): Slice[] {
  return useMemo(() => {
    const inSeries = new Set(series);
    const head = stats.filter((s) => inSeries.has(s.model));
    const tail = stats.filter((s) => !inSeries.has(s.model));
    const otherTotal = tail.reduce((a, s) => a + s.usage.total, 0);
    const otherCost = tail.reduce((a, s) => a + s.cost, 0);
    const grand = stats.reduce((a, s) => a + s.usage.total, 0) || 1;
    return [
      ...head.map((s) => ({ name: s.model, value: s.usage.total, cost: s.cost, color: colorOf(s.model), estimated: s.estimated, share: s.usage.total / grand })),
      ...(otherTotal > 0 ? [{ name: otherLabel, value: otherTotal, cost: otherCost, color: otherColor, estimated: false, share: otherTotal / grand }] : []),
    ];
  }, [stats, series, colorOf, otherColor, otherLabel]);
}

/** Donut with the total as its hero figure, plus a legend list (identity never rides on color alone). */
export function ModelDistribution({ stats, series, colorOf }: Props) {
  const theme = useChartTheme();
  const t = useTranslations("charts");
  const tc = useTranslations("common");
  const { animate, duration } = useFirstRenderAnimation();
  const items = useSlices(stats, series, colorOf, theme.other, tc("other"));
  const total = items.reduce((a, s) => a + s.value, 0);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="relative mx-auto h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={items}
              dataKey="value"
              nameKey="name"
              innerRadius="68%"
              outerRadius="92%"
              paddingAngle={items.length > 1 ? 2 : 0}
              stroke={theme.surface}
              strokeWidth={2}
              isAnimationActive={animate}
              animationDuration={duration}
              animationEasing="ease-out"
            >
              {items.map((it) => (
                <Cell key={it.name} fill={it.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const it = payload[0].payload as Slice;
                return (
                  <TooltipBox title={<span className="font-mono">{it.name}</span>}>
                    <TooltipRow color={it.color} label={tc("tokens")} value={formatTokens(it.value)} />
                    <TooltipRow label={tc("share")} value={formatPercent(it.share, 1)} />
                    <TooltipRow label={tc("cost")} value={formatUSD(it.cost)} muted />
                  </TooltipBox>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-semibold leading-none tracking-tight text-fg">{formatTokens(total)}</span>
          <span className="eyebrow mt-1.5 text-[10px]">{tc("tokens")}</span>
        </div>
      </div>
      <ul className="min-w-0 flex-1 divide-y divide-border text-sm">
        {items.map((it) => (
          <li key={it.name} className="flex items-center gap-3 py-1.5">
            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: it.color }} />
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{it.name}</span>
            {it.estimated ? (
              <Badge variant="warning" title={t("priceEstimated")}>
                {tc("estimated")}
              </Badge>
            ) : null}
            <span className="tabular w-12 text-right text-xs text-muted">{formatPercent(it.share, 1)}</span>
            <span className="tabular hidden w-16 text-right text-xs text-fg-2 xs:inline">{formatTokens(it.value)}</span>
            <span className="tabular w-16 text-right text-xs text-fg">{formatUSD(it.cost)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ModelTable({ stats, series, colorOf }: Props) {
  const theme = useChartTheme();
  const t = useTranslations("charts");
  const tc = useTranslations("common");
  const inSeries = new Set(series);
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>{tc("model")}</Th>
            <Th right>{tc("tokens")}</Th>
            <Th right>{tc("share")}</Th>
            <Th right>{tc("input")}</Th>
            <Th right>{tc("cached")}</Th>
            <Th right>{tc("output")}</Th>
            <Th right>{tc("cacheHit")}</Th>
            <Th right>{tc("requests")}</Th>
            <Th right>{tc("cost")}</Th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s) => (
            <tr key={s.model} className="hover:bg-card-2/60">
              <Td primary>
                <span className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: inSeries.has(s.model) ? colorOf(s.model) : theme.other }} />
                  <span className="font-mono text-[12px]">{s.model}</span>
                  {s.estimated ? (
                    <Badge variant="warning" title={t("priceEstimated")}>
                      {tc("estimated")}
                    </Badge>
                  ) : null}
                </span>
              </Td>
              <Td right mono label={tc("tokens")}>{formatTokens(s.usage.total)}</Td>
              <Td right mono label={tc("share")}>{formatPercent(s.share, 1)}</Td>
              <Td right mono label={tc("input")}>{formatTokens(s.usage.input)}</Td>
              <Td right mono label={tc("cached")}>{formatTokens(s.usage.cached)}</Td>
              <Td right mono label={tc("output")}>{formatTokens(s.usage.output)}</Td>
              <Td right mono label={tc("cacheHit")}>{formatPercent(cacheHitRate(s.usage))}</Td>
              <Td right mono label={tc("requests")}>{s.usage.requests}</Td>
              <Td right mono label={tc("cost")}>{formatUSD(s.cost)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
