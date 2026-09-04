"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { CalendarDays } from "lucide-react";
import { addLocalDays } from "@codex-tracker/shared/time";
import { MAX_CUSTOM_DAYS, spanDays } from "@/lib/ranges";
import { fmtDayKey, fmtDayKeyRange } from "@/lib/format";
import { useMediaQuery } from "@/hooks/use-media-query";
import { MonthCalendar } from "@/components/ui/calendar";
import { DateWheels } from "@/components/ui/wheel-picker";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type End = "from" | "to";

interface Props {
  fromKey: string;
  toKey: string;
  todayKey: string;
  /** Both ends after a pick; the caller normalises (order, today cap, longest span). */
  onChange: (fromKey: string, toKey: string) => void;
  className?: string;
}

const DATE: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

function monthOf(key: string): { y: number; m: number } {
  const [y, m] = key.split("-").map(Number);
  return { y, m };
}

/**
 * Start / end day fields in the segmented-control chrome. On a laptop they open a month calendar
 * popover with an accent band over the span; on a phone a bottom sheet with iOS-style drums. Every
 * pick applies at once, like the presets — picking a start moves on to the end, picking the end closes.
 */
export function DayRangePicker({ fromKey, toKey, todayKey, onChange, className }: Props) {
  const t = useTranslations("ranges");
  const tc = useTranslations("common");
  const locale = useLocale();
  const desktop = useMediaQuery("(min-width: 768px)", true);
  const [open, setOpen] = useState(false);
  const [end, setEnd] = useState<End>("from");
  const [view, setView] = useState(() => monthOf(fromKey));
  const rootRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const fromRef = useRef<HTMLButtonElement>(null);
  const toRef = useRef<HTMLButtonElement>(null);
  const minKey = addLocalDays(todayKey, -(MAX_CUSTOM_DAYS - 1));
  const active = end === "from" ? fromKey : toKey;

  const openFor = (which: End) => {
    setEnd(which);
    setView(monthOf(which === "from" ? fromKey : toKey));
    setOpen(true);
  };
  const close = useCallback(() => {
    setOpen(false);
    (end === "from" ? fromRef : toRef).current?.focus();
  }, [end]);

  // The other end gives way rather than refusing the pick, so the range can never invert.
  const pick = (key: string) => {
    if (end === "from") onChange(key, key > toKey ? key : toKey);
    else onChange(key < fromKey ? key : fromKey, key);
  };
  const pickOnCalendar = (key: string) => {
    pick(key);
    if (end === "from") setEnd("to");
    else close();
  };
  const switchEnd = (which: End) => {
    setEnd(which);
    setView(monthOf(which === "from" ? fromKey : toKey));
  };

  // Popover: click outside or Escape closes. Sheet: Escape closes, the page behind stops scrolling.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    const onPointer = (e: PointerEvent) => {
      if (desktop && rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    const body = document.body.style;
    const prevOverflow = body.overflow;
    if (!desktop) {
      body.overflow = "hidden";
      sheetRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
    }
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      body.overflow = prevOverflow;
    };
  }, [open, desktop, close]);

  const summary = (
    <p className="tabular flex items-center justify-between gap-3 text-xs text-muted">
      <span className="truncate">{fmtDayKeyRange(fromKey, toKey, locale)}</span>
      <span className="shrink-0">{t("days", { count: spanDays(fromKey, toKey) })}</span>
    </p>
  );
  const endSwitch = (className?: string) => (
    <Segmented<End>
      options={[
        { value: "from", label: t("from") },
        { value: "to", label: t("to") },
      ]}
      value={end}
      onChange={switchEnd}
      ariaLabel={t("customTitle")}
      className={className}
    />
  );

  const field = (which: End, ref: React.RefObject<HTMLButtonElement | null>) => {
    const key = which === "from" ? fromKey : toKey;
    const isOpen = open && end === which;
    return (
      <button
        ref={ref}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`${t(which)}: ${fmtDayKey(key, locale, DATE)}`}
        onClick={() => (isOpen ? close() : openFor(which))}
        className={cn(
          "tabular h-9 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
          isOpen ? "bg-accent-soft text-accent" : "text-fg hover:bg-card-2",
        )}
      >
        {fmtDayKey(key, locale, DATE)}
      </button>
    );
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="inline-flex h-10 items-center rounded-lg border border-border bg-card p-0.5 pl-2.5">
        <CalendarDays size={14} aria-hidden className="mr-1.5 shrink-0 text-muted" />
        {field("from", fromRef)}
        <span aria-hidden className="px-1 text-xs text-muted">
          {t("rangeJoin")}
        </span>
        {field("to", toRef)}
      </div>

      {open && desktop ? (
        <div
          role="dialog"
          aria-label={t("customTitle")}
          className="pop-in absolute top-[calc(100%+8px)] right-0 z-50 w-[276px] rounded-xl border border-border bg-bg-2/95 p-3 shadow-xl shadow-black/20 backdrop-blur-md"
        >
          {endSwitch()}
          <MonthCalendar
            className="mt-2"
            year={view.y}
            month={view.m}
            onMonthChange={(y, m) => setView({ y, m })}
            fromKey={fromKey}
            toKey={toKey}
            onPick={pickOnCalendar}
            todayKey={todayKey}
            minKey={minKey}
            maxKey={todayKey}
            anchorKey={active}
            autoFocus
          />
          <div className="mt-2 border-t border-border pt-2">{summary}</div>
        </div>
      ) : null}

      {open && !desktop && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[60]">
              <div className="fade-in absolute inset-0 bg-[var(--tour-dim)]" style={{ animationDuration: "0.25s" }} onClick={close} aria-hidden />
              <div
                ref={sheetRef}
                role="dialog"
                aria-modal="true"
                aria-label={t("customTitle")}
                className="sheet-up absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-border bg-bg-2 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-[0_-24px_60px_-30px_rgba(0,0,0,0.7)]"
              >
                <span aria-hidden className="mx-auto mb-3 block h-1 w-9 rounded-full bg-border-strong" />
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-fg">{t("customTitle")}</h2>
                  {endSwitch("min-w-[188px]")}
                </div>
                <DateWheels className="mt-3" value={active} onChange={pick} minKey={minKey} maxKey={todayKey} />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">{summary}</div>
                  <Button variant="primary" size="sm" onClick={close}>
                    {tc("done")}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
