"use client";

import dynamic from "next/dynamic";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { useInView } from "@/hooks/use-in-view";
import { LogoMark } from "@/components/header/logo";
import { buttonClasses } from "@/components/ui/button";
import { Reveal } from "@/components/ui/reveal";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { LaunchLink } from "./launch-link";

// The board pulls in the chart bundle; load it on the client once the section is near.
const DemoBoard = dynamic(() => import("./demo-board").then((m) => m.DemoBoard), {
  ssr: false,
  loading: () => (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className={cn("h-24", i === 0 && "col-span-2")} />
        ))}
      </div>
      <Skeleton className="h-72" />
      <Skeleton className="h-40" />
    </div>
  ),
});

/** The product itself, framed like a window and flattening out of perspective as it scrolls in. */
export function ProductPreview() {
  const t = useTranslations("landing");
  const tc = useTranslations("common");
  const [frameRef, inView] = useInView<HTMLDivElement>({ threshold: 0.12, rootMargin: "0px 0px -5% 0px" });
  const [nearRef, near] = useInView<HTMLDivElement>({ threshold: 0, rootMargin: "600px 0px" });

  return (
    <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6" ref={nearRef}>
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">{t("previewEyebrow")}</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg md:text-4xl">{t("previewTitle")}</h2>
        <p className="mt-4 text-sm text-fg-2 sm:text-base">{t("previewBody")}</p>
      </Reveal>

      <div ref={frameRef} className={cn("tilt-frame mt-12", inView && "is-visible")}>
        <div className="overflow-hidden rounded-2xl border border-border-strong bg-bg shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]">
          <div className="flex items-center gap-3 border-b border-border bg-bg-2/80 px-4 py-2.5">
            <span className="flex gap-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-[rgba(148,163,196,0.35)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[rgba(148,163,196,0.25)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[rgba(148,163,196,0.15)]" />
            </span>
            <span className="mx-auto flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1 font-mono text-[11px] text-muted">
              <LogoMark size={14} />
              codex-tracker / dashboard / team
            </span>
          </div>
          <div className="p-3 sm:p-5">{near ? <DemoBoard /> : <Skeleton className="h-[520px]" />}</div>
        </div>
      </div>

      <div className="mt-10 flex justify-center">
        <SignedOut>
          <LaunchLink href="/sign-up" className={buttonClasses("glow", "lg")}>
            {t("previewCta")}
          </LaunchLink>
        </SignedOut>
        <SignedIn>
          <LaunchLink href="/dashboard" className={buttonClasses("glow", "lg")}>
            {tc("openDashboard")}
          </LaunchLink>
        </SignedIn>
      </div>
    </section>
  );
}
