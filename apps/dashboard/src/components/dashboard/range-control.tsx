"use client";

import { useTranslations } from "next-intl";
import { RANGE_KEYS, type RangeKey } from "@/lib/ranges";
import { cn } from "@/lib/utils";

export function RangeControl({ value, onChange }: { value: RangeKey; onChange: (k: RangeKey) => void }) {
  const t = useTranslations("ranges");
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5" role="radiogroup">
      {RANGE_KEYS.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          className={cn(
            "h-7 rounded-md px-2.5 text-xs font-medium transition-colors whitespace-nowrap",
            value === k ? "bg-accent-soft text-accent" : "text-fg-2 hover:text-fg",
          )}
        >
          {t(k)}
        </button>
      ))}
    </div>
  );
}
