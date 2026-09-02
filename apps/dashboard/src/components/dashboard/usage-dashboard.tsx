"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@codex-tracker/backend/convex/_generated/api";
import type { Id } from "@codex-tracker/backend/convex/_generated/dataModel";
import { isOpenAIModel } from "@codex-tracker/shared/pricing";
import { RANGE_KEYS, type RangeKey } from "@/lib/ranges";
import type { Scope } from "@/hooks/use-hourly-range";
import { useMe } from "@/hooks/use-me";
import { useNow } from "@/hooks/use-now";
import { useUsageData } from "@/hooks/use-usage-data";
import { UsageDashboardView } from "./usage-dashboard-view";

const RANGE_STORAGE = "codex-tracker:range";

interface Props {
  scope: Scope;
  orgId?: Id<"orgs">;
  orgName?: string;
}

/** Container: subscriptions and preferences for the live personal / team boards. */
export function UsageDashboard({ scope, orgId, orgName }: Props) {
  const now = useNow(60_000);
  const { me, ready } = useMe();

  const [range, setRange] = useState<RangeKey>("30d");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RANGE_STORAGE);
      if (saved && (RANGE_KEYS as string[]).includes(saved)) setRange(saved as RangeKey);
    } catch {
      /* ignore */
    }
  }, []);
  const changeRange = useCallback((k: RangeKey) => {
    setRange(k);
    try {
      localStorage.setItem(RANGE_STORAGE, k);
    } catch {
      /* ignore */
    }
  }, []);

  const usage = useUsageData(scope, orgId, range, now, ready);
  const scopeArgs = ready && (scope === "personal" || orgId) ? (scope === "team" ? { scope, orgId } : { scope }) : null;
  const liveNow = useQuery(api.usage.liveNow, scopeArgs ?? "skip");
  const sessions = useQuery(api.usage.recentSessions, scopeArgs ? { ...scopeArgs, limit: 12 } : "skip");
  const devices = useQuery(api.usage.myDevices, ready && scope === "personal" ? {} : "skip");
  // Codex-only: hide sessions an older client uploaded for a non-OpenAI model.
  const codexSessions = useMemo(() => sessions?.filter((s) => isOpenAIModel(s.model)), [sessions]);
  const liveUserIds = useMemo(() => new Set((liveNow ?? []).map((l) => l.user.id)), [liveNow]);

  return (
    <UsageDashboardView
      scope={scope}
      orgName={orgName}
      range={range}
      onRangeChange={changeRange}
      model={usage.model}
      users={usage.users}
      loading={usage.loading}
      stale={usage.stale}
      error={usage.error}
      empty={usage.empty}
      liveCount={liveNow?.length ?? 0}
      liveUserIds={liveUserIds}
      deviceCount={devices?.length}
      sessions={ready ? codexSessions : undefined}
      devices={devices}
      meId={me?.id ?? null}
      now={now}
    />
  );
}
