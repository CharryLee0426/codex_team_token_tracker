import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonClasses } from "@/components/ui/button";

export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-4 text-center">
      <p className="eyebrow mb-2">404</p>
      <h1 className="text-xl font-semibold tracking-tight text-fg">{t("notFoundTitle")}</h1>
      <p className="mt-2 text-sm text-fg-2">{t("notFoundBody")}</p>
      <Link href="/" className={buttonClasses("primary", "md", "mt-5")}>
        {t("home")}
      </Link>
    </main>
  );
}
