import type { Metadata } from "next";
import { SignIn } from "@clerk/nextjs";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { authAppearance } from "@/components/auth/appearance";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signInTitle") };
}

export default async function SignInPage() {
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");
  return (
    <AuthShell eyebrow={tc("appName")} title={t("signInHeadline")} lead={t("signInLead")}>
      <SignIn appearance={authAppearance} />
    </AuthShell>
  );
}
