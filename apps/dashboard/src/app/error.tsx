"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold text-fg">{t("title")}</h1>
      <p className="mt-2 text-sm text-fg-2">{t("body")}</p>
      {error?.message ? <pre className="mt-3 max-w-full overflow-x-auto rounded-lg border border-border bg-card px-3 py-2 text-left text-xs text-muted">{error.message}</pre> : null}
      <Button className="mt-4" variant="primary" onClick={reset}>
        {t("retry")}
      </Button>
    </main>
  );
}
