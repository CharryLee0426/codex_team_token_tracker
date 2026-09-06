"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { quantizeLevels } from "@codex-tracker/shared/aggregate";
import { formatTokens } from "@codex-tracker/shared/format";
import type { ActiveHoursRow } from "@/lib/analytics";
import { fmtDayKey } from "@/lib/format";
import { useChartTheme } from "./use-chart-theme";
import { TooltipBox, TooltipRow } from "./chart-tooltip";

interface Props {
  rows: ActiveHoursRow[]; // Mon..Sun, with each cell's dated breakdown
}

/** Weekdays × local hours; hover, focus or tap to see the exact dates behind a cell. */
export function ActiveHoursHeatmap({ rows }: Props) {
  const theme = useChartTheme();
  const locale = useLocale();
  const tw = useTranslations("weekdays.short");
  const t = useTranslations("charts");
  const tc = useTranslations("common");
  const [hover, setHover] = useState<{ r: number; h: number } | null>(null);
  const [focusCell, setFocusCell] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const level = useMemo(() => quantizeLevels(rows.flatMap((r) => r.hours)), [rows]);
  const hovered = hover ? rows[hover.r] : null;
  const dateLabels = useMemo(() => new Map(rows.flatMap((row) => row.days.map(({ day }) => [day, fmtDayKey(day, locale, { year: "numeric", month: "short", day: "numeric" })]))), [rows, locale]);
  const peak = useMemo(() => {
    let best = { r: 0, h: 0, v: -1 };
    rows.forEach((row, r) => row.hours.forEach((v, h) => v > best.v && (best = { r, h, v })));
    return best.v > 0 ? best : null;
  }, [rows]);

  return (
    <div
      className="relative"
      onPointerLeave={() => setHover(null)}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHover(null); }}
      onKeyDown={(event) => { if (event.key === "Escape") setHover(null); }}
    >
      {peak ? (
        <div className="mb-3 flex justify-end">
          <span className="eyebrow text-[10px] text-muted">
            {t("peak")}: {tw(String(rows[peak.r].weekday))} {String(peak.h).padStart(2, "0")}:00
          </span>
        </div>
      ) : null}
      <div
        ref={gridRef}
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: "30px repeat(24, minmax(0, 1fr))" }}
        role="group"
        aria-label={t("activeHours")}
      >
        {rows.map((r, ri) => (
          <div key={r.weekday} className="contents">
            <div className="flex items-center font-mono text-[10px] text-muted">{tw(String(r.weekday))}</div>
            {r.hours.map((v, h) => (
              <button
                key={h}
                type="button"
                data-cell={ri * 24 + h}
                tabIndex={focusCell === ri * 24 + h ? 0 : -1}
                className="h-[18px] rounded-[3px] transition-[outline-color] duration-150 focus-visible:ring-2 focus-visible:ring-accent motion-reduce:transition-none"
                style={{
                  background: theme.heatmap[level(v)],
                  outline: `1px solid ${hover?.r === ri && hover?.h === h ? theme.ink : "transparent"}`,
                  outlineOffset: -1,
                }}
                onPointerEnter={() => setHover({ r: ri, h })}
                onFocus={() => { setFocusCell(ri * 24 + h); setHover({ r: ri, h }); }}
                onKeyDown={(event) => {
                  const offset = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 24, ArrowUp: -24 }[event.key];
                  if (offset === undefined) return;
                  event.preventDefault();
                  const next = Math.max(0, Math.min(rows.length * 24 - 1, ri * 24 + h + offset));
                  gridRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${next}"]`)?.focus();
                }}
                onClick={() => setHover({ r: ri, h })}
                aria-label={`${tw(String(r.weekday))} ${String(h).padStart(2, "0")}:00 — ${formatTokens(v)} ${tc("tokens")}`}
                aria-describedby={hover?.r === ri && hover?.h === h ? tooltipId : undefined}
              />
            ))}
          </div>
        ))}
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-center font-mono text-[9.5px] text-muted tabular">
            {h % 6 === 0 ? `${String(h).padStart(2, "0")}` : ""}
          </div>
        ))}
      </div>
      {hovered && hover ? (
        <div id={tooltipId} role="tooltip" className="absolute top-full z-20 w-full max-w-xs pt-2" style={hover.h < 12 ? { left: 0 } : { right: 0 }}>
          <TooltipBox title={`${tw(String(hovered.weekday))} ${t("hour", { hour: String(hover.h).padStart(2, "0") })}`}>
            <TooltipRow label={tc("tokens")} value={formatTokens(hovered.hours[hover.h])} />
            <div tabIndex={0} role="region" aria-label={t("day")} className="max-h-48 space-y-1 overflow-y-auto border-t border-border pt-2 scrollbar-thin">
              {hovered.days.map((day) => <TooltipRow key={day.day} label={dateLabels.get(day.day)} value={formatTokens(day.hours[hover.h])} />)}
            </div>
          </TooltipBox>
        </div>
      ) : null}
    </div>
  );
}
