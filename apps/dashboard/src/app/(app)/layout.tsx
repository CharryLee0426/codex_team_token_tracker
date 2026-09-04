import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { SIDEBAR_COOKIE, toSidebarState } from "@/components/shell/sidebar-cookie";
import { BootstrapUser } from "@/components/bootstrap-user";
import { OnboardingController } from "@/components/onboarding/onboarding-controller";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  return (
    <>
      <AppShell banner={<BootstrapUser />} initialSidebar={toSidebarState(store.get(SIDEBAR_COOKIE)?.value)}>
        {children}
      </AppShell>
      {/* Above the shell: the guided tour spotlights its rail and the board. */}
      <OnboardingController />
    </>
  );
}
