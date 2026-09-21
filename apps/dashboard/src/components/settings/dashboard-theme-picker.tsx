"use client";

import { useId } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDashboardTheme } from "@/components/theme/dashboard-theme-provider";
import type { DashboardTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const themes = ["default", "tsushima"] as const satisfies readonly DashboardTheme[];

function MissionControlPreview() {
  return (
    <div
      className="relative h-full overflow-hidden bg-[#080c14]"
      style={{ backgroundImage: "radial-gradient(ellipse at 75% 15%, #17394e 0%, transparent 60%)" }}
    >
      <div className="absolute inset-y-3 left-4 w-5 rounded border border-[#314559] bg-[#101c2a]">
        <div className="mx-auto mt-2 size-2 rounded-full bg-[#5cc8ff]" />
        <div className="mx-auto mt-3 h-0.5 w-2 bg-[#557086]" />
        <div className="mx-auto mt-2 h-0.5 w-2 bg-[#557086]" />
        <div className="mx-auto mt-2 h-0.5 w-2 bg-[#557086]" />
      </div>
      <div className="absolute inset-y-3 right-4 left-12 flex flex-col gap-2">
        <div className="h-1 w-14 rounded bg-[#a7bbce]" />
        <div className="grid grid-cols-3 gap-1.5">
          {[0, 1, 2].map((index) => (
            <div key={index} className="rounded border border-[#314559] bg-[#101c2a] p-2">
              <div className="h-0.5 w-3 rounded bg-[#557086]" />
              <div className="mt-1.5 h-1 w-5 rounded bg-[#5cc8ff]" />
            </div>
          ))}
        </div>
        <div className="flex flex-1 items-end gap-1 rounded border border-[#314559] bg-[#101c2a] px-2 pt-2">
          {[28, 45, 38, 58, 42, 67, 55, 78, 64, 90, 72, 85].map((height, index) => (
            <span key={index} className="min-h-1 flex-1 rounded-t-sm bg-[#5cc8ff]/75" style={{ height: `${height}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function DashboardThemePicker() {
  const t = useTranslations("settings.visualTheme");
  const { theme, setTheme, mounted } = useDashboardTheme();
  const id = useId();

  return (
    <fieldset disabled={!mounted} aria-describedby={`${id}-hint`} className="min-w-0">
      <legend className="mb-2.5 text-xs font-medium text-fg-2">{t("label")}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {themes.map((option) => {
          const selected = theme === option;
          return (
            <label key={option} className={cn("relative min-w-0", mounted ? "cursor-pointer" : "cursor-wait")}>
              <input
                type="radio"
                name={`${id}-theme`}
                value={option}
                checked={selected}
                onChange={() => setTheme(option)}
                aria-labelledby={`${id}-${option}-title`}
                aria-describedby={`${id}-${option}-description`}
                className="peer sr-only"
              />
              <div
                className={cn(
                  "h-full overflow-hidden rounded-xl border bg-card transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent peer-disabled:opacity-60",
                  selected ? "border-accent ring-1 ring-accent" : "border-border hover:border-border-strong",
                )}
              >
                <div aria-hidden="true" className="relative aspect-[5/2] overflow-hidden border-b border-border">
                  {option === "default" ? <MissionControlPreview /> : (
                    <img
                      src="/themes/tsushima/preview.webp"
                      alt=""
                      width={480}
                      height={270}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  )}
                  {selected ? (
                    <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-accent px-2 py-1 text-[10px] font-semibold text-accent-fg shadow-sm">
                      <Check size={11} strokeWidth={2.5} /> {t("selected")}
                    </span>
                  ) : null}
                </div>
                <div className="p-3">
                  <span id={`${id}-${option}-title`} className="block text-[13px] font-semibold text-fg">{t(`${option}.title`)}</span>
                  <span id={`${id}-${option}-description`} className="mt-1 block text-xs leading-relaxed text-muted">{t(`${option}.description`)}</span>
                </div>
              </div>
            </label>
          );
        })}
      </div>
      <p id={`${id}-hint`} className="mt-3 text-xs leading-relaxed text-muted">{t("hint")}</p>
    </fieldset>
  );
}
