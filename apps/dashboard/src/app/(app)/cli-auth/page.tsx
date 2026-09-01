import type { Metadata } from "next";
import { Suspense } from "react";
import { CliAuthForm } from "@/components/cli-auth/cli-auth-form";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Connect device" };

export default function CliAuthPage() {
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-64 max-w-lg" />}>
      <CliAuthForm />
    </Suspense>
  );
}
