"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { formatTokens, formatUSD } from "@codex-tracker/shared/format";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { useScene } from "@/components/scene/scene-provider";
import { AnimatedValue } from "@/components/ui/animated-value";
import { Badge } from "@/components/ui/badge";
import { LiveDot } from "@/components/ui/live-dot";
import { Sparkline } from "@/components/ui/sparkline";
import { buttonClasses } from "@/components/ui/button";
import { LaunchLink } from "./launch-link";

export function Hero() {
  const t = useTranslations("landing");
  const tc = useTranslations("common");
  const { setFocus } = useScene();
  const focusRef = useRef<HTMLDivElement>(null);

  // Tell the scene where the constellation lives (page coordinates, so it rides with the hero).
  useEffect(() => {
    const el = focusRef.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      setFocus({ x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height });
    };
    report();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(report) : null;
    ro?.observe(el);
    window.addEventListener("resize", report);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", report);
      setFocus(null);
    };
  }, [setFocus]);

  return (
    <section className="relative">
      <div className="mx-auto grid min-h-[100svh] max-w-6xl items-center gap-10 px-4 pt-[calc(var(--header-h)+40px)] pb-20 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-6">
        <div className="launch-fade stagger relative z-10">
          <p className="eyebrow text-accent">{t("eyebrow")}</p>
          <h1 className="hero-title mt-4 text-fg">{t("title")}</h1>
          <p className="mt-5 max-w-xl text-base text-fg-2 sm:text-lg">{t("subtitle")}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <SignedOut>
              <LaunchLink href="/sign-up" className={buttonClasses("glow", "lg")}>
                {t("cta")}
              </LaunchLink>
              <Link href="/sign-in" className={buttonClasses("secondary", "lg")}>
                {tc("signIn")}
              </Link>
            </SignedOut>
            <SignedIn>
              <LaunchLink href="/dashboard" className={buttonClasses("glow", "lg")}>
                {tc("openDashboard")}
              </LaunchLink>
            </SignedIn>
          </div>
          <p className="eyebrow mt-8 text-[10px]">{t("trust")}</p>
        </div>

        <div ref={focusRef} className="launch-fade relative min-h-[300px] sm:min-h-[360px] lg:min-h-[540px]">
          <HeroHud />
        </div>
      </div>

      <a
        href="#telemetry"
        className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-1 text-muted transition-colors hover:text-fg md:flex"
        aria-label={t("scroll")}
      >
        <span className="eyebrow text-[10px]">{t("scroll")}</span>
        <ChevronDown size={16} className="bob" />
      </a>
    </section>
  );
}

const HISTORY = 24;

/** Floating telemetry card: a sample live session ticking along inside the constellation. */
function HeroHud() {
  const t = useTranslations("landing.hud");
  const tc = useTranslations("common");
  const reduced = useReducedMotion();
  const [rate, setRate] = useState(41.6);
  const [history, setHistory] = useState<number[]>(() => Array.from({ length: HISTORY }, (_, i) => 30 + 12 * Math.sin(i / 2.5) + (i % 3) * 2));

  useEffect(() => {
    if (reduced) return;
    let tick = 0;
    const id = window.setInterval(() => {
      tick++;
      const next = 34 + 10 * Math.sin(tick / 4) + 4 * Math.sin(tick / 1.7) + Math.random() * 3;
      setRate(next);
      setHistory((h) => [...h.slice(1), next]);
    }, 900);
    return () => window.clearInterval(id);
  }, [reduced]);

  return (
    <div className="glass absolute inset-x-0 bottom-4 mx-auto w-[min(300px,100%)] rounded-2xl border border-border p-4 shadow-2xl shadow-black/40 lg:inset-x-auto lg:right-0 lg:bottom-10">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{t("title")}</span>
        <Badge variant="success">
          <LiveDot size={6} /> {tc("live")}
        </Badge>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <div className="text-[30px] font-semibold leading-none tracking-tight text-fg">
            <AnimatedValue value={rate} format={(n) => n.toFixed(1)} duration={600} />
          </div>
          <div className="mt-1.5 text-xs text-muted">
            {t("rate")} · <span className="font-mono">gpt-5.5-codex</span>
          </div>
        </div>
        <Sparkline values={history} width={104} height={34} />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
        <div>
          <dt className="eyebrow text-[9.5px]">{t("devices")}</dt>
          <dd className="mt-1 text-sm font-semibold text-fg">3</dd>
        </div>
        <div>
          <dt className="eyebrow text-[9.5px]">{tc("cacheHit")}</dt>
          <dd className="mt-1 text-sm font-semibold text-fg">61%</dd>
        </div>
        <div>
          <dt className="eyebrow text-[9.5px]">{tc("today")}</dt>
          <dd className="mt-1 text-sm font-semibold text-fg">
            {formatTokens(1_842_000)} · {formatUSD(4.12)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
