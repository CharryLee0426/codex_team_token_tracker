"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/header/logo";
import { LanguageSwitcher } from "@/components/header/language-switcher";
import { ThemeToggle } from "@/components/header/theme-toggle";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { ConnectionStatus } from "./connection-status";
import { PRIMARY_NAV, SETTINGS_NAV, defaultHrefFor, isSegmentActive, type NavItem, type NavSegment } from "./nav-items";

interface AppShellProps {
  children: React.ReactNode;
  /** Route builder for nav items; the design-preview harness points it at `/preview/*`. */
  hrefFor?: (segment: NavSegment) => string;
  /** Replace Clerk's account controls with static placeholders (no session). */
  demo?: boolean;
  /** Optional banner rendered between the top bar and the page. */
  banner?: React.ReactNode;
}

/**
 * Dashboard chrome: a left rail on desktop (icon-only from `md`, labelled from `xl`), a glass top bar,
 * and a bottom tab bar on phones. The page area scrolls with the document so the browser chrome behaves.
 */
export function AppShell({ children, hrefFor = defaultHrefFor, demo = false, banner }: AppShellProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const homeHref = hrefFor("personal");

  const renderRailLink = (item: NavItem) => {
    const href = hrefFor(item.segment);
    const active = isSegmentActive(pathname, href);
    return (
      <Link
        key={item.segment}
        href={href}
        aria-current={active ? "page" : undefined}
        title={t(item.key)}
        className={cn(
          "group relative flex h-11 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition-colors xl:pr-4",
          active ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-card-2 hover:text-fg",
        )}
      >
        <span
          aria-hidden
          className={cn("absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-accent transition-opacity", active ? "opacity-100" : "opacity-0")}
        />
        <item.Icon size={18} className="shrink-0" />
        <span className="hidden truncate xl:inline">{t(item.key)}</span>
      </Link>
    );
  };

  return (
    <div className="flex min-h-dvh">
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[68px] flex-col border-r border-border bg-bg-2/70 backdrop-blur-xl md:flex xl:w-[232px]" aria-label={t("dashboard")}>
        <div className="flex h-[var(--header-h)] items-center px-4 xl:px-5">
          <Logo href={homeHref} compact className="xl:hidden" />
          <Logo href={homeHref} className="hidden xl:inline-flex" />
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2.5 pt-2 xl:px-3">{PRIMARY_NAV.map(renderRailLink)}</nav>
        <div className="flex flex-col gap-1 px-2.5 pb-4 xl:px-3">
          {renderRailLink(SETTINGS_NAV)}
          <ConnectionStatus compact className="h-9 justify-center xl:hidden" />
          <ConnectionStatus className="hidden h-9 px-3 xl:flex" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col md:pl-[68px] xl:pl-[232px]">
        {/* Top bar */}
        <header className="glass sticky top-0 z-20 border-b border-border">
          <div className="mx-auto flex h-[var(--header-h)] w-full max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Logo href={homeHref} compact className="md:hidden" />
              {demo ? (
                <span className="hidden items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-fg-2 sm:inline-flex">
                  <span className="h-4 w-4 rounded bg-accent-soft" aria-hidden />
                  Orbital Labs
                </span>
              ) : (
                <OrganizationSwitcher
                  hidePersonal={false}
                  afterSelectOrganizationUrl="/dashboard/team"
                  afterCreateOrganizationUrl="/dashboard/team"
                  afterSelectPersonalUrl="/dashboard/personal"
                  appearance={{
                    elements: {
                      rootBox: "hidden sm:block",
                      organizationSwitcherTrigger: "h-8 rounded-lg border border-border bg-card px-2 text-fg hover:bg-card-2",
                    },
                  }}
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              <LanguageSwitcher className="hidden sm:grid" />
              <ThemeToggle />
              {demo ? <Avatar name="Demo User" size={30} /> : <UserButton appearance={{ elements: { userButtonAvatarBox: "h-8 w-8 ring-1 ring-border" } }} />}
            </div>
          </div>
        </header>

        {banner}

        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-4 pb-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+20px)] sm:px-6 md:pt-6 md:pb-10">
          {children}
        </main>
      </div>

      {/* Phone tab bar */}
      <nav className="glass fixed inset-x-0 bottom-0 z-30 border-t border-border safe-bottom md:hidden" aria-label={t("dashboard")}>
        <ul className="grid h-[var(--tabbar-h)] grid-cols-5">
          {[...PRIMARY_NAV, SETTINGS_NAV].map((item) => {
            const href = hrefFor(item.segment);
            const active = isSegmentActive(pathname, href);
            return (
              <li key={item.segment} className="min-w-0">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn("relative flex h-full flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors", active ? "text-accent" : "text-muted")}
                >
                  <span aria-hidden className={cn("absolute top-0 h-0.5 w-8 rounded-b bg-accent transition-opacity", active ? "opacity-100" : "opacity-0")} />
                  <item.Icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                  <span className="truncate px-1">{t(item.key)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
