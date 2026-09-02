"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatPercent, formatTokens, formatUSD } from "@codex-tracker/shared/format";
import { cacheHitRate } from "@codex-tracker/shared/usage";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentTag } from "@/components/dashboard/agent-tag";

export interface SessionItem {
  id: string;
  user: { id: string; name: string | null; email: string | null; imageUrl: string | null };
  sessionId: string;
  agent: string;
  model: string;
  projectName: string | null;
  startedAt: number;
  lastActivityAt: number;
  input: number;
  cached: number;
  output: number;
  total: number;
  requests: number;
  cost: number;
  source: string | null;
}

export function RecentSessions({ sessions, scope, now }: { sessions: SessionItem[] | undefined; scope: "personal" | "team"; now: number }) {
  const t = useTranslations("sessions");
  const tc = useTranslations("common");
  const locale = useLocale();
  if (sessions === undefined) {
    return (
      <div className="space-y-2 px-4 pb-4 sm:px-5">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>
    );
  }
  if (!sessions.length) return <EmptyState title={t("empty")} className="py-8" />;
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>{tc("project")}</Th>
            {scope === "team" ? <Th>{tc("user")}</Th> : null}
            <Th>{tc("model")}</Th>
            <Th>{tc("started")}</Th>
            <Th>{tc("lastActive")}</Th>
            <Th right>{tc("tokens")}</Th>
            <Th right>{tc("cacheHit")}</Th>
            <Th right>{tc("cost")}</Th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="hover:bg-card-2/60">
              <Td primary>
                <span className="block max-w-[260px] truncate font-medium text-fg" title={s.sessionId}>
                  {s.projectName ?? s.sessionId.slice(0, 8)}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                  <AgentTag agent={s.agent} />
                  {s.source && s.source !== s.agent ? <span>{s.source}</span> : null}
                </span>
              </Td>
              {scope === "team" ? (
                <Td label={tc("user")}>
                  <span className="flex min-w-0 items-center gap-2 max-md:justify-end">
                    <Avatar name={s.user.name ?? s.user.email} src={s.user.imageUrl} size={20} />
                    <span className="truncate text-fg-2">{s.user.name ?? s.user.email ?? tc("unknown")}</span>
                  </span>
                </Td>
              ) : null}
              <Td label={tc("model")}>
                <span className="font-mono text-[12px]">{s.model}</span>
              </Td>
              <Td label={tc("started")} className="text-xs whitespace-nowrap text-fg-2">
                {fmtDateTime(s.startedAt, locale)}
              </Td>
              <Td label={tc("lastActive")} className="text-xs whitespace-nowrap text-fg-2" title={fmtDateTime(s.lastActivityAt, locale)}>
                {fmtRelative(s.lastActivityAt, now, locale)}
              </Td>
              <Td right mono label={tc("tokens")}>{formatTokens(s.total)}</Td>
              <Td right mono label={tc("cacheHit")}>{formatPercent(cacheHitRate({ input: s.input, cached: s.cached }))}</Td>
              <Td right mono label={tc("cost")}>{formatUSD(s.cost)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
