import { buildHeatmap, groupByLocalDay, type HeatmapGrid } from "@codex-tracker/shared/aggregate";
import { addLocalDays, dayKeyToLocalStart, hourStartOf } from "@codex-tracker/shared/time";
import {
  activeHoursRows,
  agentBreakdown,
  dailyStack,
  memberStats,
  modelBreakdown,
  orderModels,
  summarize,
  weekdaySeries,
  type AgentStat,
  type DailyStackPoint,
  type MemberStat,
  type ModelStat,
  type Summary,
  type UsageRow,
  type WeekdayPoint,
} from "./analytics";
import { activeHoursWindow, type ActiveHoursWindow, type RangeBounds } from "./ranges";

/** Everything a usage view renders, derived from raw hourly rows. Pure: shared by live data and the demo preview. */
export interface UsageModel {
  bounds: RangeBounds;
  summary: Summary;
  stats: ModelStat[];
  agents: AgentStat[];
  /** Model names in stable color order (at most MAX_SERIES; the rest fold into Other). */
  series: string[];
  daily: DailyStackPoint[];
  dailyTotals: number[];
  weekday: WeekdayPoint[];
  active: { weekday: number; hours: number[] }[];
  /** Days behind `active`: the range, or the trailing week when the range is shorter. */
  activeWindow: ActiveHoursWindow;
  heat: HeatmapGrid;
  members: MemberStat[];
  /** Rows inside the selected range (the heatmap uses the longer span). */
  rangeRows: UsageRow[];
}

/** Calendar heatmap depth: at least half a year, growing with the range up to a full year of weeks. */
export function heatmapWeeksFor(bounds: RangeBounds): number {
  return Math.min(53, Math.max(26, Math.ceil(bounds.days / 7)));
}

/** Start of the subscription span: the range or the heatmap window, whichever is longer. */
export function spanStart(bounds: RangeBounds, weeks: number): { fromKey: string; fromMs: number } {
  const spanDays = Math.max(bounds.days, weeks * 7);
  const fromKey = addLocalDays(bounds.toKey, -(spanDays - 1));
  return { fromKey, fromMs: hourStartOf(dayKeyToLocalStart(fromKey)) };
}

export function deriveUsageModel(rows: UsageRow[], bounds: RangeBounds, weeks: number, previousSeries: string[], includeMembers: boolean): UsageModel {
  const spanRows = rows.filter((r) => r.hourStart < bounds.toMs);
  const rangeRows = spanRows.filter((r) => r.hourStart >= bounds.fromMs);
  const activeWindow = activeHoursWindow(bounds);
  const activeRows = activeWindow.widened ? spanRows.filter((r) => r.hourStart >= activeWindow.fromMs) : rangeRows;
  const stats = modelBreakdown(rangeRows);
  const series = orderModels(stats, previousSeries);
  const daily = dailyStack(rangeRows, bounds.fromKey, bounds.toKey, series);
  return {
    bounds,
    summary: summarize(rangeRows),
    stats,
    agents: agentBreakdown(rangeRows),
    series,
    daily,
    dailyTotals: daily.map((d) => d.total),
    weekday: weekdaySeries(rangeRows, bounds.fromKey, bounds.toKey),
    active: activeHoursRows(activeRows),
    activeWindow,
    heat: buildHeatmap(groupByLocalDay(spanRows), bounds.toKey, weeks),
    members: includeMembers ? memberStats(rangeRows) : [],
    rangeRows,
  };
}
