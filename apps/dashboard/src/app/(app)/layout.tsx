import { DashboardHeader } from "@/components/header/dashboard-header";
import { BootstrapUser } from "@/components/bootstrap-user";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <DashboardHeader />
      <BootstrapUser />
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
