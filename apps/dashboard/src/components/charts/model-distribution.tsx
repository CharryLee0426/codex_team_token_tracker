"use client";

import { useMemo, useRef, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector } from "recharts";
import type { PieSectorDataItem } from "recharts/types/polar/Pie";
import { useTranslations } from "next-intl";
import { formatPercent, formatTokens, formatUSD } from "@codex-tracker/shared/format";
import { cacheHitRate } from "@codex-tracker/shared/usage";
import type { ModelStat } from "@/lib/analytics";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useChartTheme } from "./use-chart-theme";
import { useFirstRenderAnimation } from "./use-first-render-animation";
import { cn } from "@/lib/utils";

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

/**
 * Donut with the total as its hero figure and a legend list beside it (identity never rides on color
 * alone). Hovering or tapping a slice or a row puts that model's figures in the donut's centre and
 * highlights its row — nothing floats over the chart, so nothing can overlap. Narrow cards and phones
 * stack the list under the donut so model names keep their room.
 */
export function ModelDistribution({ stats, series, colorOf }: Props) {
  const theme = useChartTheme();
  const t = useTranslations("charts");
  const tc = useTranslations("common");
  const { animate, duration } = useFirstRenderAnimation();
  const items = useSlices(stats, series, colorOf, theme.other, tc("other"));
  const total = items.reduce((a, s) => a + s.value, 0);
  const [active, setActive] = useState<number | null>(null);
  const hovered = active !== null ? (items[active] ?? null) : null;
  // The chart only exposes mouse events, and a touch tap replays as mouse events after the pointer ones;
  // remembering the last pointer type keeps a tap from selecting a slice and then toggling it off.
  const pointer = useRef<string>("mouse");
  const notePointer = (e: React.PointerEvent) => (pointer.current = e.pointerType);
  const select = (i: number) => setActive((cur) => (pointer.current === "touch" && cur === i ? null : i));
  const hoverIn = (i: number) => pointer.current !== "touch" && setActive(i);
  const hoverOut = (e: React.PointerEvent) => e.pointerType === "mouse" && setActive(null);
  // Only keyboard focus selects a row (a tap or click focuses too, and would cancel its own selection).
  const keyboardFocus = useRef(false);
  const focusIn = (e: React.FocusEvent<HTMLButtonElement>, i: number) => {
    if (!e.currentTarget.matches(":focus-visible")) return;
    keyboardFocus.current = true;
    setActive(i);
  };
  const focusOut = () => {
    if (!keyboardFocus.current) return;
    keyboardFocus.current = false;
    setActive(null);
  };
  const anyEstimated = items.some((it) => it.estimated);

  return (
    <div className="@container" onPointerDownCapture={notePointer} onPointerMoveCapture={notePointer}>
      <div className="flex flex-col items-center gap-4 @[30rem]:flex-row">
        <div className="relative h-44 w-44 shrink-0" onPointerLeave={hoverOut}>
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
                activeIndex={active ?? undefined}
                activeShape={(props: PieSectorDataItem) => <Sector {...props} outerRadius={(props.outerRadius ?? 0) + 4} />}
                onMouseEnter={(_, i) => hoverIn(i)}
                onClick={(_, i) => select(i)}
                className="cursor-pointer"
              >
                {items.map((it, i) => (
                  <Cell key={it.name} fill={it.color} fillOpacity={active === null || active === i ? 1 : 0.35} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-7 text-center" aria-live="polite">
            {hovered ? (
              <>
                <span className="line-clamp-2 w-full font-mono text-[10.5px] leading-tight break-all text-fg-2" title={hovered.name}>
                  {hovered.name}
                </span>
                <span className="tabular mt-1 text-xl leading-none font-semibold tracking-tight text-fg">{formatTokens(hovered.value)}</span>
                <span className="eyebrow mt-1.5 text-[10px]">{formatPercent(hovered.share, 1)}</span>
              </>
            ) : (
              <>
                <span className="text-xl leading-none font-semibold tracking-tight text-fg">{formatTokens(total)}</span>
                <span className="eyebrow mt-1.5 text-[10px]">{tc("tokens")}</span>
              </>
            )}
          </div>
        </div>
        <div className="w-full min-w-0 flex-1">
          <ul className="divide-y divide-border text-sm" onPointerLeave={hoverOut}>
            {items.map((it, i) => (
              <li key={it.name}>
                <button
                  type="button"
                  aria-pressed={active === i}
                  onPointerEnter={(e) => e.pointerType === "mouse" && setActive(i)}
                  onClick={() => select(i)}
                  onFocus={(e) => focusIn(e, i)}
                  onBlur={focusOut}
                  className={cn(
                    "-mx-1.5 grid w-[calc(100%+12px)] grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 rounded-md px-1.5 py-1.5 text-left transition-colors",
                    active === i ? "bg-card-2" : "hover:bg-card-2/60",
                  )}
                >
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: it.color }} />
                  <span className="min-w-0 truncate font-mono text-[12px] text-fg" title={it.name}>
                    {it.name}
                  </span>
                  <span className="tabular w-12 text-right text-xs text-muted">{formatPercent(it.share, 1)}</span>
                  <span className="tabular w-16 text-right text-xs text-fg" title={it.estimated ? t("priceEstimated") : undefined}>
                    {it.estimated ? (
                      <span aria-hidden className="text-[#8a5a00] dark:text-[#f5c451]">
                        ≈
                      </span>
                    ) : null}
                    {formatUSD(it.cost)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {anyEstimated ? (
            <p className="mt-2 text-[11px] leading-snug text-muted">
              <span className="text-[#8a5a00] dark:text-[#f5c451]">≈</span> {t("priceEstimated")}
            </p>
          ) : null}
        </div>
      </div>
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
                <span className="flex min-w-0 max-w-full items-start gap-2">
                  <span className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: inSeries.has(s.model) ? colorOf(s.model) : theme.other }} />
                  <span className="min-w-0 break-all font-mono text-[12px] md:whitespace-nowrap" title={s.model}>
                    {s.model}
                  </span>
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
