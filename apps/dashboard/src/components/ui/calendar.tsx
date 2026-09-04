"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { addLocalDays, dayKeyOf, pad2 } from "@codex-tracker/shared/time";
import { fmtDayKey, fmtMonthYear } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Monday first, like the weekday charts. */
const WEEK_START = 1;
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const ROWS = 6;

interface Props {
  /** Month on view. */
  year: number;
  month: number; // 1-12
  onMonthChange: (year: number, month: number) => void;
  /** Selected range, inclusive local day keys (equal for a single day). */
  fromKey: string;
  toKey: string;
  onPick: (dayKey: string) => void;
  todayKey: string;
  /** Earliest / latest selectable days. */
  minKey: string;
  maxKey: string;
  /** Day the keyboard starts from (the end being edited). */
  anchorKey: string;
  autoFocus?: boolean;
  className?: string;
}

/** Six rows of seven so the grid never changes height; adjacent-month days are shown muted. */
function monthGrid(year: number, month: number): string[] {
  const offset = (new Date(year, month - 1, 1).getDay() - WEEK_START + 7) % 7;
  const start = addLocalDays(dayKeyOf(year, month, 1), -offset);
  return Array.from({ length: ROWS * 7 }, (_, i) => addLocalDays(start, i));
}

/**
 * One month of a range picker in the dashboard's own chrome: an accent band across the selected span,
 * filled ends, today in accent. Arrow keys walk the days (crossing months), Enter picks, PageUp/Down
 * turn the month.
 */
export function MonthCalendar({ year, month, onMonthChange, fromKey, toKey, onPick, todayKey, minKey, maxKey, anchorKey, autoFocus, className }: Props) {
  const locale = useLocale();
  const t = useTranslations("ranges");
  const tw = useTranslations("weekdays.short");
  const id = useId();
  const days = useMemo(() => monthGrid(year, month), [year, month]);
  const ym = `${year}-${pad2(month)}`;
  const firstOfMonth = dayKeyOf(year, month, 1);

  // Roving focus: one day is tabbable; it follows the anchor when the month on view contains it.
  const [focusKey, setFocusKey] = useState(anchorKey);
  const pendingFocus = useRef<string | null>(autoFocus ? anchorKey : null);
  useEffect(() => {
    if (!focusKey.startsWith(ym)) setFocusKey(anchorKey.startsWith(ym) ? anchorKey : firstOfMonth);
  }, [ym, anchorKey, firstOfMonth, focusKey]);
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    document.getElementById(`${id}-${key}`)?.focus();
  });

  const turn = (delta: number) => {
    const d = new Date(year, month - 1 + delta, 1);
    onMonthChange(d.getFullYear(), d.getMonth() + 1);
  };
  const prevDisabled = ym <= minKey.slice(0, 7);
  const nextDisabled = ym >= maxKey.slice(0, 7);

  const moveFocus = (key: string) => {
    if (key < minKey || key > maxKey) return;
    setFocusKey(key);
    pendingFocus.current = key;
    if (!key.startsWith(ym)) {
      const [y, m] = key.split("-").map(Number);
      onMonthChange(y, m);
    }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) {
      e.preventDefault();
      moveFocus(addLocalDays(focusKey, step[e.key]));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      if (e.key === "PageUp" ? !prevDisabled : !nextDisabled) turn(e.key === "PageUp" ? -1 : 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (focusKey >= minKey && focusKey <= maxKey) onPick(focusKey);
    }
  };

  const single = fromKey === toKey;
  const rows = Array.from({ length: ROWS }, (_, r) => days.slice(r * 7, r * 7 + 7));

  return (
    <div className={className}>
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon-sm" aria-label={t("prevMonth")} disabled={prevDisabled} onClick={() => turn(-1)}>
          <ChevronLeft size={15} />
        </Button>
        <span className="text-[13px] font-semibold text-fg" aria-live="polite">
          {fmtMonthYear(year, month, locale)}
        </span>
        <Button variant="ghost" size="icon-sm" aria-label={t("nextMonth")} disabled={nextDisabled} onClick={() => turn(1)}>
          <ChevronRight size={15} />
        </Button>
      </div>

      <div role="grid" aria-label={fmtMonthYear(year, month, locale)} className="mt-1" onKeyDown={onKeyDown}>
        <div role="row" className="grid grid-cols-7">
          {WEEKDAY_ORDER.map((wd) => (
            <div key={wd} role="columnheader" className="eyebrow flex h-7 items-center justify-center text-[10px]">
              {tw(String(wd))}
            </div>
          ))}
        </div>
        {rows.map((row, r) => (
          <div key={r} role="row" className="grid grid-cols-7">
            {row.map((key) => {
              const isFrom = key === fromKey;
              const isTo = key === toKey;
              const selected = isFrom || isTo;
              const inBand = !single && key >= fromKey && key <= toKey;
              const disabled = key < minKey || key > maxKey;
              const inMonth = key.startsWith(ym);
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  role="gridcell"
                  aria-selected={selected}
                  className={cn("flex h-9 w-9 items-center justify-center", inBand && "bg-accent-soft", inBand && isFrom && "rounded-l-md", inBand && isTo && "rounded-r-md")}
                >
                  <button
                    type="button"
                    id={`${id}-${key}`}
                    tabIndex={key === focusKey ? 0 : -1}
                    disabled={disabled}
                    aria-label={fmtDayKey(key, locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => onPick(key)}
                    onFocus={() => setFocusKey(key)}
                    className={cn(
                      "relative flex h-8 w-8 items-center justify-center rounded-md text-[13px] tabular transition-colors",
                      selected
                        ? "bg-accent font-semibold text-accent-fg"
                        : disabled
                          ? "cursor-default text-muted opacity-35"
                          : cn("hover:bg-card-2", isToday ? "font-semibold text-accent" : inMonth ? "text-fg" : "text-muted opacity-70"),
                    )}
                  >
                    {Number(key.slice(8))}
                    {isToday && !selected ? <span aria-hidden className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-accent" /> : null}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
