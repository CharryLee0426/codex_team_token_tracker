"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { HeatmapGrid } from "@codex-tracker/shared/aggregate";
import { addLocalDays } from "@codex-tracker/shared/time";
import { formatTokens, formatUSD } from "@codex-tracker/shared/format";
import { fmtDayKey, fmtMonth } from "@/lib/format";
import { useChartTheme } from "./use-chart-theme";
import { TooltipBox, TooltipRow } from "./chart-tooltip";

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 30;
const TOP = 18;

export function ContributionHeatmap({ grid }: { grid: HeatmapGrid }) {
  const theme = useChartTheme();
  const locale = useLocale();
  const t = useTranslations("charts");
  const tw = useTranslations("weekdays.short");
  const tc = useTranslations("common");
  const [hover, setHover] = useState<{ w: number; d: number } | null>(null);

  const months = useMemo(() => {
    const out: { w: number; label: string }[] = [];
    let prev = -1;
    let lastX = -10;
    grid.weeks.forEach((_, w) => {
      const key = addLocalDays(grid.from, w * 7);
      const [y, m] = key.split("-").map(Number);
      if (m !== prev) {
        if (w - lastX >= 3 || w === 0) {
          out.push({ w, label: fmtMonth(y, m, locale) });
          lastX = w;
        }
        prev = m;
      }
    });
    return out;
  }, [grid, locale]);

  const width = LEFT + grid.weeks.length * STEP;
  const height = TOP + 7 * STEP;
  const hovered = hover ? grid.weeks[hover.w]?.[hover.d] : null;

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <div className="relative inline-block" style={{ minWidth: width }}>
        <svg width={width} height={height} role="img" aria-label={t("heatmap")}>
          {months.map((m) => (
            <text key={m.w} x={LEFT + m.w * STEP} y={11} fontSize={10} fill={theme.axis}>
              {m.label}
            </text>
          ))}
          {[1, 3, 5].map((d) => (
            <text key={d} x={0} y={TOP + d * STEP + CELL - 2} fontSize={10} fill={theme.axis}>
              {tw(String(d))}
            </text>
          ))}
          {grid.weeks.map((week, w) =>
            week.map((day, d) =>
              day.dayKey ? (
                <rect
                  key={`${w}-${d}`}
                  x={LEFT + w * STEP}
                  y={TOP + d * STEP}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  fill={theme.heatmap[day.level]}
                  stroke={hover?.w === w && hover?.d === d ? theme.ink : "transparent"}
                  strokeWidth={1}
                  onMouseEnter={() => setHover({ w, d })}
                  onMouseLeave={() => setHover(null)}
                />
              ) : null,
            ),
          )}
        </svg>
        {hovered && hover ? (
          <div
            className="pointer-events-none absolute z-10"
            style={{ left: LEFT + hover.w * STEP + CELL / 2, top: TOP + hover.d * STEP - 6, transform: "translate(-50%, -100%)" }}
          >
            <TooltipBox title={fmtDayKey(hovered.dayKey, locale, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}>
              <TooltipRow label={tc("tokens")} value={formatTokens(hovered.value)} />
              <TooltipRow label={tc("cost")} value={formatUSD(hovered.cost)} muted />
              {hovered.usage.requests ? <TooltipRow label={tc("requests")} value={hovered.usage.requests} muted /> : null}
            </TooltipBox>
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-muted">
        <span>{t("less")}</span>
        {theme.heatmap.map((c, i) => (
          <span key={i} className="inline-block h-[11px] w-[11px] rounded-[2px]" style={{ background: c }} />
        ))}
        <span>{t("more")}</span>
      </div>
    </div>
  );
}
