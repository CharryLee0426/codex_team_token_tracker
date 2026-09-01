import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonClasses } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <h1 className="text-lg font-semibold text-fg">{t("notFoundTitle")}</h1>
      <p className="mt-2 text-sm text-fg-2">{t("notFoundBody")}</p>
      <Link href="/" className={buttonClasses("primary", "md", "mt-4")}>
        {t("home")}
      </Link>
    </main>
  );
}
