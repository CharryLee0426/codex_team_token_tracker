import { HEATMAP_LEVELS_DARK, HEATMAP_LEVELS_LIGHT, formatTokens, formatUSD, type HeatmapGrid } from "@codex-tracker/shared";
import type { Language } from "../../i18n";
import { localeTag, t } from "../../i18n";
import { useTooltip, Tooltip } from "./Tooltip";

const CELL = 11;
const GAP = 3;
const LEFT = 22;
const TOP = 14;

export function Heatmap({ grid, lang, dark }: { grid: HeatmapGrid; lang: Language; dark: boolean }) {
  const levels = dark ? HEATMAP_LEVELS_DARK : HEATMAP_LEVELS_LIGHT;
  const { tip, show, hide } = useTooltip();
  const weeks = grid.weeks.length;
  const width = LEFT + weeks * (CELL + GAP);
  const height = TOP + 7 * (CELL + GAP);
  const tag = localeTag(lang);
  const monthFmt = new Intl.DateTimeFormat(tag, { month: "short" });
  const dayFmt = new Intl.DateTimeFormat(tag, { weekday: "short" });
  const fullFmt = new Intl.DateTimeFormat(tag, { dateStyle: "medium" });

  // month labels: first column whose first day starts a new month
  const monthLabels: Array<{ x: number; label: string }> = [];
  let lastMonth = "";
  grid.weeks.forEach((week, wi) => {
    const first = week.find((d) => d.dayKey);
    if (!first) return;
    const m = first.dayKey.slice(0, 7);
    if (m !== lastMonth) {
      const [y, mo] = first.dayKey.split("-").map(Number);
      monthLabels.push({ x: LEFT + wi * (CELL + GAP), label: monthFmt.format(new Date(y, mo - 1, 1)) });
      lastMonth = m;
    }
  });
  const weekdayLabel = (i: number) => dayFmt.format(new Date(2024, 0, 7 + i)); // 2024-01-07 is a Sunday

  return (
    <div className="heatmap-wrap">
      <div className="heatmap">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {monthLabels.map((m, i) => (
            <text key={i} x={m.x} y={9}>
              {m.label}
            </text>
          ))}
          {[1, 3, 5].map((d) => (
            <text key={d} x={0} y={TOP + d * (CELL + GAP) + CELL - 2}>
              {weekdayLabel(d)}
            </text>
          ))}
          {grid.weeks.map((week, wi) =>
            week.map((day, di) => (
              <rect
                key={`${wi}-${di}`}
                className="cell"
                x={LEFT + wi * (CELL + GAP)}
                y={TOP + di * (CELL + GAP)}
                width={CELL}
                height={CELL}
                fill={day.dayKey ? levels[day.level] : "transparent"}
                opacity={day.dayKey ? 1 : 0}
                onMouseEnter={(e) => {
                  if (!day.dayKey) return;
                  const [y, m, d] = day.dayKey.split("-").map(Number);
                  show(
                    e,
                    <>
                      <b>{fullFmt.format(new Date(y, m - 1, d))}</b>
                      <br />
                      {formatTokens(day.value)} {t(lang, "tokens").toLowerCase()} · {formatUSD(day.cost)}
                      {day.usage.requests ? ` · ${day.usage.requests} ${t(lang, "requests").toLowerCase()}` : ""}
                    </>,
                  );
                }}
                onMouseLeave={hide}
              />
            )),
          )}
        </svg>
      </div>
      <div className="legend">
        <span>{formatTokens(0)}</span>
        {levels.map((c, i) => (
          <i key={i} style={{ background: c }} />
        ))}
        <span>{formatTokens(grid.max)}</span>
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}
