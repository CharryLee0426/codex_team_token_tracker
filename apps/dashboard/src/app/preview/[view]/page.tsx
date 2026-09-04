import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { PreviewApp } from "@/components/preview/preview-app";
import { SIDEBAR_COOKIE, toSidebarState } from "@/components/shell/sidebar-cookie";
import { isPreviewEnabled, isPreviewView } from "@/lib/preview";

export const metadata: Metadata = { title: "Design preview", robots: { index: false, follow: false } };

export default async function PreviewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!isPreviewEnabled() || !isPreviewView(view)) notFound();
  const store = await cookies();
  return <PreviewApp view={view} initialSidebar={toSidebarState(store.get(SIDEBAR_COOKIE)?.value)} />;
}
