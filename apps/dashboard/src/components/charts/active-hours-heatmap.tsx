"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { quantizeLevels } from "@codex-tracker/shared/aggregate";
import { formatTokens } from "@codex-tracker/shared/format";
import { useChartTheme } from "./use-chart-theme";

interface Props {
  rows: { weekday: number; hours: number[] }[]; // Mon..Sun
}

export function ActiveHoursHeatmap({ rows }: Props) {
  const theme = useChartTheme();
  const tw = useTranslations("weekdays.short");
  const t = useTranslations("charts");
  const tc = useTranslations("common");
  const [hover, setHover] = useState<{ r: number; h: number } | null>(null);
  const level = useMemo(() => quantizeLevels(rows.flatMap((r) => r.hours)), [rows]);
  const hovered = hover ? rows[hover.r] : null;

  return (
    <div>
      <div className="mb-2 h-4 text-xs text-fg-2 tabular">
        {hovered && hover ? (
          <span>
            {tw(String(hovered.weekday))} {t("hour", { hour: String(hover.h).padStart(2, "0") })} · {formatTokens(hovered.hours[hover.h])} {tc("tokens")}
          </span>
        ) : (
          <span className="text-muted">{t("activeHoursHint")}</span>
        )}
      </div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: "34px repeat(24, minmax(0, 1fr))" }} role="img" aria-label={t("activeHours")}>
        {rows.map((r, ri) => (
          <div key={r.weekday} className="contents">
            <div className="flex items-center text-[11px] text-muted">{tw(String(r.weekday))}</div>
            {r.hours.map((v, h) => (
              <div
                key={h}
                className="h-[18px] rounded-[3px] transition-[outline]"
                style={{
                  background: theme.heatmap[level(v)],
                  outline: hover?.r === ri && hover?.h === h ? `1px solid ${theme.ink}` : "none",
                }}
                onMouseEnter={() => setHover({ r: ri, h })}
                onMouseLeave={() => setHover(null)}
                title={`${tw(String(r.weekday))} ${String(h).padStart(2, "0")}:00 — ${formatTokens(v)}`}
              />
            ))}
          </div>
        ))}
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-center text-[9.5px] text-muted tabular">
            {h % 3 === 0 ? h : ""}
          </div>
        ))}
      </div>
    </div>
  );
}
