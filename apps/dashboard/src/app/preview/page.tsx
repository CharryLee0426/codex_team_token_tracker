import { notFound, redirect } from "next/navigation";
import { isPreviewEnabled } from "@/lib/preview";

export default function PreviewIndex() {
  if (!isPreviewEnabled()) notFound();
  redirect("/preview/personal");
}
