import type { Metadata } from "next";
import { UsageDashboard } from "@/components/dashboard/usage-dashboard";

export const metadata: Metadata = { title: "Personal" };

export default function PersonalPage() {
  return <UsageDashboard scope="personal" />;
}
