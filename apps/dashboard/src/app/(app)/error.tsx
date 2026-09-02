"use client";

import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <Card className="mx-auto max-w-lg p-6 text-center">
      <span className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[rgba(208,59,59,0.12)] text-danger">
        <TriangleAlert size={18} />
      </span>
      <h1 className="text-base font-semibold text-fg">{t("title")}</h1>
      <p className="mt-2 text-sm text-fg-2">{t("body")}</p>
      {error?.message ? <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-card-2 px-3 py-2 text-left font-mono text-xs text-muted">{error.message}</pre> : null}
      <Button className="mt-4" variant="primary" onClick={reset}>
        {t("retry")}
      </Button>
    </Card>
  );
}
