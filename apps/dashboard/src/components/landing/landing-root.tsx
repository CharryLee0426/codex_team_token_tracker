"use client";

import { useTranslations } from "next-intl";
import { useScene } from "@/components/scene/scene-provider";
import { cn } from "@/lib/utils";

/** Always-dark scope for the marketing pages; fades the content out while the scene warps into the app. */
export function LandingRoot({ children, className }: { children: React.ReactNode; className?: string }) {
  const { launching } = useScene();
  const t = useTranslations("landing");
  return (
    <div className={cn("landing-root dark min-h-dvh", launching && "is-launching", className)}>
      {children}
      <span className="sr-only" aria-live="polite">
        {launching ? t("launching") : ""}
      </span>
    </div>
  );
}
