"use client";

import { useMemo } from "react";
import { useQueries } from "convex/react";
import { api } from "@codex-tracker/backend/convex/_generated/api";
import type { Id } from "@codex-tracker/backend/convex/_generated/dataModel";
import { expandCompactRows, type CompactHourRow } from "@codex-tracker/shared/wire";
import { splitRange } from "@/lib/ranges";
import type { UsageRow } from "@/lib/analytics";

export type Scope = "personal" | "team";

export interface PublicUser {
  id: string;
  name: string | null;
  email: string | null;
  imageUrl: string | null;
}

interface HourlyResult {
  rows: CompactHourRow[];
  users: PublicUser[];
}

export interface HourlyRange {
  rows: UsageRow[];
  users: Map<string, PublicUser>;
  loading: boolean;
  error: Error | null;
  active: boolean;
}

/**
 * Subscribe to hourly usage for [fromMs, toMs). Long ranges are split into ≤ 60-day chunks
 * (the backend caps a single query at 62 days); every chunk is a live Convex subscription.
 */
export function useHourlyRange(scope: Scope, orgId: Id<"orgs"> | undefined, fromMs: number, toMs: number, enabled = true): HourlyRange {
  const chunks = useMemo(() => splitRange(fromMs, toMs), [fromMs, toMs]);
  const queries = useMemo(() => {
    const q: Record<string, { query: typeof api.usage.hourly; args: { scope: Scope; orgId?: Id<"orgs">; from: number; to: number } }> = {};
    if (!enabled) return q;
    if (scope === "team" && !orgId) return q;
    chunks.forEach((c, i) => {
      q[`chunk${i}`] = {
        query: api.usage.hourly,
        args: scope === "team" ? { scope, orgId, from: c.from, to: c.to } : { scope, from: c.from, to: c.to },
      };
    });
    return q;
  }, [chunks, scope, orgId, enabled]);

  const results = useQueries(queries) as Record<string, HourlyResult | undefined | Error>;

  return useMemo(() => {
    const keys = Object.keys(queries);
    const rows: UsageRow[] = [];
    const users = new Map<string, PublicUser>();
    let loading = false;
    let error: Error | null = null;
    for (const k of keys) {
      const r = results[k];
      if (r === undefined) loading = true;
      else if (r instanceof Error) error = r;
      else {
        rows.push(...expandCompactRows(r.rows));
        for (const u of r.users) users.set(u.id, u);
      }
    }
    return { rows, users, loading: keys.length > 0 && loading, error, active: keys.length > 0 };
  }, [results, queries]);
}
