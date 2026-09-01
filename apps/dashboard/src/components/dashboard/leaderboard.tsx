"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatPercent, formatTokens, formatUSD } from "@codex-tracker/shared/format";
import type { MemberStat } from "@/lib/analytics";
import type { PublicUser } from "@/hooks/use-hourly-range";
import { fmtRelative } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { LiveDot } from "@/components/ui/live-dot";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";

interface Props {
  stats: MemberStat[];
  users: Map<string, PublicUser>;
  liveUserIds: Set<string>;
  meId: string | null;
  now: number;
}

export function Leaderboard({ stats, users, liveUserIds, meId, now }: Props) {
  const t = useTranslations("members");
  const tc = useTranslations("common");
  const locale = useLocale();
  if (!stats.length) return <EmptyState title={t("empty")} className="py-8" />;
  const max = stats[0]?.usage.total || 1;
  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>{t("member")}</Th>
            <Th className="w-40">{tc("share")}</Th>
            <Th right>{tc("tokens")}</Th>
            <Th right>{tc("cost")}</Th>
            <Th right>{tc("cacheHit")}</Th>
            <Th right>{tc("requests")}</Th>
            <Th right>{t("lastActive")}</Th>
          </tr>
        </thead>
        <tbody>
          {stats.map((s, i) => {
            const u = users.get(s.userId);
            const live = liveUserIds.has(s.userId);
            return (
              <tr key={s.userId} className="hover:bg-card-2/60">
                <Td>
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className="w-4 text-right text-xs text-muted tabular">{i + 1}</span>
                    <Avatar name={u?.name ?? u?.email} src={u?.imageUrl} size={24} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium text-fg">{u?.name ?? u?.email ?? tc("unknown")}</span>
                        {s.userId === meId ? <Badge variant="muted">{tc("you")}</Badge> : null}
                        {live ? (
                          <Badge variant="success">
                            <LiveDot size={6} /> {tc("live")}
                          </Badge>
                        ) : null}
                      </span>
                      {u?.email && u?.name ? <span className="block truncate text-[11px] text-muted">{u.email}</span> : null}
                    </span>
                  </span>
                </Td>
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 flex-1 rounded-full bg-card-2 overflow-hidden">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (s.usage.total / max) * 100)}%` }} />
                    </span>
                    <span className="w-10 text-right text-xs text-muted tabular">{formatPercent(s.share)}</span>
                  </span>
                </Td>
                <Td right mono>{formatTokens(s.usage.total)}</Td>
                <Td right mono>{formatUSD(s.cost)}</Td>
                <Td right mono>{formatPercent(s.cacheHit)}</Td>
                <Td right mono>{s.usage.requests}</Td>
                <Td right className="text-fg-2 text-xs whitespace-nowrap">{s.lastHour ? fmtRelative(s.lastHour, now, locale) : "—"}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </TableWrap>
  );
}
