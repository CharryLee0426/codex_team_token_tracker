"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { dayKeyOf } from "@codex-tracker/shared/time";
import { fmtDayOfMonth, fmtMonth, fmtYear } from "@/lib/format";
import { clamp } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const WHEEL_ROW = 36;
const VISIBLE_ROWS = 5;
const SETTLE_MS = 120;

export interface WheelItem {
  value: number;
  label: string;
  /** Rendered dimmed; picking it still fires onChange (the owner clamps). */
  disabled?: boolean;
}

interface WheelProps {
  items: WheelItem[];
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  className?: string;
}

/**
 * One drum of an iOS-style picker: a snap-scrolling column whose centre row is the value. Momentum
 * and snapping are the browser's own, so on a phone it moves like the system control; the rows fade
 * toward the edges and the neighbours shrink a little to suggest the cylinder.
 */
export function Wheel({ items, value, onChange, ariaLabel, className }: WheelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const index = Math.max(0, items.findIndex((i) => i.value === value));
  const [centre, setCentre] = useState(index);
  const settle = useRef<number | null>(null);
  const mounted = useRef(false);

  // Bring the drum to the value whenever it changes from outside (or the list changes under it).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const top = index * WHEEL_ROW;
    if (Math.abs(el.scrollTop - top) >= 1) el.scrollTo({ top, behavior: mounted.current ? "smooth" : "auto" });
    setCentre(index);
    mounted.current = true;
  }, [index, items.length]);

  const indexAt = (el: HTMLDivElement) => clamp(Math.round(el.scrollTop / WHEEL_ROW), 0, items.length - 1);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setCentre(indexAt(el));
    if (settle.current) window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      const item = items[indexAt(el)];
      if (item && item.value !== value) onChange(item.value);
    }, SETTLE_MS);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = items[clamp(index + step, 0, items.length - 1)];
    if (next && next.value !== value) onChange(next.value);
  };

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={ariaLabel}
      tabIndex={0}
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      className={cn("wheel no-scrollbar relative snap-y snap-mandatory overflow-y-auto overscroll-contain", className)}
      style={{ height: VISIBLE_ROWS * WHEEL_ROW, paddingBlock: ((VISIBLE_ROWS - 1) / 2) * WHEEL_ROW }}
    >
      {items.map((it, i) => {
        const dist = Math.abs(i - centre);
        return (
          <div
            key={it.value}
            role="option"
            aria-selected={i === index}
            onClick={() => it.value !== value && onChange(it.value)}
            className={cn(
              "flex snap-center items-center justify-center text-[17px] tabular whitespace-nowrap transition-[color,opacity,transform] duration-150 select-none",
              dist === 0 ? "font-medium text-fg" : dist === 1 ? "scale-[0.94] text-fg-2 opacity-70" : "scale-[0.88] text-muted opacity-45",
              it.disabled && "opacity-25",
            )}
            style={{ height: WHEEL_ROW }}
          >
            {it.label}
          </div>
        );
      })}
    </div>
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

interface DateWheelsProps {
  /** Local day key. */
  value: string;
  onChange: (dayKey: string) => void;
  minKey: string;
  maxKey: string;
  className?: string;
}

/**
 * Month · day · year drums (year first in Chinese, as the language writes dates). A spin past the
 * allowed window snaps back to the nearest allowed day, the way the system picker does.
 */
export function DateWheels({ value, onChange, minKey, maxKey, className }: DateWheelsProps) {
  const locale = useLocale();
  const t = useTranslations("ranges");
  const [y, m, d] = value.split("-").map(Number);
  const minYear = Number(minKey.slice(0, 4));
  const maxYear = Number(maxKey.slice(0, 4));

  const years = useMemo(
    () => Array.from({ length: maxYear - minYear + 1 }, (_, i) => ({ value: minYear + i, label: fmtYear(minYear + i, locale) })),
    [minYear, maxYear, locale],
  );
  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const mo = i + 1;
        const disabled = dayKeyOf(y, mo, 1) > maxKey || dayKeyOf(y, mo, daysInMonth(y, mo)) < minKey;
        return { value: mo, label: fmtMonth(y, mo, locale), disabled };
      }),
    [y, minKey, maxKey, locale],
  );
  const days = useMemo(
    () =>
      Array.from({ length: daysInMonth(y, m) }, (_, i) => {
        const key = dayKeyOf(y, m, i + 1);
        return { value: i + 1, label: fmtDayOfMonth(i + 1, locale), disabled: key < minKey || key > maxKey };
      }),
    [y, m, minKey, maxKey, locale],
  );

  const set = (ny: number, nm: number, nd: number) => {
    let key = dayKeyOf(ny, nm, Math.min(nd, daysInMonth(ny, nm)));
    if (key < minKey) key = minKey;
    if (key > maxKey) key = maxKey;
    if (key !== value) onChange(key);
  };

  const wheels: Record<"year" | "month" | "day", React.ReactNode> = {
    year: <Wheel key="y" items={years} value={y} onChange={(v) => set(v, m, d)} ariaLabel={t("year")} />,
    month: <Wheel key="m" items={months} value={m} onChange={(v) => set(y, v, d)} ariaLabel={t("month")} />,
    day: <Wheel key="d" items={days} value={d} onChange={(v) => set(y, m, v)} ariaLabel={t("day")} />,
  };
  const order: Array<keyof typeof wheels> = locale === "zh" ? ["year", "month", "day"] : ["month", "day", "year"];

  return (
    <div className={cn("relative", className)}>
      {/* The selection band behind all three drums, like the system picker's centre row. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 rounded-lg bg-accent-soft" style={{ height: WHEEL_ROW, transform: "translateY(-50%)" }} />
      <div className="relative grid grid-cols-3">{order.map((k) => wheels[k])}</div>
    </div>
  );
}
