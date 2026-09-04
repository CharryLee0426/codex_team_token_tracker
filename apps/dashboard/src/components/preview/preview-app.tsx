"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { hourStartOf } from "@codex-tracker/shared/time";
import { DEMO_LIVE_USER_IDS, DEMO_ME_ID, DEMO_ORG_NAME, DEMO_USERS, demoDevices, demoInvites, demoMembers, demoRows, demoSessions } from "@/lib/demo-data";
import { DEFAULT_RANGE, rangeBounds, type RangeSelection } from "@/lib/ranges";
import { deriveUsageModel, heatmapWeeksFor } from "@/lib/usage-model";
import { AppShell } from "@/components/shell/app-shell";
import type { SidebarState } from "@/components/shell/sidebar-cookie";
import { UsageDashboardView } from "@/components/dashboard/usage-dashboard-view";
import { DevicesList } from "@/components/dashboard/devices-list";
import { MembersTable } from "@/components/dashboard/members-table";
import { InviteLinksPanel } from "@/components/dashboard/invite-links";
import { OnboardingTour } from "@/components/onboarding/onboarding-tour";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { Card } from "@/components/ui/card";
import { CodeBlock } from "@/components/ui/code-block";
import { PageHeader } from "@/components/ui/page-header";
import { TOUR_QUERY, trackerCommands } from "@/lib/onboarding";
import type { PreviewView } from "@/lib/preview";

/**
 * Design-preview harness: the real dashboard chrome and views rendered from deterministic sample
 * data, without a session. Used to review the UI on any device; never enabled in production.
 */
export function PreviewApp({ view, initialSidebar }: { view: PreviewView; initialSidebar?: SidebarState }) {
  const t = useTranslations();
  const [now] = useState(() => Date.now());
  const [range, setRange] = useState<RangeSelection>(DEFAULT_RANGE);
  const rows = useMemo(() => demoRows(now, 371), [now]);
  const users = useMemo(() => new Map(DEMO_USERS.map((u) => [u.id, u])), []);
  const seriesRef = useRef<string[]>([]);
  const scope = view === "team" ? "team" : "personal";
  const model = useMemo(() => {
    const scoped = scope === "team" ? rows : rows.filter((r) => r.userId === DEMO_ME_ID);
    const bounds = rangeBounds(range, hourStartOf(now));
    const m = deriveUsageModel(scoped, bounds, heatmapWeeksFor(bounds), seriesRef.current, scope === "team");
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
            <CodeBlock code={"npx codex-token-tracker login    # first time: sign in and approve this device\nnpx codex-token-tracker          # every day after: start the menu bar app"} />
          </div>
        </div>
      );
      break;
    default:
      content = <SettingsPanel tourHref={`/preview/personal?${TOUR_QUERY}=1`} />;
  }

  return (
    <AppShell
      demo
      initialSidebar={initialSidebar}
      hrefFor={(segment) => `/preview/${segment}`}
      banner={<div className="border-b border-[rgba(250,178,25,0.4)] bg-[rgba(250,178,25,0.1)] px-4 py-2 text-center text-xs text-fg">{t("preview.banner")}</div>}
    >
      <div className="page-enter" key={view}>
        {content}
      </div>
      <Suspense fallback={null}>
        <PreviewTour deviceCount={devices.length} />
      </Suspense>
    </AppShell>
  );
}

/** `/preview/<view>?tour=1` opens the guided tour over the sample board — no account, nothing persisted. */
function PreviewTour({ deviceCount }: { deviceCount: number }) {
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (params.get(TOUR_QUERY) === "1") setOpen(true);
  }, [params]);
  const commands = trackerCommands(origin);
  return <OnboardingTour open={open} onClose={() => setOpen(false)} loginCommand={commands.login} runCommand={commands.run} userName="Demo User" deviceCount={deviceCount} />;
}
