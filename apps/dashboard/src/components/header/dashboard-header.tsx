"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Settings } from "lucide-react";
import { Logo } from "./logo";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/dashboard/personal", key: "personal" },
  { href: "/dashboard/team", key: "team" },
  { href: "/dashboard/members", key: "members" },
  { href: "/dashboard/devices", key: "devices" },
] as const;

export function DashboardHeader() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-4 min-w-0">
          <Logo href="/dashboard/personal" />
          <nav className="hidden md:flex items-center gap-1" aria-label="Dashboard">
            {tabs.map((tab) => {
              const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    active ? "bg-accent-soft text-accent font-medium" : "text-fg-2 hover:text-fg hover:bg-card-2",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {t(tab.key)}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <OrganizationSwitcher
            hidePersonal={false}
            afterSelectOrganizationUrl="/dashboard/team"
            afterCreateOrganizationUrl="/dashboard/team"
            afterSelectPersonalUrl="/dashboard/personal"
            appearance={{ elements: { rootBox: "hidden sm:block", organizationSwitcherTrigger: "h-8 rounded-lg border border-border bg-card px-2" } }}
          />
          <LanguageSwitcher className="hidden sm:inline-flex" />
          <ThemeToggle />
          <Link href="/settings" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-fg-2 hover:text-fg" title={t("settings")}>
            <Settings size={15} />
          </Link>
          <UserButton />
        </div>
      </div>
      <nav className="md:hidden flex items-center gap-1 overflow-x-auto px-3 pb-2 scrollbar-thin" aria-label="Dashboard">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn("rounded-md px-2.5 py-1 text-sm whitespace-nowrap", active ? "bg-accent-soft text-accent font-medium" : "text-fg-2")}
            >
              {t(tab.key)}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
