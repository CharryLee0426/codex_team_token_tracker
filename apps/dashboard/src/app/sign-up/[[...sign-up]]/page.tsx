import type { Metadata } from "next";
import { SignUp } from "@clerk/nextjs";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";
import { authAppearance } from "@/components/auth/appearance";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signUpTitle") };
}

export default async function SignUpPage() {
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");
  return (
    <AuthShell eyebrow={tc("appName")} title={t("signUpHeadline")} lead={t("signUpLead")}>
      <SignUp appearance={authAppearance} />
    </AuthShell>
  );
}
