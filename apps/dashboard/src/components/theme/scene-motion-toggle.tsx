"use client";

import { useId } from "react";
import { Pause, Play } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useDashboardTheme } from "./dashboard-theme-provider";

export function SceneMotionToggle({ labels = false }: { labels?: boolean }) {
  const { theme, motion, setMotion, mounted } = useDashboardTheme();
  const reduced = useReducedMotion();
  const t = useTranslations("settings.backgroundMotion");
  const id = useId();
  if (theme !== "tsushima") return null;

  const enabled = motion && !reduced;
  const hint = t(reduced ? "reduced" : "hint");
  const action = t(enabled ? "pause" : "play");
  const Icon = enabled ? Pause : Play;
  const button = (
    <span title={reduced ? hint : action} className="inline-flex shrink-0">
      <Button
        variant="secondary"
        size={labels ? "sm" : "icon-sm"}
        aria-label={`${t("label")}: ${action}`}
        aria-describedby={`${id}-hint`}
        disabled={!mounted || reduced}
        onClick={() => setMotion(!motion)}
      >
        <Icon size={14} aria-hidden="true" />
        {labels ? action : null}
      </Button>
    </span>
  );

  if (!labels) {
    return (
      <>
        {button}
        <span id={`${id}-hint`} className="sr-only">{reduced ? hint : action}</span>
      </>
    );
  }

  return (
    <div className="border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="text-xs font-medium text-fg-2">{t("label")}</span>
        {button}
      </div>
      <p id={`${id}-hint`} className="mt-2 text-xs leading-relaxed text-muted">{hint}</p>
    </div>
  );
}
