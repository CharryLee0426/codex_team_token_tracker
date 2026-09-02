"use client";

import { useTranslations } from "next-intl";
import { Activity, ShieldCheck, Users } from "lucide-react";
import { SiteHeader } from "@/components/header/site-header";
import { LandingRoot } from "@/components/landing/landing-root";
import { LiveDot } from "@/components/ui/live-dot";
import { AuthAperture } from "./auth-aperture";

const HIGHLIGHTS = [
  { key: "live", Icon: Activity },
  { key: "team", Icon: Users },
  { key: "privacy", Icon: ShieldCheck },
] as const;

/**
 * Sign-in / sign-up / join frame. Two columns on desktop: the pitch on the left, the Clerk widget on
 * the right inside the aperture the canvas scene orbits. On narrow screens the form leads and the
 * pitch collapses to the highlight row beneath it.
 */
export function AuthShell({
  eyebrow,
  title,
  lead,
  aside,
  children,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  /** Replaces the highlight list, e.g. the invite summary on a join link. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("auth");

  return (
    <LandingRoot>
      <SiteHeader />
      <main className="mx-auto flex min-h-[100svh] max-w-6xl flex-col justify-center px-4 pt-[calc(var(--header-h)+32px)] pb-16 sm:px-6">
        <div className="grid items-center gap-10 lg:grid-cols-[1.02fr_minmax(0,420px)] lg:gap-14">
          {/* Pitch. Ordered after the form on mobile so the primary action is reachable first. */}
          <div className="page-enter order-2 lg:order-1">
            <p className="eyebrow text-accent">{eyebrow}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance text-fg sm:text-4xl lg:text-[42px] lg:leading-[1.08]">{title}</h1>
            {lead ? <p className="mt-4 max-w-md text-sm text-fg-2 sm:text-[15px]">{lead}</p> : null}

            {aside ?? (
              <ul className="stagger mt-8 grid gap-3 sm:max-w-md">
                {HIGHLIGHTS.map(({ key, Icon }) => (
                  <li key={key} className="flex items-start gap-3 rounded-xl border border-border/70 bg-[color-mix(in_srgb,var(--card)_45%,transparent)] px-3.5 py-3 backdrop-blur-sm">
                    <span className="mt-px inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <Icon size={14} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-fg">{t(`highlights.${key}.title`)}</span>
                      <span className="block text-xs text-muted">{t(`highlights.${key}.body`)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="eyebrow mt-7 flex items-center gap-2 text-[10px]">
              <LiveDot size={6} className="text-success" />
              {t("trust")}
            </p>
          </div>

          <div className="page-enter order-1 flex justify-center lg:order-2 lg:justify-end">
            <AuthAperture className="max-w-[420px]">{children}</AuthAperture>
          </div>
        </div>
      </main>
    </LandingRoot>
  );
}
