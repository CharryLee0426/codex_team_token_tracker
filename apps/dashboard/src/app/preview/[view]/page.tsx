import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PreviewApp } from "@/components/preview/preview-app";
import { isPreviewEnabled, isPreviewView } from "@/lib/preview";

export const metadata: Metadata = { title: "Design preview", robots: { index: false, follow: false } };

export default async function PreviewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!isPreviewEnabled() || !isPreviewView(view)) notFound();
  return <PreviewApp view={view} />;
}
