"use client";

import { useMemo, useRef } from "react";
import type { Id } from "@codex-tracker/backend/convex/_generated/dataModel";
import { hourStartOf } from "@codex-tracker/shared/time";
import { rangeBounds, type RangeKey } from "@/lib/ranges";
import { deriveUsageModel, heatmapWeeksFor, spanStart, type UsageModel } from "@/lib/usage-model";
import { useHourlyRange, type PublicUser, type Scope } from "./use-hourly-range";

export interface UsageData {
  /** The model to render — the fresh one, or the previous one while a new range loads. */
  model: UsageModel | null;
  users: Map<string, PublicUser>;
  /** Nothing to show yet. */
  loading: boolean;
  /** Showing the previous model while a refetch is in flight. */
  stale: boolean;
  error: Error | null;
  /** Loaded, and there is no usage at all in the subscribed span. */
  empty: boolean;
}

/**
 * Live usage for a scope + range: one chunked Convex subscription covering the range and the heatmap
 * window, derived into a render-ready model. Holds the last good model across range changes so charts
 * dim instead of flashing skeletons.
 */
export function useUsageData(scope: Scope, orgId: Id<"orgs"> | undefined, range: RangeKey, nowMs: number, enabled: boolean): UsageData {
  const hourTick = hourStartOf(nowMs);
  const bounds = useMemo(() => rangeBounds(range, hourTick), [range, hourTick]);
  const weeks = heatmapWeeksFor(range);
  const span = useMemo(() => spanStart(bounds, weeks), [bounds, weeks]);
  const data = useHourlyRange(scope, orgId, span.fromMs, bounds.toMs, enabled);

  // Stable series → color assignment: a model keeps its slot once it has one.
  const seriesRef = useRef<string[]>([]);
  const fresh = useMemo(() => {
    if (!data.active || data.loading || data.error) return null;
    const m = deriveUsageModel(data.rows, bounds, weeks, seriesRef.current, scope === "team");
    seriesRef.current = m.series;
    return m;
  }, [data.active, data.loading, data.error, data.rows, bounds, weeks, scope]);

  const lastRef = useRef<UsageModel | null>(null);
  if (fresh) lastRef.current = fresh;
  const model = fresh ?? lastRef.current;

  return {
    model,
    users: data.users,
    loading: !model && !data.error,
    stale: !fresh && !!model,
    error: data.error,
    empty: !!fresh && data.rows.length === 0,
  };
}
