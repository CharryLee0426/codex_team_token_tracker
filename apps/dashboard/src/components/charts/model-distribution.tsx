"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useTranslations } from "next-intl";
import { formatPercent, formatTokens, formatUSD } from "@codex-tracker/shared/format";
import { cacheHitRate } from "@codex-tracker/shared/usage";
import type { ModelStat } from "@/lib/analytics";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useChartTheme } from "./use-chart-theme";
import { TooltipBox, TooltipRow } from "./chart-tooltip";

interface Props {
  stats: ModelStat[];
  series: string[];
  colorOf: (model: string) => string;
  view: "chart" | "table";
}

export function ModelDistribution({ stats, series, colorOf, view }: Props) {
  const theme = useChartTheme();
  const t = useTranslations("charts");
  const tc = useTranslations("common");
  const inSeries = new Set(series);
  const head = stats.filter((s) => inSeries.has(s.model));
  const tail = stats.filter((s) => !inSeries.has(s.model));
  const otherTotal = tail.reduce((a, s) => a + s.usage.total, 0);
  const otherCost = tail.reduce((a, s) => a + s.cost, 0);
  const grand = stats.reduce((a, s) => a + s.usage.total, 0) || 1;
  const items = [
    ...head.map((s) => ({ name: s.model, value: s.usage.total, cost: s.cost, color: colorOf(s.model), estimated: s.estimated, share: s.usage.total / grand })),
    ...(otherTotal > 0 ? [{ name: tc("other"), value: otherTotal, cost: otherCost, color: theme.other, estimated: false, share: otherTotal / grand }] : []),
  ];

  if (view === "table") {
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
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: inSeries.has(s.model) ? colorOf(s.model) : theme.other }} />
                    <span className="font-mono text-[12px]">{s.model}</span>
                    {s.estimated ? (
                      <Badge variant="warning" title={t("priceEstimated")}>
                        {tc("estimated")}
                      </Badge>
                    ) : null}
                  </span>
                </Td>
                <Td right mono>{formatTokens(s.usage.total)}</Td>
                <Td right mono>{formatPercent(s.share, 1)}</Td>
                <Td right mono>{formatTokens(s.usage.input)}</Td>
                <Td right mono>{formatTokens(s.usage.cached)}</Td>
                <Td right mono>{formatTokens(s.usage.output)}</Td>
                <Td right mono>{formatPercent(cacheHitRate(s.usage))}</Td>
                <Td right mono>{s.usage.requests}</Td>
                <Td right mono>{formatUSD(s.cost)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
    );
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="h-48 w-full sm:w-48 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={items} dataKey="value" nameKey="name" innerRadius={54} outerRadius={80} paddingAngle={items.length > 1 ? 2 : 0} stroke={theme.surface} strokeWidth={2} isAnimationActive={false}>
              {items.map((it) => (
                <Cell key={it.name} fill={it.color} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const it = payload[0].payload as (typeof items)[number];
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
      </div>
      <ul className="flex-1 min-w-0 divide-y divide-border text-sm">
        {items.map((it) => (
          <li key={it.name} className="flex items-center gap-3 py-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: it.color }} />
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-fg">{it.name}</span>
            {it.estimated ? (
              <Badge variant="warning" title={t("priceEstimated")}>
                {tc("estimated")}
              </Badge>
            ) : null}
            <span className="tabular text-xs text-muted w-12 text-right">{formatPercent(it.share, 1)}</span>
            <span className="tabular text-xs text-fg-2 w-16 text-right">{formatTokens(it.value)}</span>
            <span className="tabular text-xs text-fg w-16 text-right">{formatUSD(it.cost)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
