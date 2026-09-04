"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label?: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
}

interface Props<T extends string> {
  options: SegmentedOption<T>[];
  /** `null` = none of these is selected (a sibling control holds the choice): the pill hides. */
  value: T | null;
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: "sm" | "md";
  /** `radio` exposes a radiogroup (single choice), `group` exposes toggle buttons. */
  mode?: "radio" | "group";
  disabled?: boolean;
  className?: string;
}

/**
 * Equal-width segmented control with a sliding selection pill. Shared by the range picker, theme and
 * language switches and chart/table toggles so every "pick one" control looks and behaves the same.
 */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel, size = "sm", mode = "radio", disabled, className }: Props<T>) {
  const id = useId();
  const index = options.findIndex((o) => o.value === value);
  const selected = index >= 0;
  const n = options.length;

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (mode !== "radio") return;
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = options[selected ? (index + dir + n) % n : dir > 0 ? 0 : n - 1];
    onChange(next.value);
    const el = document.getElementById(`${id}-${next.value}`);
    el?.focus();
  }

  return (
    <div
      role={mode === "radio" ? "radiogroup" : "group"}
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn("relative grid rounded-lg border border-border bg-card p-0.5", className)}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute top-0.5 bottom-0.5 left-0.5 rounded-md bg-accent-soft transition-[transform,opacity] duration-300 ease-[var(--ease-out)]"
        style={{ width: `calc((100% - 4px) / ${n})`, transform: `translateX(${Math.max(0, index) * 100}%)`, opacity: selected ? 1 : 0 }}
      />
      {options.map((o, i) => {
        const active = o.value === value;
        // With nothing selected the first segment takes the tab stop so the group stays reachable.
        const tabStop = active || (!selected && i === 0);
        return (
          <button
            key={o.value}
            id={`${id}-${o.value}`}
            type="button"
            role={mode === "radio" ? "radio" : undefined}
            aria-checked={mode === "radio" ? active : undefined}
            aria-pressed={mode === "group" ? active : undefined}
            aria-label={o.label ? undefined : o.title}
            title={o.title}
            tabIndex={mode === "radio" ? (tabStop ? 0 : -1) : 0}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative z-10 inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors",
              size === "sm" ? "h-7 px-2 text-xs" : "h-9 px-3 text-[13px]",
              active ? "text-accent" : "text-fg-2 hover:text-fg",
              disabled && "opacity-60",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
