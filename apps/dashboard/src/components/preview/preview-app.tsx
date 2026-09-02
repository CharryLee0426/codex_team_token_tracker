"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { hourStartOf } from "@codex-tracker/shared/time";
import { DEMO_LIVE_USER_IDS, DEMO_ME_ID, DEMO_ORG_NAME, DEMO_USERS, demoDevices, demoInvites, demoMembers, demoRows, demoSessions } from "@/lib/demo-data";
import { rangeBounds, type RangeKey } from "@/lib/ranges";
import { deriveUsageModel, heatmapWeeksFor } from "@/lib/usage-model";
import { AppShell } from "@/components/shell/app-shell";
import { UsageDashboardView } from "@/components/dashboard/usage-dashboard-view";
import { DevicesList } from "@/components/dashboard/devices-list";
import { MembersTable } from "@/components/dashboard/members-table";
import { InviteLinksPanel } from "@/components/dashboard/invite-links";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { Card } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { PageHeader } from "@/components/ui/page-header";
import type { PreviewView } from "@/lib/preview";

/**
 * Design-preview harness: the real dashboard chrome and views rendered from deterministic sample
 * data, without a session. Used to review the UI on any device; never enabled in production.
 */
export function PreviewApp({ view }: { view: PreviewView }) {
  const t = useTranslations();
  const [now] = useState(() => Date.now());
  const [range, setRange] = useState<RangeKey>("30d");
  const rows = useMemo(() => demoRows(now, 371), [now]);
  const users = useMemo(() => new Map(DEMO_USERS.map((u) => [u.id, u])), []);
  const seriesRef = useRef<string[]>([]);
  const scope = view === "team" ? "team" : "personal";
  const model = useMemo(() => {
    const scoped = scope === "team" ? rows : rows.filter((r) => r.userId === DEMO_ME_ID);
    const m = deriveUsageModel(scoped, rangeBounds(range, hourStartOf(now)), heatmapWeeksFor(range), seriesRef.current, scope === "team");
    seriesRef.current = m.series;
    return m;
  }, [rows, range, now, scope]);
  const sessions = useMemo(() => demoSessions(now), [now]);
  const devices = useMemo(() => demoDevices(now), [now]);
  const members = useMemo(() => demoMembers(now), [now]);
  const invites = useMemo(() => demoInvites(now), [now]);

  let content: React.ReactNode;
  switch (view) {
    case "personal":
    case "team":
      content = (
        <UsageDashboardView
          scope={scope}
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
          deviceCount={devices.length}
          sessions={scope === "team" ? sessions : sessions.filter((s) => s.user.id === DEMO_ME_ID)}
          devices={devices}
          meId={DEMO_ME_ID}
          now={now}
        />
      );
      break;
    case "members":
      content = (
        <div className="space-y-5">
          <PageHeader eyebrow={DEMO_ORG_NAME} title={t("members.title")} subtitle={t("members.subtitle")} />
          <Card>
            <InviteLinksPanel invites={invites} onCreate={async () => ({ code: "DEMOLINK2468" })} onRevoke={() => {}} />
          </Card>
          <Card>
            <MembersTable members={members} meId={DEMO_ME_ID} now={now} />
          </Card>
        </div>
      );
      break;
    case "devices":
      content = (
        <div className="space-y-5">
          <PageHeader eyebrow={t("nav.devices")} title={t("devices.title")} subtitle={t("devices.subtitle")} />
          <DevicesList devices={devices} now={now} onRevoke={() => Promise.resolve()} />
          <div className="max-w-xl">
            <p className="eyebrow mb-2">{t("devices.connectHint")}</p>
            <CodeBlock code="npm i -g codex-token-tracker && codex-tracker login" />
          </div>
        </div>
      );
      break;
    default:
      content = <SettingsPanel />;
  }

  return (
    <AppShell
      demo
      hrefFor={(segment) => `/preview/${segment}`}
      banner={<div className="border-b border-[rgba(250,178,25,0.4)] bg-[rgba(250,178,25,0.1)] px-4 py-2 text-center text-xs text-fg">{t("preview.banner")}</div>}
    >
      <div className="page-enter" key={view}>
        {content}
      </div>
    </AppShell>
  );
}
