import { AppShell } from "@/components/shell/app-shell";
import { BootstrapUser } from "@/components/bootstrap-user";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell banner={<BootstrapUser />}>{children}</AppShell>;
}
