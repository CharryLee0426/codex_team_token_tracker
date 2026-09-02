import { getTranslations } from "next-intl/server";
import { LogoMark } from "@/components/header/logo";

export async function LandingFooter() {
  const t = await getTranslations("landing");
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-xs text-muted sm:flex-row sm:px-6">
        <span className="flex items-center gap-2">
          <LogoMark size={20} />
          <span className="font-medium text-fg-2">Codex Tracker</span>
        </span>
        <span>{t("footer")}</span>
      </div>
    </footer>
  );
}
