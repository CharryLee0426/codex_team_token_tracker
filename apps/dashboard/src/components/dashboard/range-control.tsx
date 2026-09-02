"use client";

import { useTranslations } from "next-intl";
import { RANGE_KEYS, type RangeKey } from "@/lib/ranges";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

/** The one filter row: date-range presets that scope every card below. Full width on phones. */
export function RangeControl({ value, onChange, className }: { value: RangeKey; onChange: (k: RangeKey) => void; className?: string }) {
  const t = useTranslations("ranges");
  return (
    <Segmented
      options={RANGE_KEYS.map((k) => ({ value: k, label: t(k) }))}
      value={value}
      onChange={onChange}
      ariaLabel={t("label")}
      size="md"
      className={cn("w-full md:w-auto md:min-w-[380px]", className)}
    />
  );
}
