"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { quantizeLevels } from "@codex-tracker/shared/aggregate";
import { formatTokens } from "@codex-tracker/shared/format";
import { useChartTheme } from "./use-chart-theme";

interface Props {
  rows: { weekday: number; hours: number[] }[]; // Mon..Sun
}

/** 7 × 24 grid of local hours; the readout line above shows the hovered (or tapped) cell. */
export function ActiveHoursHeatmap({ rows }: Props) {
  const theme = useChartTheme();
  const tw = useTranslations("weekdays.short");
  const t = useTranslations("charts");
  const tc = useTranslations("common");
  const [hover, setHover] = useState<{ r: number; h: number } | null>(null);
  const level = useMemo(() => quantizeLevels(rows.flatMap((r) => r.hours)), [rows]);
  const hovered = hover ? rows[hover.r] : null;
  const peak = useMemo(() => {
    let best = { r: 0, h: 0, v: -1 };
    rows.forEach((row, r) => row.hours.forEach((v, h) => v > best.v && (best = { r, h, v })));
    return best.v > 0 ? best : null;
  }, [rows]);

  return (
    <div>
      <div className="mb-3 flex h-4 items-center justify-between gap-3 text-xs text-fg-2 tabular">
        {hovered && hover ? (
          <span>
            <span className="font-medium text-fg">
              {tw(String(hovered.weekday))} {t("hour", { hour: String(hover.h).padStart(2, "0") })}
            </span>{" "}
            · {formatTokens(hovered.hours[hover.h])} {tc("tokens")}
          </span>
        ) : (
          <span className="text-muted">{t("activeHoursHover")}</span>
        )}
        {peak ? (
          <span className="eyebrow hidden text-[10px] sm:inline">
            {t("peak")}: {tw(String(rows[peak.r].weekday))} {String(peak.h).padStart(2, "0")}:00
          </span>
        ) : null}
      </div>
      <div
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: "30px repeat(24, minmax(0, 1fr))" }}
        role="img"
        aria-label={t("activeHours")}
        onPointerLeave={() => setHover(null)}
      >
        {rows.map((r, ri) => (
          <div key={r.weekday} className="contents">
            <div className="flex items-center font-mono text-[10px] text-muted">{tw(String(r.weekday))}</div>
            {r.hours.map((v, h) => (
              <div
                key={h}
                className="h-[18px] rounded-[3px] transition-[outline-color] duration-150"
                style={{
                  background: theme.heatmap[level(v)],
                  outline: `1px solid ${hover?.r === ri && hover?.h === h ? theme.ink : "transparent"}`,
                  outlineOffset: -1,
                }}
                onPointerEnter={() => setHover({ r: ri, h })}
                onClick={() => setHover((cur) => (cur?.r === ri && cur?.h === h ? null : { r: ri, h }))}
                title={`${tw(String(r.weekday))} ${String(h).padStart(2, "0")}:00 — ${formatTokens(v)}`}
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
    </div>
  );
}
