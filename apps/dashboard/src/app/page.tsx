import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { getTranslations } from "next-intl/server";
import { Activity, DollarSign, MonitorSmartphone, Users } from "lucide-react";
import { SiteHeader } from "@/components/header/site-header";
import { buttonClasses } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";

const features = [
  { key: "menubar", Icon: MonitorSmartphone },
  { key: "team", Icon: Users },
  { key: "realtime", Icon: Activity },
  { key: "cost", Icon: DollarSign },
] as const;

export default async function LandingPage() {
  const t = await getTranslations("landing");
  const tc = await getTranslations("common");
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4">
        <section className="py-16 md:py-24 grid gap-10 lg:grid-cols-[1.1fr_1fr] items-center">
          <div>
            <span className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-fg-2">{t("badge")}</span>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-fg md:text-5xl leading-[1.1]">{t("title")}</h1>
            <p className="mt-4 max-w-xl text-base text-fg-2 md:text-lg">{t("subtitle")}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <SignedOut>
                <Link href="/sign-up" className={buttonClasses("primary", "lg")}>
                  {t("cta")}
                </Link>
                <Link href="/sign-in" className={buttonClasses("secondary", "lg")}>
                  {tc("signIn")}
                </Link>
              </SignedOut>
              <SignedIn>
                <Link href="/dashboard" className={buttonClasses("primary", "lg")}>
                  {tc("openDashboard")}
                </Link>
              </SignedIn>
            </div>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{t("install")}</p>
            <div className="mt-2 space-y-2">
              <CodeBlock code={"npm i -g codex-token-tracker\ncodex-tracker login --dashboard https://your-dashboard.vercel.app\ncodex-tracker            # menu bar / tray app\ncodex-tracker agent      # headless (WSL2, servers)"} />
            </div>
            <p className="mt-3 text-xs text-muted">{t("installHint")}</p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {[
                ["12.4M", tc("tokens")],
                ["61%", tc("cacheHit")],
                ["$18.20", tc("cost")],
              ].map(([v, l]) => (
                <div key={l} className="rounded-lg border border-border bg-bg px-3 py-2">
                  <div className="text-lg font-semibold text-fg tabular">{v}</div>
                  <div className="text-[11px] text-muted">{l}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 pb-16">
          {features.map(({ key, Icon }) => (
            <div key={key} className="rounded-xl border border-border bg-card p-5">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon size={16} />
              </span>
              <h3 className="mt-3 text-sm font-semibold text-fg">{t(`features.${key}.title`)}</h3>
              <p className="mt-1 text-sm text-fg-2">{t(`features.${key}.body`)}</p>
            </div>
          ))}
        </section>

        <section className="pb-20">
          <h2 className="text-lg font-semibold text-fg">{t("howTitle")}</h2>
          <ol className="mt-4 grid gap-3 md:grid-cols-3">
            {(["1", "2", "3"] as const).map((n) => (
              <li key={n} className="rounded-xl border border-border bg-card p-5">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-accent text-accent-fg text-xs font-semibold">{n}</span>
                <p className="mt-3 text-sm text-fg-2">{t(`how.${n}`)}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="border-t border-border py-6 text-center text-xs text-muted">{t("footer")}</footer>
    </div>
  );
}
