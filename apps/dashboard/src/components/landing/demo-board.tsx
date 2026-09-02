"use client";

import { useMemo, useRef, useState } from "react";
import { hourStartOf } from "@codex-tracker/shared/time";
import { DEMO_LIVE_USER_IDS, DEMO_ME_ID, DEMO_ORG_NAME, DEMO_USERS, demoRows } from "@/lib/demo-data";
import { rangeBounds, type RangeKey } from "@/lib/ranges";
import { deriveUsageModel, heatmapWeeksFor } from "@/lib/usage-model";
import { UsageDashboardView } from "@/components/dashboard/usage-dashboard-view";

/** The real team board rendered from sample data (interactive range switching included). */
export function DemoBoard() {
  const [now] = useState(() => Date.now());
  const [range, setRange] = useState<RangeKey>("30d");
  const rows = useMemo(() => demoRows(now, 190), [now]);
  const users = useMemo(() => new Map(DEMO_USERS.map((u) => [u.id, u])), []);
  const seriesRef = useRef<string[]>([]);
  const model = useMemo(() => {
    const m = deriveUsageModel(rows, rangeBounds(range, hourStartOf(now)), heatmapWeeksFor(range), seriesRef.current, true);
    seriesRef.current = m.series;
    return m;
  }, [rows, range, now]);

  return (
    <UsageDashboardView
      preview
      scope="team"
      orgName={DEMO_ORG_NAME}
      range={range}
      onRangeChange={setRange}
      model={model}
      users={users}
      loading={false}
      stale={false}
      error={null}
      empty={false}
      liveCount={1}
      liveUserIds={DEMO_LIVE_USER_IDS}
      sessions={[]}
      meId={DEMO_ME_ID}
      now={now}
    />
  );
}
