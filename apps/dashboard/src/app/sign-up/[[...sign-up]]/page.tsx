import { SignUp } from "@clerk/nextjs";
import { getTranslations } from "next-intl/server";
import { SiteHeader } from "@/components/header/site-header";

export default async function SignUpPage() {
  const t = await getTranslations("auth");
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto flex max-w-6xl flex-col items-center px-4 py-12">
        <h1 className="mb-6 text-lg font-semibold text-fg">{t("signUpTitle")}</h1>
        <SignUp />
      </main>
    </div>
  );
}
