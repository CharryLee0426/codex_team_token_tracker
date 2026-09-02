"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Logo } from "./logo";
import { LanguageSwitcher } from "./language-switcher";
import { LaunchLink } from "@/components/landing/launch-link";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Marketing / auth header: transparent over the hero, frosted once the page scrolls. */
export function SiteHeader() {
  const t = useTranslations("common");
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={cn("fixed inset-x-0 top-0 z-40 border-b transition-[background-color,border-color] duration-300", scrolled ? "glass border-border" : "border-transparent")}>
      <div className="mx-auto flex h-[var(--header-h)] max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageSwitcher className="hidden sm:grid" />
          <SignedOut>
            <Link href="/sign-in" className={buttonClasses("ghost", "sm")}>
              {t("signIn")}
            </Link>
            <LaunchLink href="/sign-up" className={buttonClasses("primary", "sm")}>
              {t("signUp")}
            </LaunchLink>
          </SignedOut>
          <SignedIn>
            <LaunchLink href="/dashboard" className={buttonClasses("primary", "sm")}>
              {t("openDashboard")}
            </LaunchLink>
            <UserButton appearance={{ elements: { userButtonAvatarBox: "h-8 w-8 ring-1 ring-border" } }} />
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
