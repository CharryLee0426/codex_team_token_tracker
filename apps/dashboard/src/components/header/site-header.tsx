import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { getTranslations } from "next-intl/server";
import { Logo } from "./logo";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeToggle } from "./theme-toggle";
import { buttonClasses } from "@/components/ui/button";

export async function SiteHeader() {
  const t = await getTranslations("common");
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <Logo />
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          <SignedOut>
            <Link href="/sign-in" className={buttonClasses("ghost", "sm")}>
              {t("signIn")}
            </Link>
            <Link href="/sign-up" className={buttonClasses("primary", "sm")}>
              {t("signUp")}
            </Link>
          </SignedOut>
          <SignedIn>
            <Link href="/dashboard" className={buttonClasses("primary", "sm")}>
              {t("openDashboard")}
            </Link>
            <UserButton />
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
