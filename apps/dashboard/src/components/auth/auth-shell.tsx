import { SiteHeader } from "@/components/header/site-header";
import { LandingRoot } from "@/components/landing/landing-root";

/** Sign-in / sign-up frame: the dark scene, the marketing header and a centered Clerk card. */
export function AuthShell({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <LandingRoot>
      <SiteHeader />
      <main className="mx-auto flex min-h-[100svh] max-w-6xl flex-col items-center justify-center px-4 pt-[calc(var(--header-h)+24px)] pb-16 sm:px-6">
        <div className="page-enter flex flex-col items-center">
          <p className="eyebrow mb-3 text-accent">{eyebrow}</p>
          <h1 className="mb-7 text-center text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {children}
        </div>
      </main>
    </LandingRoot>
  );
}
