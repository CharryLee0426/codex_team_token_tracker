"use client";

import { useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { api } from "@codex-tracker/backend/convex/_generated/api";
import type { Id } from "@codex-tracker/backend/convex/_generated/dataModel";
import { formatTokens } from "@codex-tracker/shared/format";
import { useMe } from "@/hooks/use-me";
import { useNow } from "@/hooks/use-now";
import { fmtDate, fmtRelative } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { LiveDot } from "@/components/ui/live-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import type { DeviceLive } from "./devices-list";

export interface MemberItem {
  id: string;
  name: string | null;
  email: string | null;
  imageUrl: string | null;
  role: string;
  joinedAt: number;
  deviceCount: number;
  lastSeenAt: number | null;
  live: DeviceLive | null;
}

interface Props {
  members: MemberItem[] | undefined;
  meId: string | null;
  now: number;
}

/** Presentational roster; `OrgMembersTable` wires it to Convex. */
export function MembersTable({ members, meId, now }: Props) {
  const t = useTranslations("members");
  const tc = useTranslations("common");
  const locale = useLocale();

  if (members === undefined) {
    return (
      <div className="space-y-2 p-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }
  if (!members.length) return <EmptyState title={t("empty")} />;
  const roleLabel = (role: string) => (role === "org:admin" || role === "org:member" ? t(`roles.${role}`) : role.replace(/^org:/, ""));

  return (
    <TableWrap>
      <Table>
        <thead>
          <tr>
            <Th>{t("member")}</Th>
            <Th>{t("role")}</Th>
            <Th>{t("status")}</Th>
            <Th right>{t("deviceCount")}</Th>
            <Th>{t("lastSeen")}</Th>
            <Th>{t("joined")}</Th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className="hover:bg-card-2/60">
              <Td primary>
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={m.name ?? m.email} src={m.imageUrl} size={26} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-fg">{m.name ?? m.email ?? tc("unknown")}</span>
                      {meId && m.id === meId ? <Badge variant="muted">{tc("you")}</Badge> : null}
                    </span>
                    {m.email && m.name ? <span className="block truncate text-[11px] text-muted">{m.email}</span> : null}
                  </span>
                </span>
              </Td>
              <Td label={t("role")}>
                <Badge variant={m.role === "org:admin" ? "accent" : "default"}>{roleLabel(m.role)}</Badge>
              </Td>
              <Td label={t("status")}>
                {m.live ? (
                  <span className="flex flex-wrap items-center gap-2 text-xs max-md:justify-end">
                    <Badge variant="success">
                      <LiveDot size={6} /> {tc("live")}
                    </Badge>
                    {m.live.model ? <span className="font-mono text-fg-2">{m.live.model}</span> : null}
                    <span className="tabular text-fg-2">{m.live.tokensPerSecond.toFixed(1)} tok/s</span>
                    <span className="tabular text-muted">
                      {tc("today")} {formatTokens(m.live.todayTotal)}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted">{t("offline")}</span>
                )}
              </Td>
              <Td right mono label={t("deviceCount")}>
                {m.deviceCount}
              </Td>
              <Td label={t("lastSeen")} className="text-xs whitespace-nowrap text-fg-2">
                {m.lastSeenAt ? fmtRelative(m.lastSeenAt, now, locale) : tc("never")}
              </Td>
              <Td label={t("joined")} className="text-xs whitespace-nowrap text-fg-2">
                {fmtDate(m.joinedAt, locale)}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

export function OrgMembersTable({ orgId }: { orgId: Id<"orgs"> }) {
  const now = useNow(30_000);
  const { me } = useMe();
  const members = useQuery(api.orgs.members, { orgId });
  return <MembersTable members={members} meId={me?.id ?? null} now={now} />;
}
