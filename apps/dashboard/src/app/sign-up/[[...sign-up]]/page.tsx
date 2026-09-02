import { SignUp } from "@clerk/nextjs";
import { getTranslations } from "next-intl/server";
import { AuthShell } from "@/components/auth/auth-shell";

export default async function SignUpPage() {
  const t = await getTranslations("auth");
  const tc = await getTranslations("common");
  return (
    <AuthShell eyebrow={tc("appName")} title={t("signUpTitle")}>
      <SignUp />
    </AuthShell>
  );
}
