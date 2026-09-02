"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <p className="eyebrow mb-2">Error</p>
      <h1 className="text-xl font-semibold tracking-tight text-fg">{t("title")}</h1>
      <p className="mt-2 text-sm text-fg-2">{t("body")}</p>
      {error?.message ? <pre className="mt-3 max-w-full overflow-x-auto rounded-lg border border-border bg-card px-3 py-2 text-left font-mono text-xs text-muted">{error.message}</pre> : null}
      <Button className="mt-5" variant="primary" onClick={reset}>
        {t("retry")}
      </Button>
    </main>
  );
}
