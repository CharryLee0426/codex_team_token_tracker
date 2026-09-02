"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
const MIN_WEEKS = 8;

/**
 * GitHub-style calendar. Fits as many trailing weeks as the container allows (so phones never need
 * to scroll sideways); hover or tap a cell for its day.
 */
export function ContributionHeatmap({ grid }: { grid: HeatmapGrid }) {
  const theme = useChartTheme();
  const locale = useLocale();
  const t = useTranslations("charts");
  const tw = useTranslations("weekdays.short");
  const tc = useTranslations("common");
  const [hover, setHover] = useState<{ w: number; d: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fitWeeks, setFitWeeks] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setFitWeeks(Math.max(MIN_WEEKS, Math.floor((el.clientWidth - LEFT) / STEP)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shownWeeks = Math.min(grid.weeks.length, fitWeeks ?? grid.weeks.length);
  const offset = grid.weeks.length - shownWeeks;
  const weeks = useMemo(() => grid.weeks.slice(offset), [grid.weeks, offset]);
  const firstKey = useMemo(() => addLocalDays(grid.from, offset * 7), [grid.from, offset]);

  const months = useMemo(() => {
    const out: { w: number; label: string }[] = [];
    let prev = -1;
    let lastX = -10;
    weeks.forEach((_, w) => {
      const key = addLocalDays(firstKey, w * 7);
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
  }, [weeks, firstKey, locale]);

  const width = LEFT + weeks.length * STEP;
  const height = TOP + 7 * STEP;
  const hovered = hover ? weeks[hover.w]?.[hover.d] : null;
  const tipX = hover ? LEFT + hover.w * STEP + CELL / 2 : 0;
  const tipAlign = tipX < 110 ? "0%" : tipX > width - 110 ? "-100%" : "-50%";

  return (
    <div ref={wrapRef} className="w-full">
      <div className="relative inline-block" onPointerLeave={() => setHover(null)}>
        <svg width={width} height={height} role="img" aria-label={t("heatmap")} className="block">
          {months.map((m) => (
            <text key={m.w} x={LEFT + m.w * STEP} y={11} fontSize={10} fill={theme.axis} fontFamily="var(--font-mono)">
              {m.label}
            </text>
          ))}
          {[1, 3, 5].map((d) => (
            <text key={d} x={0} y={TOP + d * STEP + CELL - 2} fontSize={10} fill={theme.axis} fontFamily="var(--font-mono)">
              {tw(String(d))}
            </text>
          ))}
          {weeks.map((week, w) =>
            week.map((day, d) =>
              day.dayKey ? (
                <rect
                  key={`${w}-${d}`}
                  x={LEFT + w * STEP}
                  y={TOP + d * STEP}
                  width={CELL}
                  height={CELL}
                  rx={2.5}
                  fill={theme.heatmap[day.level]}
                  stroke={hover?.w === w && hover?.d === d ? theme.ink : "transparent"}
                  strokeWidth={1}
                  onPointerEnter={() => setHover({ w, d })}
                  onClick={() => setHover((h) => (h?.w === w && h?.d === d ? null : { w, d }))}
                >
                  <title>{`${fmtDayKey(day.dayKey, locale)} · ${formatTokens(day.value)} ${tc("tokens")}`}</title>
                </rect>
              ) : null,
            ),
          )}
        </svg>
        {hovered && hover ? (
          <div className="pointer-events-none absolute z-10" style={{ left: tipX, top: TOP + hover.d * STEP - 6, transform: `translate(${tipAlign}, -100%)` }}>
            <TooltipBox title={fmtDayKey(hovered.dayKey, locale, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}>
              <TooltipRow label={tc("tokens")} value={formatTokens(hovered.value)} />
              <TooltipRow label={tc("cost")} value={formatUSD(hovered.cost)} muted />
              {hovered.usage.requests ? <TooltipRow label={tc("requests")} value={hovered.usage.requests} muted /> : null}
            </TooltipBox>
          </div>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-muted">
        <span className="eyebrow text-[10px]">{t("weeksShown", { count: shownWeeks })}</span>
        <span className="flex items-center gap-1">
          <span>{t("less")}</span>
          {theme.heatmap.map((c, i) => (
            <span key={i} className="inline-block h-[11px] w-[11px] rounded-[2.5px]" style={{ background: c }} />
          ))}
          <span>{t("more")}</span>
        </span>
      </div>
    </div>
  );
}
