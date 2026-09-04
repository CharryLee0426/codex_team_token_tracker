"use client";

import { useLocale, useTranslations } from "next-intl";
import { CalendarRange, Rocket } from "lucide-react";
import { localDayKey } from "@codex-tracker/shared/time";
import { PRESET_KEYS, TEAM_PLAN_START_MS, TEAM_PLAN_TIME_ZONE, normalizeCustom, rangeBounds, type PresetKey, type RangeSelection } from "@/lib/ranges";
import { fmtInstantIn } from "@/lib/format";
import { Segmented } from "@/components/ui/segmented";
import { DayRangePicker } from "./day-range-picker";
import { cn } from "@/lib/utils";

interface Props {
  value: RangeSelection;
  onChange: (next: RangeSelection) => void;
  nowMs: number;
  className?: string;
}

/**
 * The one filter row: trailing presets, "since the team plan started" and a custom day range — every
 * card below follows it. Custom mode adds the start/end picker; the plan mode a caption with its start.
 * Full width on phones, right-aligned on desktop.
 */
export function RangeControl({ value, onChange, nowMs, className }: Props) {
  const t = useTranslations("ranges");
  const locale = useLocale();
  const todayKey = localDayKey(nowMs);
  const bounds = rangeBounds(value, nowMs);
  const preset: PresetKey | null = value.key === "plan" || value.key === "custom" ? null : value.key;
  const custom = value.key === "custom" ? bounds : null;
  const planStart = fmtInstantIn(TEAM_PLAN_START_MS, TEAM_PLAN_TIME_ZONE, locale);

  const setCustom = (fromKey: string, toKey: string) => onChange({ key: "custom", ...normalizeCustom(fromKey, toKey, todayKey) });

  return (
    <div role="group" aria-label={t("label")} className={cn("flex w-full flex-col gap-2 md:w-auto md:items-end", className)}>
      <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
        <Segmented
          options={PRESET_KEYS.map((k) => ({ value: k, label: t(k) }))}
          value={preset}
          onChange={(k) => onChange({ key: k })}
          ariaLabel={t("presets")}
          size="md"
          className="w-full md:w-auto md:min-w-[380px]"
        />
        {/* One unit, so on narrow screens both buttons wrap under the presets together. */}
        <div className="flex items-center gap-2">
          <ToggleButton active={value.key === "plan"} title={t("planHint", { date: planStart })} onClick={() => onChange({ key: "plan" })}>
            <Rocket size={14} />
            {t("plan")}
          </ToggleButton>
          <ToggleButton active={!!custom} title={t("customHint")} onClick={() => !custom && setCustom(bounds.fromKey, bounds.toKey)}>
            <CalendarRange size={14} />
            {t("custom")}
          </ToggleButton>
        </div>
      </div>

      {custom ? (
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
          <DayRangePicker fromKey={custom.fromKey} toKey={custom.toKey} todayKey={todayKey} onChange={setCustom} />
          <span className="tabular text-xs text-muted">{t("days", { count: custom.days })}</span>
        </div>
      ) : value.key === "plan" ? (
        <p className="tabular text-xs text-muted">{t("planSummary", { date: planStart, count: bounds.days })}</p>
      ) : null}
    </div>
  );
}

/** Same chrome as a segmented option, standing alone: border + card fill, accent pill when pressed. */
function ToggleButton({ active, className, ...props }: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap select-none transition-[background-color,border-color,color,transform] duration-200 active:scale-[0.98]",
        active ? "border-[color-mix(in_srgb,var(--accent)_35%,transparent)] bg-accent-soft text-accent" : "border-border bg-card text-fg-2 hover:bg-card-2 hover:text-fg",
        className,
      )}
      {...props}
    />
  );
}
