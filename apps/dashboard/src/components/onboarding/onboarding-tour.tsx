"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { clamp } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { TOUR_PHASES, TOUR_STEPS, type TourStep } from "./steps";
import { HudCorners, TourArt } from "./tour-art";

export type TourCloseReason = "done" | "skip";

export interface OnboardingTourProps {
  open: boolean;
  onClose: (reason: TourCloseReason) => void;
  /** Commands for this dashboard (`trackerCommands(origin)`). */
  loginCommand: string;
  runCommand: string;
  userName?: string | null;
  /** Machines connected to the account — the final systems check reports it. */
  deviceCount?: number;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

type Side = "right" | "bottom" | "left" | "top";

const PHONE_QUERY = "(max-width: 767.98px)";
/** Breathing room between the spotlight ring and the element it frames. */
const SPOT_PAD = 6;
const CARD_GAP = 16;
const EDGE = 16;
/** How long to keep following a target after a step change (smooth scrolling into view). */
const FOLLOW_MS = 900;
/** Give a missing target this long to appear before falling back to a centered card. */
const WAIT_MS = 4000;

/**
 * The guided tour. A veil dims the page behind centered "briefing" cards; spotlight steps swap the
 * veil for a ring whose oversized shadow darkens everything except the `[data-tour]` element, and
 * dock a compact card beside it (a bottom sheet on phones). The only state that leaves this component
 * is `onClose` — persistence and the auto-open rule live in the controller.
 */
export function OnboardingTour({ open, onClose, loginCommand, runCommand, userName, deviceCount }: OnboardingTourProps) {
  const t = useTranslations("onboarding");
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const step = TOUR_STEPS[index];
  const total = TOUR_STEPS.length;
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const rect = useSpotlight(open ? step.target : undefined, reduced);
  const phone = useMediaQuery(PHONE_QUERY);
  const viewport = useViewport();
  const mode: "modal" | "spot" = step.target && rect ? "spot" : "modal";

  const next = useCallback(() => {
    if (index >= total - 1) onClose("done");
    else setIndex((i) => Math.min(total - 1, i + 1));
  }, [index, total, onClose]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);
  const skip = useCallback(() => onClose("skip"), [onClose]);

  // Keyboard: Esc skips, arrows move; Tab stays inside the card. Enter is left to the focused button.
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        skip();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      } else if (e.key === "Tab" && cardRef.current) {
        const focusable = Array.from(cardRef.current.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute("disabled"));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, next, back, skip]);

  // Focus the primary action on every step; give focus back to where it was when the tour closes.
  const primaryRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    return () => restoreRef.current?.focus?.();
  }, [open]);
  useEffect(() => {
    if (open) primaryRef.current?.focus({ preventScroll: true });
  }, [open, index, mode]);

  // Card geometry for docked cards: measured after render, re-placed whenever the target moves.
  const [cardSize, setCardSize] = useState({ w: 380, h: 240 });
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!open || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setCardSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, mode, index]);

  if (!open) return null;

  const isLast = index === total - 1;
  const remaining = String(total - 1 - index).padStart(2, "0");
  const stageNo = String(index + 1).padStart(2, "0");
  const totalNo = String(total).padStart(2, "0");
  const docked = mode === "spot" && !phone;
  const placed = docked && rect ? placeCard(rect, cardSize, step.placement ?? "right", viewport) : null;
  const spotStyle = rect
    ? { top: rect.top - SPOT_PAD, left: rect.left - SPOT_PAD, width: rect.width + SPOT_PAD * 2, height: rect.height + SPOT_PAD * 2 }
    : { top: viewport.h / 2, left: viewport.w / 2, width: 0, height: 0 };

  const header = (
    <div className="flex items-center justify-between gap-3">
      <p className="eyebrow flex items-center gap-2 text-accent">
        <span className="tabular">T-{remaining}</span>
        <span aria-hidden className="h-3 w-px bg-border-strong" />
        <span className="text-muted">{t("stage", { current: stageNo, total: totalNo })}</span>
        <span aria-hidden className="hidden h-3 w-px bg-border-strong sm:inline" />
        <span className="hidden text-muted sm:inline">{t(`phases.${step.phase}`)}</span>
      </p>
      {!isLast ? (
        <Button variant="ghost" size="sm" className="-mr-2 h-7 px-2 text-xs text-muted" onClick={skip} aria-label={t("skip")}>
          <X size={13} /> {t("skipShort")}
        </Button>
      ) : null}
    </div>
  );

  const progress = (
    <div className="tour-progress mt-3" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={index + 1} aria-label={t("stage", { current: stageNo, total: totalNo })}>
      {TOUR_STEPS.map((s, i) => (
        <span key={s.id} className={i < index ? "done" : i === index ? "current" : undefined} />
      ))}
    </div>
  );

  const footer = (
    <div className="mt-5 flex items-center justify-between gap-3">
      {mode === "modal" ? <p className="eyebrow hidden text-[10px] md:block">{t("escHint")}</p> : null}
      <div className="ml-auto flex items-center gap-2">
        {index > 0 ? (
          <Button variant="secondary" size="sm" onClick={back}>
            <ArrowLeft size={14} /> {t("back")}
          </Button>
        ) : null}
        <Button ref={primaryRef} variant={mode === "modal" ? "glow" : "primary"} size="sm" onClick={next}>
          {isLast ? t("finish") : index === 0 ? t("start") : t("next")}
          {isLast ? <Check size={14} /> : <ArrowRight size={14} />}
        </Button>
      </div>
    </div>
  );

  const rich = { code: (chunks: React.ReactNode) => <code className="rounded bg-card-2 px-1 py-px font-mono text-[0.92em] text-fg">{chunks}</code> };
  const title = step.id === "welcome" ? (userName ? t("steps.welcome.title", { name: userName.split(/\s+/)[0] }) : t("steps.welcome.titleAnon")) : t(`steps.${step.id}.title`);

  return (
    <div className="fixed inset-0 z-[100]" data-tour-open>
      {/* Blocks the page while the tour is up; the ring below only *looks* like a hole. */}
      <div className="absolute inset-0" aria-hidden />
      <div className="tour-veil" style={{ opacity: mode === "modal" ? 1 : 0 }} aria-hidden />
      <div className="tour-spot" style={{ ...spotStyle, opacity: mode === "spot" ? 1 : 0 }} aria-hidden />

      <div className={cn("pointer-events-none absolute inset-0", mode === "modal" && "flex items-center justify-center p-3 sm:p-6")}>
        <section
          ref={cardRef}
          key={`${mode}-${docked ? "dock" : "sheet"}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          className={cn(
            "tour-card pointer-events-auto",
            mode === "modal" && "auth-aperture w-full max-w-[920px]",
            mode === "spot" && !docked && "fixed inset-x-3 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+12px)] md:inset-x-auto",
            docked && "tour-docked fixed w-[380px] max-w-[calc(100vw-32px)]",
          )}
          style={placed ? { top: placed.top, left: placed.left } : undefined}
        >
          {mode === "modal" ? (
            <div className="auth-aperture-inner">
              <HudCorners radius={22} />
              <div className="relative z-[1] grid max-h-[calc(100dvh-24px)] min-w-0 overflow-y-auto scrollbar-thin sm:max-h-[calc(100dvh-48px)] md:grid-cols-[220px_minmax(0,1fr)]">
                <Timeline current={step} index={index} />
                <div className="min-w-0 p-5 sm:p-7" key={step.id}>
                  {header}
                  {progress}
                  {step.art ? (
                    <div className="page-enter mt-5">
                      <TourArt kind={step.art} loginCommand={loginCommand} runCommand={runCommand} userName={userName} deviceCount={deviceCount} />
                    </div>
                  ) : null}
                  <div className="page-enter" style={{ animationDelay: "80ms" }}>
                    <h2 id={titleId} className="mt-5 text-[22px] font-semibold tracking-tight text-fg sm:text-2xl">
                      {title}
                    </h2>
                    <p id={bodyId} className="mt-2 max-w-prose text-sm leading-relaxed text-fg-2">
                      {t.rich(`steps.${step.id}.body`, rich)}
                    </p>
                    {step.id === "connect" ? (
                      <div className="mt-4">
                        <p className="eyebrow mb-1.5">{t("steps.connect.command")}</p>
                        <CodeBlock code={loginCommand} />
                      </div>
                    ) : null}
                    {step.id === "run" ? (
                      <div className="mt-4">
                        <CodeBlock code={runCommand} />
                        <p className="mt-2 text-xs text-muted">{t("steps.run.hint")}</p>
                      </div>
                    ) : null}
                    {step.id === "done" ? (
                      <p className="mt-3 text-xs text-muted">
                        {deviceCount && deviceCount > 0 ? t("steps.done.devicesSome", { count: deviceCount }) : t("steps.done.devicesNone")}
                        {" · "}
                        {t("replayHint")}
                      </p>
                    ) : null}
                  </div>
                  {footer}
                </div>
              </div>
            </div>
          ) : (
            <div className="surface relative p-4 sm:p-5" key={step.id}>
              <HudCorners radius={14} />
              {header}
              {progress}
              <div className="page-enter">
                <h2 id={titleId} className="mt-4 text-[17px] font-semibold tracking-tight text-fg">
                  {title}
                </h2>
                <p id={bodyId} className="mt-1.5 text-[13px] leading-relaxed text-fg-2">
                  {t.rich(`steps.${step.id}.body`, rich)}
                </p>
              </div>
              {footer}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Mission timeline for briefing cards: the five phases, with the current one lit. */
function Timeline({ current, index }: { current: TourStep; index: number }) {
  const t = useTranslations("onboarding");
  const phaseIndex = TOUR_PHASES.indexOf(current.phase);
  return (
    <aside className="relative hidden border-r border-border bg-bg-2/40 p-6 md:block" aria-hidden>
      <p className="eyebrow">{t("eyebrow")}</p>
      <ol className="relative mt-6 space-y-5">
        <span className="absolute top-2 bottom-2 left-[7px] w-px bg-border" />
        {TOUR_PHASES.map((phase, i) => {
          const state = i < phaseIndex ? "done" : i === phaseIndex ? "current" : "todo";
          const count = TOUR_STEPS.filter((s) => s.phase === phase).length;
          const first = TOUR_STEPS.findIndex((s) => s.phase === phase);
          const within = state === "current" ? index - first + 1 : 0;
          return (
            <li key={phase} className="relative flex items-start gap-3 pl-0">
              <span
                className={cn(
                  "relative z-10 mt-0.5 inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full border bg-bg",
                  state === "done" && "border-accent bg-accent text-accent-fg",
                  state === "current" && "border-accent text-accent shadow-[0_0_0_4px_var(--accent-soft)]",
                  state === "todo" && "border-border-strong",
                )}
              >
                {state === "done" ? <Check size={9} strokeWidth={3} /> : state === "current" ? <span className="h-1.5 w-1.5 rounded-full bg-accent" /> : null}
              </span>
              <span className="min-w-0">
                <span className={cn("block text-[13px] font-medium", state === "current" ? "text-fg" : state === "done" ? "text-fg-2" : "text-muted")}>{t(`phases.${phase}`)}</span>
                <span className="eyebrow mt-0.5 block text-[9.5px]">
                  {String(i + 1).padStart(2, "0")}
                  {count > 1 && state === "current" ? ` · ${within}/${count}` : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/* ------------------------------------------------------------------------------------ geometry */

function findTarget(name: string): HTMLElement | null {
  // The rail and the phone tab bar carry the same names; take whichever is actually laid out.
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** Tracks the spotlight target's viewport rect: into view first, then follows scroll and resizes. */
function useSpotlight(target: string | undefined, reduced: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  useEffect(() => {
    if (!target) {
      setRect(null);
      return;
    }
    let el = findTarget(target);
    let raf = 0;
    const measure = () => {
      if (!el || !el.isConnected) el = findTarget(target);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev && Math.abs(prev.top - r.top) < 0.5 && Math.abs(prev.left - r.left) < 0.5 && Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
    };
    el?.scrollIntoView({ block: "center", inline: "nearest", behavior: reduced ? "auto" : "smooth" });
    const started = performance.now();
    // Follow while the page scrolls the target into view; keep looking a while longer for a target
    // that has not rendered yet (the board's header mounts a beat after the shell).
    const follow = () => {
      measure();
      const elapsed = performance.now() - started;
      if (elapsed < FOLLOW_MS || (!el && elapsed < WAIT_MS)) raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);
    window.addEventListener("scroll", measure, { capture: true, passive: true });
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" && el ? new ResizeObserver(measure) : null;
    if (el) ro?.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, [target, reduced]);
  return rect;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const sync = () => setMatches(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

function useViewport(): { w: number; h: number } {
  const [size, setSize] = useState({ w: 1280, h: 800 });
  useEffect(() => {
    const sync = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);
  return size;
}

/** First side (preferred, then the rest) where the card fits; clamped to the viewport with a margin. */
function placeCard(target: Rect, card: { w: number; h: number }, preferred: Side, vp: { w: number; h: number }): { top: number; left: number; side: Side | "center" } {
  const order: Side[] = [preferred, ...(["right", "bottom", "left", "top"] as Side[]).filter((s) => s !== preferred)];
  for (const side of order) {
    let top: number;
    let left: number;
    if (side === "right") {
      left = target.left + target.width + CARD_GAP;
      top = target.top + target.height / 2 - card.h / 2;
      if (left + card.w > vp.w - EDGE) continue;
    } else if (side === "left") {
      left = target.left - CARD_GAP - card.w;
      top = target.top + target.height / 2 - card.h / 2;
      if (left < EDGE) continue;
    } else if (side === "bottom") {
      top = target.top + target.height + CARD_GAP;
      left = target.left + target.width / 2 - card.w / 2;
      if (top + card.h > vp.h - EDGE) continue;
    } else {
      top = target.top - CARD_GAP - card.h;
      left = target.left + target.width / 2 - card.w / 2;
      if (top < EDGE) continue;
    }
    return { top: clamp(top, EDGE, Math.max(EDGE, vp.h - EDGE - card.h)), left: clamp(left, EDGE, Math.max(EDGE, vp.w - EDGE - card.w)), side };
  }
  return { top: Math.max(EDGE, (vp.h - card.h) / 2), left: Math.max(EDGE, (vp.w - card.w) / 2), side: "center" };
}
